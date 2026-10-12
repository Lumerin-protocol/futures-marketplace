/**
 * Which way a position session was pointing.
 *
 * The indexer has no direction field on `PositionSession`. While a session is
 * open its `netQuantity` carries the sign, but a closed session is flat by
 * definition and the field is zero — which used to make every closed position
 * read as Long. `maxQuantity` is documented as signed but arrives unsigned, and
 * agreed with the real direction in 11 of 20 live sessions, i.e. no better than
 * chance.
 *
 * So closed sessions are resolved from a single fill instead. See
 * `sessionIsLong` for the rule.
 */

/** One fill, as the `lastFill` slices select it. Values may be strings off the wire. */
export type DirectionFill = {
  /** The session's net quantity immediately after this fill. Signed. */
  netQuantityAfter: string | number | bigint;
  /** The size of this fill. Signed: negative is a sell. */
  tradeQuantity: string | number | bigint;
};

/** Sign only, so the precision lost widening a large BigInt does not matter. */
const isPositive = (value: string | number | bigint) => Number(value) > 0;
const isZero = (value: string | number | bigint) => Number(value) === 0;

/**
 * Resolve a session's direction, from its net quantity and one of its fills.
 *
 * A fill records the session's net quantity *after* it, and only the fill that
 * closes a session can leave that at zero — so:
 *
 * - a non-zero `netQuantityAfter` is the position itself, and its sign is the
 *   answer. This covers every fill of an open session, and the last fill of one
 *   that expired while still open.
 * - a zero `netQuantityAfter` means this fill closed the session, so it traded
 *   *against* the position and the answer is the reverse of its sign.
 *
 * Note that this works on *any* fill of the session, not only the newest. The
 * queries ask for the newest because that one is guaranteed to exist and costs
 * a single row, but the derivation does not depend on which one arrives — which
 * is what makes it safe that two fills in the same block cannot be ordered.
 *
 * Falls back to Long when a session is flat and no fill came back, which is the
 * prior behaviour and only reachable if the fill is omitted from the query.
 */
export const sessionIsLong = (
  netQuantity: string | number | bigint,
  lastFill?: DirectionFill | null,
): boolean => {
  if (!isZero(netQuantity)) return isPositive(netQuantity);
  if (!lastFill) return true;

  return isZero(lastFill.netQuantityAfter)
    ? !isPositive(lastFill.tradeQuantity)
    : isPositive(lastFill.netQuantityAfter);
};
