import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";
import { withErrors } from "../../../lib/withErrors";
import { usePerpsContractConstants } from "./usePerpsContractConstants";
import { usePerpsOrderBook } from "./usePerpsOrderBook";

const BPS = 10_000n;
/// The contract carries the rate at 10^FUNDING_DECIMALS, so the clamp against
/// `fundingRateMaxBps` has to happen at the same precision to land on the same
/// value. Only the final display conversion drops to float.
const FUNDING_SCALE = 10n ** 18n;

/**
 * Current perpetual funding rate, per `fundingPeriod`.
 *
 * Mirrors `_getCurrentCumulativeFunding` in HashPowerPerpsDEXBase: the premium
 * of the order-book mid over the oracle index, clamped to ±`fundingRateMaxBps`.
 * The contract has no view for this, and the `fundingRate` field on the
 * `FundingUpdated` event is really the cumulative-accumulator delta (collateral
 * units × 10^18), not a rate — so it is recomputed here from the same inputs.
 */
export const useFundingRate = () => {
  const orderBook = usePerpsOrderBook();
  const { fundingRateMaxBps } = usePerpsContractConstants();

  const indexPriceQuery = useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
    abi: withErrors(HashPowerPerpsDEXAbi),
    functionName: "getMarketPrice",
    query: {
      refetchInterval: 10000,
      refetchOnWindowFocus: true,
    },
  });

  const indexPrice = indexPriceQuery.data as bigint | undefined;

  const data = useMemo(() => {
    const { bestBid, bestAsk } = bestPrices(orderBook.data?.data.priceLevels);

    // A one-sided book or an unusable oracle means no funding accrues at all,
    // which is not the same as a 0% rate — leave it undefined so callers can
    // render a placeholder.
    if (bestBid === undefined || bestAsk === undefined) return undefined;
    if (indexPrice === undefined || indexPrice === 0n) return undefined;
    if (fundingRateMaxBps === undefined) return undefined;

    const markPrice = (bestBid + bestAsk) / 2n;
    const maxRateScaled = (fundingRateMaxBps * FUNDING_SCALE) / BPS;

    const uncappedScaled = ((markPrice - indexPrice) * FUNDING_SCALE) / indexPrice;
    const rateScaled =
      uncappedScaled > maxRateScaled
        ? maxRateScaled
        : uncappedScaled < -maxRateScaled
          ? -maxRateScaled
          : uncappedScaled;

    const rate = Number(rateScaled) / Number(FUNDING_SCALE);

    return {
      rate,
      rateScaled,
      markPrice,
      indexPrice,
      isCapped: rateScaled !== uncappedScaled,
      formattedRate: formatRate(rate),
    };
  }, [orderBook.data, indexPrice, fundingRateMaxBps]);

  return {
    data,
    isLoading: orderBook.isLoading || indexPriceQuery.isLoading,
    isError: orderBook.isError || indexPriceQuery.isError,
  };
};

/// Highest bid and lowest ask with resting size, matching the contract's
/// `_bestBidPrice` / `_bestAskPrice` over the active price-level lists.
const bestPrices = (priceLevels?: { price: bigint; isBid: boolean; totalQuantity: bigint }[]) => {
  let bestBid: bigint | undefined;
  let bestAsk: bigint | undefined;

  for (const level of priceLevels ?? []) {
    if (level.totalQuantity <= 0n) continue;
    if (level.isBid) {
      if (bestBid === undefined || level.price > bestBid) bestBid = level.price;
    } else if (bestAsk === undefined || level.price < bestAsk) {
      bestAsk = level.price;
    }
  }

  return { bestBid, bestAsk };
};

const formatRate = (rate: number) => {
  const pct = rate * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(4)}%`;
};
