import { describe, expect, test } from "vitest";
import { imRequired, type AccountSnapshot, type MMParams } from "@hashpower/portfolio-margin";
import {
  maxAffordableQuantity,
  orderNotional,
  quoteOrderMargin,
  snapshotWithChanges,
  type OrderLeg,
} from "./orderMargin";

/**
 * These lock order entry to the venue's own gate. `Futures.createOrder` places
 * the order and then requires `balance >= computePortfolioIM(user)`, so every
 * expectation below is either a hand-computed engine term or a round trip
 * through `imRequired` — never a restatement of the code under test.
 */

const USDC = 1_000_000n;
const USER = "0x1111111111111111111111111111111111111111" as const;

/** IM shock above MM, the ordering every engine configuration has. */
const params: MMParams = {
  imSpotShock: 10n ** 17n, // 10%
  mmSpotShock: 5n * 10n ** 16n, // 5%
  tokenDecimals: 6,
  perpQuantityDecimals: 6,
};

/** `price` in whole USDC. */
const usdc = (price: number) => BigInt(Math.round(price * 1e6));

/** The mark every case below is quoted at. */
const MARK = usdc(5);

const noOrders = { buyDelta: 0n, sellDelta: 0n, buyValue: 0n, sellValue: 0n };

function snapshot(overrides: {
  balance?: bigint;
  perp?: Partial<AccountSnapshot["perp"]>;
  positions?: AccountSnapshot["futures"]["positions"];
  futuresOrders?: AccountSnapshot["futures"]["orders"];
}): AccountSnapshot {
  return {
    user: USER,
    balance: overrides.balance ?? 0n,
    perp: { netQty: 0n, entryPrice: 0n, orders: noOrders, fundingOwed: 0n, ...overrides.perp },
    futures: {
      positions: overrides.positions ?? [],
      orders: overrides.futuresOrders ?? noOrders,
    },
  };
}

function future(
  netQuantity: bigint,
  entryPrice: bigint,
  expirationAt = 1n,
): AccountSnapshot["futures"]["positions"][number] {
  return {
    expirationAt,
    netQuantity,
    netEntryValue: entryPrice * netQuantity,
    settlementPrice: 0n,
  };
}

const bid = (quantity: bigint, price: bigint): OrderLeg => ({
  venue: "futures",
  price,
  quantity,
});
const ask = (quantity: bigint, price: bigint): OrderLeg => ({
  venue: "futures",
  price,
  quantity: -quantity,
});

/** The gate `createOrder` applies, spelled out rather than borrowed. */
const gateAccepts = (snap: AccountSnapshot, leg: OrderLeg): boolean => {
  const withLeg = snapshotWithChanges(snap, params, { place: [leg] });
  return snap.balance >= imRequired(withLeg, params, MARK);
};

/**
 * The per-leg estimate this module replaced, kept here so the regression tests
 * below can show what it answered. It charged the *maintenance* shock on the
 * limit price and then credited the leg's signed distance from the mark, where
 * the engine charges the initial shock on the mark and clamps that credit at
 * zero. Both errors ran the same way, and a 100%-of-balance order reverted with
 * `InsufficientMarginBalance`.
 */
const perLegEstimate = (limitPrice: bigint, quantity: bigint): bigint => {
  const absQuantity = quantity < 0n ? -quantity : quantity;
  const maintenance = (limitPrice * absQuantity * params.mmSpotShock) / 10n ** 18n;
  return maintenance - (MARK - limitPrice) * quantity;
};

const imFor = (snap: AccountSnapshot, leg: OrderLeg): bigint =>
  quoteOrderMargin({ snapshot: snap, params, markPrice: MARK, changes: { place: [leg] } })
    .imIncrease;

