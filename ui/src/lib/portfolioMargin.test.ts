import { describe, expect, test } from "vitest";
import {
  futuresUnrealizedPnl,
  marginRequired,
  mmSurplus,
  netDeltaWad,
  pickLiquidationLevel,
  solveLiquidationThresholds,
  type FuturesAggregate,
  type MarginParams,
  type PortfolioSnapshot,
} from "./portfolioMargin";

const USDC = 1_000_000n;
const params: MarginParams = {
  imSpotShock: 10n ** 17n, // 10%
  mmSpotShock: 5n * 10n ** 16n, // 5%
  tokenDecimals: 6,
  perpQuantityDecimals: 6,
};

/** `price` in whole USDC. */
const usdc = (price: number) => BigInt(Math.round(price * 1e6));

function snapshot(overrides: {
  balance?: bigint;
  perp?: Partial<PortfolioSnapshot["perp"]>;
  futuresOrderMargin?: bigint;
  positions?: FuturesAggregate[];
}): PortfolioSnapshot {
  return {
    balance: overrides.balance ?? 0n,
    perp: {
      netQty: 0n,
      entryPrice: 0n,
      orderMargin: 0n,
      fundingOwed: 0n,
      ...overrides.perp,
    },
    futures: {
      orderMargin: overrides.futuresOrderMargin ?? 0n,
      positions: overrides.positions ?? [],
    },
  };
}

function future(
  netQuantity: bigint,
  entryPrice: bigint,
  settlementPrice = 0n,
  expirationAt = 1n,
): FuturesAggregate {
  return {
    expirationAt,
    netQuantity,
    netEntryValue: entryPrice * netQuantity,
    settlementPrice,
  };
}

/// The threshold is the last price that is still solvent, so the surplus must
/// flip sign across it (or land exactly on zero).
function assertIsRoot(snap: PortfolioSnapshot, root: bigint, side: "down" | "up") {
  const at = mmSurplus(snap, params, root);
  const beyond = mmSurplus(snap, params, side === "down" ? root - 1n : root + 1n);
  expect(at >= 0n, `surplus at root should be solvent, got ${at}`).toBe(true);
  expect(beyond < 0n, `surplus past root should be underwater, got ${beyond}`).toBe(true);
}

describe("marginRequired reproduces the engine's terms", () => {
  test("stress is |netDelta| * shock * price", () => {
    // 2 contracts long, mark 100 USDC, 5% MM shock -> 10 USDC of stress.
    const snap = snapshot({ balance: 1000n * USDC, positions: [future(2n, usdc(100))] });
    expect(marginRequired(snap, params, usdc(100), false)).toBe(usdc(10));
  });

  test("IM uses the larger shock", () => {
    const snap = snapshot({ balance: 1000n * USDC, positions: [future(2n, usdc(100))] });
    expect(marginRequired(snap, params, usdc(100), true)).toBe(usdc(20));
  });

  test("order margin and owed funding are constant in price", () => {
    const snap = snapshot({
      balance: 1000n * USDC,
      perp: { orderMargin: 7n * USDC, fundingOwed: 3n * USDC },
      futuresOrderMargin: 5n * USDC,
    });
    expect(marginRequired(snap, params, usdc(100), false)).toBe(15n * USDC);
    expect(marginRequired(snap, params, usdc(250), false)).toBe(15n * USDC);
  });

  test("only losses are added, gains are clamped away", () => {
    const long = snapshot({ balance: 1000n * USDC, positions: [future(1n, usdc(100))] });
    // 20 below entry: 5 stress + 20 loss.
    expect(marginRequired(long, params, usdc(80), false)).toBe(usdc(24));
    // 20 above entry: 6 stress only, the gain does not reduce the requirement.
    expect(marginRequired(long, params, usdc(120), false)).toBe(usdc(6));
  });

  test("hedged legs net out of the stress delta", () => {
    const hedged = snapshot({
      balance: 1000n * USDC,
      perp: { netQty: 3n * USDC, entryPrice: usdc(100) },
      positions: [future(-3n, usdc(100))],
    });
    expect(netDeltaWad(hedged, params)).toBe(0n);
    expect(marginRequired(hedged, params, usdc(100), false)).toBe(0n);
  });
});

