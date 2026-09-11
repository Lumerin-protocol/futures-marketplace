/** One position to flatten. */
export interface ExitAllClose {
  /** Signed native quantity currently held: long > 0, short < 0. */
  netQuantity: bigint;
  /** Futures only: which delivery the position sits in. */
  expirationAt?: bigint;
}

/** One closing leg as it will be sent, for the review screen and the receipt. */
export interface ExitAllIntent {
  /** Signed native quantity: the negation of what is held. */
  quantity: bigint;
  /** Worst acceptable price, already snapped to the tick. */
  price: bigint;
  expirationAt?: bigint;
}

/**
 * Turn a held quantity into the IOC leg that flattens it: opposite sign, and
 * a limit a fixed fraction past the mark so the fill cannot run away, snapped
 * to the venue's tick. IOC rather than FOK so a thin book still closes what
 * it can; the remainder is dropped, not left resting.
 *
 * The cap rounds *away* from the mark, never onto a worse-than-asked tick on
 * the wrong side: a seller's floor rounds down, a buyer's ceiling rounds up.
 * Otherwise a mark sitting just above a tick could produce a floor above the
 * best bid and miss a fill the user would have accepted.
 */
export function closingIntent(
  close: ExitAllClose,
  marketPrice: bigint,
  slippage: number,
  priceStep: bigint,
): ExitAllIntent {
  const isLong = close.netQuantity > 0n;
  const factor = isLong ? 1 - slippage : 1 + slippage;
  const raw = BigInt(Math.round(Number(marketPrice) * factor));
  const step = priceStep > 0n ? priceStep : 1n;
  const price = isLong ? (raw / step) * step : ((raw + step - 1n) / step) * step;
  return { quantity: -close.netQuantity, price, expirationAt: close.expirationAt };
}

/** Sum of magnitudes — legs on opposite sides must not cancel each other out. */
export function totalSize(quantities: readonly bigint[]): bigint {
  return quantities.reduce((sum, q) => sum + (q < 0n ? -q : q), 0n);
}
