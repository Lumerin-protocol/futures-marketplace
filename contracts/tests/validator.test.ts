import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFuturesFixture } from "./fixtures";
import { parseEventLogs, parseUnits, getAddress } from "viem";
import { expect } from "chai";
import { catchError } from "../../lib";

describe("Validator Functions", function () {
  it("should allow validator to close position after start time", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, buyer, validator, pc, tc } = accounts;

    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];
    const marginAmount = price * 7n;

    // Add margin for both participants
    await futures.write.addMargin([marginAmount], {
      account: seller.account,
    });
    await futures.write.addMargin([marginAmount], {
      account: buyer.account,
    });

    // Create matching orders to form a position
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

    // Move time to after start time but before expiration
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n }); // 1 day + 1 second

    // Close order as validator
    const closeTxHash = await futures.write.closeDelivery([positionId, true], {
      account: validator.account,
    });

    const closeReceipt = await pc.waitForTransactionReceipt({ hash: closeTxHash });
    const [closeEvent] = parseEventLogs({
      logs: closeReceipt.logs,
      abi: futures.abi,
      eventName: "PositionDeliveryClosed",
    });

    expect(closeEvent.args.positionId).to.equal(positionId);
    expect(getAddress(closeEvent.args.closedBy)).to.equal(getAddress(validator.account.address));
  });

  it("should reject validator closing position before start time", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, buyer, validator, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    // Create matching orders to form an position
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

    // Try to close order as validator before start time
    await catchError(futures.abi, "PositionDeliveryNotStartedYet", async () => {
      await futures.write.closeDelivery([positionId, true], {
        account: validator.account,
      });
    });
  });

  it("should reject non-validator from calling validator functions", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, buyer, buyer2, pc, tc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
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

    await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n });

    // Try to close order as non-validator
    await catchError(futures.abi, "OnlyValidatorOrPositionParticipant", async () => {
      await futures.write.closeDelivery([positionId, true], {
        account: buyer2.account,
      });
    });
  });
});
