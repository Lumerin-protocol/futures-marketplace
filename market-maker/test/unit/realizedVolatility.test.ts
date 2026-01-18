import test, { describe } from "node:test";
import assert from "node:assert";
import { realizedVolatility } from "../../helpers.ts";

describe("realizedVolatility", () => {
  test("returns sigmaPerStep: 0 for empty array", () => {
    const result = realizedVolatility([]);
    assert.deepStrictEqual(result, { sigmaPerStep: 0 });
  });

  test("returns sigmaPerStep: 0 for single price point", () => {
    const result = realizedVolatility([{ date: 1000, price: 100n }]);
    assert.deepStrictEqual(result, { sigmaPerStep: 0 });
  });

  test("returns NaN for two prices with sample variance (division by zero)", () => {
    // With 2 prices we get 1 return, sample variance divides by (n-1) = 0
    const result = realizedVolatility([
      { date: 1000, price: 100n },
      { date: 2000, price: 100n },
    ]);
    assert.ok(Number.isNaN(result.sigmaPerStep));
  });

  test("returns sigmaPerStep: 0 for two equal prices with population variance", () => {
    const result = realizedVolatility(
      [
        { date: 1000, price: 100n },
        { date: 2000, price: 100n },
      ],
      false // population variance
    );
    assert.deepStrictEqual(result, { sigmaPerStep: 0 });
  });

  test("returns sigmaPerStep: 0 for multiple equal prices", () => {
    const result = realizedVolatility([
      { date: 1000, price: 50n },
      { date: 2000, price: 50n },
      { date: 3000, price: 50n },
      { date: 4000, price: 50n },
    ]);
    assert.deepStrictEqual(result, { sigmaPerStep: 0 });
  });

  test("computes correct volatility for two prices with population variance", () => {
    // With 2 prices we get 1 return, population variance divides by n = 1
    // Single return has 0 variance (no deviation from mean)
    const result = realizedVolatility(
      [
        { date: 1000, price: 100n },
        { date: 2000, price: 200n },
      ],
      false // population variance
    );
    assert.strictEqual(result.sigmaPerStep, 0);
  });

  test("computes correct volatility for known returns (sample variance)", () => {
    // Prices: 100 -> 110 -> 100 -> 110
    // Log returns: ln(1.1), ln(10/11), ln(1.1)
    // ln(1.1) ≈ 0.09531, ln(10/11) ≈ -0.09531
    // Returns: [0.09531, -0.09531, 0.09531]
    // Mean: (0.09531 - 0.09531 + 0.09531) / 3 ≈ 0.03177
    // Variance (sample): sum of squared deviations / (n-1)

    const result = realizedVolatility([
      { date: 1000, price: 100n },
      { date: 2000, price: 110n },
      { date: 3000, price: 100n },
      { date: 4000, price: 110n },
    ]);

    const r1 = Math.log(110 / 100);
    const r2 = Math.log(100 / 110);
    const r3 = Math.log(110 / 100);
    const returns = [r1, r2, r3];
    const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
    const variance = returns.reduce((s, x) => s + (x - mean) ** 2, 0) / (returns.length - 1);
    const expectedSigma = Math.sqrt(variance);

    assert.strictEqual(result.sigmaPerStep, expectedSigma);
  });

  test("computes correct volatility with population variance", () => {
    const result = realizedVolatility(
      [
        { date: 1000, price: 100n },
        { date: 2000, price: 110n },
        { date: 3000, price: 100n },
        { date: 4000, price: 110n },
      ],
      false // population variance
    );

    const r1 = Math.log(110 / 100);
    const r2 = Math.log(100 / 110);
    const r3 = Math.log(110 / 100);
    const returns = [r1, r2, r3];
    const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
    const variance = returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length; // population
    const expectedSigma = Math.sqrt(variance);

    assert.strictEqual(result.sigmaPerStep, expectedSigma);
  });

  test("sample variance is larger than population variance", () => {
    const prices = [
      { date: 1000, price: 100n },
      { date: 2000, price: 120n },
      { date: 3000, price: 90n },
      { date: 4000, price: 110n },
    ];

    const sampleResult = realizedVolatility(prices, true);
    const populationResult = realizedVolatility(prices, false);

    assert.ok(sampleResult.sigmaPerStep > populationResult.sigmaPerStep);
  });

  test("sorts unsorted input by date", () => {
    // Out of order input should produce same result as sorted
    const sorted = realizedVolatility([
      { date: 1000, price: 100n },
      { date: 2000, price: 110n },
      { date: 3000, price: 105n },
    ]);

    const unsorted = realizedVolatility([
      { date: 3000, price: 105n },
      { date: 1000, price: 100n },
      { date: 2000, price: 110n },
    ]);

    assert.strictEqual(sorted.sigmaPerStep, unsorted.sigmaPerStep);
  });

  test("throws for price <= 0", () => {
    assert.throws(() => realizedVolatility([{ date: 1000, price: 0n }]), /Invalid p\.price/);

    assert.throws(() => realizedVolatility([{ date: 1000, price: -1n }]), /Invalid p\.price/);
  });

  test("throws for invalid date (NaN)", () => {
    assert.throws(() => realizedVolatility([{ date: NaN, price: 100n }]), /Invalid p\.date/);
  });

  test("throws for date <= 0", () => {
    assert.throws(() => realizedVolatility([{ date: 0, price: 100n }]), /Invalid p\.date/);

    assert.throws(() => realizedVolatility([{ date: -1000, price: 100n }]), /Invalid p\.date/);
  });

  test("throws for Infinity date", () => {
    assert.throws(() => realizedVolatility([{ date: Infinity, price: 100n }]), /Invalid p\.date/);
  });

  test("handles large price values", () => {
    // Should not overflow with bigint conversion to Number
    // Use 3+ prices to avoid sample variance division by zero
    const result = realizedVolatility([
      { date: 1000, price: 1000000000000000000n }, // 1e18
      { date: 2000, price: 1100000000000000000n }, // 1.1e18
      { date: 3000, price: 1050000000000000000n }, // 1.05e18
    ]);

    assert.ok(Number.isFinite(result.sigmaPerStep));
    assert.ok(result.sigmaPerStep > 0);
  });

  test("correctly handles exponential price growth", () => {
    // Constant growth rate should give 0 volatility (all returns equal)
    // P_t = P_0 * e^(r*t), so ln(P_t/P_{t-1}) = r (constant)
    const e = Math.E;
    const r = 0.1;
    const prices = [
      { date: 1000, price: BigInt(Math.round(100 * e ** (r * 0))) },
      { date: 2000, price: BigInt(Math.round(100 * e ** (r * 1))) },
      { date: 3000, price: BigInt(Math.round(100 * e ** (r * 2))) },
      { date: 4000, price: BigInt(Math.round(100 * e ** (r * 3))) },
    ];

    const result = realizedVolatility(prices);

    // Due to rounding, volatility won't be exactly 0, but should be very small
    assert.ok(result.sigmaPerStep < 0.01);
  });

  test("defaults to sample variance when sample parameter not provided", () => {
    const prices = [
      { date: 1000, price: 100n },
      { date: 2000, price: 120n },
      { date: 3000, price: 90n },
    ];

    const defaultResult = realizedVolatility(prices);
    const sampleResult = realizedVolatility(prices, true);

    assert.strictEqual(defaultResult.sigmaPerStep, sampleResult.sigmaPerStep);
  });
});
