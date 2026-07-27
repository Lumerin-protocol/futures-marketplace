import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture, type FuturesFixture } from "./fixtures.ts";
import { quantizePrice, refreshHashprice, scaleHashprice } from "./utils.ts";

const { networkHelpers } = await network.getOrCreate();

async function totalContractBalance(contracts: FuturesFixture["contracts"]) {
  const { futures, collateralVault } = contracts;
  const insuranceFundAddr = await collateralVault.read.INSURANCE_FUND_ADDR();
  return (
    (await collateralVault.read.balanceOf([futures.address])) +
    (await collateralVault.read.balanceOf([insuranceFundAddr]))
  );
}

async function reachMaturityWithMovedMark(
  contracts: FuturesFixture["contracts"],
  tc: FuturesFixture["accounts"]["tc"],
  expirationAt: bigint,
) {
  await scaleHashprice(contracts.hashpriceUsd, 12n, 10n);
  await refreshHashprice(contracts.hashpriceUsd, expirationAt);
  await tc.setNextBlockTimestamp({ timestamp: expirationAt });
}

describe("Futures - Offset & Cash Settlement", () => {
  it("should handle position offset and settlement with contract balance correctly when buyer exits at profit", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault } = contracts;
    const { seller, buyer, buyer2, validator, tc, pc } = accounts;

    const marginAmount = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([marginAmount], { account: seller.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer2.account });

    const contractBalanceBefore = await totalContractBalance(contracts);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);

    const initialPrice = quantizePrice(parseUnits("100", 6), config.priceLadderStep);
    const exitPrice = quantizePrice(parseUnits("120", 6), config.priceLadderStep);

    await futures.write.createOrder([initialPrice, deliveryDate, -1n], { account: seller.account });
    await futures.write.createOrder([initialPrice, deliveryDate, 1n], { account: buyer.account });

    await futures.write.createOrder([exitPrice, deliveryDate, -1n], { account: buyer.account });

    const offsetTxHash = await futures.write.createOrder([exitPrice, deliveryDate, 1n], {
      account: buyer2.account,
    });
    const offsetReceipt = await pc.waitForTransactionReceipt({ hash: offsetTxHash });

    const matches = parseEventLogs({
      logs: offsetReceipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(matches.length, 1);

    assert.equal(
      (await futures.read.getUserPosition([buyer.account.address, deliveryDate])).netQuantity,
      0n,
    );
    assert.equal(
      (await futures.read.getUserPosition([seller.account.address, deliveryDate])).netQuantity,
      -1n,
    );
    assert.equal(
      (await futures.read.getUserPosition([buyer2.account.address, deliveryDate])).netQuantity,
      1n,
    );

    const buyerBalanceAfterOffset = await collateralVault.read.balanceOf([buyer.account.address]);
    const contractBalanceAfterOffset = await totalContractBalance(contracts);

    const expectedPnL = exitPrice - initialPrice;
    const takerFee = await futures.read.takerFee();
    const expectedBuyerBalanceChange = expectedPnL - takerFee;
    assert.equal(buyerBalanceAfterOffset - buyerBalanceBefore, expectedBuyerBalanceChange);

    const totalFees = takerFee * 2n;
    const expectedContractBalanceChange = expectedPnL - totalFees;
    assert.equal(contractBalanceBefore - contractBalanceAfterOffset, expectedContractBalanceChange);

    await reachMaturityWithMovedMark(contracts, tc, deliveryDate);

    await futures.write.settlePosition([seller.account.address, deliveryDate], {
      account: validator.account,
    });
    await futures.write.settlePosition([buyer2.account.address, deliveryDate], {
      account: validator.account,
    });

    const contractBalanceAfterSettlement = await totalContractBalance(contracts);
    assert.equal(contractBalanceBefore + totalFees, contractBalanceAfterSettlement);

    assert.equal(
      (await futures.read.getUserPosition([seller.account.address, deliveryDate])).netQuantity,
      0n,
    );
    assert.equal(
      (await futures.read.getUserPosition([buyer2.account.address, deliveryDate])).netQuantity,
      0n,
    );
  });

  it("should handle position offset and settlement with contract balance correctly when buyer exits at loss", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault } = contracts;
    const { seller, buyer, buyer2, validator, tc, pc } = accounts;

    const marginAmount = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([marginAmount], { account: seller.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer2.account });

    const contractBalanceBefore = await totalContractBalance(contracts);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);

    const initialPrice = quantizePrice(parseUnits("100", 6), config.priceLadderStep);
    const exitPrice = quantizePrice(parseUnits("90", 6), config.priceLadderStep);

    await futures.write.createOrder([initialPrice, deliveryDate, -1n], { account: seller.account });
    await futures.write.createOrder([initialPrice, deliveryDate, 1n], { account: buyer.account });

    await futures.write.createOrder([exitPrice, deliveryDate, -1n], { account: buyer.account });

    const offsetTxHash = await futures.write.createOrder([exitPrice, deliveryDate, 1n], {
      account: buyer2.account,
    });
    const offsetReceipt = await pc.waitForTransactionReceipt({ hash: offsetTxHash });

    const matches = parseEventLogs({
      logs: offsetReceipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(matches.length, 1);

    assert.equal(
      (await futures.read.getUserPosition([buyer.account.address, deliveryDate])).netQuantity,
      0n,
    );
    assert.equal(
      (await futures.read.getUserPosition([seller.account.address, deliveryDate])).netQuantity,
      -1n,
    );
    assert.equal(
      (await futures.read.getUserPosition([buyer2.account.address, deliveryDate])).netQuantity,
      1n,
    );

    const buyerBalanceAfterOffset = await collateralVault.read.balanceOf([buyer.account.address]);
    const contractBalanceAfterOffset = await totalContractBalance(contracts);

    const expectedPnL = exitPrice - initialPrice;
    const takerFee = await futures.read.takerFee();
    const expectedBuyerBalanceChange = expectedPnL - takerFee;
    assert.equal(buyerBalanceAfterOffset - buyerBalanceBefore, expectedBuyerBalanceChange);

    const totalFees = takerFee * 2n;
    const expectedContractBalanceChange = expectedPnL - totalFees;
    assert.equal(contractBalanceBefore - contractBalanceAfterOffset, expectedContractBalanceChange);

    await reachMaturityWithMovedMark(contracts, tc, deliveryDate);

    const sellerBalanceBeforeSettlement = await collateralVault.read.balanceOf([
      seller.account.address,
    ]);
    const buyer2BalanceBeforeSettlement = await collateralVault.read.balanceOf([
      buyer2.account.address,
    ]);

    await futures.write.settlePosition([seller.account.address, deliveryDate], {
      account: validator.account,
    });
    await futures.write.settlePosition([buyer2.account.address, deliveryDate], {
      account: validator.account,
    });

    const contractBalanceAfterSettlement = await totalContractBalance(contracts);
    assert.equal(contractBalanceBefore + totalFees, contractBalanceAfterSettlement);

    const marketPrice = await futures.read.getMarketPrice();

    const sellerBalance = await collateralVault.read.balanceOf([seller.account.address]);
    const deltaSeller = sellerBalance - sellerBalanceBeforeSettlement;
    const expectedSellerPnl = initialPrice - marketPrice;
    assert.equal(deltaSeller, expectedSellerPnl);

    const buyer2Balance = await collateralVault.read.balanceOf([buyer2.account.address]);
    const deltaBuyer2 = buyer2Balance - buyer2BalanceBeforeSettlement;
    const expectedBuyer2Pnl = marketPrice - exitPrice;
    assert.equal(deltaBuyer2, expectedBuyer2Pnl);
  });
});