describe("snapshotWithChanges reports what the venues report to the engine", () => {
  test("a futures bid joins the buy side at the venue's delta and value scale", () => {
    // `getRiskView` scales order delta by 10^collateralDecimals and values the
    // book at the orders' own limit prices.
    const withBid = snapshotWithChanges(snapshot({}), params, {
      place: [bid(3n, usdc(4))],
    });

    expect(withBid.futures.orders.buyDelta).toBe(3n * USDC);
    expect(withBid.futures.orders.buyValue).toBe(3n * usdc(4));
    expect(withBid.futures.orders.sellDelta).toBe(0n);
    expect(withBid.perp.orders).toEqual(noOrders);
  });

  test("a perps ask joins the perps book with quantity de-scaled", () => {
    // Perps quantity carries `perpQuantityDecimals`; delta and value do not.
    const twoContracts = 2n * USDC;
    const withAsk = snapshotWithChanges(snapshot({}), params, {
      place: [{ venue: "perps", price: usdc(5), quantity: -twoContracts }],
    });

    expect(withAsk.perp.orders.sellDelta).toBe(2n * USDC);
    expect(withAsk.perp.orders.sellValue).toBe(usdc(10));
    expect(withAsk.futures.orders).toEqual(noOrders);
  });

  test("cancelling a leg undoes placing it", () => {
    const leg = bid(7n, usdc(6));
    const base = snapshot({ balance: 100n * USDC });
    const placed = snapshotWithChanges(base, params, { place: [leg] });

    expect(snapshotWithChanges(placed, params, { cancel: [leg] }).futures.orders).toEqual(
      base.futures.orders,
    );
  });

  test("a modify prices the replacement with the old order already off the book", () => {
    // What `updateOrders` does: cancels, then creates, then checks margin once.
    const resting = bid(10n, usdc(5));
    const withResting = snapshotWithChanges(snapshot({}), params, { place: [resting] });

    const modified = snapshotWithChanges(withResting, params, {
      cancel: [resting],
      place: [bid(4n, usdc(5))],
    });

    expect(modified.futures.orders.buyDelta).toBe(4n * USDC);
    expect(modified.futures.orders.buyValue).toBe(4n * usdc(5));
  });

  test("closing a venue clears its position but leaves the other one alone", () => {
    const snap = snapshot({
      balance: 100n * USDC,
      perp: { netQty: 2n * USDC, entryPrice: MARK },
      positions: [future(-3n, MARK)],
    });

    const flatPerps = snapshotWithChanges(snap, params, { closePerps: true });
    expect(flatPerps.perp.netQty).toBe(0n);
    expect(flatPerps.futures.positions).toEqual(snap.futures.positions);

    const flatFutures = snapshotWithChanges(snap, params, { closeFutures: [1n] });
    expect(flatFutures.futures.positions).toEqual([]);
    expect(flatFutures.perp.netQty).toBe(2n * USDC);
  });

  test("closing futures drops only the named expiries", () => {
    // The venue aggregates one net position per expiry, so attribution is per
    // expiry and the others have to survive untouched.
    const snap = snapshot({
      balance: 100n * USDC,
      positions: [future(2n, MARK, 100n), future(-3n, MARK, 200n), future(4n, MARK, 300n)],
    });

    const remaining = snapshotWithChanges(snap, params, { closeFutures: [200n] }).futures.positions;
    expect(remaining.map((position) => position.expirationAt)).toEqual([100n, 300n]);
  });

  test("closing a position leaves funding already owed in place", () => {
    // Closing out settles exposure, not a debt the account has already accrued.
    const snap = snapshot({
      balance: 100n * USDC,
      perp: { netQty: 2n * USDC, entryPrice: MARK, fundingOwed: usdc(3) },
    });
    expect(snapshotWithChanges(snap, params, { closePerps: true }).perp.fundingOwed).toBe(usdc(3));
  });

  test("orderNotional is the fee base at the leg's own limit price", () => {
    expect(orderNotional(bid(3n, usdc(4)), params)).toBe(usdc(12));
    expect(orderNotional({ venue: "perps", price: usdc(4), quantity: 3n * USDC }, params)).toBe(
      usdc(12),
    );
  });
});

