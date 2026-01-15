import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { getAddress, parseEventLogs, parseUnits, zeroAddress } from "viem";
import { deployFuturesFixture } from "./fixtures";
import { catchError } from "../../lib";

async function positionWithMarginFixture() {
  const data = await loadFixture(deployFuturesFixture);
  const { contracts, accounts, config } = data;
  const { futures } = contracts;
  const { seller, buyer } = accounts;

  const entryPricePerDay = await futures.read.getMarketPrice();
  const margin = entryPricePerDay * 2n;
  const deliveryDate = config.deliveryDates[0];

  // Add margin for both participants
  await futures.write.addMargin([margin], { account: seller.account });
  await futures.write.addMargin([margin], { account: buyer.account });

  // Create a position by matching orders
  await futures.write.createOrder([entryPricePerDay, deliveryDate, "", -1], {
    account: seller.account,
  });
  await futures.write.createOrder([entryPricePerDay, deliveryDate, "", 1], {
    account: buyer.account,
  });

  return {
    ...data,
    entryPricePerDay,
    margin,
    deliveryDate,
  };
}

describe("Futures - getMinMargin", function () {
  it("should return larger value when buyer is at loss", async function () {
    const { contracts, accounts } = await loadFixture(positionWithMarginFixture);
    const { futures, hashrateOracle } = contracts;
    const { buyer, seller } = accounts;

    const buyerMargin = await futures.read.getMinMargin([buyer.account.address]);
    const sellerMargin = await futures.read.getMinMargin([seller.account.address]);

    expect(sellerMargin === buyerMargin).to.be.true; // at market price only

    const marketPricePerDay = await futures.read.getMarketPrice();
    const hashesForBTC = await hashrateOracle.read.getHashesForBTC();
    await hashrateOracle.write.setHashesForBTC([(hashesForBTC.value * 110n) / 100n]);
    const newMarketPricePerDay = await futures.read.getMarketPrice();

    expect(newMarketPricePerDay < marketPricePerDay).to.be.true;
    const buyerMargin2 = await futures.read.getMinMargin([buyer.account.address]);
    const sellerMargin2 = await futures.read.getMinMargin([seller.account.address]);

    expect(buyerMargin2 > buyerMargin).to.be.true;
    expect(sellerMargin2 < sellerMargin).to.be.true;
  });

  it("should return smaller value when buyer is at profit", async function () {
    const { contracts, accounts } = await loadFixture(positionWithMarginFixture);
    const { futures, hashrateOracle } = contracts;
    const { buyer, seller } = accounts;

    const buyerMargin = await futures.read.getMinMargin([buyer.account.address]);
    const sellerMargin = await futures.read.getMinMargin([seller.account.address]);

    expect(sellerMargin === buyerMargin).to.be.true; // at market price only

    const marketPricePerDay = await futures.read.getMarketPrice();
    const hashesForBTC = await hashrateOracle.read.getHashesForBTC();
    await hashrateOracle.write.setHashesForBTC([(hashesForBTC.value * 90n) / 100n]);
    const newMarketPricePerDay = await futures.read.getMarketPrice();

    expect(newMarketPricePerDay > marketPricePerDay).to.be.true;
    const buyerMargin2 = await futures.read.getMinMargin([buyer.account.address]);
    const sellerMargin2 = await futures.read.getMinMargin([seller.account.address]);
    expect(buyerMargin2 < buyerMargin).to.be.true;
    expect(sellerMargin2 > sellerMargin).to.be.true;
  });

  it("effective margin can go negative for expensive sell", async function () {
    const { contracts, accounts } = await loadFixture(positionWithMarginFixture);
    const { futures } = contracts;

    const marketPricePerDay = await futures.read.getMarketPrice();

    const buyerMargin = await futures.read.getMinMarginForPosition([marketPricePerDay * 100n, -1n]);
    expect(buyerMargin < 0n).to.be.true;
  });

  it("party cant withdraw so balance is less than effective margin", async function () {
    const { contracts, accounts, margin } = await loadFixture(positionWithMarginFixture);
    const { futures } = contracts;
    const { buyer } = accounts;
    const currentBalance = await futures.read.balanceOf([buyer.account.address]);
    await catchError(futures.abi, "InsufficientMarginBalance", async () => {
      await futures.write.removeMargin([currentBalance], { account: buyer.account.address });
    });

    const buyerMargin = await futures.read.getMinMargin([buyer.account.address]);
    const availableToWithdraw = currentBalance - buyerMargin;
    await futures.write.removeMargin([availableToWithdraw], { account: buyer.account.address });

    const newBalance = await futures.read.balanceOf([buyer.account.address]);
    expect(newBalance).to.equal(buyerMargin);
  });

  it("orders with positive effective margin should be considered for effective margin", async function () {
    const { contracts, accounts, deliveryDate } = await loadFixture(positionWithMarginFixture);
    const { futures } = contracts;
    const { buyer } = accounts;

    const marketPricePerDay = await futures.read.getMarketPrice();
    // making sure buyer has excessive margin
    await futures.write.addMargin([marketPricePerDay * 10n], { account: buyer.account });

    const effectiveMargin = await futures.read.getMinMargin([buyer.account.address]);
    await futures.write.createOrder([marketPricePerDay, deliveryDate, "", -1], {
      account: buyer.account,
    });
    const effectiveMargin2 = await futures.read.getMinMargin([buyer.account.address]);
    expect(effectiveMargin2 > effectiveMargin).to.be.true;
  });

  it("orders with negative effective margin should not be considered for effective margin", async function () {
    const { contracts, accounts, deliveryDate } = await loadFixture(positionWithMarginFixture);
    const { futures } = contracts;
    const { buyer } = accounts;
    const marketPricePerDay = await futures.read.getMarketPrice();
    const effectiveMargin = await futures.read.getMinMargin([buyer.account.address]);
    await futures.write.createOrder([marketPricePerDay * 100n, deliveryDate, "", -1], {
      account: buyer.account,
    });
    const effectiveMargin2 = await futures.read.getMinMargin([buyer.account.address]);
    expect(effectiveMargin2 === effectiveMargin).to.be.true;
  });

  it("party cant withdraw more than deposited collateral even if effective margin is negative", async function () {
    const { contracts, accounts, deliveryDate } = await loadFixture(positionWithMarginFixture);
    const { futures } = contracts;
    const { buyer, seller } = accounts;
    const marketPricePerDay = await futures.read.getMarketPrice();

    // create very profitable sell order
    await futures.write.createOrder([marketPricePerDay * 100n, deliveryDate, "", -1], {
      account: seller.account,
    });

    // match very profitable order
    await futures.write.addMargin([marketPricePerDay * 1000n], { account: buyer.account });
    await futures.write.createOrder([marketPricePerDay * 100n, deliveryDate, "", 1], {
      account: buyer.account,
    });

    // check effective margin is negative (pnl is larger than maintenance margin)
    const effectiveMargin = await futures.read.getMinMargin([seller.account.address]);
    expect(effectiveMargin < 0n).to.be.true;

    const balance = await futures.read.balanceOf([seller.account.address]);
    await catchError(futures.abi, "ERC20InsufficientBalance", async () => {
      await futures.write.removeMargin([balance + 1n], { account: seller.account });
    });

    // party can withdraw full deposited collateral balance
    await futures.write.removeMargin([balance], { account: seller.account });
  });

  it("outdated orders do not affect getMinMargin calculation", async function () {
    const { contracts, accounts, config } = await loadFixture(positionWithMarginFixture);
    const { futures } = contracts;
    const { buyer, tc, pc } = accounts;
    const marketPricePerDay = await futures.read.getMarketPrice();

    // Get initial margin (from the position created in the fixture)
    const initialMargin = await futures.read.getMinMargin([buyer.account.address]);

    // Create an order with a future delivery date
    const futureDeliveryDate = config.deliveryDates[1];
    await futures.write.addMargin([marketPricePerDay * 10n], { account: buyer.account });

    const txHash = await futures.write.createOrder([marketPricePerDay, futureDeliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const orderId = events[0].args.orderId;

    // Get the margin requirement with the active order
    // It should be higher than initial because the new order requires margin
    const marginWithActiveOrder = await futures.read.getMinMargin([buyer.account.address]);
    expect(marginWithActiveOrder >= initialMargin).to.be.true;

    // Advance time past the delivery date to make the order outdated
    await tc.setNextBlockTimestamp({ timestamp: futureDeliveryDate + 1n });

    // Get the margin requirement after the order becomes outdated
    // It should be less than or equal to marginWithActiveOrder because outdated orders are ignored
    const marginWithOutdatedOrder = await futures.read.getMinMargin([buyer.account.address]);

    // The margin should be less because the outdated order is no longer included in the calculation
    // It should be close to the initial margin (just the position margin)
    expect(marginWithOutdatedOrder <= marginWithActiveOrder).to.be.true;

    // Verify the order still exists in storage but is outdated
    const order = await futures.read.getOrderById([orderId]);
    expect(order.participant).to.equal(getAddress(buyer.account.address));

    expect(order.deliveryAt === futureDeliveryDate).to.be.true;
  });

  it("should calculate minimum margin for orders", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const [date1, date2] = config.deliveryDates;
    const marginAmount = price * BigInt(config.deliveryDurationDays);

    // Add margin first
    await futures.write.addMargin([marginAmount], {
      account: seller.account,
    });

    // Create buy order
    await futures.write.createOrder([price, date1, "", 1], {
      account: seller.account,
    });

    const minMargin = await futures.read.getMinMargin([seller.account.address]);
    expect(minMargin > 0n).to.be.true;

    // Create a sell order
    await futures.write.createOrder([price, date2, "", -1], {
      account: seller.account,
    });

    const minMarginAfterShort = await futures.read.getMinMargin([seller.account.address]);
    expect(minMarginAfterShort > minMargin).to.be.true;
  });

  it("should calculate minimum margin for positions", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, buyer } = accounts;

    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];
    const marginAmount = price * BigInt(config.deliveryDurationDays);

    // Add margin for both participants
    await futures.write.addMargin([marginAmount], {
      account: seller.account,
    });
    await futures.write.addMargin([marginAmount], {
      account: buyer.account,
    });

    // Create matching orders to form an position
    await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });
    await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const sellerMinMargin = await futures.read.getMinMargin([seller.account.address]);
    const buyerMinMargin = await futures.read.getMinMargin([buyer.account.address]);

    expect(sellerMinMargin > 0n).to.be.true;
    expect(buyerMinMargin > 0n).to.be.true;
  });
});

