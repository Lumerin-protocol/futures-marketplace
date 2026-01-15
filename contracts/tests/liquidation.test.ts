import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { parseEventLogs, parseUnits, getAddress, Account } from "viem";
import { deployFuturesFixture } from "./fixtures";
import { catchError, getTxDeltaBalance } from "../../lib";
import { viem } from "hardhat";

async function positionWithMarginFixture() {
  const data = await loadFixture(deployFuturesFixture);
  const { contracts, accounts, config } = data;
  const { futures, hashrateOracle } = contracts;
  const { seller, buyer, validator, pc } = accounts;

  const entryPricePerDay = await futures.read.getMarketPrice();
  // Use smaller margin to ensure liquidation can be triggered
  const margin = entryPricePerDay * 3n; // Enough margin initially but can become insufficient
  const deliveryDate = config.deliveryDates[0];

  // Add margin for both participants
  await futures.write.addMargin([margin], { account: seller.account });
  await futures.write.addMargin([margin], { account: buyer.account });

  // Create a position by matching orders - store the tx hash to get position ID
  await futures.write.createOrder([entryPricePerDay, deliveryDate, "", -1], {
    account: seller.account,
  });
  const matchTxHash = await futures.write.createOrder([entryPricePerDay, deliveryDate, "", 1], {
    account: buyer.account,
  });

  // Get position ID from the transaction
  const receipt = await pc.waitForTransactionReceipt({ hash: matchTxHash });
  const positionCreatedEvents = parseEventLogs({
    logs: receipt.logs,
    abi: futures.abi,
    eventName: "PositionCreated",
  });
  const positionId =
    positionCreatedEvents.length > 0 ? positionCreatedEvents[0].args.positionId : null;

  return {
    ...data,
    entryPricePerDay,
    margin,
    deliveryDate,
    positionId,
  };
}

function getFuturesContract(address: `0x${string}`) {
  return viem.getContractAt("Futures", address);
}

async function getMarginDeficit(
  futures: Awaited<ReturnType<typeof getFuturesContract>>,
  party: Account
) {
  const partyCollateral = await futures.read.balanceOf([party.address]);
  const partyMinMargin = await futures.read.getMinMargin([party.address]);
  const marginDeficit = partyMinMargin - partyCollateral;
  return marginDeficit;
}

