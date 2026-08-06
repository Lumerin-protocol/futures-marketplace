import { useReadContracts } from "wagmi";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";

export function usePerpsContractConstants() {
  const perpsAddress = process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`;

  const result = useReadContracts({
    contracts: [
      {
        address: perpsAddress,
        abi: HashPowerPerpsDEXAbi,
        functionName: "fundingPeriod",
      },
      {
        address: perpsAddress,
        abi: HashPowerPerpsDEXAbi,
        functionName: "fundingRateMaxBps",
      },
      {
        address: perpsAddress,
        abi: HashPowerPerpsDEXAbi,
        functionName: "MAX_ORDERS_PER_PARTICIPANT",
      },
      {
        address: perpsAddress,
        abi: HashPowerPerpsDEXAbi,
        functionName: "liquidationFeeBps",
      },
      {
        address: perpsAddress,
        abi: HashPowerPerpsDEXAbi,
        functionName: "MAX_PRICE_LEVELS_PER_SIDE",
      },
      {
        address: perpsAddress,
        abi: HashPowerPerpsDEXAbi,
        functionName: "lastFundingUpdateTime",
      },
    ],
    query: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  });

  const fundingPeriod = result.data?.[0]?.result as bigint | undefined;
  const fundingRateMaxBps = result.data?.[1]?.result as bigint | undefined;
  const maxOrdersPerParticipant = result.data?.[2]?.result as number | undefined;
  const liquidationFeeBps = result.data?.[3]?.result as number | undefined;
  const maxPriceLevelsPerSide = result.data?.[4]?.result as bigint | undefined;
  const lastFundingUpdateTime = result.data?.[5]?.result as bigint | undefined;

  return {
    ...result,
    fundingPeriod,
    fundingPeriodSeconds: fundingPeriod ? Number(fundingPeriod) : null,
    fundingRateMaxBps,
    fundingRateMaxBpsFormatted: fundingRateMaxBps ? Number(fundingRateMaxBps) : null,
    maxOrdersPerParticipant,
    liquidationFeeBps,
    // Basis points of the liquidated notional, not a flat charge.
    liquidationFeePercent: liquidationFeeBps !== undefined ? liquidationFeeBps / 100 : null,
    maxPriceLevelsPerSide: maxPriceLevelsPerSide ? Number(maxPriceLevelsPerSide) : null,
    lastFundingUpdateTime: lastFundingUpdateTime ? Number(lastFundingUpdateTime) : null,
  };
}
