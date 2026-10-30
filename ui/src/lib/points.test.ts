import { describe, expect, test } from "vitest";
import { feeOnNotional } from "./orderFees";
import { fillPoints } from "./points";

const WEIGHT_SCALE = 10n ** 18n;
const W_TAKER = 10n ** 18n;
const W_MAKER = 15n * 10n ** 17n;
/** `POINTS_MIN_FEE` on dev and prd: 0.01 USDC. */
const MIN_FEE = 10_000n;
/** One contract at the prd mark, 32.83 USDC. */
const NOTIONAL = 32_830_000n;
const notionalUSDC = Number(NOTIONAL) / 1e6;

describe("fillPoints (X3-R4-5-4)", () => {
  const base = { notionalUSDC, minFee: MIN_FEE, weightScale: WEIGHT_SCALE };

  test("a taker paying at least minFee earns weight × notional", () => {
    const fee = feeOnNotional(NOTIONAL, 10);
    expect(fillPoints({ ...base, fee, weight: W_TAKER, side: "taker" })).toBeCloseTo(32.83);
  });

  test("a taker fee below minFee earns nothing", () => {
    expect(fillPoints({ ...base, fee: MIN_FEE - 1n, weight: W_TAKER, side: "taker" })).toBe(0);
  });

  test("a zero-fee maker earns nothing even with minFee at 0", () => {
    expect(fillPoints({ ...base, minFee: 0n, fee: 0n, weight: W_MAKER, side: "maker" })).toBe(0);
  });

  test("a maker paying at least minFee earns the maker weight", () => {
    expect(fillPoints({ ...base, fee: MIN_FEE, weight: W_MAKER, side: "maker" })).toBeCloseTo(49.245);
  });
});
