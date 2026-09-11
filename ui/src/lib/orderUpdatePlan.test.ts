import { describe, expect, test } from "vitest";
import { planOffset, planShrink, totalRestingQty, type RestingOrder } from "./orderUpdatePlan";

const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

/** Oldest first, as both planners expect. */
const orders = (...quantities: number[]): RestingOrder[] =>
  quantities.map((qty, i) => ({ id: id(i + 1), restingQty: BigInt(qty) }));

describe("planShrink", () => {
  test("reduces a single order in place", () => {
    expect(planShrink(orders(10), 4n, true)).toEqual({
      cancelIds: [],
      reduces: [{ orderId: id(1), newQuantity: 4n }],
      leftoverQty: 0n,
    });
  });

  test("signs the new quantity to match a sell", () => {
    expect(planShrink(orders(10), 4n, false).reduces).toEqual([
      { orderId: id(1), newQuantity: -4n },
    ]);
  });

  test("trims the newest first so the oldest keeps its queue slot", () => {
    // 6 + 3 + 2 resting, shrinking to 7 has to give up 4: all of the newest
    // order and part of the middle one.
    expect(planShrink(orders(6, 3, 2), 7n, true)).toEqual({
      cancelIds: [id(3)],
      reduces: [{ orderId: id(2), newQuantity: 1n }],
      leftoverQty: 0n,
    });
  });

  test("emits a cancel rather than a zero reduce when an order is fully consumed", () => {
    expect(planShrink(orders(5, 3), 5n, true)).toEqual({
      cancelIds: [id(2)],
      reduces: [],
      leftoverQty: 0n,
    });
  });

  test("cancels everything when the target is zero", () => {
    expect(planShrink(orders(5, 3), 0n, true)).toEqual({
      cancelIds: [id(2), id(1)],
      reduces: [],
      leftoverQty: 0n,
    });
  });

  test("is a no-op when the target is not smaller", () => {
    expect(planShrink(orders(5), 5n, true)).toEqual({
      cancelIds: [],
      reduces: [],
      leftoverQty: 0n,
    });
  });
});

describe("planOffset", () => {
  test("partially offsets, leaving nothing to create", () => {
    expect(planOffset(orders(10), 4n, true)).toEqual({
      cancelIds: [],
      reduces: [{ orderId: id(1), newQuantity: 6n }],
      leftoverQty: 0n,
    });
  });

  test("fully offsets an exact match", () => {
    expect(planOffset(orders(10), 10n, true)).toEqual({
      cancelIds: [id(1)],
      reduces: [],
      leftoverQty: 0n,
    });
  });

  test("reports the excess as leftover to create", () => {
    expect(planOffset(orders(4), 10n, true)).toEqual({
      cancelIds: [id(1)],
      reduces: [],
      leftoverQty: 6n,
    });
  });

  test("consumes oldest first, mirroring the self-cross FIFO walk", () => {
    expect(planOffset(orders(2, 5), 4n, false)).toEqual({
      cancelIds: [id(1)],
      reduces: [{ orderId: id(2), newQuantity: -3n }],
      leftoverQty: 0n,
    });
  });
});

describe("totalRestingQty", () => {
  test("sums resting quantity", () => {
    expect(totalRestingQty(orders(2, 5, 1))).toBe(8n);
  });

  test("ignores non-positive entries", () => {
    expect(totalRestingQty([...orders(5), { id: id(9), restingQty: 0n }])).toBe(5n);
  });
});
