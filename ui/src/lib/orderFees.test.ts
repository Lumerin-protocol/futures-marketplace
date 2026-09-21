import { describe, expect, test } from "vitest";
import { feeOnNotional, quoteOrderFees } from "./orderFees";

const USDC = 1_000_000n;

describe("feeOnNotional", () => {
  test("charges bps of notional, truncating like the contract", () => {
    // 25 USDC at 10 bps = 0.025 USDC.
    expect(feeOnNotional(25n * USDC, 10)).toBe(25_000n);
    // 1 unit at 10 bps truncates to nothing.
    expect(feeOnNotional(1n, 10)).toBe(0n);
  });

  test("a negative rate is a rebate", () => {
    expect(feeOnNotional(25n * USDC, -5)).toBe(-12_500n);
  });
});

describe("quoteOrderFees", () => {
  const notional = 100n * USDC;

  test("a resting-capable order can pay either rate and reserves the larger", () => {
    const quote = quoteOrderFees({ notional, makerFeeBps: 10, takerFeeBps: 25, canRest: true });
    expect(quote.maker).toBe(100_000n);
    expect(quote.taker).toBe(250_000n);
    expect(quote.reserved).toBe(250_000n);
  });

  test("an order that cannot rest is a taker only", () => {
    const quote = quoteOrderFees({ notional, makerFeeBps: 10, takerFeeBps: 25, canRest: false });
    expect(quote.maker).toBeUndefined();
    expect(quote.taker).toBe(250_000n);
    expect(quote.reserved).toBe(250_000n);
  });

  test("a maker rebate is shown but never reserved as headroom", () => {
    const quote = quoteOrderFees({ notional, makerFeeBps: -5, takerFeeBps: 20, canRest: true });
    expect(quote.maker).toBe(-50_000n);
    expect(quote.reserved).toBe(200_000n);
  });

  test("reserved is never negative even when both rates are rebates", () => {
    const quote = quoteOrderFees({ notional, makerFeeBps: -5, takerFeeBps: -1, canRest: true });
    expect(quote.reserved).toBe(0n);
  });

  test("reserved matches what the margin gate holds back", () => {
    // `useMakerTakerFees().feeFor` reserves max(maker, taker) bps of notional,
    // clamped at zero; the confirmation's total must agree with that gate.
    const feeFor = (n: bigint, maker: number, taker: number) => {
      const worst = Math.max(maker, taker);
      return worst <= 0 ? 0n : (n * BigInt(worst)) / 10_000n;
    };
    for (const [maker, taker] of [
      [10, 25],
      [30, 25],
      [-5, 20],
      [0, 0],
    ]) {
      expect(quoteOrderFees({ notional, makerFeeBps: maker, takerFeeBps: taker, canRest: true }).reserved).toBe(
        feeFor(notional, maker, taker),
      );
    }
  });
});
