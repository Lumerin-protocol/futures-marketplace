import { describe, expect, test } from "vitest";
import {
  REALIZED_PNL_WINDOW_DAYS,
  realizedPnlAfterFees,
  realizedPnlSinceBaseline,
  sumTradeFees,
  sumUnrealizedPnl,
  windowCutoffSeconds,
  type UnrealizedLeg,
} from "./portfolioPnl";

/** Whole USDC at the payment token's 6 decimals. */
const usdc = (amount: number) => BigInt(Math.round(amount * 1e6));

/** Futures contracts are indivisible, so quantities are raw counts. */
const futuresLeg = (
  contracts: number,
  entry: number,
  mark: number,
): UnrealizedLeg => ({
  netQuantity: BigInt(contracts),
  entryPrice: usdc(entry),
  markPrice: usdc(mark),
  quantityScale: 1n,
});

/** Perps quantities carry 6 decimals, matching `QUANTITY_SCALE`. */
const perpsLeg = (contracts: number, entry: number, mark: number): UnrealizedLeg => ({
  netQuantity: usdc(contracts),
  entryPrice: usdc(entry),
  markPrice: usdc(mark),
  quantityScale: 1_000_000n,
});

describe("windowCutoffSeconds", () => {
  test("lands 30 days before now", () => {
    const now = Date.UTC(2026, 7, 25, 12, 0, 0);
    const expected = now / 1000 - REALIZED_PNL_WINDOW_DAYS * 86400;
    expect(windowCutoffSeconds(now)).toBe(expected);
  });

  // The cutoff doubles as a react-query key, so it has to hold still between
  // renders instead of moving with every millisecond of wall clock.
  test("is stable across an hour", () => {
    const topOfHour = Date.UTC(2026, 7, 25, 12, 0, 0);
    expect(windowCutoffSeconds(topOfHour + 59 * 60_000)).toBe(windowCutoffSeconds(topOfHour));
    expect(windowCutoffSeconds(topOfHour + 60 * 60_000)).toBeGreaterThan(
      windowCutoffSeconds(topOfHour),
    );
  });
});

describe("sumUnrealizedPnl", () => {
  test("a flat account has no unrealized PnL", () => {
    expect(sumUnrealizedPnl([])).toBe(0n);
  });

  test("a long gains when the mark rises", () => {
    expect(sumUnrealizedPnl([futuresLeg(2, 100, 110)])).toBe(usdc(20));
  });

  test("a long loses when the mark falls", () => {
    expect(sumUnrealizedPnl([futuresLeg(2, 100, 90)])).toBe(usdc(-20));
  });

  test("a short gains when the mark falls", () => {
    expect(sumUnrealizedPnl([futuresLeg(-2, 100, 90)])).toBe(usdc(20));
  });

  test("legs from different venues sum in the same units despite different quantity scales", () => {
    // Same economic exposure on both venues, so both legs must contribute 20 USDC.
    const total = sumUnrealizedPnl([futuresLeg(2, 100, 110), perpsLeg(2, 100, 110)]);
    expect(total).toBe(usdc(40));
  });

  test("opposing legs across venues net out", () => {
    expect(sumUnrealizedPnl([futuresLeg(2, 100, 110), perpsLeg(-2, 100, 110)])).toBe(0n);
  });

  test("a closed leg contributes nothing", () => {
    expect(sumUnrealizedPnl([futuresLeg(0, 100, 110)])).toBe(0n);
  });

  // A matured expiration marks against its pinned settlement price, so its PnL
  // stays put while the live mark keeps moving under the rest of the book.
  test("a leg priced at a pinned settlement price ignores the live mark", () => {
    const settled = futuresLeg(2, 100, 105);
    const live = futuresLeg(2, 100, 110);
    expect(sumUnrealizedPnl([settled, live])).toBe(usdc(10) + usdc(20));
  });
});

describe("realizedPnlSinceBaseline", () => {
  test("subtracts the pre-window snapshot from the lifetime total", () => {
    expect(realizedPnlSinceBaseline(usdc(500), usdc(120))).toBe(usdc(380));
  });

  test("an account with no pre-window trades reports its lifetime total", () => {
    expect(realizedPnlSinceBaseline(usdc(500), null)).toBe(usdc(500));
  });

  test("a losing window reports a negative figure", () => {
    expect(realizedPnlSinceBaseline(usdc(80), usdc(200))).toBe(usdc(-120));
  });

  test("a window with no closes reports zero, not the lifetime total", () => {
    expect(realizedPnlSinceBaseline(usdc(500), usdc(500))).toBe(0n);
  });
});

describe("realizedPnlAfterFees", () => {
  test("takes the fees out of a gain", () => {
    expect(realizedPnlAfterFees(usdc(19.2), usdc(7.84))).toBe(usdc(11.36));
  });

  test("deepens a loss by the fees paid", () => {
    expect(realizedPnlAfterFees(usdc(-3.76), usdc(0.31))).toBe(usdc(-4.07));
  });

  test("an opening fill realizes a loss of its fee", () => {
    expect(realizedPnlAfterFees(0n, usdc(0.48))).toBe(usdc(-0.48));
  });

  test("a rebate adds to the figure", () => {
    expect(realizedPnlAfterFees(usdc(10), usdc(-0.5))).toBe(usdc(10.5));
  });

  test("trading and liquidation fees both come out", () => {
    expect(realizedPnlAfterFees(usdc(-50), usdc(1), usdc(20))).toBe(usdc(-71));
  });

  test("a fee that does not apply is skipped", () => {
    expect(realizedPnlAfterFees(usdc(5), usdc(1), null)).toBe(usdc(4));
  });
});

describe("sumTradeFees", () => {
  test("no trades cost nothing", () => {
    expect(sumTradeFees([])).toBe(0n);
  });

  test("adds trading and liquidation fees across rows", () => {
    const rows = [
      { tradingFee: "480200", liquidationFee: null },
      { tradingFee: "0", liquidationFee: "20000000" },
      { tradingFee: "-100000", liquidationFee: null },
    ];
    expect(sumTradeFees(rows)).toBe(480200n + 20000000n - 100000n);
  });

  test("reads rows that select only the liquidation fee", () => {
    expect(sumTradeFees([{ liquidationFee: "1500000" }, { liquidationFee: "500000" }])).toBe(
      2000000n,
    );
  });
});
