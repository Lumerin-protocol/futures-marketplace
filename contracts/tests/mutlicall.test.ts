import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData, getAddress, parseEventLogs } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";

const { networkHelpers } = await network.getOrCreate();

describe("Futures - multicall write", () => {
  it("should perform multicall write", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;
    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];
    await collateralVault.write.deposit([price * 10n], { account: seller.account });

    const calldata = [
      encodeFunctionData({
        abi: futures.abi,
        functionName: "createOrder",
        args: [price, deliveryDate, "", -1],
      }),
      encodeFunctionData({
        abi: futures.abi,
        functionName: "createOrder",
        args: [price, deliveryDate, "", -1],
      }),
    ];

    const tx = await futures.write.multicall([calldata], { account: seller.account });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });

    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(events.length, 2);
    for (const event of events) {
      assert.equal(event.args.participant, getAddress(seller.account.address));
    }

    const closeCalldata = [
      encodeFunctionData({
        abi: futures.abi,
        functionName: "createOrder",
        args: [price, deliveryDate, "", 1],
      }),
      encodeFunctionData({
        abi: futures.abi,
        functionName: "createOrder",
        args: [price, deliveryDate, "", 1],
      }),
    ];

    const closeTx = await futures.write.multicall([closeCalldata], { account: seller.account });
    const closeReceipt = await pc.waitForTransactionReceipt({ hash: closeTx });

    const closeEvents = parseEventLogs({
      logs: closeReceipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });
    assert.equal(closeEvents.length, 2);
    for (const event of closeEvents) {
      assert.equal(event.args.participant, getAddress(seller.account.address));
    }
  });
});
