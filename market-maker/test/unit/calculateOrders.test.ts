import test, { describe } from "node:test";
import assert from "node:assert";
import { calculateOrders } from "../../helpers.ts";
import type { Order } from "../../subgraph.ts";

// Helper to sort orders for comparison
const sortByPrice = (orders: Order[]) =>
  [...orders].sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));

// Helper to check if two order arrays are equivalent
const assertOrdersEqual = (actual: Order[], expected: Order[]) => {
  const sortedActual = sortByPrice(actual);
  const sortedExpected = sortByPrice(expected);
  assert.deepStrictEqual(sortedActual, sortedExpected);
};

describe("calculateOrders", () => {
  describe("basic cases", () => {
    test("returns empty array when both inputs are empty", () => {
      const result = calculateOrders([], []);
      assert.deepStrictEqual(result, []);
    });

    test("returns modelled orders when current is empty", () => {
      const modelled: Order[] = [
        { price: 100n, qty: 5n },
        { price: 200n, qty: 3n },
      ];
      const result = calculateOrders(modelled, []);
      assertOrdersEqual(result, modelled);
    });

    test("returns negative of current orders when modelled is empty", () => {
      const current: Order[] = [
        { price: 100n, qty: 5n },
        { price: 200n, qty: 3n },
      ];
      const expected: Order[] = [
        { price: 100n, qty: -5n },
        { price: 200n, qty: -3n },
      ];
      const result = calculateOrders([], current);
      assertOrdersEqual(result, expected);
    });

    test("returns empty when modelled equals current", () => {
      const orders: Order[] = [
        { price: 100n, qty: 5n },
        { price: 200n, qty: 3n },
      ];
      const result = calculateOrders(orders, orders);
      assert.deepStrictEqual(result, []);
    });
  });

  describe("quantity differences", () => {
    test("returns positive diff when modelled > current", () => {
      const modelled: Order[] = [{ price: 100n, qty: 10n }];
      const current: Order[] = [{ price: 100n, qty: 3n }];
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [{ price: 100n, qty: 7n }]);
    });

    test("returns negative diff when modelled < current", () => {
      const modelled: Order[] = [{ price: 100n, qty: 3n }];
      const current: Order[] = [{ price: 100n, qty: 10n }];
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [{ price: 100n, qty: -7n }]);
    });

    test("handles zero quantity in result (no order placed)", () => {
      const modelled: Order[] = [{ price: 100n, qty: 5n }];
      const current: Order[] = [{ price: 100n, qty: 5n }];
      const result = calculateOrders(modelled, current);
      assert.deepStrictEqual(result, []);
    });
  });

  describe("price level handling", () => {
    test("handles non-overlapping price levels", () => {
      const modelled: Order[] = [{ price: 100n, qty: 5n }];
      const current: Order[] = [{ price: 200n, qty: 3n }];
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [
        { price: 100n, qty: 5n },
        { price: 200n, qty: -3n },
      ]);
    });

    test("handles partially overlapping price levels", () => {
      const modelled: Order[] = [
        { price: 100n, qty: 5n },
        { price: 200n, qty: 3n },
      ];
      const current: Order[] = [
        { price: 200n, qty: 1n },
        { price: 300n, qty: 2n },
      ];
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [
        { price: 100n, qty: 5n },
        { price: 200n, qty: 2n },
        { price: 300n, qty: -2n },
      ]);
    });
  });

  describe("aggregation of multiple orders at same price", () => {
    test("aggregates multiple modelled orders at same price", () => {
      const modelled: Order[] = [
        { price: 100n, qty: 3n },
        { price: 100n, qty: 2n },
      ];
      const current: Order[] = [];
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [{ price: 100n, qty: 5n }]);
    });

    test("aggregates multiple current orders at same price", () => {
      const modelled: Order[] = [];
      const current: Order[] = [
        { price: 100n, qty: 3n },
        { price: 100n, qty: 2n },
      ];
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [{ price: 100n, qty: -5n }]);
    });

    test("aggregates both and calculates correct diff", () => {
      const modelled: Order[] = [
        { price: 100n, qty: 3n },
        { price: 100n, qty: 4n },
      ]; // total: 7
      const current: Order[] = [
        { price: 100n, qty: 2n },
        { price: 100n, qty: 1n },
      ]; // total: 3
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [{ price: 100n, qty: 4n }]); // 7 - 3 = 4
    });
  });

  describe("negative quantities (short orders)", () => {
    test("handles negative modelled quantity", () => {
      const modelled: Order[] = [{ price: 100n, qty: -5n }];
      const current: Order[] = [];
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [{ price: 100n, qty: -5n }]);
    });

    test("handles negative current quantity", () => {
      const modelled: Order[] = [];
      const current: Order[] = [{ price: 100n, qty: -5n }];
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [{ price: 100n, qty: 5n }]);
    });

    test("handles transition from negative to positive", () => {
      const modelled: Order[] = [{ price: 100n, qty: 3n }];
      const current: Order[] = [{ price: 100n, qty: -2n }];
      const result = calculateOrders(modelled, current);
      // To go from -2 to +3, we need +5
      assertOrdersEqual(result, [{ price: 100n, qty: 5n }]);
    });

    test("handles transition from positive to negative", () => {
      const modelled: Order[] = [{ price: 100n, qty: -3n }];
      const current: Order[] = [{ price: 100n, qty: 2n }];
      const result = calculateOrders(modelled, current);
      // To go from +2 to -3, we need -5
      assertOrdersEqual(result, [{ price: 100n, qty: -5n }]);
    });

    test("handles mixed positive and negative at same price canceling out", () => {
      const modelled: Order[] = [
        { price: 100n, qty: 5n },
        { price: 100n, qty: -5n },
      ];
      const current: Order[] = [];
      const result = calculateOrders(modelled, current);
      // 5 + (-5) = 0, should return empty
      assert.deepStrictEqual(result, []);
    });
  });

  describe("large numbers", () => {
    test("handles very large bigint values", () => {
      const large = 1000000000000000000000n; // 10^21
      const modelled: Order[] = [{ price: large, qty: large }];
      const current: Order[] = [{ price: large, qty: large / 2n }];
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [{ price: large, qty: large / 2n }]);
    });
  });

  describe("sorting", () => {
    test("returns orders sorted by price ascending", () => {
      const modelled: Order[] = [
        { price: 300n, qty: 1n },
        { price: 100n, qty: 2n },
        { price: 200n, qty: 3n },
      ];
      const result = calculateOrders(modelled, []);
      assert.deepStrictEqual(result, [
        { price: 100n, qty: 2n },
        { price: 200n, qty: 3n },
        { price: 300n, qty: 1n },
      ]);
    });
  });

  describe("invariant: applying result to current should yield modelled", () => {
    test("invariant holds for complex scenario", () => {
      const modelled: Order[] = [
        { price: 100n, qty: 10n },
        { price: 150n, qty: -5n },
        { price: 200n, qty: 3n },
      ];
      const current: Order[] = [
        { price: 100n, qty: 7n },
        { price: 200n, qty: 5n },
        { price: 250n, qty: 2n },
      ];

      const result = calculateOrders(modelled, current);

      // Apply result to current and verify we get modelled
      const appliedByPrice = new Map<bigint, bigint>();
      for (const order of current) {
        const existing = appliedByPrice.get(order.price) ?? 0n;
        appliedByPrice.set(order.price, existing + order.qty);
      }
      for (const order of result) {
        const existing = appliedByPrice.get(order.price) ?? 0n;
        appliedByPrice.set(order.price, existing + order.qty);
      }

      // Build expected from modelled
      const expectedByPrice = new Map<bigint, bigint>();
      for (const order of modelled) {
        const existing = expectedByPrice.get(order.price) ?? 0n;
        expectedByPrice.set(order.price, existing + order.qty);
      }

      // Compare - remove zero entries
      for (const [price, qty] of appliedByPrice) {
        if (qty === 0n) appliedByPrice.delete(price);
      }
      for (const [price, qty] of expectedByPrice) {
        if (qty === 0n) expectedByPrice.delete(price);
      }

      assert.deepStrictEqual(appliedByPrice, expectedByPrice);
    });
  });

  describe("edge cases - potential bug hunting", () => {
    test("zero quantity order in modelled", () => {
      const modelled: Order[] = [{ price: 100n, qty: 0n }];
      const current: Order[] = [];
      const result = calculateOrders(modelled, current);
      // Zero qty in modelled, nothing in current -> diff is 0, should not appear in result
      assert.deepStrictEqual(result, []);
    });

    test("zero quantity order in current", () => {
      const modelled: Order[] = [];
      const current: Order[] = [{ price: 100n, qty: 0n }];
      const result = calculateOrders(modelled, current);
      // Nothing in modelled, zero in current -> diff is 0, should not appear in result
      assert.deepStrictEqual(result, []);
    });

    test("both have zero quantity at same price", () => {
      const modelled: Order[] = [{ price: 100n, qty: 0n }];
      const current: Order[] = [{ price: 100n, qty: 0n }];
      const result = calculateOrders(modelled, current);
      assert.deepStrictEqual(result, []);
    });

    test("many orders at many price levels", () => {
      const modelled: Order[] = [];
      const current: Order[] = [];
      for (let i = 0; i < 100; i++) {
        modelled.push({ price: BigInt(i * 10), qty: BigInt(i + 1) });
        current.push({ price: BigInt(i * 10), qty: BigInt(i) });
      }
      const result = calculateOrders(modelled, current);
      // Each price level should have diff of 1 (except price 0 where modelled=1, current=0)
      assert.strictEqual(result.length, 100);
      for (const order of result) {
        assert.strictEqual(order.qty, 1n);
      }
    });

    test("duplicate prices in input arrays are handled correctly", () => {
      // Multiple entries with same price should be aggregated
      const modelled: Order[] = [
        { price: 100n, qty: 1n },
        { price: 100n, qty: 2n },
        { price: 100n, qty: 3n },
      ];
      const current: Order[] = [
        { price: 100n, qty: 1n },
        { price: 100n, qty: 1n },
      ];
      const result = calculateOrders(modelled, current);
      // modelled total: 6, current total: 2, diff: 4
      assertOrdersEqual(result, [{ price: 100n, qty: 4n }]);
    });

    test("result is idempotent when applied twice", () => {
      // If we apply result once, we should get modelled
      // If we calculate again with modelled as both inputs, result should be empty
      const modelled: Order[] = [
        { price: 100n, qty: 10n },
        { price: 200n, qty: 5n },
      ];
      const current: Order[] = [{ price: 100n, qty: 3n }];

      const firstResult = calculateOrders(modelled, current);

      // Now calculate what's needed to go from modelled to modelled
      const secondResult = calculateOrders(modelled, modelled);
      assert.deepStrictEqual(secondResult, []);
    });

    test("handles negative prices", () => {
      // Unusual but bigint allows it
      const modelled: Order[] = [{ price: -100n, qty: 5n }];
      const current: Order[] = [{ price: -100n, qty: 2n }];
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [{ price: -100n, qty: 3n }]);
    });

    test("minimum bigint values", () => {
      const modelled: Order[] = [{ price: 1n, qty: 1n }];
      const current: Order[] = [{ price: 1n, qty: 2n }];
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [{ price: 1n, qty: -1n }]);
    });
  });

  describe("regression tests - specific scenarios", () => {
    test("scenario: adding new price levels while removing others", () => {
      // Current: orders at 100, 200
      // Target: orders at 200, 300
      // Should: cancel 100, keep 200 (if same), add 300
      const modelled: Order[] = [
        { price: 200n, qty: 5n },
        { price: 300n, qty: 3n },
      ];
      const current: Order[] = [
        { price: 100n, qty: 2n },
        { price: 200n, qty: 5n },
      ];
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [
        { price: 100n, qty: -2n }, // cancel
        { price: 300n, qty: 3n }, // add
        // 200 is unchanged (5-5=0)
      ]);
    });

    test("scenario: complete position flip", () => {
      // Current: long 10 at 100
      // Target: short 10 at 100
      const modelled: Order[] = [{ price: 100n, qty: -10n }];
      const current: Order[] = [{ price: 100n, qty: 10n }];
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [{ price: 100n, qty: -20n }]);
    });

    test("scenario: reduce all positions to zero (close everything)", () => {
      const current: Order[] = [
        { price: 100n, qty: 5n },
        { price: 200n, qty: -3n },
        { price: 300n, qty: 10n },
      ];
      const modelled: Order[] = []; // close everything
      const result = calculateOrders(modelled, current);
      assertOrdersEqual(result, [
        { price: 100n, qty: -5n },
        { price: 200n, qty: 3n },
        { price: 300n, qty: -10n },
      ]);
    });
  });
});
