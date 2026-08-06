import { useReadContracts } from "wagmi";
import { FuturesAbi } from "futures-marketplace-abi/Futures.ts";
import { withErrors } from "../../lib/withErrors";

/**
 * Hook to get additional futures contract constants
 * Fetches: futureExpirationDatesCount, expirationIntervalDays,
 *          MAX_ORDERS_PER_PARTICIPANT, makerFeeBps, takerFeeBps
 */
export function useFuturesContractConstants() {
  const futuresAddress = process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`;

  const result = useReadContracts({
    contracts: [
      {
        address: futuresAddress,
        abi: withErrors(FuturesAbi),
        functionName: "futureExpirationDatesCount",
      },
      {
        address: futuresAddress,
        abi: withErrors(FuturesAbi),
        functionName: "expirationIntervalDays",
      },
      {
        address: futuresAddress,
        abi: withErrors(FuturesAbi),
        functionName: "MAX_ORDERS_PER_PARTICIPANT",
      },
      {
        address: futuresAddress,
        abi: withErrors(FuturesAbi),
        functionName: "makerFeeBps",
      },
      {
        address: futuresAddress,
        abi: withErrors(FuturesAbi),
        functionName: "takerFeeBps",
      },
    ],
    query: {
      staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
      gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  });

  const futureExpirationDatesCount = result.data?.[0]?.result as number | undefined;
  const expirationIntervalDays = result.data?.[1]?.result as number | undefined;
  const maxOrdersPerParticipant = result.data?.[2]?.result as number | undefined;
  const makerFeeBps = result.data?.[3]?.result as number | undefined;
  const takerFeeBps = result.data?.[4]?.result as number | undefined;

  return {
    ...result,
    futureExpirationDatesCount,
    expirationIntervalDays,
    maxOrdersPerParticipant,
    makerFeeBps,
    takerFeeBps,
    // Signed basis points of the filled notional; negative is a maker rebate.
    makerFeePercent: makerFeeBps !== undefined ? makerFeeBps / 100 : null,
    takerFeePercent: takerFeeBps !== undefined ? takerFeeBps / 100 : null,
  };
}
