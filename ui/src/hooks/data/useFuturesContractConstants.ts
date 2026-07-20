import { useReadContracts } from "wagmi";
import { FuturesAbi } from "../../abi/Futures";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../lib/units";

/**
 * Hook to get additional futures contract constants
 * Fetches: futureExpirationDatesCount, expirationIntervalDays, MAX_ORDERS_PER_PARTICIPANT,
 *          makerFee, takerFee
 */
export function useFuturesContractConstants() {
  const futuresAddress = process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`;

  const result = useReadContracts({
    contracts: [
      {
        address: futuresAddress,
        abi: FuturesAbi,
        functionName: "futureExpirationDatesCount",
      },
      {
        address: futuresAddress,
        abi: FuturesAbi,
        functionName: "expirationIntervalDays",
      },
      {
        address: futuresAddress,
        abi: FuturesAbi,
        functionName: "MAX_ORDERS_PER_PARTICIPANT",
      },
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
      staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
      gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  });

  const futureExpirationDatesCount = result.data?.[0]?.result as number | undefined;
  const expirationIntervalDays = result.data?.[1]?.result as number | undefined;
  const maxOrdersPerParticipant = result.data?.[2]?.result as number | undefined;
  const makerFee = result.data?.[3]?.result as bigint | undefined;
  const takerFee = result.data?.[4]?.result as bigint | undefined;

  return {
    ...result,
    futureExpirationDatesCount,
    expirationIntervalDays,
    maxOrdersPerParticipant,
    makerFee,
    takerFee,
    makerFeeFormatted:
      makerFee !== undefined ? Number(makerFee) / PAYMENT_TOKEN_SCALE_NUM : null,
    takerFeeFormatted:
      takerFee !== undefined ? Number(takerFee) / PAYMENT_TOKEN_SCALE_NUM : null,
  };
}
