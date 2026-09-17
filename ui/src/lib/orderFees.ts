/**
 * Trading fees an order can end up paying, quoted in token units so the order
 * confirmation can show a USDC figure next to the margin instead of two rates.
 *
 * Both venues charge `notional * bps / 10000` on the filled notional, and which
 * rate applies depends on how the order fills: an order that crosses the book
 * on placement is a taker; one that rests and is filled later is a maker. At
 * placement only a resting-capable order (a GTC limit) can still go either way.
 */

/** Basis-point denominator, matching `BPS` in the contracts. */
export const BPS = 10_000n;

export interface OrderFeeQuote {
  /**
   * Fee if the order rests and is later filled. Negative when the venue pays a
   * maker rebate. `undefined` when the order cannot rest.
   */
  maker: bigint | undefined;
  /** Fee if the order fills against the book on placement. */
  taker: bigint;
  /**
   * Held back from balance at placement: the larger of the fees the order can
   * incur, never negative — a rebate is not spendable headroom. This is the
   * figure `useMakerTakerFees().feeFor` reserves, so total cost shown to the
   * user matches what the margin gate charges.
   */
  reserved: bigint;
}

/**
 * Signed fee on `notional` at `bps`. Truncates toward zero like the contract's
 * integer division, so a rebate rounds toward zero as well.
 */
export function feeOnNotional(notional: bigint, bps: number): bigint {
  return (notional * BigInt(Math.trunc(bps))) / BPS;
}

/**
 * Fees for an order of `notional` (token units).
 *
 * `canRest` is whether the order may still be on the book after placement —
 * true for a GTC limit, false for market, IOC and FOK, which are takers for
 * whatever they fill.
 */
export function quoteOrderFees(args: {
  notional: bigint;
  makerFeeBps: number;
  takerFeeBps: number;
  canRest: boolean;
}): OrderFeeQuote {
  const { notional, makerFeeBps, takerFeeBps, canRest } = args;
  const taker = feeOnNotional(notional, takerFeeBps);
  const maker = canRest ? feeOnNotional(notional, makerFeeBps) : undefined;
  const worst = maker !== undefined && maker > taker ? maker : taker;
  return { maker, taker, reserved: worst > 0n ? worst : 0n };
}
