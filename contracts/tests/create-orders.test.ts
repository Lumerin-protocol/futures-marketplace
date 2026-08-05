import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData, getAddress, parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { warpPastDeliveryWithFreshOracle } from "./utils.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

// Reusable per-intent shape that matches `Futures.OrderIntent` exactly.
type OrderIntent = {
  price: bigint;
  expirationAt: bigint;
  quantity: bigint;
  timeInForce: number;
};

describe("Futures.createOrders (batch placement)", () => {
  it("empty intents array is a no-op", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    // Even with zero collateral, an empty batch must succeed: outdated-orders
    // sweep is empty, and the IM check passes trivially (required = 0).
    const balanceBefore = await collateralVault.read.balanceOf([seller.account.address]);

    const tx = await futures.write.createOrders([[]], { account: seller.account });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    assert.equal(receipt.status, "success");

    const created = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(created.length, 0);
    assert.equal(await collateralVault.read.balanceOf([seller.account.address]), balanceBefore);
  });

  it("places multiple same-side orders in one call and emits one OrderCreated per intent", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });

    const mp = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const dd = config.deliveryDates[0];

    const intents: OrderIntent[] = [
      { price: mp + step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      { price: mp + 2n * step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      { price: mp + 3n * step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      // qty > 1 expands into multiple OrderCreated events under the same intent
      { price: mp + 4n * step, expirationAt: dd, quantity: -2n, timeInForce: TimeInForce.GTC },
    ];

    const tx = await futures.write.createOrders([intents], { account: seller.account });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    assert.equal(receipt.status, "success");

    const created = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    // One OrderCreated per intent (qty-bearing); intents are -1,-1,-1,-2 → 4 events.
    assert.equal(created.length, 4);
    const qtys = created.map((ev) => ev.args.quantity).sort((a, b) => (a < b ? -1 : 1));
    assert.deepEqual(qtys, [-2n, -1n, -1n, -1n]);
    for (const ev of created) {
      assert.equal(getAddress(ev.args.participant), getAddress(seller.account.address));
      assert.equal(ev.args.expirationAt, dd);
    }
  });

  it("matches against a resting opposite-side book in a single call", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    const mp = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const dd = config.deliveryDates[0];

    // Seller rests asks at mp, mp+step, mp+2*step.
    const restingAsks: OrderIntent[] = [
      { price: mp, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      { price: mp + step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      { price: mp + 2n * step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
    ];
    await futures.write.createOrders([restingAsks], { account: seller.account });

    // Buyer batches three lifts at exactly those three levels.
    const lifts: OrderIntent[] = restingAsks.map((a) => ({
      price: a.price,
      expirationAt: dd,
      quantity: 1n,
      timeInForce: TimeInForce.GTC,
    }));
    const tx = await futures.write.createOrders([lifts], { account: buyer.account });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    assert.equal(receipt.status, "success");

    const matches = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(matches.length, 3);
    for (const m of matches) {
      assert.equal(getAddress(m.args.maker), getAddress(seller.account.address));
      assert.equal(getAddress(m.args.taker), getAddress(buyer.account.address));
      assert.equal(m.args.expirationAt, dd);
      assert.equal(m.args.takerQuantity, 1n);
    }
  });

  it("reverts atomically when any intent fails validation (zero price)", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });

    const mp = await futures.read.getMarketPrice();
    const dd = config.deliveryDates[0];

    const intents: OrderIntent[] = [
      { price: mp, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      // Bad: zero price → InvalidPrice
      { price: 0n, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      {
        price: mp + config.priceLadderStep,
        expirationAt: dd,
        quantity: -1n,
        timeInForce: TimeInForce.GTC,
      },
    ];

    await viem.assertions.revertWithCustomError(
      futures.write.createOrders([intents], { account: seller.account }),
      futures,
      "InvalidPrice",
    );

    // Nothing should have landed; the seller's order set must remain empty.
    const sellerOrders = await futures.read.getUserOrders([seller.account.address]);
    assert.equal(sellerOrders.length, 0);

    // Sanity: matching tx-cost gas via a successful baseline call.
    const tx = await futures.write.createOrders(
      [
        [
          {
            price: mp,
            expirationAt: dd,
            quantity: -1n,
            timeInForce: TimeInForce.GTC,
          } satisfies OrderIntent,
        ],
      ],
      { account: seller.account },
    );
    assert.equal((await pc.waitForTransactionReceipt({ hash: tx })).status, "success");
  });

  it("reverts InsufficientMarginBalance from the single end-of-batch IM check", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    // No deposit → any placement leaves balance(0) < required(>0) at the IM check.
    // We use multiple intents to confirm the failure happens at the end-of-batch
    // check rather than inside the placement loop, and that the whole batch
    // unwinds atomically (no resting orders left behind).
    const mp = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const dd = config.deliveryDates[0];

    const intents: OrderIntent[] = [
      { price: mp, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      { price: mp + step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      { price: mp + 2n * step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
    ];

    await viem.assertions.revertWithCustomError(
      futures.write.createOrders([intents], { account: seller.account }),
      futures,
      "InsufficientMarginBalance",
    );

    const sellerOrders = await futures.read.getUserOrders([seller.account.address]);
    assert.equal(sellerOrders.length, 0);
  });

  it("does not auto-sweep expired orders on the hot path", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc, tc } = accounts;

    await collateralVault.write.deposit([parseUnits("5000", 6)], { account: seller.account });

    const mp = await futures.read.getMarketPrice();
    const dd = config.deliveryDates[0];

    // Seller rests one order.
    await futures.write.createOrder([mp, dd, -1n, TimeInForce.GTC], { account: seller.account });

    await warpPastDeliveryWithFreshOracle(
      tc,
      contracts.hashpriceUsd,
      dd,
      BigInt(config.expirationIntervalSeconds),
    );

    // The stale order is now past `expirationAt`, but a fresh `createOrders`
    // call must NOT close it (the prologue sweep is gone). The only effect on
    // the seller's order set is the newly-added intent.
    const ordersBefore = await futures.read.getUserOrders([seller.account.address]);
    assert.equal(ordersBefore.length, 1, "stale order should still be present pre-placement");

    const freshDeliveryDate = (await futures.read.getExpirationDates()).at(-1);
    if (!freshDeliveryDate) {
      assert.fail("no delivery dates");
    }
    const tx = await futures.write.createOrders(
      [
        [
          {
            price: mp,
            expirationAt: freshDeliveryDate,
            quantity: -1n,
            timeInForce: TimeInForce.GTC,
          } satisfies OrderIntent,
        ],
      ],
      { account: seller.account },
    );
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });

    // No OrderClosed(EXPIRED) was emitted as a side effect.
    const closed = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCancelled",
    });
    assert.equal(closed.length, 0, "createOrders must not implicitly close expired orders");

    const ordersAfter = await futures.read.getUserOrders([seller.account.address]);
    assert.equal(ordersAfter.length, 2, "stale order is still resting next to the new one");
  });

  it("is cheaper than the equivalent multicall(createOrder × N)", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    // Fixture tops each wallet up to 10k USDC, so deposit a bit under that.
    await collateralVault.write.deposit([parseUnits("5000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("5000", 6)], { account: buyer.account });

    const mp = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const dd = config.deliveryDates[0];
    const N = 4;

    // Baseline: N × createOrder under one multicall (the current MM behavior).
    const baselineCalldata: `0x${string}`[] = [];
    for (let i = 0; i < N; i++) {
      baselineCalldata.push(
        encodeFunctionData({
          abi: futures.abi,
          functionName: "createOrder",
          args: [mp + BigInt(i + 1) * step, dd, -1n, TimeInForce.GTC],
        }),
      );
    }
    const baselineTx = await futures.write.multicall([baselineCalldata], {
      account: seller.account,
    });
    const baselineGas = (await pc.waitForTransactionReceipt({ hash: baselineTx })).gasUsed;

    // Candidate: a single createOrders call placing N orders on a *different*
    // participant so book state stays comparable (no resting orders to match).
    const intents: OrderIntent[] = [];
    for (let i = 0; i < N; i++) {
      // Place buys far below market so they rest without matching the seller's asks.
      intents.push({
        price: mp - BigInt(i + 1) * step,
        expirationAt: dd,
        quantity: 1n,
        timeInForce: TimeInForce.GTC,
      });
    }
    const batchTx = await futures.write.createOrders([intents], { account: buyer.account });
    const batchGas = (await pc.waitForTransactionReceipt({ hash: batchTx })).gasUsed;

    // The savings scale with how much work `computePortfolioIM` does — the more
    // resting state, the bigger the win — so we only assert an absolute floor
    // that's still meaningful in the bare test fixture (the PME stack here is a
    // mock; on a real deployment with multiple registered venues the savings
    // grow substantially).
    assert.ok(
      batchGas < baselineGas,
      `createOrders (${batchGas}) should be cheaper than multicall(createOrder × ${N}) (${baselineGas})`,
    );
    const savings = baselineGas - batchGas;
    // Floor: each of the (N-1) skipped end-of-call IM checks must be worth at
    // least ~8k gas (cross-contract call + engine reads). The futures margin
    // views now iterate only the participant's touched expiration dates (one
    // here) instead of a fixed future-date window, so each IM check is cheaper
    // than before and the per-skip floor is lower. 24k for N=4.
    const minSavings = BigInt(N - 1) * 8_000n;
    assert.ok(
      savings >= minSavings,
      `expected ≥${minSavings} gas saved over ${N} placements; got ${savings} (${baselineGas} → ${batchGas})`,
    );
  });
});
