import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { refreshHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

describe("Validator Functions", () => {
  it("should allow validator to close position after start time", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, validator, pc, tc } = accounts;

    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];
    const marginAmount = price * 7n;

    await collateralVault.write.deposit([marginAmount], { account: seller.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [orderEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const { lotId: positionId } = orderEvent.args;

    // Move time to after start time but before expiration
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n }); // 1 day + 1 second
    await refreshHashprice(contracts.hashrateOracle);

    const closeTxHash = await futures.write.closeDelivery([positionId, true], {
      account: validator.account,
    });

    const closeReceipt = await pc.waitForTransactionReceipt({ hash: closeTxHash });
    const [closeEvent] = parseEventLogs({
      logs: closeReceipt.logs,
      abi: futures.abi,
      eventName: "LotClosed",
    });

    assert.equal(closeEvent.args.lotId, positionId);
    assert.equal(closeEvent.args.reason, 2);
    assert.equal(getAddress(closeEvent.args.closedBy), getAddress(validator.account.address));
  });

  it("should reject validator closing position before start time", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, validator, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [createdEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const { lotId: positionId } = createdEvent.args;

    await viem.assertions.revertWithCustomError(
      futures.write.closeDelivery([positionId, true], { account: validator.account }),
      futures,
      "PositionDeliveryNotStartedYet",
    );
  });

  it("should reject non-validator from calling validator functions", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, buyer2, pc, tc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [orderEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const { lotId: positionId } = orderEvent.args;

    await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n });

    await viem.assertions.revertWithCustomError(
      futures.write.closeDelivery([positionId, true], { account: buyer2.account }),
      futures,
      "OnlyValidatorOrPositionParticipant",
    );
  });
});