describe("futures unrealized loss uses the aggregate clamp", () => {
  // At P = 100 the long is +150 and the short is -120, so the book is +30
  // overall. Net delta is +1 contract, giving 5 USDC of stress.
  const winner = future(3n, usdc(50), 0n, 1n);
  const loser = future(-2n, usdc(40), 0n, 2n);
  const snap = snapshot({ balance: 1000n * USDC, positions: [winner, loser] });

  test("profit on one expiry offsets a loss on another", () => {
    expect(futuresUnrealizedPnl(snap, usdc(100))).toBe(usdc(30));
    expect(marginRequired(snap, params, usdc(100), false)).toBe(usdc(5));
  });

  test("per-leg clamping would have charged 120 for the losing expiry", () => {
    const legPnls = snap.futures.positions.map(
      (p) => usdc(100) * p.netQuantity - p.netEntryValue,
    );
    expect(legPnls).toEqual([usdc(150), usdc(-120)]);

    const perLegLoss = legPnls.reduce((sum, pnl) => sum + (pnl < 0n ? -pnl : 0n), 0n);
    expect(perLegLoss).toBe(usdc(120));
    expect(marginRequired(snap, params, usdc(100), false)).toBeLessThan(perLegLoss);
  });
});

describe("settled expiries", () => {
  test("mark at the settlement price and drop out of the delta", () => {
    const settled = future(4n, usdc(100), usdc(90));
    const snap = snapshot({ balance: 1000n * USDC, positions: [settled] });

    expect(netDeltaWad(snap, params)).toBe(0n);
    // Fixed -40 loss regardless of where spot goes; no stress term.
    expect(marginRequired(snap, params, usdc(10), false)).toBe(usdc(40));
    expect(marginRequired(snap, params, usdc(500), false)).toBe(usdc(40));
  });

  test("a live leg still moves while a settled one is frozen", () => {
    const snap = snapshot({
      balance: 1000n * USDC,
      positions: [future(4n, usdc(100), usdc(90), 1n), future(1n, usdc(100), 0n, 2n)],
    });
    // Settled -40, live -10 at P = 90 -> aggregate -50, plus 4.5 stress on 1 contract.
    expect(marginRequired(snap, params, usdc(90), false)).toBe(usdc(54.5));
  });
});

