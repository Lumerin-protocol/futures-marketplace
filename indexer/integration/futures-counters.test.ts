/**
 * Integration tests: global counters and User aggregation invariants.
 *
 * Per-entity tests cover their own state mutations, but the global
 * `Futures` singleton stats (`totalUsers`, `totalOrders`, `activeOrders`,
 * `totalTrades`, `totalFills`, `totalVolume`) can drift if one of the
 * mutations forgets a counter update. This file walks through an
 * end-to-end scenario and pins down every counter at each step so a
 * silent regression is caught immediately.
 *
 * It also pins down the documented semantic split between
 * `User.tradeCount` (per-tx aggregate row) and `User.fillCount`
 * (per-counterparty within tx):
 *   - same-tx multi-counterparty fill → tradeCount += 1, fillCount += N
 *   - different-tx fills against same counterparty → tradeCount += 1,
 *     fillCount += 1 each, totals += 2 / +2
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read, type EntityFields } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { TimeInForce } from "../../contracts/tests/timeInForce.ts";

const conn = await network.getOrCreate();

describe("Futures singleton counters: stepwise consistency through a trade flow", () => {
  after(() => conn.matchstick.reset());

  it("totalUsers / totalOrders / activeOrders / totalTrades / totalFills / totalVolume", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const askPrice = price + 5n * config.priceLadderStep;
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("HashPowerFutures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // --- Step 1: seller rests an ask (no match). ---
    const askTx = await futures.write.createOrder([askPrice, deliveryDate, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    const askReceipt = await pc.waitForTransactionReceipt({ hash: askTx });
    const [askOrder] = parseEventLogs({
      logs: askReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const askOrderId = askOrder.args.orderId.toLowerCase() as `0x${string}`;

    let snap = await conn.matchstick.indexSnapshot([read("Futures", "0")]);
    let f = snap.entity("Futures", "0");
    assert.ok(f);
    assert.equal(String(f.totalUsers), "1", "1 user after first order");
    assert.equal(String(f.totalOrders), "1");
    assert.equal(String(f.activeOrders), "1");
    assert.equal(String(f.totalTrades), "0", "no fills yet");
    assert.equal(String(f.totalFills), "0");
    assert.equal(String(f.totalVolume), "0", "volume only ticks when orders are matched");

    // --- Step 2: seller cancels — activeOrders back to 0, totalOrders sticky. ---
    await futures.write.cancelOrder([askOrderId], { account: seller.account });

    snap = await conn.matchstick.indexSnapshot([read("Futures", "0")]);
    f = snap.entity("Futures", "0");
    assert.ok(f);
    assert.equal(String(f.activeOrders), "0", "cancel drops activeOrders");
    assert.equal(String(f.totalOrders), "1", "totalOrders is monotonic across cancels");

    // --- Step 3: matched trade — buyer takes seller's order. ---
    await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], { account: buyer.account });

    snap = await conn.matchstick.indexSnapshot([read("Futures", "0")]);
    f = snap.entity("Futures", "0");
    assert.ok(f);
    assert.equal(String(f.totalUsers), "2", "buyer becomes a User on first activity");
    assert.equal(
      String(f.totalOrders),
      "3",
      "first ask + new ask + buyer's matched buy → 3 Order aggregates total",
    );
    assert.equal(String(f.activeOrders), "0", "both orders fully matched/cancelled");
    assert.equal(String(f.totalTrades), "2", "one Trade per side");
    assert.equal(String(f.totalFills), "2", "one Fill per side");

    const expectedVolume = price;
    assert.equal(
      String(f.totalVolume),
      String(expectedVolume),
      "totalVolume = price per matched unit",
    );
  });
});

describe("User.tradeCount vs User.fillCount: per-tx aggregation semantics", () => {
  after(() => conn.matchstick.reset());

  it("same-tx N counterparties → 1 Trade, N Fills for the taker", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, buyer2, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await collateralVault.write.deposit([margin], { account: buyer2.account });

    conn.matchstick.bind("HashPowerFutures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Two MAKERS rest sell orders at the same price.
    await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], { account: buyer.account });
    await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], { account: buyer2.account });

    // ONE taker buys qty=2 → matches both makers in a single tx.
    const takeTx = await futures.write.createOrder([price, deliveryDate, 2n, TimeInForce.GTC], {
      account: seller.account,
    });
    const takeReceipt = await pc.waitForTransactionReceipt({ hash: takeTx });
    const matchedEvents = parseEventLogs({
      logs: takeReceipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(matchedEvents.length, 2, "taker must match both makers in one tx");

    const takerAddr = seller.account.address.toLowerCase() as `0x${string}`;

    const snap = await conn.matchstick.indexSnapshot([read("User", takerAddr)]);
    const takerUser = snap.entity("User", takerAddr);
    assert.ok(takerUser);

    assert.equal(
      String(takerUser.tradeCount),
      "1",
      "taker has one aggregated Trade row per tx, regardless of counterparties",
    );
    assert.equal(
      String(takerUser.fillCount),
      "2",
      "taker has one Fill row per distinct counterparty in the same tx",
    );

    const takerFills = snap
      .saved("Fill")
      .filter((f: EntityFields) => String(f.user).toLowerCase() === takerAddr);
    assert.equal(takerFills.length, 2);
    const takerCounterparties = new Set(
      takerFills.map((f: EntityFields) => String(f.counterparty).toLowerCase()),
    );
    assert.equal(
      takerCounterparties.size,
      2,
      "taker's two Fills must be against distinct counterparties",
    );

    const takerTrades = snap
      .saved("Trade")
      .filter((t: EntityFields) => String(t.user).toLowerCase() === takerAddr);
    assert.equal(takerTrades.length, 1, "taker has exactly one Trade aggregate per tx");
  });
});
