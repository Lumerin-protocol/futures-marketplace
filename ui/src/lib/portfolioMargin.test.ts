import { describe, expect, test } from "vitest";
import { mmSurplus, netDeltaWad, type AccountSnapshot, type MMParams } from "@hashpower/portfolio-margin";
import { pickLiquidationLevel, solveLiquidationThresholds } from "./portfolioMargin";

/**
 * Only the presentation decisions are tested here. The margin model and the
 * threshold solver belong to `@hashpower/portfolio-margin` and are covered by
 * that package's own suite, against the same inputs the keeper uses.
 */

const USDC = 1_000_000n;
const USER = "0x1111111111111111111111111111111111111111" as const;

const params: MMParams = {
  imSpotShock: 10n ** 17n, // 10%
  mmSpotShock: 5n * 10n ** 16n, // 5%
  tokenDecimals: 6,
  perpQuantityDecimals: 6,
};

/** `price` in whole USDC. */
const usdc = (price: number) => BigInt(Math.round(price * 1e6));

const noOrders = { buyDelta: 0n, sellDelta: 0n, buyValue: 0n, sellValue: 0n };

function snapshot(overrides: {
  balance?: bigint;
  perp?: Partial<AccountSnapshot["perp"]>;
  positions?: AccountSnapshot["futures"]["positions"];
}): AccountSnapshot {
  return {
    user: USER,
    balance: overrides.balance ?? 0n,
    perp: {
      netQty: 0n,
      entryPrice: 0n,
      orders: noOrders,
      fundingOwed: 0n,
      ...overrides.perp,
    },
    futures: {
      positions: overrides.positions ?? [],
      orders: noOrders,
    },
  };
}

function future(
  netQuantity: bigint,
  entryPrice: bigint,
  settlementPrice = 0n,
  expirationAt = 1n,
): AccountSnapshot["futures"]["positions"][number] {
  return {
    expirationAt,
    netQuantity,
    netEntryValue: entryPrice * netQuantity,
    settlementPrice,
  };
}

describe("solveLiquidationThresholds reports the account's current state", () => {
  const at = usdc(100);

  test("an account already under MM reports no forward-looking level", () => {
    // 2 contracts long at 100 with almost no collateral: underwater at the mark.
    const snap = snapshot({ balance: 1n, positions: [future(2n, usdc(100))] });
    expect(mmSurplus(snap, params, at)).toBeLessThan(0n);

    const thresholds = solveLiquidationThresholds(snap, params, at);
    expect(thresholds.alreadyUnderwater).toBe(true);
    expect(thresholds.liqDown).toBeUndefined();
    expect(thresholds.liqUp).toBeUndefined();
  });

  test("a solvent account reports thresholds and is not flagged underwater", () => {
    const snap = snapshot({ balance: 20n * USDC, positions: [future(2n, usdc(100))] });
    const thresholds = solveLiquidationThresholds(snap, params, at);
    expect(thresholds.alreadyUnderwater).toBe(false);
    expect(thresholds.liqDown).toBeDefined();
  });
});

describe("pickLiquidationLevel chooses the side the book is exposed to", () => {
  const at = usdc(100);
  const pick = (snap: AccountSnapshot) =>
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

  // MM nets unrealized PnL across the portfolio, so a genuinely hedged book has
  // no price that can sink it: the legs move against each other by construction
  // and the stress term is zero. The UI should show no level rather than invent
  // one. This is the case the old per-venue clamp got wrong — it charged both
  // legs' losses while discarding both legs' gains, and liquidated a flat book.
  test("a delta-neutral hedged book has no liquidation level", () => {
    const snap = snapshot({
      balance: 12n * USDC,
      perp: { netQty: 2n * USDC, entryPrice: usdc(100) },
      positions: [future(-2n, usdc(100))],
    });
    expect(netDeltaWad(snap, params)).toBe(0n);
    expect(pick(snap)).toBeUndefined();
  });

  test("a flat account has no level", () => {
    expect(pick(snapshot({ balance: 100n * USDC }))).toBeUndefined();
  });
});
