/**
 * Integration test: owner forced settlement keeps the subgraph equal to the chain.
 *
 * `forceCancelOrders` and `forceClosePositions` replace the old `resetState`, which
 * deleted positions without an event. Each scenario replays every log from deployment
 * through the mappings and then compares the indexed book, pointers and sessions against
 * the contract views, so any storage change without a matching event shows up as a
 * mismatch.
 *
 * Book before the forced calls (p = mark, s = ladder step, first / second delivery date):
 *   - first: seller short 2 (1 at p, 1 at p + 2s), buyer long 1 at p, buyer2 long 1 at p + 2s
 *     asks: seller 1 left of a 2-lot order at p + 2s, seller 1 and buyer2 1 at p + 3s
 *     bids: buyer 1 and buyer2 1 at p - s
 *   - second: seller long 1 against buyer short 1 at p - s, seller ask 1 at p + s
 * buyer2 shares both first-date levels with a forced user, so a forced cancel must drain a
 * level only partially.
 */
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import type { NetworkConnection } from "hardhat/types/network";
import { type Address, type Hex, parseEventLogs, parseUnits, zeroAddress } from "viem";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { TimeInForce } from "../../contracts/tests/timeInForce.ts";
import { quantizePrice, refreshHashprice } from "../../contracts/tests/utils.ts";
import { pointerId, priceLevelId } from "./helpers.ts";

const conn = await network.getOrCreate();
const { matchstick } = conn;

const RESTING = new Set(["ACTIVE", "PARTIALLY_FILLED"]);

async function bookFixture(c: NetworkConnection) {
  const data = await c.networkHelpers.loadFixture(deployFuturesFixture);
  const { futures, collateralVault } = data.contracts;
  const { seller, buyer, buyer2 } = data.accounts;
  const [first, second] = data.config.deliveryDates;
  const s = data.config.priceLadderStep;
  const p = quantizePrice(await futures.read.getMarketPrice(), s);
  type Wallet = typeof seller;
  const place = (who: Wallet, price: bigint, date: bigint, qty: bigint) =>
    futures.write.createOrder([price, date, qty, TimeInForce.GTC], { account: who.account });

  for (const who of [seller, buyer, buyer2]) {
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: who.account });
  }
  await place(seller, p, first, -1n);
  await place(buyer, p, first, 1n);
  await place(seller, p + 2n * s, first, -2n);
  await place(buyer2, p + 2n * s, first, 1n);
  await place(seller, p + 3n * s, first, -1n);
  await place(buyer2, p + 3n * s, first, -1n);
  await place(buyer, p - s, first, 1n);
  await place(buyer2, p - s, first, 1n);
  await place(seller, p - s, second, 1n);
  await place(buyer, p - s, second, -1n);
  await place(seller, p + s, second, -1n);

  const users = [seller, buyer, buyer2].map((w) => w.account.address);
  const legs = users.flatMap((user) => [first, second].map((date) => [user, date] as const));
  return { ...data, users, legs, book: { p, s, first, second } };
}

type Fixture = Awaited<ReturnType<typeof bookFixture>>;
type Snap = Awaited<ReturnType<typeof matchstick.indexSnapshot>>;

async function setup() {
  const fixture = await conn.networkHelpers.loadFixture(bookFixture);
  const { futures } = fixture.contracts;
  matchstick.bind("HashPowerFutures", futures.address, futures.abi);
  await matchstick.captureViewMocks();
  return fixture;
}

const id = (address: Address) => address.toLowerCase();
const big = (value: unknown) => BigInt(String(value));
const abs = (value: bigint) => (value < 0n ? -value : value);
const columns = (legs: Fixture["legs"]) =>
  [legs.map(([user]) => user), legs.map(([, date]) => date)] as [Address[], bigint[]];

