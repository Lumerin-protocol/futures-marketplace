import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFuturesFixture } from "./fixtures";
import { encodeFunctionData, getAddress, parseEventLogs } from "viem";
import { expect } from "chai";

describe("Futures - multicall write", function () {
  it("should perform multicall write", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, pc } = accounts;
    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];
    await futures.write.addMargin([price * 10n], {
      account: seller.account,
    });

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

    const tx = await futures.write.multicall([calldata], {
      account: seller.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });

    const events = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    expect(events.length).to.equal(2);
    for (const event of events) {
      expect(event.args.participant).to.equal(getAddress(seller.account.address));
    }

    // now close the orders
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

    const closeTx = await futures.write.multicall([closeCalldata], {
      account: seller.account,
    });
    const closeReceipt = await pc.waitForTransactionReceipt({ hash: closeTx });

    const closeEvents = parseEventLogs({
      logs: closeReceipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });
    expect(closeEvents.length).to.equal(2);
    for (const event of closeEvents) {
      expect(event.args.participant).to.equal(getAddress(seller.account.address));
    }
  });
});
