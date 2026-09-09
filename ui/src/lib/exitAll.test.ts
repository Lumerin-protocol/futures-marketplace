import { describe, expect, it } from "vitest";
import { closingIntent, totalSize } from "./exitAll";

const USDC = 1_000_000n;
const TICK = 10_000n; // 0.01 USDC

describe("closingIntent", () => {
  it("flattens a long by selling, capped below the mark", () => {
    const leg = closingIntent({ netQuantity: 3n }, 40n * USDC, 0.05, TICK);
    expect(leg.quantity).toBe(-3n);
    expect(leg.price).toBe(38n * USDC); // 40 × 0.95
  });

  it("flattens a short by buying, capped above the mark", () => {
    const leg = closingIntent({ netQuantity: -2n }, 40n * USDC, 0.05, TICK);
    expect(leg.quantity).toBe(2n);
    expect(leg.price).toBe(42n * USDC); // 40 × 1.05
  });

  it("snaps the cap onto the tick, rounding away from the mark", () => {
    // 39.333333 × 0.95 = 37.366666…; a seller's floor rounds down to 37.36.
    const sell = closingIntent({ netQuantity: 1n }, 39_333_333n, 0.05, TICK);
    expect(sell.price).toBe(37_360_000n);
    expect(sell.price % TICK).toBe(0n);
    // 39.333333 × 1.05 = 41.299999…; a buyer's ceiling rounds up to 41.30.
    const buy = closingIntent({ netQuantity: -1n }, 39_333_333n, 0.05, TICK);
    expect(buy.price).toBe(41_300_000n);
    expect(buy.price % TICK).toBe(0n);
  });

  it("carries the delivery through for futures", () => {
    const leg = closingIntent({ netQuantity: 1n, expirationAt: 1_700_000_000n }, 40n * USDC, 0.05, TICK);
    expect(leg.expirationAt).toBe(1_700_000_000n);
  });

  it("tolerates a zero tick", () => {
    expect(closingIntent({ netQuantity: 1n }, 40n * USDC, 0.05, 0n).price).toBe(38n * USDC);
  });
});

describe("totalSize", () => {
  it("sums magnitudes so opposite sides do not cancel", () => {
    expect(totalSize([3n, -2n])).toBe(5n);
    expect(totalSize([])).toBe(0n);
  });
});