/** Every indexed order, price level, user, pointer and session agrees with the contract views. */
async function assertMatchesChain(snap: Snap, { contracts, users, legs }: Fixture) {
  const { futures } = contracts;

  for (const order of snap.saved("Order")) {
    const onChain = await futures.read.getOrder([String(order.id) as Hex]);
    const resting = onChain.participant !== zeroAddress;
    assert.equal(RESTING.has(String(order.status)), resting, `Order ${order.id} is ${order.status}`);
    assert.equal(big(order.quantity), abs(onChain.quantity), `Order ${order.id} remaining size`);
  }

  const levelCounts = new Map<string, number>();
  const userCounts = new Map<string, number>();
  let restingCount = 0;
  let openPositions = 0;
  for (const [user, date] of legs) {
    const orderIds = await futures.read.getUserOrdersAtExpiration([user, date]);
    restingCount += orderIds.length;
    userCounts.set(user, (userCounts.get(user) ?? 0) + orderIds.length);
    for (const orderId of orderIds) {
      const order = await futures.read.getOrder([orderId]);
      const key = priceLevelId(date, order.price, order.quantity > 0n);
      levelCounts.set(key, (levelCounts.get(key) ?? 0) + 1);
    }

    const { netQuantity } = await futures.read.getUserPosition([user, date]);
    const pointer = snap.entity("UserDeliverySessionPointer", pointerId(user, date));
    const label = `${user}@${date}`;
    assert.equal(big(pointer?.netQuantity ?? 0), netQuantity, `pointer ${label} netQuantity`);
    if (netQuantity === 0n) {
      assert.equal(pointer?.currentSessionId ?? "", "", `flat pointer ${label} has no open session`);
    } else {
      openPositions++;
      assert.ok(pointer);
      const session = snap.entity("PositionSession", String(pointer.currentSessionId));
      assert.ok(session, `pointer ${label} open session indexed`);
      assert.equal(session.status, "OPEN");
      assert.equal(big(session.netQuantity), netQuantity);
    }
  }

  for (const user of users) {
    assert.equal(snap.get("User", id(user), "activeOrderCount"), userCounts.get(user), `User ${user} activeOrderCount`);
  }

  for (const level of snap.saved("PriceLevel")) {
    assert.equal(
      big(level.totalQuantity),
      await futures.read.getQuantityAtPrice([big(level.expirationAt), big(level.price), Boolean(level.isBid)]),
      `PriceLevel ${level.id} totalQuantity`,
    );
    assert.equal(level.orderCount, levelCounts.get(String(level.id)) ?? 0, `PriceLevel ${level.id} orderCount`);
  }

  const openSessions = snap.saved("PositionSession").filter((session) => session.status === "OPEN");
  assert.equal(openSessions.length, openPositions, "one OPEN session per open position");
  assert.equal(snap.get("Futures", "0", "activeOrders"), restingCount, "Futures.activeOrders");
}

