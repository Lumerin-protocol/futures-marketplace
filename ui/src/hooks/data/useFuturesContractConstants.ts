import { useReadContracts } from "wagmi";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { withErrors } from "../../lib/withErrors";

const FUTURES_PER_DELIVERY_ORDER_LIMIT_ABI = [
  {
    type: "function",
    name: "MAX_ORDERS_PER_PARTICIPANT_PER_EXPIRATION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

/**
 * Hook to get additional futures contract constants
 * Fetches: futureExpirationDatesCount, expirationIntervalDays,
 *          MAX_ORDERS_PER_PARTICIPANT_PER_EXPIRATION, makerFeeBps, takerFeeBps
 */
export function useFuturesContractConstants() {
  const futuresAddress = process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`;

  const result = useReadContracts({
    contracts: [
      {
        address: futuresAddress,
        abi: withErrors(HashPowerFuturesAbi),
        functionName: "futureExpirationDatesCount",
      },
      {
        address: futuresAddress,
        abi: withErrors(HashPowerFuturesAbi),
        functionName: "expirationIntervalDays",
      },
      {
        address: futuresAddress,
        abi: withErrors(FUTURES_PER_DELIVERY_ORDER_LIMIT_ABI),
        functionName: "MAX_ORDERS_PER_PARTICIPANT_PER_EXPIRATION",
      },
      {
        address: futuresAddress,
        abi: withErrors(HashPowerFuturesAbi),
        functionName: "makerFeeBps",
      },
      {
        address: futuresAddress,
        abi: withErrors(HashPowerFuturesAbi),
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
