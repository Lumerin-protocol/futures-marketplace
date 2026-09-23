import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { isDeepEqual, writeIfChanged, writeResponseIfChanged } from "./writeIfChanged";

describe("isDeepEqual", () => {
  it("compares bigints, which JSON.stringify cannot serialise at all", () => {
    expect(isDeepEqual({ price: 10n }, { price: 10n })).toBe(true);
    expect(isDeepEqual({ price: 10n }, { price: 11n })).toBe(false);
  });

  it("does not treat a bigint as equal to the number with the same value", () => {
    expect(isDeepEqual({ q: 1n }, { q: 1 })).toBe(false);
  });

  it("walks nested rows the way the mapped subgraph shapes are built", () => {
    const a = { positions: [{ id: "1", trades: [{ fee: 5n }] }] };
    const b = { positions: [{ id: "1", trades: [{ fee: 5n }] }] };
    expect(isDeepEqual(a, b)).toBe(true);

    const c = { positions: [{ id: "1", trades: [{ fee: 6n }] }] };
    expect(isDeepEqual(a, c)).toBe(false);
  });

  it("separates null from an object and from undefined", () => {
    expect(isDeepEqual({ expiration: null }, { expiration: {} })).toBe(false);
    expect(isDeepEqual(null, undefined)).toBe(false);
    expect(isDeepEqual(null, null)).toBe(true);
  });

  it("does not call an array equal to an object with the same keys", () => {
    expect(isDeepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it("catches a key present on only one side even when lengths match", () => {
    expect(isDeepEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
  });

  it("notices rows appearing, disappearing and reordering", () => {
    expect(isDeepEqual([{ id: "a" }], [{ id: "a" }, { id: "b" }])).toBe(false);
    expect(isDeepEqual([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "a" }])).toBe(false);
  });
});

/**
 * A later tick: issued after everything already in the cache was written.
 *
 * Real ticks are five seconds apart, but a test writes its setup and its
 * assertion within the same millisecond, so the separation has to be stated
 * rather than waited for.
 */
const laterTick = () => Date.now() + 1_000;

/** An earlier tick: issued before the write that follows it in the test. */
const earlierTick = () => Date.now() - 1_000;

describe("writeIfChanged", () => {
  it("keeps the previous object identity when the value is unchanged", () => {
    const qc = new QueryClient();
    writeIfChanged(qc, ["k"], [{ id: "1", price: 10n }], laterTick());
    const stored = qc.getQueryData(["k"]);

    // A freshly mapped but identical payload, as every snapshot tick produces.
    writeIfChanged(qc, ["k"], [{ id: "1", price: 10n }], laterTick());

    expect(qc.getQueryData(["k"])).toBe(stored);
  });

  it("writes when the value actually changed", () => {
    const qc = new QueryClient();
    writeIfChanged(qc, ["k"], [{ id: "1", price: 10n }], laterTick());
    const next = [{ id: "1", price: 11n }];
    writeIfChanged(qc, ["k"], next, laterTick());

    expect(qc.getQueryData(["k"])).toEqual(next);
  });

  it("writes a first value into an empty cache", () => {
    const qc = new QueryClient();
    writeIfChanged(qc, ["k"], { a: 1 }, laterTick());
    expect(qc.getQueryData(["k"])).toEqual({ a: 1 });
  });

  it("does not overwrite an entry refreshed while the snapshot was in flight", () => {
    const qc = new QueryClient();
    const snapshotStartedAt = earlierTick();

    // A post-transaction refetch lands first, carrying the new order.
    qc.setQueryData(["k"], [{ id: "new-order" }]);

    // The snapshot, issued before the transaction confirmed, returns without it.
    writeIfChanged(qc, ["k"], [], snapshotStartedAt);

    expect(qc.getQueryData(["k"])).toEqual([{ id: "new-order" }]);
  });
});

describe("writeResponseIfChanged", () => {
  it("ignores a moved block number when the data is unchanged", () => {
    const qc = new QueryClient();
    writeResponseIfChanged(qc, ["k"], { orders: [] }, 100, laterTick());
    const stored = qc.getQueryData(["k"]);

    // Base seals a block every ~2s, so this is the common case on every tick.
    writeResponseIfChanged(qc, ["k"], { orders: [] }, 105, laterTick());

    expect(qc.getQueryData(["k"])).toBe(stored);
  });

  it("writes both data and the new block number when the data changed", () => {
    const qc = new QueryClient();
    writeResponseIfChanged(qc, ["k"], { orders: [] }, 100, laterTick());
    writeResponseIfChanged(qc, ["k"], { orders: [{ id: "1" }] }, 105, laterTick());

    expect(qc.getQueryData(["k"])).toEqual({ data: { orders: [{ id: "1" }] }, blockNumber: 105 });
  });

  it("does not overwrite an entry refreshed while the snapshot was in flight", () => {
    const qc = new QueryClient();
    const snapshotStartedAt = earlierTick();

    qc.setQueryData(["k"], { data: { orders: [{ id: "new" }] }, blockNumber: 200 });
    writeResponseIfChanged(qc, ["k"], { orders: [] }, 199, snapshotStartedAt);

    expect(qc.getQueryData(["k"])).toEqual({
      data: { orders: [{ id: "new" }] },
      blockNumber: 200,
    });
  });
});