describe("forced settlement: the indexer follows forceCancelOrders and forceClosePositions", () => {
  beforeEach(() => matchstick.reset());
  after(() => matchstick.reset());

  it("forceCancelOrders drops the legs' orders, including a partial fill, and leaves positions", async () => {
    const fixture = await setup();
    const { futures, collateralVault } = fixture.contracts;
    const { owner, seller, buyer, buyer2, pc } = fixture.accounts;
    const { p, s, first, second } = fixture.book;
    const [partialId] = await futures.read.getUserOrdersAtExpiration([seller.account.address, first]);
    const bystanderIds = await futures.read.getUserOrdersAtExpiration([buyer2.account.address, first]);

    await collateralVault.write.halt({ account: owner.account });
    const hash = await futures.write.forceCancelOrders(
      [[seller.account.address, seller.account.address, buyer.account.address], [first, second, first]],
      { account: owner.account },
    );
    const receipt = await pc.waitForTransactionReceipt({ hash });
    assert.equal(parseEventLogs({ abi: futures.abi, logs: receipt.logs, eventName: "OrderCancelled" }).length, 4);

    const snap = await matchstick.indexSnapshot([]);
    await assertMatchesChain(snap, fixture);

    const partial = snap.entity("Order", partialId.toLowerCase());
    assert.ok(partial);
    assert.equal(partial.status, "CANCELLED");
    assert.equal(big(partial.filledQuantity), 1n);
    assert.equal(big(partial.cancelledQuantity), 1n, "only the unfilled lot is cancelled");
    for (const orderId of bystanderIds) {
      assert.equal(snap.get("Order", orderId.toLowerCase(), "status"), "ACTIVE", "bystander orders stay");
    }
    assert.equal(snap.get("PriceLevel", priceLevelId(first, p + 2n * s, false), "orderCount"), 0);
    assert.equal(snap.get("PriceLevel", priceLevelId(first, p + 3n * s, false), "orderCount"), 1);
    assert.equal(snap.get("PriceLevel", priceLevelId(first, p - s, true), "orderCount"), 1);
    assert.equal(snap.get("PriceLevel", priceLevelId(second, p + s, false), "orderCount"), 0);
    assert.equal(big(snap.get("UserDeliverySessionPointer", pointerId(seller.account.address, first), "netQuantity")), -2n);
  });

  it("forceClosePositions closes every leg's session at the mark", async () => {
    const fixture = await setup();
    const { futures, collateralVault } = fixture.contracts;
    const { owner, pc } = fixture.accounts;

    await collateralVault.write.halt({ account: owner.account });
    const mark = await futures.read.getMarketPrice();
    const hash = await futures.write.forceClosePositions(columns(fixture.legs), { account: owner.account });
    const receipt = await pc.waitForTransactionReceipt({ hash });
    const closed = parseEventLogs({ abi: futures.abi, logs: receipt.logs, eventName: "PositionLiquidated" });
    assert.equal(closed.length, 5, "every open leg, flat legs skipped");

    const snap = await matchstick.indexSnapshot([]);
    await assertMatchesChain(snap, fixture);

    const trades = snap.saved("Trade").filter((tr) => String(tr.transactionHash).toLowerCase() === hash);
    assert.equal(trades.length, closed.length);
    for (const trade of trades) {
      assert.equal(trade.isLiquidation, true, "a forced close is indexed as a liquidation");
      assert.equal(String(trade.liquidator).toLowerCase(), id(owner.account.address));
      assert.equal(big(trade.liquidationFee), 0n);
      assert.equal(big(trade.tradePrice), mark, "exit price derived from pnl equals the mark");
      assert.equal(big(trade.netQuantityAfter), 0n);
      assert.equal(snap.get("PositionSession", String(trade.positionSession), "status"), "CLOSE");
    }
    assert.equal(snap.get("Futures", "0", "totalLiquidations"), 1);
  });

  it("a matured leg settles, every leg is emptied, and trading after resume opens fresh sessions", async () => {
    const fixture = await setup();
    const { futures, collateralVault, hashpriceUsd } = fixture.contracts;
    const { owner, seller, buyer, tc } = fixture.accounts;
    const { p, first, second } = fixture.book;
    const { users, legs } = fixture;

    const before = await matchstick.indexSnapshot([]);
    const oldSessions = new Set(before.saved("PositionSession").map((session) => session.id));

    await tc.setNextBlockTimestamp({ timestamp: first + 1n });
    await tc.mine({ blocks: 1 });
    await refreshHashprice(hashpriceUsd, first + 1n);
    await futures.write.settlePositions([users, users.map(() => first)]);

    await collateralVault.write.halt({ account: owner.account });
    await futures.write.forceCancelOrders(columns(legs), { account: owner.account });
    const live = legs.filter(([, date]) => date === second);
    await futures.write.forceClosePositions(columns(live), { account: owner.account });
    await collateralVault.write.resume({ account: owner.account });

    const flat = await matchstick.indexSnapshot([]);
    await assertMatchesChain(flat, fixture);
    assert.equal(flat.get("Futures", "0", "activeOrders"), 0);
    for (const level of flat.saved("PriceLevel")) {
      assert.equal(level.orderCount, 0, `PriceLevel ${level.id} is empty`);
      assert.equal(big(level.totalQuantity), 0n);
    }
    assert.ok(flat.saved("PositionSession").every((session) => session.status === "CLOSE"));
    for (const order of flat.saved("Order")) {
      if (big(order.expirationAt) !== first || order.status === "FILLED") continue;
      assert.equal(order.status, "EXPIRED", `matured Order ${order.id} is indexed as expired`);
    }

    await futures.write.createOrder([p, second, -1n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([p, second, 1n, TimeInForce.GTC], { account: buyer.account });

    const reopened = await matchstick.indexSnapshot([]);
    await assertMatchesChain(reopened, fixture);
    for (const user of [seller, buyer]) {
      const pointer = pointerId(user.account.address, second);
      const sessionId = String(reopened.get("UserDeliverySessionPointer", pointer, "currentSessionId"));
      assert.ok(sessionId.length > 0 && !oldSessions.has(sessionId), "a new session, not a revived one");
    }
  });
});
