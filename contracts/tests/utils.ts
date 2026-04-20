export function quantizePrice(price: bigint, priceLadderStep: bigint) {
  return price - (price % priceLadderStep);
}

/// Minimal subset of `PriceFeedMock` used by tests to scale the latest hashprice.
type ScalablePriceFeed = {
  read: { latestRoundData: () => Promise<readonly [bigint, bigint, bigint, bigint, bigint]> };
  write: { setPrice: (args: readonly [bigint]) => Promise<`0x${string}`> };
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
