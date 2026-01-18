import { useReadContracts } from "wagmi";
import { FuturesABI } from "../../abi/Futures";

/**
 * Hook to get additional futures contract constants
 * Fetches: futureDeliveryDatesCount, deliveryIntervalDays, MAX_ORDERS_PER_PARTICIPANT, orderFee
 */
export function useFuturesContractConstants() {
  const futuresAddress = process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`;

  const result = useReadContracts({
    contracts: [
      {
        address: futuresAddress,
        abi: FuturesABI,
        functionName: "futureDeliveryDatesCount",
      },
      {
        address: futuresAddress,
        abi: FuturesABI,
        functionName: "deliveryIntervalDays",
      },
      {
        address: futuresAddress,
        abi: FuturesABI,
        functionName: "MAX_ORDERS_PER_PARTICIPANT",
      },
      {
        address: futuresAddress,
        abi: FuturesABI,
        functionName: "orderFee",
      },
    ],
    query: {
      staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
      gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  });

  const futureDeliveryDatesCount = result.data?.[0]?.result as number | undefined;
  const deliveryIntervalDays = result.data?.[1]?.result as number | undefined;
  const maxOrdersPerParticipant = result.data?.[2]?.result as number | undefined;
  const orderFee = result.data?.[3]?.result as bigint | undefined;

  return {
    ...result,
    futureDeliveryDatesCount,
    deliveryIntervalDays,
    maxOrdersPerParticipant,
    orderFee,
    orderFeeFormatted: orderFee ? Number(orderFee) / 1e6 : null,
  };
}