import { useReadContracts } from "wagmi";
import { FuturesAbi } from "../../abi/Futures";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../lib/units";

const futuresAddress = process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}` | undefined;

/**
 * Reads the current flat maker and taker fees from the Futures contract.
 *
 * - `makerFee` is paid by the resting order's owner when their order is filled.
 * - `takerFee` is paid by the incoming caller on a matching fill.
 * - `worstCaseFee` is `max(makerFee, takerFee)` — the safest amount to reserve
 *   for IM headroom at order-submit time, since at that moment we don't yet
 *   know whether the order will match (taker) or rest (eventual maker).
 *
 * Replaces the legacy per-participant `useOrderFee` (the `addressFeeDiscountPercent`
 * discount was removed alongside the maker/taker upgrade — fees are flat for all).
 */
export function useMakerTakerFees() {
  const result = useReadContracts({
    contracts: [
      {
        address: futuresAddress,
        abi: FuturesAbi,
        functionName: "makerFee",
      },
      {
        address: futuresAddress,
        abi: FuturesAbi,
        functionName: "takerFee",
      },
    ],
    query: {
      enabled: !!futuresAddress,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  });

  const makerFee = result.data?.[0]?.result as bigint | undefined;
  const takerFee = result.data?.[1]?.result as bigint | undefined;
  const worstCaseFee =
    makerFee !== undefined && takerFee !== undefined
      ? makerFee > takerFee
        ? makerFee
        : takerFee
      : undefined;

  return {
    ...result,
    makerFee,
    takerFee,
    worstCaseFee,
    makerFeeUSDC: makerFee !== undefined ? Number(makerFee) / PAYMENT_TOKEN_SCALE_NUM : null,
    takerFeeUSDC: takerFee !== undefined ? Number(takerFee) / PAYMENT_TOKEN_SCALE_NUM : null,
    worstCaseFeeUSDC:
      worstCaseFee !== undefined ? Number(worstCaseFee) / PAYMENT_TOKEN_SCALE_NUM : null,
    dataFetchedAt: result.dataUpdatedAt ? new Date(result.dataUpdatedAt) : undefined,
  };
}
