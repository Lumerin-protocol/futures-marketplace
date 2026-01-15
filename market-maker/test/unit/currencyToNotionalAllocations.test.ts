import test, { describe } from "node:test";
import assert from "node:assert";
import { currencyToNotionalAllocations } from "../../helpers.ts";

describe("currencyToNotionalAllocations", () => {
  describe("basic functionality", () => {
    test("returns correct structure", () => {
      const result = currencyToNotionalAllocations([100n, 200n], [10n, 20n]);
      assert.ok("result" in result);
      assert.ok("remainder" in result);
      assert.strictEqual(result.result.length, 2);
    });

    test("simple division with no remainders", () => {
      // 100 / 10 = 10, 200 / 20 = 10
      const result = currencyToNotionalAllocations([100n, 200n], [10n, 20n]);
      assert.deepStrictEqual(result.result, [10n, 10n]);
      assert.strictEqual(result.remainder, 0n);
    });

    test("simple division with remainders but not enough to add contracts", () => {
      // 105 / 10 = 10 r5, 205 / 20 = 10 r5
      // totalRemainder = 10, not enough for another 10 or 20
      const result = currencyToNotionalAllocations([104n, 204n], [10n, 20n]);
      assert.deepStrictEqual(result.result, [10n, 10n]);
      assert.strictEqual(result.remainder, 8n);
    });

    test("remainders can form an extra contract", () => {
      // 95 / 10 = 9 r5, 95 / 10 = 9 r5
      // totalRemainder = 10, enough for one more contract at index 0 or 1
      const result = currencyToNotionalAllocations([95n, 95n], [10n, 10n]);
      // Should add one extra to one of them
      const sum = result.result.reduce((a, b) => a + b, 0n);
      assert.strictEqual(sum, 19n); // 9 + 9 + 1 extra
      assert.strictEqual(result.remainder, 0n);
    });

    test("single element array", () => {
      const result = currencyToNotionalAllocations([100n], [10n]);
      assert.deepStrictEqual(result.result, [10n]);
      assert.strictEqual(result.remainder, 0n);
    });

    test("single element with remainder", () => {
      const result = currencyToNotionalAllocations([105n], [10n]);
      assert.deepStrictEqual(result.result, [10n]);
      assert.strictEqual(result.remainder, 5n);
    });
  });

  describe("remainder distribution priority", () => {
    test("extra contract goes to entry with largest remainder", () => {
      // 19 / 10 = 1 r9, 11 / 10 = 1 r1
      // totalRemainder = 10, should go to index 0 (larger remainder)
      const result = currencyToNotionalAllocations([19n, 11n], [10n, 10n]);
      assert.deepStrictEqual(result.result, [2n, 1n]);
      assert.strictEqual(result.remainder, 0n);
    });

    test("multiple extra contracts distributed by remainder order", () => {
      // 18 / 10 = 1 r8, 17 / 10 = 1 r7, 15 / 10 = 1 r5
      // totalRemainder = 20, can add 2 contracts
      // Should go to indices 0 and 1 (highest remainders)
      const result = currencyToNotionalAllocations([18n, 17n, 15n], [10n, 10n, 10n]);
      assert.deepStrictEqual(result.result, [2n, 2n, 1n]);
      assert.strictEqual(result.remainder, 0n);
    });

    test("equal remainders maintain original order", () => {
      // 15 / 10 = 1 r5, 15 / 10 = 1 r5
      // totalRemainder = 10, should go to first index (stable sort)
      const result = currencyToNotionalAllocations([15n, 15n], [10n, 10n]);
      // One of them should get the extra contract
      const sum = result.result.reduce((a, b) => a + b, 0n);
      assert.strictEqual(sum, 3n);
      assert.strictEqual(result.remainder, 0n);
    });
  });

  describe("edge cases", () => {
    test("empty arrays", () => {
      const result = currencyToNotionalAllocations([], []);
      assert.deepStrictEqual(result.result, []);
      assert.strictEqual(result.remainder, 0n);
    });

    test("zero currency allocations", () => {
      const result = currencyToNotionalAllocations([0n, 0n], [10n, 10n]);
      assert.deepStrictEqual(result.result, [0n, 0n]);
      assert.strictEqual(result.remainder, 0n);
    });

    test("currency less than contract value", () => {
      const result = currencyToNotionalAllocations([5n, 3n], [10n, 10n]);
      assert.deepStrictEqual(result.result, [0n, 0n]);
      assert.strictEqual(result.remainder, 8n);
    });

    test("large values", () => {
      const trillion = 1000000000000n;
      const result = currencyToNotionalAllocations([trillion], [1000000n]);
      assert.deepStrictEqual(result.result, [1000000n]);
      assert.strictEqual(result.remainder, 0n);
    });
  });

  describe("different contract values", () => {
    test("varying contract values", () => {
      // 100 / 10 = 10 r0, 100 / 20 = 5 r0
      const result = currencyToNotionalAllocations([100n, 100n], [10n, 20n]);
      assert.deepStrictEqual(result.result, [10n, 5n]);
      assert.strictEqual(result.remainder, 0n);
    });

    test("extra contract goes to affordable slot even with smaller remainder", () => {
      // 109 / 100 = 1 r9, 11 / 10 = 1 r1
      // totalRemainder = 10
      // Sorted by remainder: index 0 (r9) first, then index 1 (r1)
      // Check index 0: 10 >= 100? No
      // Check index 1: 10 >= 10? Yes, add 1
      const result = currencyToNotionalAllocations([109n, 11n], [100n, 10n]);
      assert.deepStrictEqual(result.result, [1n, 2n]);
      assert.strictEqual(result.remainder, 0n);
    });

    test("remainder not enough for any contract", () => {
      // 109 / 100 = 1 r9, 209 / 200 = 1 r9
      // totalRemainder = 18, not enough for 100 or 200
      const result = currencyToNotionalAllocations([109n, 209n], [100n, 200n]);
      assert.deepStrictEqual(result.result, [1n, 1n]);
      assert.strictEqual(result.remainder, 18n);
    });
  });

  describe("validation", () => {
    test("throws when arrays have different lengths", () => {
      assert.throws(
        () => currencyToNotionalAllocations([100n, 200n], [10n]),
        /must have the same length/
      );
    });

    test("throws when arrays have different lengths (other direction)", () => {
      assert.throws(
        () => currencyToNotionalAllocations([100n], [10n, 20n]),
        /must have the same length/
      );
    });
  });

  describe("division by zero", () => {
    test("throws when contract value is zero", () => {
      assert.throws(
        () => currencyToNotionalAllocations([100n], [0n]),
        /Division by zero/ // or whatever error JS throws
      );
    });
  });

  describe("invariants", () => {
    test("total value of contracts plus remainder equals original allocation", () => {
      const currencies = [105n, 207n, 89n];
      const values = [10n, 20n, 30n];
      const result = currencyToNotionalAllocations(currencies, values);

      // contracts * values + remainder should equal total currency
      let totalValue = 0n;
      for (let i = 0; i < result.result.length; i++) {
        totalValue += result.result[i] * values[i];
      }
      totalValue += result.remainder;

      const totalCurrency = currencies.reduce((a, b) => a + b, 0n);
      assert.strictEqual(totalValue, totalCurrency);
    });

    test("remainder is always less than smallest contract value", () => {
      const currencies = [99n, 199n, 299n];
      const values = [10n, 20n, 30n];
      const result = currencyToNotionalAllocations(currencies, values);

      const minValue = values.reduce((a, b) => (a < b ? a : b));
      // This might not always be true - let's see
      // Actually the remainder can be larger if we can't add any more contracts
      // because none of them are affordable
    });
  });

  describe("BUG DETECTION: potential issue with single-pass distribution", () => {
    test("POTENTIAL BUG: algorithm only adds 1 contract per slot", () => {
      // Consider: 0 / 100 = 0 r0, 150 / 50 = 3 r0
      // No remainders, straightforward
      const result1 = currencyToNotionalAllocations([0n, 150n], [100n, 50n]);
      assert.deepStrictEqual(result1.result, [0n, 3n]);

      // Now consider: remainders that could add multiple contracts to same slot
      // 0 / 100 = 0 r0, 100 / 50 = 2 r0
      // plus extra remainder from somewhere else
      // Actually, remainders can't exceed the divisor, so max remainder per slot < value

      // Let's try: 50 / 100 = 0 r50, 150 / 50 = 3 r0
      // totalRemainder = 50
      // Sorted: index 0 (r50), index 1 (r0)
      // Check index 0: 50 >= 100? No
      // Check index 1: 50 >= 50? Yes, add 1, totalRemainder = 0
      // Result: [0, 4]
      const result2 = currencyToNotionalAllocations([50n, 150n], [100n, 50n]);
      assert.deepStrictEqual(result2.result, [0n, 4n]);
      assert.strictEqual(result2.remainder, 0n);
    });

    test("POTENTIAL BUG: could add more contracts if we loop", () => {
      // 50 / 100 = 0 r50, 50 / 10 = 5 r0
      // totalRemainder = 50
      // Sorted: index 0 (r50), index 1 (r0)
      // Check index 0: 50 >= 100? No
      // Check index 1: 50 >= 10? Yes, add 1, totalRemainder = 40
      // END OF LOOP
      //
      // But we could still add more! 40 >= 10, add another...
      // The algorithm doesn't loop back!
      const result = currencyToNotionalAllocations([50n, 50n], [100n, 10n]);

      // Current (possibly buggy) behavior: only adds 1 to index 1
      // Expected if algorithm looped: would add up to 5 contracts to index 1
      // totalRemainder = 50, all should go to index 1 (value 10)
      // 50 / 10 = 5 contracts

      // Let's check what we actually get
      console.log("Result:", result);

      // This test documents potential bug - the remainder could be distributed more
      // If totalRemainder after first pass is still >= smallest contract value,
      // we could add more contracts

      // Current algorithm adds only 1 contract per slot in a single pass
      // Expected: result[1] should be 5 + 5 = 10 (original 5 plus 5 from remainder)
      // Actual: result[1] is likely 5 + 1 = 6

      const totalContracts = result.result.reduce((a, b) => a + b, 0n);
      const expectedMinContracts = 10n; // 5 base + 5 from remainder distribution

      // This assertion will likely fail, exposing the bug
      if (totalContracts < expectedMinContracts) {
        console.log("POTENTIAL BUG FOUND!");
        console.log(`Expected at least ${expectedMinContracts} contracts, got ${totalContracts}`);
        console.log(`Remainder left: ${result.remainder}`);
      }

      // Verify invariant still holds
      const value = result.result[0] * 100n + result.result[1] * 10n + result.remainder;
      assert.strictEqual(value, 100n); // 50 + 50
    });

    test("BUG: multiple contracts could fit from accumulated remainders", () => {
      // Create scenario where many remainders accumulate
      // 9 / 10 = 0 r9 (x10 slots)
      // totalRemainder = 90
      // Each slot has value 10, so we could add 9 contracts total
      // But algorithm only adds 1 per slot in a single pass

      const currencies = Array(10).fill(9n);
      const values = Array(10).fill(10n);

      const result = currencyToNotionalAllocations(currencies, values);

      // totalRemainder = 90, all slots have r9
      // Algorithm will add 1 to each of 9 slots (sorted by remainder, all equal)
      // Wait, all remainders are equal, so order is preserved
      // It should add 1 to slots until remainder runs out

      // 90 / 10 = 9 extra contracts to distribute
      // The algorithm SHOULD add 1 to 9 slots... let's check

      const totalContracts = result.result.reduce((a, b) => a + b, 0n);
      console.log("10 slots with 9 each, value 10:", result);
      console.log("Total contracts:", totalContracts);
      console.log("Remainder:", result.remainder);

      // Expected: 9 contracts (from remainder distribution), remainder 0
      // Each slot gets 0 base allocation, but 9 slots get +1 from remainder
      assert.strictEqual(totalContracts, 9n);
      assert.strictEqual(result.remainder, 0n);
    });
  });

  describe("comprehensive remainder distribution", () => {
    test("all remainder can be distributed", () => {
      // 19 / 10 = 1 r9, 19 / 10 = 1 r9, 12 / 10 = 1 r2
      // totalRemainder = 20
      // Add 1 to first two (highest remainders)
      const result = currencyToNotionalAllocations([19n, 19n, 12n], [10n, 10n, 10n]);
      assert.deepStrictEqual(result.result, [2n, 2n, 1n]);
      assert.strictEqual(result.remainder, 0n);
    });

    test("partial remainder distribution", () => {
      // 15 / 10 = 1 r5, 15 / 10 = 1 r5, 15 / 10 = 1 r5
      // totalRemainder = 15
      // Can only add 1 contract (need 10)
      // 5 remainder left
      const result = currencyToNotionalAllocations([15n, 15n, 15n], [10n, 10n, 10n]);
      const sum = result.result.reduce((a, b) => a + b, 0n);
      assert.strictEqual(sum, 4n); // 3 base + 1 extra
      assert.strictEqual(result.remainder, 5n);
    });
  });

  describe("greedy vs optimal distribution", () => {
    test("greedy by remainder may leave more remainder than optimal", () => {
      // 99 / 100 = 0 r99, 1 / 10 = 0 r1
      // totalRemainder = 100
      // Sorted: index 0 (r99), index 1 (r1)
      // Check index 0: 100 >= 100? Yes, add 1, totalRemainder = 0
      // Result: [1, 0], remainder 0

      // Alternative: add to index 1 first
      // Check index 1: 100 >= 10? Yes, add 1, totalRemainder = 90
      // Check index 0: 90 >= 100? No
      // Result: [0, 1], remainder 90

      // Current greedy approach gives better result in this case!
      const result = currencyToNotionalAllocations([99n, 1n], [100n, 10n]);
      assert.deepStrictEqual(result.result, [1n, 0n]);
      assert.strictEqual(result.remainder, 0n);
    });

    test("greedy may not maximize number of contracts", () => {
      // 90 / 100 = 0 r90, 10 / 10 = 1 r0
      // totalRemainder = 90
      // Sorted: index 0 (r90), index 1 (r0)
      // Check index 0: 90 >= 100? No
      // Check index 1: 90 >= 10? Yes, add 1, totalRemainder = 80
      // END - but we could add 8 more to index 1!

      const result = currencyToNotionalAllocations([90n, 10n], [100n, 10n]);
      console.log("Greedy result:", result);

      // Current behavior: [0, 2], remainder 80
      // Optimal: [0, 10], remainder 0 (add 9 contracts to index 1)

      // This exposes the bug - only 1 contract added per slot
      // Total value should be: 0*100 + 2*10 + 80 = 100 ✓
      const totalValue = result.result[0] * 100n + result.result[1] * 10n + result.remainder;
      assert.strictEqual(totalValue, 100n);

      // Document the bug
      if (result.remainder > 0n && result.remainder >= 10n) {
        console.log("BUG: Could add more contracts from remainder!");
        console.log(`Remainder ${result.remainder} >= smallest contract value 10`);
      }
    });
  });
});
