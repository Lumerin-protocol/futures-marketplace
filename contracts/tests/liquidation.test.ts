import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Account, getAddress, parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { scaleHashprice } from "./utils.ts";
import type { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";
import type { NetworkConnection } from "hardhat/types";
import { network } from "hardhat";

const { viem, networkHelpers } = await network.getOrCreate();

async function positionWithMarginFixture(conn: NetworkConnection) {
  const { networkHelpers } = conn;
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { contracts, accounts, config } = data;
  const { futures, collateralVault } = contracts;
  const { seller, buyer, pc } = accounts;

  const entryPricePerDay = await futures.read.getMarketPrice();
  // Smaller margin so liquidation can be triggered.
  const margin = entryPricePerDay * 3n;
  const deliveryDate = config.deliveryDates[0];

  await collateralVault.write.deposit([margin], { account: seller.account });
  await collateralVault.write.deposit([margin], { account: buyer.account });

  await futures.write.createOrder([entryPricePerDay, deliveryDate, "", -1], {
    account: seller.account,
  });
  const matchTxHash = await futures.write.createOrder([entryPricePerDay, deliveryDate, "", 1], {
    account: buyer.account,
  });

  const receipt = await pc.waitForTransactionReceipt({ hash: matchTxHash });
  const positionCreatedEvents = parseEventLogs({
    logs: receipt.logs,
    abi: futures.abi,
    eventName: "LotCreated",
  });
  const positionId =
    positionCreatedEvents.length > 0 ? positionCreatedEvents[0].args.lotId : null;

  return {
    ...data,
    entryPricePerDay,
    margin,
    deliveryDate,
    positionId,
  };
}

type CollateralVaultContract = ContractReturnType<"CollateralVault">;

async function getMarginDeficit(
  pme: ContractReturnType<"PortfolioMarginEngine">,
  collateralVault: CollateralVaultContract,
  party: Account,
) {
  // Portfolio-IM driven deficit (signed). Positive = top-up required.
  const required = await pme.read.computePortfolioIM([party.address]);
  const balance = await collateralVault.read.balanceOf([party.address]);
  return BigInt(required) - BigInt(balance);
}

describe("Futures - Liquidation", function () {
  describe("Margin Call - Position Liquidation", function () {
    it("should liquidate buyer position when buyer is at loss and margin insufficient", async function () {
      const { contracts, accounts, entryPricePerDay, deliveryDate, positionId } =
        await networkHelpers.loadFixture(positionWithMarginFixture);
      const { futures, hashrateOracle, collateralVault } = contracts;
      const { seller, buyer, validator, pc } = accounts;

      const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
      const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);

      assert.notEqual(positionId, null);

      // Drop hashprice ~33% so margin becomes insufficient and buyer is at loss.
      await scaleHashprice(hashrateOracle, 100n, 150n);
      const newMarketPrice = await futures.read.getMarketPrice();
      assert.ok(newMarketPrice < entryPricePerDay);

      const buyerMmAfter = await contracts.portfolioMarginEngine.read.computePortfolioMM([
        buyer.account.address,
      ]);
      const buyerCollateralAfter = await collateralVault.read.balanceOf([buyer.account.address]);
      assert.ok(buyerCollateralAfter < buyerMmAfter, "buyer is below MM after price drop");

      const txHash = await futures.write.marginCall([buyer.account.address], {
        account: validator.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotClosed",
      });
      assert.equal(positionClosedEvents.length, 1);
      assert.equal(positionClosedEvents[0].args.lotId, positionId);

      const buyerPnL = (BigInt(newMarketPrice) - BigInt(entryPricePerDay)) * 7n;

      const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);
      const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);

      if (buyerPnL < 0n) {
        const expectedBuyerBalance = buyerBalanceBefore + buyerPnL;
        const tolerance = parseUnits("1", 6);
        const buyerDiff =
          buyerBalanceAfter > expectedBuyerBalance
            ? buyerBalanceAfter - expectedBuyerBalance
            : expectedBuyerBalance - buyerBalanceAfter;
        const sellerDiff =
          sellerBalanceAfter > sellerBalanceBefore - buyerPnL
            ? sellerBalanceAfter - (sellerBalanceBefore - buyerPnL)
            : sellerBalanceBefore - buyerPnL - sellerBalanceAfter;
        assert.ok(buyerDiff <= tolerance);
        assert.ok(sellerDiff <= tolerance);
      }
    });

    it("should liquidate seller position when seller is at loss and margin insufficient", async function () {
      const { contracts, accounts, entryPricePerDay, deliveryDate, positionId } =
        await networkHelpers.loadFixture(positionWithMarginFixture);
      const { futures, hashrateOracle, collateralVault } = contracts;
      const { seller, buyer, validator, pc } = accounts;

      const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
      const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);

      assert.notEqual(positionId, null);

      // Raise hashprice ~25% so seller is at loss.
      await scaleHashprice(hashrateOracle, 100n, 80n);
      const newMarketPrice = await futures.read.getMarketPrice();
      assert.ok(newMarketPrice > entryPricePerDay);

      const sellerMm = await contracts.portfolioMarginEngine.read.computePortfolioMM([
        seller.account.address,
      ]);
      const sellerCollateral = await collateralVault.read.balanceOf([seller.account.address]);
      assert.ok(sellerCollateral < sellerMm, "seller is below MM after price rise");

      const txHash = await futures.write.marginCall([seller.account.address], {
        account: validator.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotClosed",
      });
      assert.equal(positionClosedEvents.length, 1);
      assert.equal(positionClosedEvents[0].args.lotId, positionId);

      const buyerPnL = (BigInt(newMarketPrice) - BigInt(entryPricePerDay)) * 7n;

      const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
      const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);

      if (buyerPnL > 0n) {
        const tolerance = parseUnits("1", 6);
        const sellerDiff =
          sellerBalanceAfter > sellerBalanceBefore - buyerPnL
            ? sellerBalanceAfter - (sellerBalanceBefore - buyerPnL)
            : sellerBalanceBefore - buyerPnL - sellerBalanceAfter;
        const buyerDiff =
          buyerBalanceAfter > buyerBalanceBefore + buyerPnL
            ? buyerBalanceAfter - (buyerBalanceBefore + buyerPnL)
            : buyerBalanceBefore + buyerPnL - buyerBalanceAfter;
        assert.ok(sellerDiff <= tolerance);
        assert.ok(buyerDiff <= tolerance);
      }
    });

    it("should close orders first, then positions during margin call", async function () {
      const { contracts, accounts, entryPricePerDay, deliveryDate, config } =
        await networkHelpers.loadFixture(positionWithMarginFixture);
      const { futures, hashrateOracle, collateralVault } = contracts;
      const { buyer, validator, pc } = accounts;

      const marketPrice = await futures.read.getMarketPrice();
      const amount =
        ((marketPrice *
          BigInt(config.deliveryDurationDays) *
          BigInt(config.liquidationMarginPercent)) /
          100n) *
        2n;
      await collateralVault.write.deposit([amount], { account: buyer.account });

      const orderTx1 = await futures.write.createOrder([marketPrice, deliveryDate, "", 1], {
        account: buyer.account,
      });
      const orderTx2 = await futures.write.createOrder([marketPrice, deliveryDate, "", 1], {
        account: buyer.account,
      });
      const receipt1 = await pc.waitForTransactionReceipt({ hash: orderTx1 });
      const receipt2 = await pc.waitForTransactionReceipt({ hash: orderTx2 });
      const orders1 = parseEventLogs({
        logs: receipt1.logs,
        abi: futures.abi,
        eventName: "OrderCreated",
      });
      const orders2 = parseEventLogs({
        logs: receipt2.logs,
        abi: futures.abi,
        eventName: "OrderCreated",
      });
      assert.ok(orders1.length + orders2.length >= 2);

      // Move market price down to trigger margin call
      await scaleHashprice(hashrateOracle, 100n, 150n);

      const marginDeficit = await getMarginDeficit(contracts.portfolioMarginEngine, collateralVault, buyer.account);
      assert.ok(marginDeficit > 0n);

      const txHash = await futures.write.marginCall([buyer.account.address], {
        account: validator.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const orderClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "OrderClosed",
      });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotClosed",
      });

      assert.equal(orderClosedEvents.length, 2);
      assert.equal(positionClosedEvents.length, 0);
    });

    it("should liquidate multiple positions if needed", async () => {
      const data = await networkHelpers.loadFixture(deployFuturesFixture);
      const { contracts, accounts, config } = data;

      const entryPricePerDay = await contracts.futures.read.getMarketPrice();
      const deliveryDate = config.deliveryDates[0];
      const { futures, hashrateOracle, collateralVault } = contracts;
      const { seller, buyer, validator, pc } = accounts;

      // Tight deposit sized to the PME stress IM at entry: stress shock × spot ×
      // |Δ| (in token units). Matches the legacy `getMinMarginForPosition` value
      // since the futures fixture pins the PME shock at `liquidationMarginPercent`.
      const stressShockBps = BigInt(config.liquidationMarginPercent);
      const margin =
        (entryPricePerDay * BigInt(config.deliveryDurationDays) * 2n * stressShockBps) / 100n;
      const takerFee = await futures.read.takerFee();
      // Seller places the resting -2 first (no fee under post-2.9 model); buyer is taker on
      // both fills and pays 2× takerFee. makerFee defaults to 0 in the fixture, so seller
      // doesn't need extra headroom.
      await collateralVault.write.deposit([margin], { account: seller.account });
      await collateralVault.write.deposit([margin + takerFee * 2n], { account: buyer.account });

      await futures.write.createOrder([entryPricePerDay, deliveryDate, "", -2], {
        account: seller.account,
      });
      const txhash = await futures.write.createOrder([entryPricePerDay, deliveryDate, "", 2], {
        account: buyer.account,
      });

      const receipt1 = await pc.waitForTransactionReceipt({ hash: txhash });
      const positionCreatedEvents = parseEventLogs({
        logs: receipt1.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });
      assert.equal(positionCreatedEvents.length, 2);

      // Move market price up (seller loses on both positions)
      await scaleHashprice(hashrateOracle, 100n, 90n);

      const sellerMarginDeficit = await getMarginDeficit(contracts.portfolioMarginEngine, collateralVault, seller.account);
      assert.ok(sellerMarginDeficit > 0n);

      const txHash = await futures.write.marginCall([seller.account.address], {
        account: validator.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotClosed",
      });
      assert.equal(positionClosedEvents.length, 2);

      const sellerMarginDeficit2 = await getMarginDeficit(contracts.portfolioMarginEngine, collateralVault, seller.account);
      assert.ok(sellerMarginDeficit2 <= 0n);
    });

    it("should not liquidate if margin is sufficient", async function () {
      const { contracts, accounts, entryPricePerDay } =
        await networkHelpers.loadFixture(positionWithMarginFixture);
      const { futures, hashrateOracle, collateralVault } = contracts;
      const { buyer, validator, pc } = accounts;

      // Move market price slightly (small loss)
      await scaleHashprice(hashrateOracle, 100n, 105n);

      const buyerMm = await contracts.portfolioMarginEngine.read.computePortfolioMM([
        buyer.account.address,
      ]);
      const buyerCollateral = await collateralVault.read.balanceOf([buyer.account.address]);
      assert.ok(buyerCollateral >= buyerMm, "buyer is healthy under PME");

      const txHash = await futures.write.marginCall([buyer.account.address], {
        account: validator.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotClosed",
      });
      assert.equal(positionClosedEvents.length, 0);
    });

    it("should only allow validator to call marginCall", async () => {
      const { contracts, accounts } = await networkHelpers.loadFixture(positionWithMarginFixture);
      const { futures } = contracts;
      const { buyer, seller } = accounts;

      await viem.assertions.revertWithCustomError(
        futures.write.marginCall([buyer.account.address], { account: seller.account }),
        futures,
        "OnlyValidator",
      );
    });

    it("should correctly calculate and transfer PnL when buyer profits", async function () {
      const { contracts, accounts, entryPricePerDay } =
        await networkHelpers.loadFixture(positionWithMarginFixture);
      const { futures, hashrateOracle, collateralVault } = contracts;
      const { seller, buyer, validator } = accounts;

      const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
      const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);

      // Raise hashprice ~25% so buyer profits.
      await scaleHashprice(hashrateOracle, 100n, 80n);
      const newMarketPrice = await futures.read.getMarketPrice();
      assert.ok(newMarketPrice > entryPricePerDay);

      const sellerBalance = await collateralVault.read.balanceOf([seller.account.address]);
      const sellerIm = await contracts.portfolioMarginEngine.read.computePortfolioIM([
        seller.account.address,
      ]);
      if (sellerBalance > sellerIm) {
        const withdrawAmount = sellerBalance - sellerIm;
        await collateralVault.write.withdraw([withdrawAmount], { account: seller.account });
      }

      await futures.write.marginCall([seller.account.address], { account: validator.account });

      const buyerPnL = (BigInt(newMarketPrice) - BigInt(entryPricePerDay)) * 7n;

      const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);
      const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);

      if (buyerPnL > 0n) {
        const tolerance = parseUnits("1", 6);
        const buyerDiff =
          buyerBalanceAfter > buyerBalanceBefore + buyerPnL
            ? buyerBalanceAfter - (buyerBalanceBefore + buyerPnL)
            : buyerBalanceBefore + buyerPnL - buyerBalanceAfter;
        const sellerDiff =
          sellerBalanceAfter > sellerBalanceBefore - buyerPnL
            ? sellerBalanceAfter - (sellerBalanceBefore - buyerPnL)
            : sellerBalanceBefore - buyerPnL - sellerBalanceAfter;
        assert.ok(buyerDiff <= tolerance);
        assert.ok(sellerDiff <= tolerance);
      }
    });

    it("should create counterparty order when buyer is liquidated", async () => {
      const { contracts, accounts, positionId } =
        await networkHelpers.loadFixture(positionWithMarginFixture);
      const { futures, hashrateOracle, collateralVault } = contracts;
      const { seller, buyer, validator, pc } = accounts;

      assert.ok(positionId);
      const position = await futures.read.getPositionById([positionId]);
      assert.equal(position.seller, getAddress(seller.account.address));
      assert.equal(position.buyer, getAddress(buyer.account.address));
      const positionPrice = position.sellPricePerDay;
      const positionDeliveryDate = position.deliveryAt;
      const positionDestURL = position.destURL;

      // Drop hashprice ~33% so buyer is at loss.
      await scaleHashprice(hashrateOracle, 100n, 150n);

      const buyerMm = await contracts.portfolioMarginEngine.read.computePortfolioMM([
        buyer.account.address,
      ]);
      const buyerCollateral = await collateralVault.read.balanceOf([buyer.account.address]);
      assert.ok(buyerCollateral < buyerMm, "buyer is below MM");

      const txHash = await futures.write.marginCall([buyer.account.address], {
        account: validator.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotClosed",
      });
      assert.equal(positionClosedEvents.length, 1);
      assert.equal(positionClosedEvents[0].args.lotId, positionId);

      const orderCreatedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "OrderCreated",
      });
      assert.equal(orderCreatedEvents.length, 1);

      const counterpartyOrder = orderCreatedEvents[0].args;
      assert.equal(counterpartyOrder.participant, getAddress(seller.account.address));
      assert.equal(counterpartyOrder.pricePerDay, positionPrice);
      assert.equal(counterpartyOrder.deliveryAt, positionDeliveryDate);
      assert.equal(counterpartyOrder.destURL, positionDestURL);
      // Buyer liquidated → seller (counterparty) gets a sell order.
      assert.equal(counterpartyOrder.isBuy, false);

      const order = await futures.read.getOrderById([counterpartyOrder.orderId]);
      assert.equal(order.participant, getAddress(seller.account.address));
      assert.equal(order.pricePerDay, positionPrice);
      assert.equal(order.deliveryAt, positionDeliveryDate);
      assert.equal(order.isBuy, false);
    });

    it("should create counterparty order when seller is liquidated", async () => {
      const { contracts, accounts, positionId } =
        await networkHelpers.loadFixture(positionWithMarginFixture);
      const { futures, hashrateOracle, collateralVault } = contracts;
      const { seller, buyer, validator, pc } = accounts;

      assert.ok(positionId);
      const position = await futures.read.getPositionById([positionId]);
      assert.equal(position.seller, getAddress(seller.account.address));
      assert.equal(position.buyer, getAddress(buyer.account.address));
      const positionPrice = position.sellPricePerDay;
      const positionDeliveryDate = position.deliveryAt;
      const positionDestURL = position.destURL;

      // Raise hashprice ~25% so seller is at loss.
      await scaleHashprice(hashrateOracle, 100n, 80n);

      const sellerMm = await contracts.portfolioMarginEngine.read.computePortfolioMM([
        seller.account.address,
      ]);
      const sellerCollateral = await collateralVault.read.balanceOf([seller.account.address]);
      assert.ok(sellerCollateral < sellerMm, "seller is below MM");

      const txHash = await futures.write.marginCall([seller.account.address], {
        account: validator.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotClosed",
      });
      assert.equal(positionClosedEvents.length, 1);
      assert.equal(positionClosedEvents[0].args.lotId, positionId);

      const orderCreatedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "OrderCreated",
      });
      assert.equal(orderCreatedEvents.length, 1);

      const counterpartyOrder = orderCreatedEvents[0].args;
      assert.equal(counterpartyOrder.participant, getAddress(buyer.account.address));
      assert.equal(counterpartyOrder.pricePerDay, positionPrice);
      assert.equal(counterpartyOrder.deliveryAt, positionDeliveryDate);
      assert.equal(counterpartyOrder.destURL, positionDestURL);
      // Seller liquidated → buyer (counterparty) gets a buy order.
      assert.equal(counterpartyOrder.isBuy, true);

      const order = await futures.read.getOrderById([counterpartyOrder.orderId]);
      assert.equal(order.participant, getAddress(buyer.account.address));
      assert.equal(order.pricePerDay, positionPrice);
      assert.equal(order.deliveryAt, positionDeliveryDate);
      assert.equal(order.isBuy, true);
    });
  });
});
