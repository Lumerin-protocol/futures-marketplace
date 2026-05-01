export function quantizePrice(price: bigint, priceLadderStep: bigint) {
  return price - (price % priceLadderStep);
}

/// Minimal subset of `PriceFeedMock` used by tests to scale the latest hashprice.
type ScalablePriceFeed = {
  read: { latestRoundData: () => Promise<readonly [bigint, bigint, bigint, bigint, bigint]> };
  write: {
    setPrice: (args: readonly [bigint]) => Promise<`0x${string}`>;
    setRound: (args: readonly [bigint, bigint, bigint, bigint, bigint]) => Promise<`0x${string}`>;
  };
};

/// Multiplies the current price feed answer by `numerator / denominator`.
/// Direction reminder: the legacy oracle's `setHashesForBTC(× n/d)` mapped to
/// `getMarketPrice() ÷ (n/d)`, so callers should pass `(d, n)` for the same effect.
export async function scaleHashprice(
  feed: ScalablePriceFeed,
  numerator: bigint,
  denominator: bigint,
): Promise<bigint> {
  const [, answer] = await feed.read.latestRoundData();
  const next = (answer * numerator) / denominator;
  await feed.write.setPrice([next]);
  return next;
}

/// Re-pushes the current price feed answer so its `updatedAt` becomes the next block's
/// timestamp. Use this after `setNextBlockTimestamp` jumps far enough that the cached
/// answer would trip `Futures.MAX_ORACLE_STALENESS`.
///
/// When `freshAt` is supplied, the helper instead writes that timestamp directly via
/// `setRound` without consuming the next block's timestamp slot. Use this overload when
/// the next tx (e.g. `closeDelivery`) must mine at a specific `deliveryDate` and the
/// refresh shouldn't shift it.
export async function refreshHashprice(feed: ScalablePriceFeed, freshAt?: bigint): Promise<void> {
  const [roundId, answer, startedAt, , answeredInRound] = await feed.read.latestRoundData();
  if (freshAt === undefined) {
    await feed.write.setPrice([answer]);
  } else {
    await feed.write.setRound([roundId, answer, startedAt, freshAt, answeredInRound]);
  }
}