describe("solveLiquidationThresholds", () => {
  test("a plain long is liquidated on the way down by its loss", () => {
    const snap = snapshot({
      balance: 20n * USDC,
      positions: [future(2n, usdc(100))],
    });
    const { liqDown, alreadyUnderwater } = solveLiquidationThresholds(snap, params, usdc(100));

    expect(alreadyUnderwater).toBe(false);
    expect(liqDown).toBeDefined();
    assertIsRoot(snap, liqDown as bigint, "down");

    // Closed form: 20 = 2(100 - P) + 0.05 * 2P  =>  P = 180/1.9.
    expect(liqDown).toBe((usdc(180) * 100n) / 190n);
  });

  test("a plain long is also liquidated on the way up by its stress charge", () => {
    // Unrealized gains never credit the vault, but the stress requirement
    // scales with price, so a flat balance eventually stops covering it:
    // 20 = 0.05 * 2 * P  =>  P = 200. This is what the engine enforces, and
    // it is why the UI shows a band rather than a single price.
    const snap = snapshot({
      balance: 20n * USDC,
      positions: [future(2n, usdc(100))],
    });
    const { liqUp } = solveLiquidationThresholds(snap, params, usdc(100));

    expect(liqUp).toBeDefined();
    assertIsRoot(snap, liqUp as bigint, "up");
    // Integer truncation of the stress term leaves the root a few wei above 200.
    expect(liqUp).toBeGreaterThanOrEqual(usdc(200));
    expect(liqUp).toBeLessThan(usdc(200.001));
  });

  test("a plain short is liquidated on the way up only", () => {
    const snap = snapshot({
      balance: 20n * USDC,
      positions: [future(-2n, usdc(100))],
    });
    const { liqDown, liqUp } = solveLiquidationThresholds(snap, params, usdc(100));

    expect(liqDown).toBeUndefined();
    expect(liqUp).toBeDefined();
    assertIsRoot(snap, liqUp as bigint, "up");

    // Loss and stress both grow with price: 20 = 2(P - 100) + 0.05 * 2P.
    expect(liqUp).toBe((usdc(220) * 100n) / 210n + 1n);
  });

  test("a perp long matches the same closed form as a futures long", () => {
    const perp = snapshot({
      balance: 20n * USDC,
      perp: { netQty: 2n * USDC, entryPrice: usdc(100) },
    });
    const fut = snapshot({ balance: 20n * USDC, positions: [future(2n, usdc(100))] });

    expect(solveLiquidationThresholds(perp, params, usdc(100)).liqDown).toBe(
      solveLiquidationThresholds(fut, params, usdc(100)).liqDown,
    );
  });

  test("a hedged book survives far wider moves than either leg alone", () => {
    const naked = snapshot({
      balance: 20n * USDC,
      perp: { netQty: 3n * USDC, entryPrice: usdc(100) },
    });
    const hedged = snapshot({
      balance: 20n * USDC,
      perp: { netQty: 3n * USDC, entryPrice: usdc(100) },
      positions: [future(-2n, usdc(100))],
    });

    const nakedDown = solveLiquidationThresholds(naked, params, usdc(100)).liqDown as bigint;
    const hedgedDown = solveLiquidationThresholds(hedged, params, usdc(100)).liqDown as bigint;

    expect(hedgedDown).toBeLessThan(nakedDown);
    assertIsRoot(hedged, hedgedDown, "down");
  });

  test("an underwater account reports no forward-looking thresholds", () => {
    const snap = snapshot({
      balance: 1n * USDC,
      positions: [future(2n, usdc(100))],
    });
    const result = solveLiquidationThresholds(snap, params, usdc(50));

    expect(result.alreadyUnderwater).toBe(true);
    expect(result.liqDown).toBeUndefined();
    expect(result.liqUp).toBeUndefined();
  });

  test("a flat account is never liquidatable", () => {
    const snap = snapshot({ balance: 100n * USDC });
    const result = solveLiquidationThresholds(snap, params, usdc(100));

    expect(result.alreadyUnderwater).toBe(false);
    expect(result.liqDown).toBeUndefined();
    expect(result.liqUp).toBeUndefined();
  });

  test("resting orders alone can leave a solvent account with no thresholds", () => {
    const snap = snapshot({ balance: 100n * USDC, futuresOrderMargin: 40n * USDC });
    const result = solveLiquidationThresholds(snap, params, usdc(100));

    expect(result.alreadyUnderwater).toBe(false);
    expect(result.liqDown).toBeUndefined();
    expect(result.liqUp).toBeUndefined();
  });

  test("owed funding tightens the threshold", () => {
    const base = snapshot({
      balance: 20n * USDC,
      perp: { netQty: 2n * USDC, entryPrice: usdc(100) },
    });
    const withFunding = snapshot({
      balance: 20n * USDC,
      perp: { netQty: 2n * USDC, entryPrice: usdc(100), fundingOwed: 5n * USDC },
    });

    const baseDown = solveLiquidationThresholds(base, params, usdc(100)).liqDown as bigint;
    const fundedDown = solveLiquidationThresholds(withFunding, params, usdc(100))
      .liqDown as bigint;

    expect(fundedDown).toBeGreaterThan(baseDown);
    assertIsRoot(withFunding, fundedDown, "down");
  });

  test("a settled loss narrows the band without adding delta", () => {
    const snap = snapshot({
      balance: 60n * USDC,
      positions: [future(2n, usdc(100), 0n, 1n), future(2n, usdc(100), usdc(80), 2n)],
    });
    const { liqDown, alreadyUnderwater } = solveLiquidationThresholds(snap, params, usdc(100));

    expect(alreadyUnderwater).toBe(false);
    expect(liqDown).toBeDefined();
    assertIsRoot(snap, liqDown as bigint, "down");
  });
});

