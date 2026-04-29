import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture, type FuturesFixture } from "./fixtures.ts";
import { quantizePrice } from "./utils.ts";

const { networkHelpers } = await network.getOrCreate();

// Combined balance: PnL flows through INSURANCE_FUND_ADDR, fees accumulate at futures.address.
async function totalContractBalance(contracts: FuturesFixture["contracts"]) {
  const { futures, collateralVault } = contracts;
  const insuranceFundAddr = await collateralVault.read.INSURANCE_FUND_ADDR();
  return (
    (await futures.read.balanceOf([futures.address])) +
    (await futures.read.balanceOf([insuranceFundAddr]))
  );
}

describe("Futures - Offset & Cash Settlement", () => {
  it("should handle position offset and settlement with contract balance correctly when buyer exits at profit", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures } = contracts;
    const { seller, buyer, buyer2, validator, tc, pc } = accounts;

    const marginAmount = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const dst = "https://destination-url.com";

    await futures.write.addMargin([marginAmount], { account: seller.account });
    await futures.write.addMargin([marginAmount], { account: buyer.account });
    await futures.write.addMargin([marginAmount], { account: buyer2.account });

    const contractBalanceBefore = await totalContractBalance(contracts);
    const buyerBalanceBefore = await futures.read.balanceOf([buyer.account.address]);

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
      eventName: "PositionCreated",
    });

    assert.ok(positionCreatedEvents.length > 0);
    const newPositionId = positionCreatedEvents[0].args.positionId;

    // Buyer profits — contract pays out from balance.
    const buyerBalanceAfterOffset = await futures.read.balanceOf([buyer.account.address]);
    const contractBalanceAfterOffset = await totalContractBalance(contracts);

    const expectedPnL = (exitPrice - initialPrice) * BigInt(config.deliveryDurationDays);
    const orderFee = await futures.read.orderFee();
    // Buyer placed 2 orders, so 2× orderFee deducted.
    const expectedBuyerBalanceChange = expectedPnL - orderFee * 2n;
    assert.equal(buyerBalanceAfterOffset - buyerBalanceBefore, expectedBuyerBalanceChange);

    // Total fees collected: seller (1) + buyer (2) + buyer2 (1) = 4.
    const totalOrderFees = orderFee * 4n;
    const expectedContractBalanceChange = expectedPnL - totalOrderFees;
    assert.equal(contractBalanceBefore - contractBalanceAfterOffset, expectedContractBalanceChange);

    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });

    await futures.write.closeDelivery([newPositionId, false], { account: validator.account });

    const contractBalanceAfterSettlement = await totalContractBalance(contracts);
    assert.equal(contractBalanceBefore + totalOrderFees, contractBalanceAfterSettlement);
  });

  it("should handle position offset and settlement with contract balance correctly when buyer exits at loss", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures } = contracts;
    const { seller, buyer, buyer2, validator, tc, pc } = accounts;

    const marginAmount = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const dst = "https://destination-url.com";

    await futures.write.addMargin([marginAmount], { account: seller.account });
    await futures.write.addMargin([marginAmount], { account: buyer.account });
    await futures.write.addMargin([marginAmount], { account: buyer2.account });

    const contractBalanceBefore = await totalContractBalance(contracts);
    const buyerBalanceBefore = await futures.read.balanceOf([buyer.account.address]);

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
      eventName: "PositionCreated",
    });

    assert.ok(positionCreatedEvents.length > 0);
    const newPositionId = positionCreatedEvents[0].args.positionId;

    const buyerBalanceAfterOffset = await futures.read.balanceOf([buyer.account.address]);
    const contractBalanceAfterOffset = await totalContractBalance(contracts);

    const expectedPnL = (exitPrice - initialPrice) * BigInt(config.deliveryDurationDays);
    const orderFee = await futures.read.orderFee();
    const expectedBuyerBalanceChange = expectedPnL - orderFee * 2n;
    assert.equal(buyerBalanceAfterOffset - buyerBalanceBefore, expectedBuyerBalanceChange);

    const totalOrderFees = orderFee * 4n;
    const expectedContractBalanceChange = expectedPnL - totalOrderFees;
    assert.equal(contractBalanceBefore - contractBalanceAfterOffset, expectedContractBalanceChange);

    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });

    const sellerBalanceBeforeSettlement = await futures.read.balanceOf([seller.account.address]);
    const buyer2BalanceBeforeSettlement = await futures.read.balanceOf([buyer2.account.address]);

    await futures.write.closeDelivery([newPositionId, false], { account: validator.account });

    const contractBalanceAfterSettlement = await totalContractBalance(contracts);
    assert.equal(contractBalanceBefore + totalOrderFees, contractBalanceAfterSettlement);
    const marketPrice = await futures.read.getMarketPrice();

    const sellerBalance = await futures.read.balanceOf([seller.account.address]);
    const deltaSeller = sellerBalance - sellerBalanceBeforeSettlement;
    const expectedSellerPnl = (initialPrice - marketPrice) * BigInt(config.deliveryDurationDays);
    assert.equal(deltaSeller, expectedSellerPnl);

    const buyer2Balance = await futures.read.balanceOf([buyer2.account.address]);
    const deltaBuyer2 = buyer2Balance - buyer2BalanceBeforeSettlement;
    const expectedBuyer2Pnl = (marketPrice - exitPrice) * BigInt(config.deliveryDurationDays);
    assert.equal(deltaBuyer2, expectedBuyer2Pnl);
  });
});
