import { beforeEach, describe, expect, it, vi } from "vitest";

const { graphqlRequest } = vi.hoisted(() => ({ graphqlRequest: vi.fn() }));
vi.mock("./graphql", () => ({ graphqlRequest }));

const { dropInFlightFuturesHistory, fetchFuturesHistoryFirstPage } = await import(
  "./futuresHistoryBatch"
);

const ADDRESS = "0xd916bd29e2adb2c3c6b60fba82057454bc92f26a";
const PAGE = 10;

/** A response whose completion the test controls, so overlap is deterministic. */
const deferredResponse = () => {
  let settle!: (value: unknown) => void;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  graphqlRequest.mockReturnValueOnce(promise);
  return settle;
};

const page = () => ({
  historyOrders: [{ id: "order" }],
  historyPositions: [{ id: "session" }],
  historyTrades: [{ id: "trade" }],
});

beforeEach(() => {
  graphqlRequest.mockReset();
  dropInFlightFuturesHistory();
});

describe("fetchFuturesHistoryFirstPage", () => {
  it("serves all three tables from one request", async () => {
    const settle = deferredResponse();

    // Mirrors the cold load: the tab widget mounts all three tables at once.
    const rows = Promise.all([
      fetchFuturesHistoryFirstPage("historyOrders", ADDRESS, PAGE),
      fetchFuturesHistoryFirstPage("historyPositions", ADDRESS, PAGE),
      fetchFuturesHistoryFirstPage("historyTrades", ADDRESS, PAGE),
    ]);
    settle(page());

    expect(await rows).toEqual([[{ id: "order" }], [{ id: "session" }], [{ id: "trade" }]]);
    expect(graphqlRequest).toHaveBeenCalledTimes(1);
  });

  it("asks for the requested page size", async () => {
    graphqlRequest.mockResolvedValueOnce(page());
    await fetchFuturesHistoryFirstPage("historyOrders", ADDRESS, 25);

    expect(graphqlRequest.mock.calls[0][1]).toEqual({ address: ADDRESS, historyFirst: 25, historySkip: 0 });
  });

  it("keeps different accounts and page sizes apart", async () => {
    graphqlRequest.mockResolvedValue(page());
    await Promise.all([
      fetchFuturesHistoryFirstPage("historyOrders", ADDRESS, PAGE),
      fetchFuturesHistoryFirstPage("historyOrders", "0xother", PAGE),
      fetchFuturesHistoryFirstPage("historyOrders", ADDRESS, 25),
    ]);

    expect(graphqlRequest).toHaveBeenCalledTimes(3);
  });

  it("starts a fresh request once the shared one has settled", async () => {
    graphqlRequest.mockResolvedValue(page());
    await fetchFuturesHistoryFirstPage("historyOrders", ADDRESS, PAGE);
    await fetchFuturesHistoryFirstPage("historyOrders", ADDRESS, PAGE);

    expect(graphqlRequest).toHaveBeenCalledTimes(2);
  });

  it("does not let a post-transaction refetch join a pre-transaction request", async () => {
    const settle = deferredResponse();
    const stale = fetchFuturesHistoryFirstPage("historyOrders", ADDRESS, PAGE);

    dropInFlightFuturesHistory();
    graphqlRequest.mockResolvedValueOnce({ ...page(), historyOrders: [{ id: "new order" }] });
    const fresh = fetchFuturesHistoryFirstPage("historyOrders", ADDRESS, PAGE);

    settle(page());
    expect(await stale).toEqual([{ id: "order" }]);
    expect(await fresh).toEqual([{ id: "new order" }]);
    expect(graphqlRequest).toHaveBeenCalledTimes(2);
  });

  it("tolerates a table the response left out", async () => {
    graphqlRequest.mockResolvedValueOnce({ historyOrders: [{ id: "order" }] });

    await expect(fetchFuturesHistoryFirstPage("historyTrades", ADDRESS, PAGE)).resolves.toEqual([]);
  });

  it("does not strand later callers when the request fails", async () => {
    graphqlRequest.mockRejectedValueOnce(new Error("rate limited"));
    await expect(fetchFuturesHistoryFirstPage("historyOrders", ADDRESS, PAGE)).rejects.toThrow(
      "rate limited",
    );

    graphqlRequest.mockResolvedValueOnce(page());
    await expect(fetchFuturesHistoryFirstPage("historyOrders", ADDRESS, PAGE)).resolves.toEqual([
      { id: "order" },
    ]);
  });
});