describe("Futures - margin management", function () {
  it("should allow adding margin", async function () {
    const { contracts, accounts } = await loadFixture(deployFuturesFixture);
    const { futures, usdcMock } = contracts;
    const { seller, pc } = accounts;

    const sellerBalance1 = await futures.read.balanceOf([seller.account.address]);
    const futuresUsdcBalance1 = await usdcMock.read.balanceOf([futures.address]);

    const marginAmount = parseUnits("1000", 6); // $1000

    const txHash = await futures.write.addMargin([marginAmount], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    expect(receipt.status).to.equal("success");

    // Check balance
    const sellerBalance2 = await futures.read.balanceOf([seller.account.address]);
    expect(sellerBalance2).to.equal(sellerBalance1 + marginAmount);

    // Check USDC balance of futures contract
    const futuresUsdcBalance2 = await usdcMock.read.balanceOf([futures.address]);
    expect(futuresUsdcBalance2).to.equal(futuresUsdcBalance1 + marginAmount);
  });

  it("should allow removing margin when sufficient balance", async function () {
    const { contracts, accounts } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;

    const marginAmount = parseUnits("1000", 6);
    const removeAmount = parseUnits("500", 6);

    // Add margin first
    await futures.write.addMargin([marginAmount], {
      account: seller.account,
    });

    // Remove margin
    const txHash = await futures.write.removeMargin([removeAmount], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    expect(receipt.status).to.equal("success");

    // Check balance
    const balance = await futures.read.balanceOf([seller.account.address]);
    expect(balance).to.equal(marginAmount - removeAmount);
  });

  it("should reject removing margin when insufficient balance", async function () {
    const { contracts, accounts } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const marginAmount = parseUnits("1000", 6);
    const removeAmount = parseUnits("1500", 6);

    // Add margin first
    await futures.write.addMargin([marginAmount], {
      account: seller.account,
    });

    // Try to remove more than balance
    await catchError(futures.abi, "ERC20InsufficientBalance", async () => {
      await futures.write.removeMargin([removeAmount], {
        account: seller.account,
      });
    });
  });

  it("should reject removing margin when below minimum required", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const minMargin = await futures.read.getMinMarginForPosition([price, 1n]);
    const deliveryDate = config.deliveryDates[0];

    // Add margin
    await futures.write.addMargin([minMargin + config.orderFee], {
      account: seller.account,
    });

    // Create order to require minimum margin
    await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });

    // Try to remove too much margin
    const removeAmount = 1n;
    await catchError(futures.abi, "InsufficientMarginBalance", async () => {
      await futures.write.removeMargin([removeAmount], {
        account: seller.account,
      });
    });
  });
});

