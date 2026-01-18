import test, { describe, mock } from "node:test";
import assert from "node:assert";
import { mult, wait, NowSeconds, clamp, abs } from "../../lib.ts";

describe("mult", () => {
  test("multiplies bigint by 1 returns same value", () => {
    const result = mult(1000000n, 1);
    assert.strictEqual(result, 1000000n);
  });

  test("multiplies bigint by 0 returns 0", () => {
    const result = mult(1000000n, 0);
    assert.strictEqual(result, 0n);
  });

  test("multiplies bigint by 0.5 returns half", () => {
    const result = mult(1000000n, 0.5);
    assert.strictEqual(result, 500000n);
  });

  test("multiplies bigint by 2 returns double", () => {
    const result = mult(1000000n, 2);
    assert.strictEqual(result, 2000000n);
  });

  test("multiplies bigint by small decimal", () => {
    const result = mult(1000000n, 0.001);
    assert.strictEqual(result, 1000n);
  });

  test("handles negative bigint", () => {
    const result = mult(-1000000n, 0.5);
    assert.strictEqual(result, -500000n);
  });

  test("handles negative multiplier", () => {
    const result = mult(1000000n, -0.5);
    assert.strictEqual(result, -500000n);
  });

  test("handles both negative", () => {
    const result = mult(-1000000n, -0.5);
    assert.strictEqual(result, 500000n);
  });

  test("truncates fractional result (floors)", () => {
    // 100 * 0.333333 = 33.3333, should floor to 33
    const result = mult(100n, 0.333333);
    assert.strictEqual(result, 33n);
  });

  test("handles zero bigint", () => {
    const result = mult(0n, 0.5);
    assert.strictEqual(result, 0n);
  });

  test("handles large bigint values", () => {
    const result = mult(1000000000000000000n, 0.5);
    assert.strictEqual(result, 500000000000000000n);
  });
});

describe("wait", () => {
  test("returns a promise", () => {
    const result = wait(1);
    assert.ok(result instanceof Promise);
  });

  test("resolves after specified time", async () => {
    const start = Date.now();
    await wait(50);
    const elapsed = Date.now() - start;
    // Allow some tolerance for timing
    assert.ok(elapsed >= 45, `Expected at least 45ms, got ${elapsed}ms`);
    assert.ok(elapsed < 150, `Expected less than 150ms, got ${elapsed}ms`);
  });

  test("resolves with undefined", async () => {
    const result = await wait(1);
    assert.strictEqual(result, undefined);
  });

  test("handles zero milliseconds", async () => {
    const result = await wait(0);
    assert.strictEqual(result, undefined);
  });
});

describe("NowSeconds", () => {
  test("returns a number", () => {
    const result = NowSeconds();
    assert.strictEqual(typeof result, "number");
  });

  test("returns integer (no fractional seconds)", () => {
    const result = NowSeconds();
    assert.strictEqual(result, Math.floor(result));
  });

  test("returns current time in seconds", () => {
    const before = Math.floor(Date.now() / 1000);
    const result = NowSeconds();
    const after = Math.floor(Date.now() / 1000);

    assert.ok(result >= before, `Expected result >= ${before}, got ${result}`);
    assert.ok(result <= after, `Expected result <= ${after}, got ${result}`);
  });

  test("returns value close to Date.now() / 1000", () => {
    const result = NowSeconds();
    const expected = Math.floor(Date.now() / 1000);
    // Allow 1 second tolerance for execution time
    assert.ok(Math.abs(result - expected) <= 1);
  });
});

describe("clamp", () => {
  test("returns value when within range", () => {
    assert.strictEqual(clamp(5, 0, 10), 5);
  });

  test("returns lo when value is below range", () => {
    assert.strictEqual(clamp(-5, 0, 10), 0);
  });

  test("returns hi when value is above range", () => {
    assert.strictEqual(clamp(15, 0, 10), 10);
  });

  test("returns lo when value equals lo", () => {
    assert.strictEqual(clamp(0, 0, 10), 0);
  });

  test("returns hi when value equals hi", () => {
    assert.strictEqual(clamp(10, 0, 10), 10);
  });

  test("handles negative range", () => {
    assert.strictEqual(clamp(-5, -10, -1), -5);
    assert.strictEqual(clamp(-15, -10, -1), -10);
    assert.strictEqual(clamp(0, -10, -1), -1);
  });

  test("handles floating point values", () => {
    assert.strictEqual(clamp(0.5, 0, 1), 0.5);
    assert.strictEqual(clamp(-0.5, 0, 1), 0);
    assert.strictEqual(clamp(1.5, 0, 1), 1);
  });

  test("handles equal lo and hi", () => {
    assert.strictEqual(clamp(5, 5, 5), 5);
    assert.strictEqual(clamp(0, 5, 5), 5);
    assert.strictEqual(clamp(10, 5, 5), 5);
  });

  test("handles zero as bounds", () => {
    assert.strictEqual(clamp(0, 0, 0), 0);
    assert.strictEqual(clamp(-1, 0, 0), 0);
    assert.strictEqual(clamp(1, 0, 0), 0);
  });
});

describe("abs", () => {
  test("returns positive value unchanged", () => {
    assert.strictEqual(abs(5n), 5n);
  });

  test("returns absolute value of negative", () => {
    assert.strictEqual(abs(-5n), 5n);
  });

  test("returns 0n for 0n", () => {
    assert.strictEqual(abs(0n), 0n);
  });

  test("handles large positive bigint", () => {
    const large = 1000000000000000000n;
    assert.strictEqual(abs(large), large);
  });

  test("handles large negative bigint", () => {
    const large = -1000000000000000000n;
    assert.strictEqual(abs(large), 1000000000000000000n);
  });

  test("handles -1n", () => {
    assert.strictEqual(abs(-1n), 1n);
  });

  test("handles 1n", () => {
    assert.strictEqual(abs(1n), 1n);
  });
});