describe("quoteOrderMargin charges what the engine charges", () => {
  const flat = snapshot({ balance: 10n * USDC });

  test("a bid at the mark costs the IM spot shock on notional", () => {
    // 4 contracts × $5 × 10% = $2. Nothing else: the order is at the mark, so
    // there is no fill loss, and a flat account has no unrealized PnL.
    expect(imFor(flat, bid(4n, MARK))).toBe(usdc(2));
    expect(imFor(flat, ask(4n, MARK))).toBe(usdc(2));
  });

  test("an out-of-the-money order earns no credit for its distance from the mark", () => {
    // The engine's fill loss is `max(0, value − mark)` per side, so a bid below
    // the mark is charged the same stress as one at it — no more, no less.
    expect(imFor(flat, bid(4n, usdc(4)))).toBe(usdc(2));
    expect(imFor(flat, ask(4n, usdc(6)))).toBe(usdc(2));
  });

  test("an in-the-money order is charged its fill loss on top of the stress", () => {
    // Bid $1 over the mark on 4 contracts: $2 stress + $4 that fills underwater.
    expect(imFor(flat, bid(4n, usdc(6)))).toBe(usdc(6));
    expect(imFor(flat, ask(4n, usdc(4)))).toBe(usdc(6));
  });

  test("the reserved fee comes out of headroom on top of IM", () => {
    const leg = bid(20n, MARK); // exactly $10 of IM against a $10 balance
    const free = quoteOrderMargin({
      snapshot: flat,
      params,
      markPrice: MARK,
      changes: { place: [leg] },
    });
    expect(free.affordable).toBe(true);
    expect(free.headroom).toBe(0n);

    const withFee = quoteOrderMargin({
      snapshot: flat,
      params,
      markPrice: MARK,
      changes: { place: [leg] },
      reservedFee: usdc(0.1),
    });
    expect(withFee.affordable).toBe(false);
    expect(withFee.headroom).toBe(-usdc(0.1));
  });

  test("a leg that hedges an open position adds no margin", () => {
    // Short 10 at $5 costs $5 of IM. Bidding those 10 back leaves the account's
    // worst post-fill delta unchanged, so the engine asks for nothing extra.
    const short = snapshot({ balance: 5n * USDC, positions: [future(-10n, MARK)] });
    expect(imRequired(short, params, MARK)).toBe(usdc(5));
    expect(imFor(short, bid(10n, MARK))).toBe(0n);
  });

  test("a position's margin is what closing it would free", () => {
    // Long 2 perp contracts at the mark: 2 × $5 × 10% = $1 of IM, all of it the
    // position's, so flattening the leg gives the whole requirement back.
    const long = snapshot({
      balance: 50n * USDC,
      perp: { netQty: 2n * USDC, entryPrice: MARK },
    });
    expect(imRequired(long, params, MARK)).toBe(usdc(1));

    const closed = quoteOrderMargin({
      snapshot: long,
      params,
      markPrice: MARK,
      changes: { closePerps: true },
    });
    expect(closed.imAfter).toBe(0n);
    expect(closed.imIncrease).toBe(-usdc(1));
  });

  test("a calendar spread's expiries each account for almost none of the requirement", () => {
    // Long 4 at one delivery date against short 3 at another nets to +1, so the
    // account is charged 1 × $5 × 10% = $0.50 — not the $3.50 the two legs would
    // cost apart. Removing either leg *raises* the requirement, which is why the
    // table clamps: neither expiry can be said to account for the charge.
    const spread = snapshot({
      balance: 50n * USDC,
      positions: [future(4n, MARK, 100n), future(-3n, MARK, 200n)],
    });
    expect(imRequired(spread, params, MARK)).toBe(usdc(0.5));

    const perExpiry = (expirationAt: bigint) =>
      quoteOrderMargin({
        snapshot: spread,
        params,
        markPrice: MARK,
        changes: { closeFutures: [expirationAt] },
      }).imIncrease;

    expect(perExpiry(100n)).toBe(usdc(1)); // left short 3: $1.50 − $0.50
    expect(perExpiry(200n)).toBe(usdc(1.5)); // left long 4: $2.00 − $0.50
  });

  test("a hedging position accounts for no margin of its own", () => {
    // Long 2 perp against short 2 futures is delta-flat, so the account carries
    // no stress charge — and closing either leg would *raise* the requirement.
    const hedged = snapshot({
      balance: 50n * USDC,
      perp: { netQty: 2n * USDC, entryPrice: MARK },
      positions: [future(-2n, MARK)],
    });
    expect(imRequired(hedged, params, MARK)).toBe(0n);

    const closed = quoteOrderMargin({
      snapshot: hedged,
      params,
      markPrice: MARK,
      changes: { closePerps: true },
    });
    expect(closed.imIncrease).toBe(usdc(1));
  });

  test("a locally reducing leg is admitted below IM while IM does not rise", () => {
    // `createOrder`'s `maxAllowedIm` branch: a fully margined account must still
    // be able to close out, and the reducing bid above costs nothing.
    const short = snapshot({ balance: 5n * USDC, positions: [future(-10n, MARK)] });
    const changes = { place: [bid(10n, MARK)] };

    const strict = quoteOrderMargin({
      snapshot: short,
      params,
      markPrice: MARK,
      changes,
      reservedFee: usdc(1),
    });
    expect(strict.affordable).toBe(false);

    const reducing = quoteOrderMargin({
      snapshot: short,
      params,
      markPrice: MARK,
      changes,
      reservedFee: usdc(1),
      locallyReducing: true,
    });
    expect(reducing.affordable).toBe(true);
  });
});