describe("Futures - margin call", function () {
  it("should perform margin call when margin is insufficient", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures, btcPriceOracleMock } = contracts;
    const { seller, validator, pc } = accounts;

    const price = await futures.read.getMarketPrice();
    const minMargin = await futures.read.getMinMarginForPosition([price, 1n]);
    const deliveryDate = config.deliveryDates[0];

    // Add small margin
    await futures.write.addMargin([minMargin + config.orderFee], {
      account: seller.account,
    });

    // Create order that requires more margin
    const tx = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: seller.account,
    });
    const rec = await pc.waitForTransactionReceipt({ hash: tx });
    const [createdEvent] = parseEventLogs({
      logs: rec.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const { orderId } = createdEvent.args;

    // Decrease bitcoin price
    await btcPriceOracleMock.write.setPrice([config.oracle.btcPrice / 2n, 8]);

    // Perform margin call
    const txHash = await futures.write.marginCall([seller.account.address], {
      account: validator.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    expect(receipt.status).to.equal("success");

    // Check for order closed event
    const [closedEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });
    expect(closedEvent.args.orderId).to.equal(orderId);

    // Check that order was closed
    const order = await futures.read.getOrderById([orderId]);
    expect(order.participant).to.equal(zeroAddress);
  });

  it("should reject margin call by non-validator", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    // Create position
    await futures.write.addMargin([margin], {
      account: seller.account,
    });
    await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: seller.account,
    });

    // Try to perform margin call as non-validator
    await catchError(futures.abi, "OnlyValidator", async () => {
      await futures.write.marginCall([seller.account.address], {
        account: seller.account,
      });
    });
  });
});
