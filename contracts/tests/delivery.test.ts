import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFuturesFixture } from "./fixtures";
import { Account, Client, parseEventLogs, parseUnits } from "viem";
import { expect } from "chai";
import { quantizePrice } from "./utils";
import { catchError } from "../../lib";

describe("Futures Delivery", () => {
  async function positionFixture() {
    const data = await loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures } = contracts;
    const { seller, buyer, pc } = accounts;

    async function logBalance(client: Client, name: string) {
      const balance = await futures.read.balanceOf([client!.account!.address]);
      console.log(`${name} balance`, balance);
    }

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const marginAmount = parseUnits("1000", 6);
    const deliveryDate = config.deliveryDates[0];

    // Add margin for both participants
    await futures.write.addMargin([marginAmount], {
      account: seller.account,
    });
    await futures.write.addMargin([marginAmount], {
      account: buyer.account,
    });

    logBalance(seller, "seller");
    logBalance(buyer, "buyer");

    // Create matching orders to form a position
    const dst = "https://destination-url.com";
    await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });
    const txHash = await futures.write.createOrder([price, deliveryDate, dst, 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [orderEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });
    const { positionId } = orderEvent.args;

    return {
      ...data,
      position: { positionId, deliveryDate, price, marginAmount, seller, buyer },
      logBalance,
    };
  }
  it("check behaviour when 50% is not delivered and price not changed", async () => {
    const data = await loadFixture(positionFixture);
    const { contracts, position, accounts, config, logBalance } = data;
    const { seller, buyer, tc, validator } = accounts;
    const { futures } = contracts;

    await tc.setNextBlockTimestamp({
      timestamp: position.deliveryDate + BigInt(config.deliveryDurationSeconds) / 2n,
    });
    await futures.write.closeDelivery([position.positionId, true], {
      account: validator.account,
    });
    await logBalance(seller, "seller after close");
    await logBalance(buyer, "buyer after close");
  });

  it("should handle expired positions", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, buyer, pc, tc } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * BigInt(config.deliveryDurationDays);
    const deliveryDate = config.deliveryDates[0];

    // Create matching positions to form an order
    await futures.write.addMargin([margin], {
      account: seller.account,
    });
    await futures.write.addMargin([margin], {
      account: buyer.account,
    });
    await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [orderEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    const { positionId } = orderEvent.args;

    // Move time to after order expiration (30 days + 1 second)
    await tc.setNextBlockTimestamp({
      timestamp: deliveryDate + BigInt(config.deliveryDurationSeconds) + 1n,
    });

    // Try to close expired order
    await catchError(futures.abi, "PositionDeliveryExpired", async () => {
      await futures.write.closeDelivery([positionId, false], {
        account: buyer.account,
      });
    });
  });
});
describe("Position Management", function () {
  it("should not allow buyer to close position before start time", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = parseUnits("100", 6);
    const deliveryDate = config.deliveryDates[0];
    const marginAmount = parseUnits("1000", 6);

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
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [positionEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    const { positionId } = positionEvent.args;

    await catchError(futures.abi, "PositionDeliveryNotStartedYet", async () => {
      await futures.write.closeDelivery([positionId, false], {
        account: buyer.account,
      });
    });
  });

  it("should not allow seller to close position before start time", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = parseUnits("100", 6);
    const deliveryDate = config.deliveryDates[0];
    const marginAmount = parseUnits("1000", 6);

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
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [createdEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    const { positionId } = createdEvent.args;

    // Close position as seller
    await catchError(futures.abi, "PositionDeliveryNotStartedYet", async () => {
      await futures.write.closeDelivery([positionId, false], {
        account: seller.account,
      });
    });
  });

  it("should reject closing position by non-participant", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, buyer, buyer2, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    // Create matching orders
    await futures.write.addMargin([margin], {
      account: seller.account,
    });
    await futures.write.addMargin([margin], {
      account: buyer.account,
    });
    await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [createdEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    const { positionId } = createdEvent.args;

    // Try to close order with different account
    await catchError(futures.abi, "OnlyValidatorOrPositionParticipant", async () => {
      await futures.write.closeDelivery([positionId, false], {
        account: buyer2.account,
      });
    });
  });
});