describe("maxAffordableQuantity lands on the gate's edge", () => {
  const maxFor = (snap: AccountSnapshot, price: bigint, isBuy: boolean) =>
    maxAffordableQuantity({
      snapshot: snap,
      params,
      venue: "futures",
      price,
      markPrice: MARK,
      isBuy,
    });

  /** The property the slider needs: 100% places, 100% + one contract does not. */
  const isExactlyAtTheEdge = (snap: AccountSnapshot, price: bigint, isBuy: boolean) => {
    const max = maxFor(snap, price, isBuy);
    const leg = (quantity: bigint) => (isBuy ? bid(quantity, price) : ask(quantity, price));
    return { max, accepted: gateAccepts(snap, leg(max)), nextRejected: !gateAccepts(snap, leg(max + 1n)) };
  };

  test("a full-balance order at the mark is accepted, one contract more is not", () => {
    // $10 buys 20 contracts at $5 × 10%.
    const flat = snapshot({ balance: 10n * USDC });
    expect(isExactlyAtTheEdge(flat, MARK, true)).toEqual({
      max: 20n,
      accepted: true,
      nextRejected: true,
    });
  });

  test("the same holds for a bid below the mark, where the old estimate went negative", () => {
    // This is the reported failure. The per-leg estimate credited the $1 gap
    // between a $4 bid and the $5 mark against a maintenance-shock charge, which
    // made its "required margin" negative — so the slider ran to its own search
    // ceiling and every 100% order reverted. The engine charges the IM shock on
    // the mark and clamps that credit at zero.
    const flat = snapshot({ balance: 10n * USDC });
    expect(perLegEstimate(usdc(4), 4n)).toBeLessThan(0n);

    expect(isExactlyAtTheEdge(flat, usdc(4), true)).toEqual({
      max: 20n,
      accepted: true,
      nextRejected: true,
    });
  });

  test("the old estimate's own answer at 100% would have been rejected", () => {
    // Even at the mark, where it has no bogus credit to hand out, it charged the
    // maintenance shock against a gate that charges the initial one — so it
    // cleared twice the size the account could actually carry.
    const flat = snapshot({ balance: 10n * USDC });
    const perLegMax = 40n; // $10 / ($5 × 5% MM shock)
    expect(perLegEstimate(MARK, perLegMax)).toBe(flat.balance);

    expect(gateAccepts(flat, bid(perLegMax, MARK))).toBe(false);
    expect(maxFor(flat, MARK, true)).toBe(20n);
  });

  test("an in-the-money bid buys less size, and still exactly fits", () => {
    // $1.50 per contract: $0.50 stress + $1.00 fill loss.
    const flat = snapshot({ balance: 15n * USDC });
    expect(isExactlyAtTheEdge(flat, usdc(6), true)).toEqual({
      max: 10n,
      accepted: true,
      nextRejected: true,
    });
  });

  test("hedging capacity is reported, so a short can bid past its own size", () => {
    // Short 10 with only the $5 its own IM needs: the engine charges the worse of
    // the pre-fill and post-fill delta, so anything up to +20 leaves |delta| ≤ 10.
    const short = snapshot({ balance: 5n * USDC, positions: [future(-10n, MARK)] });
    expect(isExactlyAtTheEdge(short, MARK, true)).toEqual({
      max: 20n,
      accepted: true,
      nextRejected: true,
    });
    // The other side extends the position instead, so it has no funded capacity.
    expect(maxFor(short, MARK, false)).toBe(0n);
  });

  test("the reserved fee shrinks the answer", () => {
    const flat = snapshot({ balance: 10n * USDC });
    const tenBps = (notional: bigint) => (notional * 10n) / 10_000n;

    expect(
      maxAffordableQuantity({
        snapshot: flat,
        params,
        venue: "futures",
        price: MARK,
        markPrice: MARK,
        isBuy: true,
        reserveFee: tenBps,
      }),
    ).toBe(19n);
  });

  test("an account with no free collateral has no funded capacity", () => {
    const spent = snapshot({ balance: 5n * USDC, positions: [future(10n, MARK)] });
    expect(imRequired(spent, params, MARK)).toBe(usdc(5));
    expect(maxFor(spent, MARK, true)).toBe(0n);
  });

  test("perps sizes are reported in the venue's own quantity units", () => {
    // $10 at $5 × 10% is 20 contracts, which the perps book counts in millionths.
    const flat = snapshot({ balance: 10n * USDC });
    const perpsLeg = (quantity: bigint): OrderLeg => ({ venue: "perps", price: MARK, quantity });
    const max = maxAffordableQuantity({
      snapshot: flat,
      params,
      venue: "perps",
      price: MARK,
      markPrice: MARK,
      isBuy: true,
    });

    // The engine divides down to token decimals, which leaves the last millionth
    // of a contract free — so pin the contract count and the edge itself rather
    // than a unit count that only reflects where that division rounds.
    expect(max / USDC).toBe(20n);
    expect(gateAccepts(flat, perpsLeg(max))).toBe(true);
    expect(gateAccepts(flat, perpsLeg(max + 1n))).toBe(false);
  });
});
