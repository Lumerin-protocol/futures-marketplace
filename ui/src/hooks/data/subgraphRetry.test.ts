import { describe, expect, it } from "vitest";
import { isRateLimited, RATE_LIMIT_RESET_MS, subgraphRetryOptions } from "./subgraphRetry";

const clientError = (status: number) =>
  Object.assign(new Error("GraphQL request failed"), { response: { status } });

describe("isRateLimited", () => {
  it("matches a readable 429", () => {
    expect(isRateLimited(clientError(429))).toBe(true);
  });

  it("matches the opaque failure a CORS-blocked 429 becomes in a browser", () => {
    // Goldsky's 429 carries no `Access-Control-Allow-Origin`, so the browser
    // rejects it before JS can read the status and `fetch` throws this instead.
    expect(isRateLimited(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("ignores GraphQL errors for an invalid query", () => {
    // These arrive as HTTP 200 with an `errors` array; retrying cannot fix them.
    expect(isRateLimited(clientError(200))).toBe(false);
  });

  it("ignores other readable failures", () => {
    expect(isRateLimited(clientError(500))).toBe(false);
    expect(isRateLimited(clientError(404))).toBe(false);
  });
});

describe("subgraphRetryOptions", () => {
  it("retries rate limiting exactly once", () => {
    const { retry } = subgraphRetryOptions;
    expect(retry(0, clientError(429))).toBe(true);
    expect(retry(1, clientError(429))).toBe(false);
  });

  it("does not retry anything else", () => {
    expect(subgraphRetryOptions.retry(0, clientError(500))).toBe(false);
  });

  it("waits for the window to reset", () => {
    // Matches the `Retry-After: 10` the endpoint sends.
    expect(subgraphRetryOptions.retryDelay).toBe(RATE_LIMIT_RESET_MS);
    expect(RATE_LIMIT_RESET_MS).toBe(10_000);
  });
});
