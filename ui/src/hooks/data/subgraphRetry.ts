/** What Goldsky's 429 asks for: `Retry-After: 10`, and "limits reset every 10 seconds". */
export const RATE_LIMIT_RESET_MS = 10_000;

/**
 * Whether a failed subgraph request looks like rate limiting.
 *
 * Goldsky answers an over-budget request with `429` and `Retry-After: 10`, but
 * that response carries no `Access-Control-Allow-Origin`. The browser therefore
 * rejects it as a CORS failure before any of it reaches JavaScript: `fetch`
 * rejects with a `TypeError` and the status and `Retry-After` are both
 * unreadable. Checking for status 429 alone would consequently never match in a
 * browser, so an opaque fetch failure has to count as well.
 *
 * Being offline produces the same opaque `TypeError`, which is acceptable —
 * waiting ten seconds before one retry is a reasonable response to that too.
 *
 * Deliberately excluded: GraphQL errors for a malformed or invalid query. Those
 * come back as HTTP 200 with an `errors` array and a readable response, and no
 * amount of retrying will fix them.
 */
export const isRateLimited = (error: unknown): boolean => {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status !== undefined) return status === 429;

  return error instanceof TypeError;
};

/**
 * Retry policy for queries that read a subgraph.
 *
 * One retry, ten seconds later, and only for rate limiting. The default policy
 * is three retries at 1s/2s/4s, which turns a burst that trips the limit into
 * four bursts and keeps the window tripped across reloads.
 */
export const subgraphRetryOptions = {
  retry: (failureCount: number, error: Error) => failureCount < 1 && isRateLimited(error),
  retryDelay: RATE_LIMIT_RESET_MS,
} as const;