describe("pickLiquidationLevel chooses the side the book is exposed to", () => {
  const at = usdc(100);
  const pick = (snap: PortfolioSnapshot) =>
    pickLiquidationLevel(snap, params, solveLiquidationThresholds(snap, params, at), at);

  test("a net long reports the downside level", () => {
    const snap = snapshot({ balance: 20n * USDC, positions: [future(2n, usdc(100))] });
    const thresholds = solveLiquidationThresholds(snap, params, at);

    // Both sides exist here, so this really is a choice and not a fallback.
    expect(thresholds.liqDown).toBeDefined();
    expect(thresholds.liqUp).toBeDefined();
    expect(pick(snap)).toEqual({ price: thresholds.liqDown, direction: "down" });
  });

  test("a net short reports the upside level", () => {
    const snap = snapshot({ balance: 20n * USDC, positions: [future(-2n, usdc(100))] });
    expect(pick(snap)?.direction).toBe("up");
  });

  test("a net long perp behaves the same as a net long future", () => {
    const snap = snapshot({
      balance: 20n * USDC,
      perp: { netQty: 2n * USDC, entryPrice: usdc(100) },
    });
    expect(pick(snap)?.direction).toBe("down");
  });

  test("net exposure decides, not the individual legs", () => {
    // Long 3 perp contracts against short 2 futures: net +1, so downside.
    const snap = snapshot({
      balance: 20n * USDC,
      perp: { netQty: 3n * USDC, entryPrice: usdc(100) },
      positions: [future(-2n, usdc(100))],
    });
    expect(netDeltaWad(snap, params)).toBeGreaterThan(0n);
    expect(pick(snap)?.direction).toBe("down");
  });

  test("falls back to the other side when the preferred one does not exist", () => {
    // Collateral covers the worst case at P = 0, so a fall can never liquidate
    // this long; only the stress charge on the way up can.
    const snap = snapshot({ balance: 500n * USDC, positions: [future(2n, usdc(100))] });
    const thresholds = solveLiquidationThresholds(snap, params, at);

    expect(thresholds.liqDown).toBeUndefined();
    expect(thresholds.liqUp).toBeDefined();
    expect(pick(snap)).toEqual({ price: thresholds.liqUp, direction: "up" });
  });

  // With `netDelta == 0` the PnL slopes cancel, but the perp and futures losses
  // are clamped independently, so `MM(P)` still moves and the book is not
  // risk-free. There is no directional bias, so distance to the mark decides.
  test("a delta-neutral book with equal gaps breaks the tie downwards", () => {
    // MM(P) = 2|P - 100|, so the roots sit symmetrically at 94 and 106.
    const snap = snapshot({
      balance: 12n * USDC,
      perp: { netQty: 2n * USDC, entryPrice: usdc(100) },
      positions: [future(-2n, usdc(100))],
    });
    expect(netDeltaWad(snap, params)).toBe(0n);

    const thresholds = solveLiquidationThresholds(snap, params, at);
    expect(at - (thresholds.liqDown as bigint)).toBe((thresholds.liqUp as bigint) - at);
    expect(pick(snap)).toEqual({ price: thresholds.liqDown, direction: "down" });
  });

  test("a delta-neutral book picks the upside when it is the nearer gap", () => {
    // The perp long is far in profit while the futures short is far in loss, so
    // the loss-free plateau sits below the mark: the upside root is much closer.
    const snap = snapshot({
      balance: 70n * USDC,
      perp: { netQty: 2n * USDC, entryPrice: usdc(60) },
      positions: [future(-2n, usdc(70))],
    });
    expect(netDeltaWad(snap, params)).toBe(0n);

    const thresholds = solveLiquidationThresholds(snap, params, at);
    const downGap = at - (thresholds.liqDown as bigint);
    const upGap = (thresholds.liqUp as bigint) - at;
    expect(upGap).toBeLessThan(downGap);
    expect(pick(snap)).toEqual({ price: thresholds.liqUp, direction: "up" });
  });

  test("a flat account has no level", () => {
    expect(pick(snapshot({ balance: 100n * USDC }))).toBeUndefined();
  });
});