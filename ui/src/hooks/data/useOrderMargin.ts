import { useCallback, useMemo } from "react";
import { useAccount } from "wagmi";
import { imRequired, type MMParams } from "@hashpower/portfolio-margin";
import {
  maxAffordableQuantity,
  quoteOrderMargin,
  type OrderMarginQuote,
  type OrderVenue,
  type PortfolioChanges,
} from "../../lib/orderMargin";
import { useGetMarketPrice } from "./useGetMarketPrice";
import { useMarginEngineShocks } from "./useMarginEngineShocks";
import { usePortfolioSnapshot } from "./usePortfolioSnapshot";

/**
 * The order-entry margin gate for the connected account.
 *
 * Both venues admit an order on portfolio initial margin — one cross-account
 * figure covering every futures expiry and the perps leg together — so an
 * affordability check has to be evaluated against the whole account, not the leg
 * being entered. This binds `lib/orderMargin` to the live snapshot, the engine's
 * shock parameters and the venue mark, which is everything
 * `PortfolioMarginEngine._computeMargin` reads.
 *
 * Every read here is already mounted by the page's risk panel and liquidation
 * solver, so wagmi serves them from cache rather than issuing more RPC.
 */
export interface OrderMarginModel {
  /** Every input the gate reads has loaded, so the quotes below are trustworthy. */
  isReady: boolean;
  isLoading: boolean;
  /** Portfolio IM as the account stands (token decimals). */
  currentIm: bigint | undefined;
  /** Collateral the venues margin against (token decimals). */
  balance: bigint | undefined;
  /**
   * What `changes` would cost and whether the gate takes them. `undefined` until
   * the reads land — callers must not read that as "affordable".
   */
  quote: (
    changes: PortfolioChanges,
    options?: { reservedFee?: bigint; locallyReducing?: boolean },
  ) => OrderMarginQuote | undefined;
  /**
   * Largest funded size for a side, in the venue's quantity units. Excludes
   * reduce-only capacity, which the gate admits through its own branch.
   */
  maxQuantity: (args: {
    venue: OrderVenue;
    price: bigint;
    isBuy: boolean;
    reserveFee?: (notional: bigint) => bigint;
  }) => bigint | undefined;
}

export function useOrderMargin(): OrderMarginModel {
  const { address } = useAccount();
  const { snapshot, tokenDecimals, perpQuantityDecimals, isLoading, isError } =
    usePortfolioSnapshot(address);
  const shocks = useMarginEngineShocks();
  const { data: marketPrice } = useGetMarketPrice();

  const params = useMemo<MMParams | undefined>(() => {
    if (shocks.imSpotShock === undefined || shocks.mmSpotShock === undefined) return undefined;
    if (tokenDecimals === undefined || perpQuantityDecimals === undefined) return undefined;
    return {
      imSpotShock: shocks.imSpotShock,
      mmSpotShock: shocks.mmSpotShock,
      tokenDecimals,
      perpQuantityDecimals,
    };
  }, [shocks.imSpotShock, shocks.mmSpotShock, tokenDecimals, perpQuantityDecimals]);

  const markPrice = marketPrice as bigint | undefined;
  // A failed read leaves a partial picture, which can only understate the
  // requirement, so it counts as not ready: order entry has to fall back to
  // blocking rather than to an optimistic number.
  const isReady = !!snapshot && !!params && !!markPrice && markPrice > 0n && !isError;

  const quote = useCallback(
    (
      changes: PortfolioChanges,
      options?: { reservedFee?: bigint; locallyReducing?: boolean },
    ): OrderMarginQuote | undefined => {
      if (!snapshot || !params || !markPrice) return undefined;
      return quoteOrderMargin({
        snapshot,
        params,
        markPrice,
        changes,
        reservedFee: options?.reservedFee,
        locallyReducing: options?.locallyReducing,
      });
    },
    [snapshot, params, markPrice],
  );

  const maxQuantity = useCallback(
    (args: {
      venue: OrderVenue;
      price: bigint;
      isBuy: boolean;
      reserveFee?: (notional: bigint) => bigint;
    }): bigint | undefined => {
      if (!snapshot || !params || !markPrice) return undefined;
      return maxAffordableQuantity({ snapshot, params, markPrice, ...args });
    },
    [snapshot, params, markPrice],
  );

  const currentIm = useMemo(() => {
    if (!snapshot || !params || !markPrice) return undefined;
    return imRequired(snapshot, params, markPrice);
  }, [snapshot, params, markPrice]);

  return {
    isReady,
    isLoading: isLoading || shocks.isLoading,
    currentIm,
    balance: snapshot?.balance,
    quote,
    maxQuantity,
  };
}