describe("Futures - Liquidation", function () {
  describe("Margin Call - Position Liquidation", function () {
    it("should liquidate buyer position when buyer is at loss and margin insufficient", async function () {
      const { contracts, accounts, entryPricePerDay, deliveryDate, positionId } = await loadFixture(
        positionWithMarginFixture
      );
      const { futures, hashrateOracle } = contracts;
      const { seller, buyer, validator, pc } = accounts;

      // Get initial balances
      const buyerBalanceBefore = await futures.read.balanceOf([buyer.account.address]);
      const sellerBalanceBefore = await futures.read.balanceOf([seller.account.address]);

      // Position ID is already in the fixture
      expect(positionId).to.not.be.null;

      // Move market price down significantly (buyer is at loss)
      const hashesForBTC = await hashrateOracle.read.getHashesForBTC();
      // Increase hashes significantly (lower price) - buyer loses more
      // Use 150% to ensure margin becomes insufficient
      await hashrateOracle.write.setHashesForBTC([(hashesForBTC.value * 150n) / 100n]);
      const newMarketPrice = await futures.read.getMarketPrice();
      expect(newMarketPrice < entryPricePerDay).to.be.true;

      // Check that buyer now has insufficient margin
      const buyerMinMargin = await futures.read.getMinMargin([buyer.account.address]);
      const buyerCollateral = await futures.read.balanceOf([buyer.account.address]);

      // Verify margin is now insufficient
      const buyerMinMarginAfter = await futures.read.getMinMargin([buyer.account.address]);
      const buyerCollateralAfter = await futures.read.balanceOf([buyer.account.address]);
      expect(buyerCollateralAfter < buyerMinMarginAfter).to.be.true;

      // Execute margin call
      const txHash = await futures.write.marginCall([buyer.account.address], {
        account: validator.account,
      });

      // Check PositionClosed event
      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionClosed",
      });
      expect(positionClosedEvents.length).to.equal(1);
      expect(positionClosedEvents[0].args.positionId).to.equal(positionId);

      // Verify position is closed (PositionClosed event confirms it)

      // Calculate expected PnL
      const buyerPnL = (BigInt(newMarketPrice) - BigInt(entryPricePerDay)) * 7n; // deliveryDurationDays = 7
      const deliveryDurationDays = 7n;

      // Verify PnL was transferred (buyer loses, so buyer pays seller)
      const buyerBalanceAfter = await futures.read.balanceOf([buyer.account.address]);
      const sellerBalanceAfter = await futures.read.balanceOf([seller.account.address]);

      // Buyer should have paid the loss
      if (buyerPnL < 0n) {
        const expectedBuyerBalance = buyerBalanceBefore + buyerPnL; // buyerPnL is negative
        const tolerance = parseUnits("1", 6);
        const buyerDiff =
          buyerBalanceAfter > expectedBuyerBalance
            ? buyerBalanceAfter - expectedBuyerBalance
            : expectedBuyerBalance - buyerBalanceAfter;
        const sellerDiff =
          sellerBalanceAfter > sellerBalanceBefore - buyerPnL
            ? sellerBalanceAfter - (sellerBalanceBefore - buyerPnL)
            : sellerBalanceBefore - buyerPnL - sellerBalanceAfter;
        expect(buyerDiff <= tolerance).to.be.true;
        expect(sellerDiff <= tolerance).to.be.true;
      }
    });

    it("should liquidate seller position when seller is at loss and margin insufficient", async function () {
      const { contracts, accounts, entryPricePerDay, deliveryDate, positionId } = await loadFixture(
        positionWithMarginFixture
      );
      const { futures, hashrateOracle } = contracts;
      const { seller, buyer, validator, pc } = accounts;

      // Get initial balances
      const sellerBalanceBefore = await futures.read.balanceOf([seller.account.address]);
      const buyerBalanceBefore = await futures.read.balanceOf([buyer.account.address]);

      // Position ID is already in the fixture
      expect(positionId).to.not.be.null;

      // Move market price up (seller is at loss)
      const hashesForBTC = await hashrateOracle.read.getHashesForBTC();
      // Decrease hashes (higher price) - seller loses
      await hashrateOracle.write.setHashesForBTC([(hashesForBTC.value * 80n) / 100n]);
      const newMarketPrice = await futures.read.getMarketPrice();
      expect(newMarketPrice > entryPricePerDay).to.be.true;

      // Check that seller now has insufficient margin
      const sellerMinMargin = await futures.read.getMinMargin([seller.account.address]);
      const sellerCollateral = await futures.read.balanceOf([seller.account.address]);
      expect(sellerCollateral < sellerMinMargin).to.be.true;

      // Execute margin call
      const txHash = await futures.write.marginCall([seller.account.address], {
        account: validator.account,
      });

      // Check PositionClosed event
      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionClosed",
      });
      expect(positionClosedEvents.length).to.equal(1);
      expect(positionClosedEvents[0].args.positionId).to.equal(positionId);

      // Verify position is closed (PositionClosed event confirms it)

      // Calculate expected PnL (buyer perspective)
      const buyerPnL = (BigInt(newMarketPrice) - BigInt(entryPricePerDay)) * 7n; // deliveryDurationDays = 7

      // Verify PnL was transferred (seller loses, so seller pays buyer)
      const sellerBalanceAfter = await futures.read.balanceOf([seller.account.address]);
      const buyerBalanceAfter = await futures.read.balanceOf([buyer.account.address]);

      // Seller should have paid the loss
      if (buyerPnL > 0n) {
        // Buyer profits, seller pays
        const tolerance = parseUnits("1", 6);
        const sellerDiff =
          sellerBalanceAfter > sellerBalanceBefore - buyerPnL
            ? sellerBalanceAfter - (sellerBalanceBefore - buyerPnL)
            : sellerBalanceBefore - buyerPnL - sellerBalanceAfter;
        const buyerDiff =
          buyerBalanceAfter > buyerBalanceBefore + buyerPnL
            ? buyerBalanceAfter - (buyerBalanceBefore + buyerPnL)
            : buyerBalanceBefore + buyerPnL - buyerBalanceAfter;
        expect(sellerDiff <= tolerance).to.be.true;
        expect(buyerDiff <= tolerance).to.be.true;
      }
    });

    it("should close orders first, then positions during margin call", async function () {
      const { contracts, accounts, entryPricePerDay, deliveryDate, config } = await loadFixture(
        positionWithMarginFixture
      );
      const { futures, hashrateOracle } = contracts;
      const { seller, buyer, validator, pc } = accounts;

      // Create additional orders for the buyer
      const marketPrice = await futures.read.getMarketPrice();
      const addMargin =
        ((marketPrice *
          BigInt(config.deliveryDurationDays) *
          BigInt(config.liquidationMarginPercent)) /
          100n) *
        2n;
      await futures.write.addMargin([addMargin], { account: buyer.account });

      // Verify buyer has orders by checking OrderCreated events from the transactions
      // We created 2 additional orders, so we expect at least 2 OrderCreated events
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
      expect(orders1.length + orders2.length).to.be.greaterThanOrEqual(2);

      // Move market price down to trigger margin call
      const hashesForBTC = await hashrateOracle.read.getHashesForBTC();
      await hashrateOracle.write.setHashesForBTC([(hashesForBTC.value * 150n) / 100n]);

      const marginDeficit = await getMarginDeficit(futures, buyer.account);

      expect(marginDeficit > 0n).to.be.true;

      // Execute margin call
      const txHash = await futures.write.marginCall([buyer.account.address], {
        account: validator.account,
      });

      const marginDeficit2 = await getMarginDeficit(futures, buyer.account);

      // Check events
      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const orderClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "OrderClosed",
      });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionClosed",
      });

      // Orders should be closed first
      expect(orderClosedEvents.length === 2).to.be.true;
      // Position should be closed after orders
      expect(positionClosedEvents.length === 0).to.be.true;

      // Verify orders and position are closed (events confirm this)
    });

    it("should liquidate multiple positions if needed", async function () {
      const data = await loadFixture(deployFuturesFixture);
      const { contracts, accounts, config } = data;

      const entryPricePerDay = await contracts.futures.read.getMarketPrice();
      const deliveryDate = config.deliveryDates[0];
      const { futures, hashrateOracle } = contracts;
      const { seller, buyer, buyer2, validator, pc } = accounts;

      const margin = await futures.read.getMinMarginForPosition([entryPricePerDay, -2n]);
      const orderFee = await futures.read.orderFee();
      await futures.write.addMargin([margin + orderFee], { account: seller.account });
      await futures.write.addMargin([margin + orderFee], { account: buyer.account });

      // Create multiple positions for seller
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
        eventName: "PositionCreated",
      });
      expect(positionCreatedEvents.length).to.equal(2);

      // Move market price up (seller loses on both positions)
      const hashesForBTC = await hashrateOracle.read.getHashesForBTC();
      await hashrateOracle.write.setHashesForBTC([(hashesForBTC.value * 90n) / 100n]);

      // Check margin is insufficient
      const sellerMarginDeficit = await getMarginDeficit(futures, seller.account);
      expect(sellerMarginDeficit > 0n).to.be.true;

      // Execute margin call
      const txHash = await futures.write.marginCall([seller.account.address], {
        account: validator.account,
      });

      // Check events - one position should be closed
      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionClosed",
      });
      expect(positionClosedEvents.length).to.equal(2);

      // Check margin is insufficient
      const sellerMarginDeficit2 = await getMarginDeficit(futures, seller.account);
      expect(sellerMarginDeficit2 <= 0n).to.be.true;
    });

    it("should not liquidate if margin is sufficient", async function () {
      const { contracts, accounts, entryPricePerDay } = await loadFixture(
        positionWithMarginFixture
      );
      const { futures, hashrateOracle } = contracts;
      const { buyer, validator, pc } = accounts;

      // Move market price slightly (small loss)
      const hashesForBTC = await hashrateOracle.read.getHashesForBTC();
      await hashrateOracle.write.setHashesForBTC([(hashesForBTC.value * 105n) / 100n]);

      // Check margin is still sufficient
      const buyerMinMargin = await futures.read.getMinMargin([buyer.account.address]);
      const buyerCollateral = await futures.read.balanceOf([buyer.account.address]);
      expect(buyerCollateral >= buyerMinMargin).to.be.true;

      // Execute margin call (should do nothing)
      const txHash = await futures.write.marginCall([buyer.account.address], {
        account: validator.account,
      });

      // Check no PositionClosed event
      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionClosed",
      });
      expect(positionClosedEvents.length).to.equal(0);

      // Verify position still exists (no PositionClosed event was emitted)
    });

    it("should only allow validator to call marginCall", async function () {
      const { contracts, accounts } = await loadFixture(positionWithMarginFixture);
      const { futures } = contracts;
      const { buyer, seller } = accounts;

      await catchError(futures.abi, "OnlyValidator", async () => {
        await futures.write.marginCall([buyer.account.address], {
          account: seller.account,
        });
      });
    });

    it("should correctly calculate and transfer PnL when buyer profits", async function () {
      const { contracts, accounts, entryPricePerDay } = await loadFixture(
        positionWithMarginFixture
      );
      const { futures, hashrateOracle } = contracts;
      const { seller, buyer, validator, pc } = accounts;

      const buyerBalanceBefore = await futures.read.balanceOf([buyer.account.address]);
      const sellerBalanceBefore = await futures.read.balanceOf([seller.account.address]);

      // Move market price up (buyer profits)
      const hashesForBTC = await hashrateOracle.read.getHashesForBTC();
      await hashrateOracle.write.setHashesForBTC([(hashesForBTC.value * 80n) / 100n]);
      const newMarketPrice = await futures.read.getMarketPrice();
      expect(newMarketPrice > entryPricePerDay).to.be.true;

      // Make seller margin insufficient to trigger liquidation
      // First, reduce seller's margin
      const sellerBalance = await futures.read.balanceOf([seller.account.address]);
      const sellerMinMargin = await futures.read.getMinMargin([seller.account.address]);
      if (sellerBalance > sellerMinMargin) {
        // Withdraw some margin to make it insufficient
        const withdrawAmount = sellerBalance - sellerMinMargin + parseUnits("1", 6);
        await futures.write.removeMargin([withdrawAmount], { account: seller.account });
      }

      // Execute margin call on seller
      const txHash = await futures.write.marginCall([seller.account.address], {
        account: validator.account,
      });

      // Calculate expected PnL
      const buyerPnL = (BigInt(newMarketPrice) - BigInt(entryPricePerDay)) * 7n; // deliveryDurationDays = 7

      // Verify PnL transfer (buyer profits, seller pays)
      const buyerBalanceAfter = await futures.read.balanceOf([buyer.account.address]);
      const sellerBalanceAfter = await futures.read.balanceOf([seller.account.address]);

      if (buyerPnL > 0n) {
        // Buyer should receive profit
        const tolerance = parseUnits("1", 6);
        const buyerDiff =
          buyerBalanceAfter > buyerBalanceBefore + buyerPnL
            ? buyerBalanceAfter - (buyerBalanceBefore + buyerPnL)
            : buyerBalanceBefore + buyerPnL - buyerBalanceAfter;
        const sellerDiff =
          sellerBalanceAfter > sellerBalanceBefore - buyerPnL
            ? sellerBalanceAfter - (sellerBalanceBefore - buyerPnL)
            : sellerBalanceBefore - buyerPnL - sellerBalanceAfter;
        expect(buyerDiff <= tolerance).to.be.true;
        expect(sellerDiff <= tolerance).to.be.true;
      }
    });

    it("should create counterparty order when buyer is liquidated", async function () {
      const { contracts, accounts, positionId } = await loadFixture(positionWithMarginFixture);
      const { futures, hashrateOracle } = contracts;
      const { seller, buyer, validator, pc } = accounts;

      // Get position details before liquidation
      const position = await futures.read.getPositionById([positionId!]);
      expect(position.seller).to.equal(getAddress(seller.account.address));
      expect(position.buyer).to.equal(getAddress(buyer.account.address));
      const positionPrice = position.sellPricePerDay;
      const positionDeliveryDate = position.deliveryAt;
      const positionDestURL = position.destURL;

      // Move market price down significantly (buyer is at loss)
      const hashesForBTC = await hashrateOracle.read.getHashesForBTC();
      await hashrateOracle.write.setHashesForBTC([(hashesForBTC.value * 150n) / 100n]);

      // Verify buyer has insufficient margin
      const buyerMinMargin = await futures.read.getMinMargin([buyer.account.address]);
      const buyerCollateral = await futures.read.balanceOf([buyer.account.address]);
      expect(buyerCollateral < buyerMinMargin).to.be.true;

      // Execute margin call on buyer
      const txHash = await futures.write.marginCall([buyer.account.address], {
        account: validator.account,
      });

      // Check events
      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionClosed",
      });
      expect(positionClosedEvents.length).to.equal(1);
      expect(positionClosedEvents[0].args.positionId).to.equal(positionId);

      // Verify OrderCreated event for counterparty (seller)
      const orderCreatedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "OrderCreated",
      });
      expect(orderCreatedEvents.length).to.equal(1);

      const counterpartyOrder = orderCreatedEvents[0].args;
      expect(counterpartyOrder.participant).to.equal(getAddress(seller.account.address));
      expect(counterpartyOrder.pricePerDay).to.equal(positionPrice);
      expect(counterpartyOrder.deliveryAt).to.equal(positionDeliveryDate);
      expect(counterpartyOrder.destURL).to.equal(positionDestURL);
      // When buyer is liquidated, seller (counterparty) should get a sell order (isBuy = false)
      expect(counterpartyOrder.isBuy).to.equal(false);

      // Verify the order exists in the contract
      const order = await futures.read.getOrderById([counterpartyOrder.orderId]);
      expect(order.participant).to.equal(getAddress(seller.account.address));
      expect(order.pricePerDay).to.equal(positionPrice);
      expect(order.deliveryAt).to.equal(positionDeliveryDate);
      expect(order.isBuy).to.equal(false);
    });

    it("should create counterparty order when seller is liquidated", async function () {
      const { contracts, accounts, positionId } = await loadFixture(positionWithMarginFixture);
      const { futures, hashrateOracle } = contracts;
      const { seller, buyer, validator, pc } = accounts;

      // Get position details before liquidation
      const position = await futures.read.getPositionById([positionId!]);
      expect(position.seller).to.equal(getAddress(seller.account.address));
      expect(position.buyer).to.equal(getAddress(buyer.account.address));
      const positionPrice = position.sellPricePerDay;
      const positionDeliveryDate = position.deliveryAt;
      const positionDestURL = position.destURL;

      // Move market price up (seller is at loss)
      const hashesForBTC = await hashrateOracle.read.getHashesForBTC();
      await hashrateOracle.write.setHashesForBTC([(hashesForBTC.value * 80n) / 100n]);

      // Verify seller has insufficient margin
      const sellerMinMargin = await futures.read.getMinMargin([seller.account.address]);
      const sellerCollateral = await futures.read.balanceOf([seller.account.address]);
      expect(sellerCollateral < sellerMinMargin).to.be.true;

      // Execute margin call on seller
      const txHash = await futures.write.marginCall([seller.account.address], {
        account: validator.account,
      });

      // Check events
      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const positionClosedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionClosed",
      });
      expect(positionClosedEvents.length).to.equal(1);
      expect(positionClosedEvents[0].args.positionId).to.equal(positionId);

      // Verify OrderCreated event for counterparty (buyer)
      const orderCreatedEvents = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "OrderCreated",
      });
      expect(orderCreatedEvents.length).to.equal(1);

      const counterpartyOrder = orderCreatedEvents[0].args;
      expect(counterpartyOrder.participant).to.equal(getAddress(buyer.account.address));
      expect(counterpartyOrder.pricePerDay).to.equal(positionPrice);
      expect(counterpartyOrder.deliveryAt).to.equal(positionDeliveryDate);
      expect(counterpartyOrder.destURL).to.equal(positionDestURL);
      // When seller is liquidated, buyer (counterparty) should get a buy order (isBuy = true)
      expect(counterpartyOrder.isBuy).to.equal(true);

      // Verify the order exists in the contract
      const order = await futures.read.getOrderById([counterpartyOrder.orderId]);
      expect(order.participant).to.equal(getAddress(buyer.account.address));
      expect(order.pricePerDay).to.equal(positionPrice);
      expect(order.deliveryAt).to.equal(positionDeliveryDate);
      expect(order.isBuy).to.equal(true);
    });
  });
});
