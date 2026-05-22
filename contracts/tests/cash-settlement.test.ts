import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture, type FuturesFixture } from "./fixtures.ts";
import { quantizePrice } from "./utils.ts";
import { refreshHashprice } from "./utils.ts";
const { networkHelpers } = await network.getOrCreate();

// Combined balance: PnL flows through INSURANCE_FUND_ADDR, fees accumulate at futures.address.
async function totalContractBalance(contracts: FuturesFixture["contracts"]) {
  const { futures, collateralVault } = contracts;
  const insuranceFundAddr = await collateralVault.read.INSURANCE_FUND_ADDR();
  return (
    (await collateralVault.read.balanceOf([futures.address])) +
    (await collateralVault.read.balanceOf([insuranceFundAddr]))
  );
}

describe("Futures - Offset & Cash Settlement", () => {
  it("should handle position offset and settlement with contract balance correctly when buyer exits at profit", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault } = contracts;
    const { seller, buyer, buyer2, validator, tc, pc } = accounts;

    const marginAmount = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const dst = "https://destination-url.com";

    await collateralVault.write.deposit([marginAmount], { account: seller.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer2.account });

    const contractBalanceBefore = await totalContractBalance(contracts);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);

    const initialPrice = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

    await futures.write.createOrder([initialPrice, deliveryDate, "", -1], {
      account: seller.account,
    });

    await futures.write.createOrder([initialPrice, deliveryDate, dst, 1], {
      account: buyer.account,
    });

    // Price changes — Party A (buyer) exits at higher price (120) for profit
    const exitPrice = quantizePrice(parseUnits("120", 6), config.priceLadderStep);

    await futures.write.createOrder([exitPrice, deliveryDate, "", -1], {
      account: buyer.account,
    });

    // Party C (buyer2) creates buy order at exit price, offsetting buyer and creating
    // a new position between seller and buyer2.
    const offsetTxHash = await futures.write.createOrder([exitPrice, deliveryDate, dst, 1], {
      account: buyer2.account,
    });

    const offsetReceipt = await pc.waitForTransactionReceipt({ hash: offsetTxHash });

    const positionCreatedEvents = parseEventLogs({
      logs: offsetReceipt.logs,
      abi: futures.abi,
      eventName: "LotTransferred",
    });

    assert.ok(positionCreatedEvents.length > 0);
    const newPositionId = positionCreatedEvents[0].args.newLotId;

    // Buyer profits — contract pays out from balance.
    const buyerBalanceAfterOffset = await collateralVault.read.balanceOf([buyer.account.address]);
    const contractBalanceAfterOffset = await totalContractBalance(contracts);

    const expectedPnL = (exitPrice - initialPrice) * BigInt(config.deliveryDurationDays);
    const takerFee = await futures.read.takerFee();
    // Under the post-2.9 model only takers pay (makerFee defaults to 0): buyer was taker on
    // step 2 (entry) and maker on step 4 (exit, via LotTransferred), so only 1× takerFee deducted.
    const expectedBuyerBalanceChange = expectedPnL - takerFee;
    assert.equal(buyerBalanceAfterOffset - buyerBalanceBefore, expectedBuyerBalanceChange);

    // Total fees collected: 2 taker fills (buyer entry, buyer2 entry).
    const totalFees = takerFee * 2n;
    const expectedContractBalanceChange = expectedPnL - totalFees;
    assert.equal(contractBalanceBefore - contractBalanceAfterOffset, expectedContractBalanceChange);

    await refreshHashprice(contracts.hashrateOracle, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });

    await futures.write.closeDelivery([newPositionId, false], { account: validator.account });

    const contractBalanceAfterSettlement = await totalContractBalance(contracts);
    assert.equal(contractBalanceBefore + totalFees, contractBalanceAfterSettlement);
  });

  it("should handle position offset and settlement with contract balance correctly when buyer exits at loss", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault } = contracts;
    const { seller, buyer, buyer2, validator, tc, pc } = accounts;

    const marginAmount = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const dst = "https://destination-url.com";

    await collateralVault.write.deposit([marginAmount], { account: seller.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer2.account });

    const contractBalanceBefore = await totalContractBalance(contracts);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);

    const initialPrice = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

    await futures.write.createOrder([initialPrice, deliveryDate, "", -1], {
      account: seller.account,
    });

    await futures.write.createOrder([initialPrice, deliveryDate, dst, 1], {
      account: buyer.account,
    });

    // Buyer exits at a lower price for a loss.
    const exitPrice = quantizePrice(parseUnits("90", 6), config.priceLadderStep);

    await futures.write.createOrder([exitPrice, deliveryDate, "", -1], {
      account: buyer.account,
    });

    const offsetTxHash = await futures.write.createOrder([exitPrice, deliveryDate, dst, 1], {
      account: buyer2.account,
    });

    const offsetReceipt = await pc.waitForTransactionReceipt({ hash: offsetTxHash });

    const positionCreatedEvents = parseEventLogs({
      logs: offsetReceipt.logs,
      abi: futures.abi,
      eventName: "LotTransferred",
    });

    assert.ok(positionCreatedEvents.length > 0);
    const newPositionId = positionCreatedEvents[0].args.newLotId;

    const buyerBalanceAfterOffset = await collateralVault.read.balanceOf([buyer.account.address]);
    const contractBalanceAfterOffset = await totalContractBalance(contracts);

    const expectedPnL = (exitPrice - initialPrice) * BigInt(config.deliveryDurationDays);
    const takerFee = await futures.read.takerFee();
    // Only takers pay (makerFee=0 by default): buyer was taker on step 2 and maker on step 4.
    const expectedBuyerBalanceChange = expectedPnL - takerFee;
    assert.equal(buyerBalanceAfterOffset - buyerBalanceBefore, expectedBuyerBalanceChange);

    const totalFees = takerFee * 2n;
    const expectedContractBalanceChange = expectedPnL - totalFees;
    assert.equal(contractBalanceBefore - contractBalanceAfterOffset, expectedContractBalanceChange);

    // Step 6: Move time forward to delivery date and settle the new position
    await refreshHashprice(contracts.hashrateOracle, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });

    const sellerBalanceBeforeSettlement = await collateralVault.read.balanceOf([
      seller.account.address,
    ]);
    const buyer2BalanceBeforeSettlement = await collateralVault.read.balanceOf([
      buyer2.account.address,
    ]);

    await futures.write.closeDelivery([newPositionId, false], { account: validator.account });

    const contractBalanceAfterSettlement = await totalContractBalance(contracts);
    assert.equal(contractBalanceBefore + totalFees, contractBalanceAfterSettlement);
    const marketPrice = await futures.read.getMarketPrice();

    const sellerBalance = await collateralVault.read.balanceOf([seller.account.address]);
    const deltaSeller = sellerBalance - sellerBalanceBeforeSettlement;
    const expectedSellerPnl = (initialPrice - marketPrice) * BigInt(config.deliveryDurationDays);
    assert.equal(deltaSeller, expectedSellerPnl);

    const buyer2Balance = await collateralVault.read.balanceOf([buyer2.account.address]);
    const deltaBuyer2 = buyer2Balance - buyer2BalanceBeforeSettlement;
    const expectedBuyer2Pnl = (marketPrice - exitPrice) * BigInt(config.deliveryDurationDays);
    assert.equal(deltaBuyer2, expectedBuyer2Pnl);
  });
});
