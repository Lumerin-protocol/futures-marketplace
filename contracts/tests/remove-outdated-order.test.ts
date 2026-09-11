import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits, zeroHash } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { warpPastDeliveryWithFreshOracle } from "./utils.ts";
import { TimeInForce } from "./timeInForce.ts";
import {
  getUserOrders,
} from "./lib/viewHelpers.ts";

const { networkHelpers } = await network.getOrCreate();

describe("HashPowerFutures.removeOutdatedOrders", () => {
  it("bulk-cleans expired orders while skipping stale and live ids", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc, tc } = accounts;

    await collateralVault.write.deposit([parseUnits("5000", 6)], { account: seller.account });

    const mp = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const expiringDd = config.deliveryDates[0];

    const restingIds: `0x${string}`[] = [];
    for (let i = 0; i < 2; i++) {
      const tx = await futures.write.createOrder(
        [mp + BigInt(i) * step, expiringDd, -1n, TimeInForce.GTC],
        {
          account: seller.account,
        },
      );
      const [ev] = parseEventLogs({
        logs: (await pc.waitForTransactionReceipt({ hash: tx })).logs,
        abi: futures.abi,
        eventName: "OrderCreated",
      });
      restingIds.push(ev.args.orderId);
    }

    await warpPastDeliveryWithFreshOracle(
      tc,
      contracts.hashpriceUsd,
      expiringDd,
      BigInt(config.expirationIntervalSeconds),
    );
    const futureDates = await futures.read.getExpirationDates();
    const freshDd = futureDates[futureDates.length - 1];
    const freshTx = await futures.write.createOrder([mp + 2n * step, freshDd, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    const [freshCreated] = parseEventLogs({
      logs: (await pc.waitForTransactionReceipt({ hash: freshTx })).logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    const tx = await futures.write.removeOutdatedOrders(
      [[restingIds[0], zeroHash, freshCreated.args.orderId, restingIds[1], restingIds[0]]],
      { account: buyer.account },
    );
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });

    const closed = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCancelled",
    });
    assert.deepEqual(
      closed.map((event) => event.args.orderId),
      restingIds,
    );

    const finalOrders = await getUserOrders(futures, seller.account.address);
    assert.deepEqual(finalOrders, [freshCreated.args.orderId]);
  });
});
