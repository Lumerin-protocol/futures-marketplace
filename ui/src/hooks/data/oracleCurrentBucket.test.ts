import { beforeEach, describe, expect, it, vi } from "vitest";

const { graphqlRequest } = vi.hoisted(() => ({ graphqlRequest: vi.fn() }));
vi.mock("./graphql", () => ({ graphqlRequest }));

const { isEmptyCurrentBucketError, requestOracleAggregation } = await import("./oracleCurrentBucket");

/** How graphql-request surfaces a GraphQL error: HTTP 200 with an `errors` array. */
const clientError = (...messages: string[]) =>
  Object.assign(new Error("GraphQL Error"), {
    response: { status: 200, errors: messages.map((message) => ({ message })) },
  });

const emptyBucket = () => clientError("Null value resolved for non-null field `id`");

const currentOf = (call: number) => graphqlRequest.mock.calls[call][1].current;

beforeEach(() => {
  graphqlRequest.mockReset();
});

describe("isEmptyCurrentBucketError", () => {
  it("matches the empty-current-bucket violation", () => {
    expect(isEmptyCurrentBucketError(emptyBucket())).toBe(true);
    expect(isEmptyCurrentBucketError(clientError("Null value resolved for non-null field `sum`"))).toBe(true);
  });

  it("matches when it is one of several errors", () => {
    expect(
      isEmptyCurrentBucketError(
        clientError("Null value resolved for non-null field `id`", "Null value resolved for non-null field `sum`"),
      ),
    ).toBe(true);
  });

  it("ignores unrelated failures", () => {
    expect(isEmptyCurrentBucketError(clientError("Unknown field `nope`"))).toBe(false);
    expect(isEmptyCurrentBucketError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isEmptyCurrentBucketError(undefined)).toBe(false);
  });
});

describe("requestOracleAggregation", () => {
  it("asks for the in-progress bucket and costs one request when it works", async () => {
    graphqlRequest.mockResolvedValueOnce({ rows: [1] });

    await expect(requestOracleAggregation("Q", { interval: "hour" })).resolves.toEqual({ rows: [1] });
    expect(graphqlRequest).toHaveBeenCalledTimes(1);
    expect(currentOf(0)).toBe("include");
  });

  it("falls back to the completed buckets when the current one is empty", async () => {
    graphqlRequest.mockRejectedValueOnce(emptyBucket()).mockResolvedValueOnce({ rows: [2] });

    await expect(requestOracleAggregation("Q", { interval: "hour" })).resolves.toEqual({ rows: [2] });
    expect(graphqlRequest).toHaveBeenCalledTimes(2);
    expect(currentOf(0)).toBe("include");
    expect(currentOf(1)).toBe("exclude");
  });

  it("preserves the caller's variables in the fallback", async () => {
    graphqlRequest.mockRejectedValueOnce(emptyBucket()).mockResolvedValueOnce({});

    await requestOracleAggregation("Q", { interval: "hour", first: 1000, startTimestamp: "123" });
    expect(graphqlRequest.mock.calls[1][1]).toMatchObject({
      interval: "hour",
      first: 1000,
      startTimestamp: "123",
      current: "exclude",
    });
  });

  it("rethrows anything else without a second request", async () => {
    const boom = clientError("Unknown field `nope`");
    graphqlRequest.mockRejectedValueOnce(boom);

    await expect(requestOracleAggregation("Q", {})).rejects.toBe(boom);
    expect(graphqlRequest).toHaveBeenCalledTimes(1);
  });

  it("does not swallow a rate limit into a silent downgrade", async () => {
    const limited = new TypeError("Failed to fetch");
    graphqlRequest.mockRejectedValueOnce(limited);

    await expect(requestOracleAggregation("Q", {})).rejects.toBe(limited);
    expect(graphqlRequest).toHaveBeenCalledTimes(1);
  });

  it("propagates a fallback failure rather than masking it", async () => {
    const second = clientError("boom");
    graphqlRequest.mockRejectedValueOnce(emptyBucket()).mockRejectedValueOnce(second);

    await expect(requestOracleAggregation("Q", {})).rejects.toBe(second);
    expect(graphqlRequest).toHaveBeenCalledTimes(2);
  });
});
