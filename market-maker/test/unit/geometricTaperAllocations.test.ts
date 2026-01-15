import test, { describe } from "node:test";
import assert from "node:assert";
import { geometricTaperAllocations } from "../../helpers.ts";

describe("geometricTaperAllocations", () => {
  describe("basic functionality", () => {
    test("returns correct structure with default alpha", () => {
      const result = geometricTaperAllocations(1000n, 4);
      assert.strictEqual(result.perSideBudget, 1000n);
      assert.strictEqual(result.weights.length, 4);
      assert.strictEqual(result.allocations.length, 4);
    });

    test("weights sum to 1", () => {
      const result = geometricTaperAllocations(1000n, 4, 0.6);
      const sumWeights = result.weights.reduce((a, b) => a + b, 0);
      assert.ok(
        Math.abs(sumWeights - 1) < 1e-10,
        `Expected weights to sum to 1, got ${sumWeights}`
      );
    });

    test("weights are decreasing (with alpha < 1)", () => {
      const result = geometricTaperAllocations(1000n, 5, 0.6);
      for (let i = 1; i < result.weights.length; i++) {
        assert.ok(
          result.weights[i] < result.weights[i - 1],
          `Expected weight[${i}] (${result.weights[i]}) < weight[${i - 1}] (${
            result.weights[i - 1]
          })`
        );
      }
    });

    test("allocations are decreasing (with alpha < 1)", () => {
      const result = geometricTaperAllocations(10000n, 5, 0.6);
      for (let i = 1; i < result.allocations.length; i++) {
        assert.ok(
          result.allocations[i] <= result.allocations[i - 1],
          `Expected allocation[${i}] (${result.allocations[i]}) <= allocation[${i - 1}] (${
            result.allocations[i - 1]
          })`
        );
      }
    });

    test("first weight is largest", () => {
      const result = geometricTaperAllocations(1000n, 4, 0.5);
      const maxWeight = Math.max(...result.weights);
      assert.strictEqual(result.weights[0], maxWeight);
    });
  });

  describe("edge cases", () => {
    test("levels = 0 returns empty arrays", () => {
      const result = geometricTaperAllocations(1000n, 0);
      assert.deepStrictEqual(result.weights, []);
      assert.deepStrictEqual(result.allocations, []);
      assert.strictEqual(result.perSideBudget, 1000n);
    });

    test("levels = 1 returns single allocation equal to budget", () => {
      const result = geometricTaperAllocations(1000n, 1, 0.5);
      assert.strictEqual(result.weights.length, 1);
      assert.strictEqual(result.weights[0], 1);
      assert.strictEqual(result.allocations.length, 1);
      assert.strictEqual(result.allocations[0], 1000n);
    });

    test("levels = 2 with alpha = 0.5", () => {
      const result = geometricTaperAllocations(1000n, 2, 0.5);
      // u = [1, 0.5], sum = 1.5
      // weights = [1/1.5, 0.5/1.5] = [0.6666..., 0.3333...]
      assert.ok(Math.abs(result.weights[0] - 2 / 3) < 1e-10);
      assert.ok(Math.abs(result.weights[1] - 1 / 3) < 1e-10);
    });

    test("handles large budget values", () => {
      const largeBudget = 1000000000000n; // 1 trillion
      const result = geometricTaperAllocations(largeBudget, 5, 0.6);
      assert.strictEqual(result.allocations.length, 5);
      // All allocations should be positive
      for (const alloc of result.allocations) {
        assert.ok(alloc > 0n, `Expected positive allocation, got ${alloc}`);
      }
    });

    test("handles small budget values", () => {
      const smallBudget = 10n;
      const result = geometricTaperAllocations(smallBudget, 3, 0.6);
      assert.strictEqual(result.allocations.length, 3);
      // Sum should not exceed budget
      const sum = result.allocations.reduce((a, b) => a + b, 0n);
      assert.ok(sum <= smallBudget, `Sum ${sum} exceeds budget ${smallBudget}`);
    });

    test("handles zero budget", () => {
      const result = geometricTaperAllocations(0n, 4, 0.5);
      assert.deepStrictEqual(result.allocations, [0n, 0n, 0n, 0n]);
    });
  });

  describe("alpha parameter variations", () => {
    test("alpha close to 0 concentrates weight on first level", () => {
      const result = geometricTaperAllocations(1000n, 4, 0.01);
      // With alpha = 0.01, first weight should be very close to 1
      assert.ok(result.weights[0] > 0.99, `Expected first weight > 0.99, got ${result.weights[0]}`);
    });

    test("alpha close to 1 distributes weight more evenly", () => {
      const result = geometricTaperAllocations(1000n, 4, 0.99);
      // With alpha = 0.99, weights should be nearly equal
      const maxWeight = Math.max(...result.weights);
      const minWeight = Math.min(...result.weights);
      const ratio = minWeight / maxWeight;
      assert.ok(ratio > 0.9, `Expected ratio > 0.9, got ${ratio}`);
    });

    test("alpha = 0.5 creates 2:1 ratio between adjacent weights", () => {
      const result = geometricTaperAllocations(1000n, 4, 0.5);
      for (let i = 1; i < result.weights.length; i++) {
        const ratio = result.weights[i] / result.weights[i - 1];
        assert.ok(Math.abs(ratio - 0.5) < 1e-10, `Expected ratio 0.5, got ${ratio}`);
      }
    });
  });

  describe("validation errors", () => {
    test("throws for negative levels", () => {
      assert.throws(() => geometricTaperAllocations(1000n, -1), /levels must be >= 0/);
    });

    test("throws for alpha = 0", () => {
      assert.throws(() => geometricTaperAllocations(1000n, 4, 0), /alpha must be > 0 and < 1/);
    });

    test("throws for alpha = 1", () => {
      assert.throws(() => geometricTaperAllocations(1000n, 4, 1), /alpha must be > 0 and < 1/);
    });

    test("throws for negative alpha", () => {
      assert.throws(() => geometricTaperAllocations(1000n, 4, -0.5), /alpha must be > 0 and < 1/);
    });

    test("throws for alpha > 1", () => {
      assert.throws(() => geometricTaperAllocations(1000n, 4, 1.5), /alpha must be > 0 and < 1/);
    });

    test("throws for NaN levels", () => {
      assert.throws(() => geometricTaperAllocations(1000n, NaN), /levels must be >= 0/);
    });

    test("throws for NaN alpha", () => {
      assert.throws(() => geometricTaperAllocations(1000n, 4, NaN), /alpha must be > 0 and < 1/);
    });
  });

  describe("allocation sum and precision", () => {
    test("sum of allocations does not exceed budget", () => {
      const budget = 1000n;
      const result = geometricTaperAllocations(budget, 5, 0.6);
      const sum = result.allocations.reduce((a, b) => a + b, 0n);
      assert.ok(sum <= budget, `Sum ${sum} exceeds budget ${budget}`);
    });

    test("allocation loss due to truncation is bounded", () => {
      const budget = 1000000n; // 1 million for precision
      const result = geometricTaperAllocations(budget, 5, 0.6);
      const sum = result.allocations.reduce((a, b) => a + b, 0n);
      const loss = budget - sum;
      // Loss should be at most N (one unit per level due to truncation)
      assert.ok(loss <= BigInt(5), `Expected loss <= 5, got ${loss}`);
    });

    test("allocations are all non-negative", () => {
      const result = geometricTaperAllocations(1000n, 10, 0.3);
      for (const alloc of result.allocations) {
        assert.ok(alloc >= 0n, `Expected non-negative allocation, got ${alloc}`);
      }
    });
  });

  describe("mathematical properties", () => {
    test("weight formula is correct: u_i = alpha^i", () => {
      const alpha = 0.7;
      const result = geometricTaperAllocations(1000n, 4, alpha);

      // Calculate expected weights manually
      const u = [1, 0.7, 0.49, 0.343]; // alpha^0, alpha^1, alpha^2, alpha^3
      const sumU = u.reduce((a, b) => a + b, 0);
      const expectedWeights = u.map((ui) => ui / sumU);

      for (let i = 0; i < 4; i++) {
        assert.ok(
          Math.abs(result.weights[i] - expectedWeights[i]) < 1e-10,
          `Weight[${i}] mismatch: got ${result.weights[i]}, expected ${expectedWeights[i]}`
        );
      }
    });

    test("ratio between consecutive weights equals alpha", () => {
      const alpha = 0.65;
      const result = geometricTaperAllocations(1000n, 5, alpha);

      for (let i = 1; i < result.weights.length; i++) {
        const ratio = result.weights[i] / result.weights[i - 1];
        assert.ok(
          Math.abs(ratio - alpha) < 1e-10,
          `Ratio at position ${i} should be ${alpha}, got ${ratio}`
        );
      }
    });
  });

  describe("potential issue: non-integer levels", () => {
    test("non-integer levels are silently truncated by Array.from", () => {
      // This is a potential issue - the function doesn't validate that levels is an integer
      // Array.from({ length: 3.7 }) creates an array of length 3
      const result = geometricTaperAllocations(1000n, 3.7 as unknown as number, 0.5);
      // This test documents the current behavior
      assert.strictEqual(
        result.weights.length,
        3,
        "Non-integer levels are truncated by Array.from"
      );
    });
  });
});
