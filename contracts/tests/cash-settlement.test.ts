import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFuturesFixture } from "./fixtures";
import { getAddress, parseEventLogs, parseUnits } from "viem";
import { expect } from "chai";
import { quantizePrice } from "./utils";

describe("Futures - Offset & Cash Settlement", () => {
  it("should handle position offset and settlement with contract balance correctly when buyer exits at profit", async () => {
    const data = await loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures } = contracts;
    const { seller, buyer, buyer2, validator, tc, pc, owner } = accounts;

    const marginAmount = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const dst = "https://destination-url.com";

    // Step 1: Add margin for all participants
    await futures.write.addMargin([marginAmount], { account: seller.account });
    await futures.write.addMargin([marginAmount], { account: buyer.account });
    await futures.write.addMargin([marginAmount], { account: buyer2.account });

    // Get initial balances
    const contractBalanceBefore = await futures.read.balanceOf([futures.address]);
    const buyerBalanceBefore = await futures.read.balanceOf([buyer.account.address]);

    // Step 2: Party A (buyer) enters into position with Party B (seller) at price 100
    const initialPrice = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

    // Create sell order first
    await futures.write.createOrder([initialPrice, deliveryDate, "", -1], {
      account: seller.account,
    });

    // Create buy order to match and create position
    await futures.write.createOrder([initialPrice, deliveryDate, dst, 1], {
      account: buyer.account,
    });

    // Step 3: Price changes - Party A (buyer) exits by creating sell order at higher price (120)
    // This represents a profit scenario where buyer exits at a higher price
    const exitPrice = quantizePrice(parseUnits("120", 6), config.priceLadderStep);

    // Buyer creates sell order to exit
    await futures.write.createOrder([exitPrice, deliveryDate, "", -1], {
      account: buyer.account,
    });

    // Step 4: Party C (buyer2) creates buy order at exit price, matching with buyer's sell order
    // This offsets buyer's position and creates new position between seller and buyer2
    const offsetTxHash = await futures.write.createOrder([exitPrice, deliveryDate, dst, 1], {
      account: buyer2.account,
    });

    const offsetReceipt = await pc.waitForTransactionReceipt({ hash: offsetTxHash });

    const positionCreatedEvents = parseEventLogs({
      logs: offsetReceipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    expect(positionCreatedEvents.length).to.be.greaterThan(0);
    // Get the new position ID
    const newPositionId = positionCreatedEvents[0].args.positionId;
    const newPosition = await futures.read.getPositionById([newPositionId]);

    // Step 5: Verify buyer was credited from contract balance (profit scenario)
    // When buyer exits at higher price, they profit, so contract pays them
    const buyerBalanceAfterOffset = await futures.read.balanceOf([buyer.account.address]);
    const contractBalanceAfterOffset = await futures.read.balanceOf([futures.address]);

    // Calculate expected PnL: (exitPrice - initialPrice) * deliveryDurationDays
    const expectedPnL = (exitPrice - initialPrice) * BigInt(config.deliveryDurationDays);
    // Buyer created 2 orders (entry and exit), so 2 * orderFee was deducted
    const orderFee = await futures.read.orderFee();
    const expectedBuyerBalanceChange = expectedPnL - orderFee * 2n;
    expect(buyerBalanceAfterOffset - buyerBalanceBefore).to.equal(expectedBuyerBalanceChange);

    // Contract balance decreases by PnL paid, but increases by order fees collected
    // Total orders created: seller (1) + buyer (2) + buyer2 (1) = 4 orders
    const totalOrderFees = orderFee * 4n;
    const expectedContractBalanceChange = expectedPnL - totalOrderFees;
    expect(contractBalanceBefore - contractBalanceAfterOffset).to.equal(
      expectedContractBalanceChange
    );

    // Step 6: Move time forward to delivery date and settle the new position
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });

    // Get balances before settlement
    const contractBalanceBeforeSettlement = await futures.read.balanceOf([futures.address]);

    // Close delivery for the new position
    await futures.write.closeDelivery([newPositionId, false], {
      account: validator.account,
    });

    // Step 7: Verify funds are returned to contract balance during settlement
    const contractBalanceAfterSettlement = await futures.read.balanceOf([futures.address]);
    expect(contractBalanceBefore + totalOrderFees).to.equal(contractBalanceAfterSettlement);
  });

  it("should handle position offset and settlement with contract balance correctly when buyer exits at loss", async () => {
    const data = await loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures } = contracts;
    const { seller, buyer, buyer2, validator, tc, pc } = accounts;

    const marginAmount = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const dst = "https://destination-url.com";

    // Step 1: Add margin for all participants
    await futures.write.addMargin([marginAmount], { account: seller.account });
    await futures.write.addMargin([marginAmount], { account: buyer.account });
    await futures.write.addMargin([marginAmount], { account: buyer2.account });

    // Get initial balances
    const contractBalanceBefore = await futures.read.balanceOf([futures.address]);
    const buyerBalanceBefore = await futures.read.balanceOf([buyer.account.address]);

    // Step 2: Party A (buyer) enters into position with Party B (seller) at price 100
    const initialPrice = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

    // Create sell order first
    await futures.write.createOrder([initialPrice, deliveryDate, "", -1], {
      account: seller.account,
    });

    // Create buy order to match and create position
    await futures.write.createOrder([initialPrice, deliveryDate, dst, 1], {
      account: buyer.account,
    });

    // Step 3: Price changes - Party A (buyer) exits by creating sell order at higher price (120)
    // This represents a profit scenario where buyer exits at a higher price
    const exitPrice = quantizePrice(parseUnits("90", 6), config.priceLadderStep);

    // Buyer creates sell order to exit
    await futures.write.createOrder([exitPrice, deliveryDate, "", -1], {
      account: buyer.account,
    });

    // Step 4: Party C (buyer2) creates buy order at exit price, matching with buyer's sell order
    // This offsets buyer's position and creates new position between seller and buyer2
    const offsetTxHash = await futures.write.createOrder([exitPrice, deliveryDate, dst, 1], {
      account: buyer2.account,
    });

    const offsetReceipt = await pc.waitForTransactionReceipt({ hash: offsetTxHash });

    const positionCreatedEvents = parseEventLogs({
      logs: offsetReceipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    expect(positionCreatedEvents.length).to.be.greaterThan(0);
    // Get the new position ID
    const newPositionId = positionCreatedEvents[0].args.positionId;

    // Step 5: Verify buyer was debited from contract balance (loss scenario)
    const buyerBalanceAfterOffset = await futures.read.balanceOf([buyer.account.address]);
    const contractBalanceAfterOffset = await futures.read.balanceOf([futures.address]);

    // Calculate expected PnL: (exitPrice - initialPrice) * deliveryDurationDays
    const expectedPnL = (exitPrice - initialPrice) * BigInt(config.deliveryDurationDays);
    // Buyer created 2 orders (entry and exit), so 2 * orderFee was deducted
    const orderFee = await futures.read.orderFee();
    const expectedBuyerBalanceChange = expectedPnL - orderFee * 2n;
    expect(buyerBalanceAfterOffset - buyerBalanceBefore).to.equal(expectedBuyerBalanceChange);
    // Contract balance decreases by PnL paid, but increases by order fees collected
    // Total orders created: seller (1) + buyer (2) + buyer2 (1) = 4 orders
    const totalOrderFees = orderFee * 4n;
    const expectedContractBalanceChange = expectedPnL - totalOrderFees;
    expect(contractBalanceBefore - contractBalanceAfterOffset).to.equal(
      expectedContractBalanceChange
    );

    // Step 6: Move time forward to delivery date and settle the new position
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });

    const sellerBalanceBeforeSettlement = await futures.read.balanceOf([seller.account.address]);
    const buyer2BalanceBeforeSettlement = await futures.read.balanceOf([buyer2.account.address]);

    // Close delivery for the new position
    await futures.write.closeDelivery([newPositionId, false], {
      account: validator.account,
    });

    // Step 7: Verify funds are returned to contract balance during settlement
    const contractBalanceAfterSettlement = await futures.read.balanceOf([futures.address]);
    expect(contractBalanceBefore + totalOrderFees).to.equal(contractBalanceAfterSettlement);
    const marketPrice = await futures.read.getMarketPrice();

    const sellerBalance = await futures.read.balanceOf([seller.account.address]);
    const deltaSeller = sellerBalance - sellerBalanceBeforeSettlement;
    const expectedSellerPnl = (initialPrice - marketPrice) * BigInt(config.deliveryDurationDays);
    expect(deltaSeller).to.equal(expectedSellerPnl);

    const buyer2Balance = await futures.read.balanceOf([buyer2.account.address]);
    const deltaBuyer2 = buyer2Balance - buyer2BalanceBeforeSettlement;
    const expectedBuyer2Pnl = (marketPrice - exitPrice) * BigInt(config.deliveryDurationDays);
    expect(deltaBuyer2).to.equal(expectedBuyer2Pnl);
  });
});
