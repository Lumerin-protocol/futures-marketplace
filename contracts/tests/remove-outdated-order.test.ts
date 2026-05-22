import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData, parseEventLogs, parseUnits, zeroHash } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";

const { viem, networkHelpers } = await network.getOrCreate();

type OrderIntent = {
  pricePerDay: bigint;
  deliveryDate: bigint;
  destURL: string;
  qty: number;
};

describe("Futures.removeOutdatedOrder", () => {
  it("closes a single expired order and emits OrderClosed(EXPIRED)", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc, tc } = accounts;

    await collateralVault.write.deposit([parseUnits("5000", 6)], { account: seller.account });

    const mp = await futures.read.getMarketPrice();
    const dd = config.deliveryDates[0];

    const restTx = await futures.write.createOrder([mp, dd, "", -1], { account: seller.account });
    const [created] = parseEventLogs({
      logs: (await pc.waitForTransactionReceipt({ hash: restTx })).logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const orderId = created.args.orderId;

    await tc.setNextBlockTimestamp({
      timestamp: dd + BigInt(config.deliveryDurationSeconds) + 1n,
    });

    const tx = await futures.write.removeOutdatedOrder([orderId], { account: seller.account });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    const closed = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });
    assert.equal(closed.length, 1);
    assert.equal(closed[0].args.orderId, orderId);
    // OrderCloseReason.EXPIRED == 2
    assert.equal(closed[0].args.reason, 2);

    const orders = await futures.read.getOrderIds([seller.account.address]);
    assert.equal(orders.length, 0);
  });

  it("reverts OrderNotExists for an unknown / already-closed orderId", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.removeOutdatedOrder([zeroHash], { account: seller.account }),
      futures,
      "OrderNotExists",
    );
  });

  it("reverts OrderNotExpired when the order's deliveryAt is still in the future", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    await collateralVault.write.deposit([parseUnits("5000", 6)], { account: seller.account });

    const mp = await futures.read.getMarketPrice();
    const dd = config.deliveryDates[0];

    const restTx = await futures.write.createOrder([mp, dd, "", -1], { account: seller.account });
    const [created] = parseEventLogs({
      logs: (await pc.waitForTransactionReceipt({ hash: restTx })).logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    await viem.assertions.revertWithCustomError(
      futures.write.removeOutdatedOrder([created.args.orderId], { account: seller.account }),
      futures,
      "OrderNotExpired",
    );
  });

  it("is callable by any address (permissionless)", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc, tc } = accounts;

    await collateralVault.write.deposit([parseUnits("5000", 6)], { account: seller.account });

    const mp = await futures.read.getMarketPrice();
    const dd = config.deliveryDates[0];

    const restTx = await futures.write.createOrder([mp, dd, "", -1], { account: seller.account });
    const [created] = parseEventLogs({
      logs: (await pc.waitForTransactionReceipt({ hash: restTx })).logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    await tc.setNextBlockTimestamp({
      timestamp: dd + BigInt(config.deliveryDurationSeconds) + 1n,
    });

    // `buyer`, not the order owner, cleans it up.
    const tx = await futures.write.removeOutdatedOrder([created.args.orderId], {
      account: buyer.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    assert.equal(receipt.status, "success");

    const orders = await futures.read.getOrderIds([seller.account.address]);
    assert.equal(orders.length, 0);
  });

  it("composes via multicall: bulk-clean N expired orders + place fresh ones in one tx", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc, tc } = accounts;

    await collateralVault.write.deposit([parseUnits("5000", 6)], { account: seller.account });

    const mp = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const expiringDd = config.deliveryDates[0];
    const N = 3;

    // Rest N orders at the soon-to-expire date.
    const restingIds: `0x${string}`[] = [];
    for (let i = 0; i < N; i++) {
      const tx = await futures.write.createOrder(
        [mp + BigInt(i) * step, expiringDd, "", -1],
        { account: seller.account },
      );
      const [ev] = parseEventLogs({
        logs: (await pc.waitForTransactionReceipt({ hash: tx })).logs,
        abi: futures.abi,
        eventName: "OrderCreated",
      });
      restingIds.push(ev.args.orderId);
    }

    // Fast-forward past expiringDd's window. Pick a placement date that is
    // still valid afterwards.
    await tc.setNextBlockTimestamp({
      timestamp: expiringDd + BigInt(config.deliveryDurationSeconds) + 1n,
    });
    const futureDates = await futures.read.getDeliveryDates();
    const freshDd = futureDates[futureDates.length - 1];

    // Build a single multicall: [N × removeOutdatedOrder, createOrders([1 new])].
    const calls: `0x${string}`[] = [];
    for (const id of restingIds) {
      calls.push(
        encodeFunctionData({
          abi: futures.abi,
          functionName: "removeOutdatedOrder",
          args: [id],
        }),
      );
    }
    calls.push(
      encodeFunctionData({
        abi: futures.abi,
        functionName: "createOrders",
        args: [
          [
            {
              pricePerDay: mp,
              deliveryDate: freshDd,
              destURL: "",
              qty: -1,
            } satisfies OrderIntent,
          ],
        ],
      }),
    );

    const tx = await futures.write.multicall([calls], { account: seller.account });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });

    const closed = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });
    assert.equal(closed.length, N);
    for (const ev of closed) {
      assert.equal(ev.args.reason, 2);
    }

    const created = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(created.length, 1);
    assert.equal(created[0].args.deliveryAt, freshDd);

    const finalOrders = await futures.read.getOrderIds([seller.account.address]);
    assert.equal(finalOrders.length, 1, "only the freshly placed order remains");
  });
});
