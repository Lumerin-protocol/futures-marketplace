import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const graphqlRequest = vi.hoisted(() => vi.fn());
vi.mock("../graphql", () => ({ graphqlRequest }));

// Timings below are expressed in polls rather than milliseconds, so that
// changing the interval does not silently break this file.
const { POLL_MS, waitForIndexedBlock } = await import("./waitForIndexedBlock");
const polls = (n: number) => n * POLL_MS;

/** Head block the mocked subgraph reports, mutated per test. */
let head = 0;

beforeEach(() => {
  vi.useFakeTimers();
  graphqlRequest.mockReset();
  graphqlRequest.mockImplementation(async () => ({ _meta: { block: { number: head } } }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForIndexedBlock", () => {
  it("resolves once the head reaches the target", async () => {
    head = 100;
    const wait = waitForIndexedBlock("futures", 100n);

    await vi.advanceTimersByTimeAsync(polls(1));

    await expect(wait).resolves.toBeUndefined();
    expect(graphqlRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps polling while the indexer is behind", async () => {
    head = 98;
    const wait = waitForIndexedBlock("futures", 100n);

    await vi.advanceTimersByTimeAsync(polls(2));
    expect(graphqlRequest).toHaveBeenCalledTimes(2);

    head = 100;
    await vi.advanceTimersByTimeAsync(polls(1));

    await expect(wait).resolves.toBeUndefined();
    expect(graphqlRequest).toHaveBeenCalledTimes(3);
  });

  it("serves concurrent callers for the same block from one polling loop", async () => {
    head = 98;

    // "Exit all" waits on one block across every open expiration.
    const waits = [
      waitForIndexedBlock("futures", 100n),
      waitForIndexedBlock("futures", 100n),
      waitForIndexedBlock("futures", 100n),
      waitForIndexedBlock("futures", 100n),
      waitForIndexedBlock("futures", 100n),
    ];

    await vi.advanceTimersByTimeAsync(polls(3));
    // Five callers, three ticks: one request per tick, not five.
    expect(graphqlRequest).toHaveBeenCalledTimes(3);

    head = 100;
    await vi.advanceTimersByTimeAsync(polls(1));
    await expect(Promise.all(waits)).resolves.toHaveLength(5);
  });

  it("polls each venue separately, since their subgraphs index independently", async () => {
    head = 100;
    const waits = [waitForIndexedBlock("futures", 100n), waitForIndexedBlock("perpetual", 100n)];

    await vi.advanceTimersByTimeAsync(polls(1));
    await Promise.all(waits);

    expect(graphqlRequest).toHaveBeenCalledTimes(2);
    const urls = graphqlRequest.mock.calls.map((call) => call[2]);
    expect(new Set(urls).size).toBe(2);
  });

  it("does not reuse a settled wait for a later transaction", async () => {
    head = 100;
    await vi.advanceTimersByTimeAsync(0);

    const first = waitForIndexedBlock("futures", 100n);
    await vi.advanceTimersByTimeAsync(polls(1));
    await first;

    // A second transaction lands on the same block; the finished loop is gone,
    // so this must start a fresh one rather than resolve off a stale entry.
    const second = waitForIndexedBlock("futures", 100n);
    await vi.advanceTimersByTimeAsync(polls(1));
    await second;

    expect(graphqlRequest).toHaveBeenCalledTimes(2);
  });

  it("rejects rather than hanging when the indexer never catches up", async () => {
    head = 1;
    const wait = waitForIndexedBlock("futures", 999n);
    const assertion = expect(wait).rejects.toThrow("Timeout waiting for block number 999");

    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
  });
});
