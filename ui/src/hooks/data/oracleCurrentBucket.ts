import { graphqlRequest } from "./graphql";

/**
 * The indexer's refusal to describe an empty current bucket.
 *
 * `current: include` asks graph-node to compute the in-progress bucket on the
 * fly. When no source rows have arrived since the last rollup it emits the row
 * anyway with `id`, `timestamp` and every aggregate null, and since the generated
 * schema types those non-null the violation propagates and nulls the whole
 * response. Upstream: graphprotocol/graph-node#6719.
 *
 * These arrive as HTTP 200 with an `errors` array, so they are readable and
 * cheap to tell apart from a network or rate-limit failure.
 */
const EMPTY_CURRENT_BUCKET = /Null value resolved for non-null field/;

export const isEmptyCurrentBucketError = (error: unknown): boolean => {
  const errors = (error as { response?: { errors?: { message?: string }[] } })?.response?.errors;
  return errors?.some((entry) => !!entry.message && EMPTY_CURRENT_BUCKET.test(entry.message)) ?? false;
};

/**
 * Read an oracle aggregation, preferring the in-progress bucket.
 *
 * Asks for `current: include` so the chart's newest bar reflects the hour in
 * progress, and falls back to `exclude` on the one failure that mode has.
 *
 * The fallback is worth a second request because it is self-limiting: it can
 * only happen while the oracle has posted nothing since the last rollup, and
 * the oracle posts several times an hour, so it is confined to the minutes just
 * after an hour boundary. That window matters more than it used to now that the
 * overlay reads the bar in progress every few seconds rather than once an hour,
 * but it still costs one extra request on a few hundred bytes.
 *
 * Any other failure is rethrown untouched — a malformed query or a rate limit
 * must not be silently downgraded into a chart that quietly drops its live bar.
 */
export const requestOracleAggregation = async <T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> => {
  const url = process.env.REACT_APP_SUBGRAPH_ORACLES_URL;

  try {
    return await graphqlRequest<T>(query, { ...variables, current: "include" }, url);
  } catch (error) {
    if (!isEmptyCurrentBucketError(error)) throw error;
    return graphqlRequest<T>(query, { ...variables, current: "exclude" }, url);
  }
};
