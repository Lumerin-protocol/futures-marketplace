import { useReadContract } from "wagmi";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";
import { QUANTITY_SCALE_NUM } from "../../../lib/units";

interface SimulatePerpsOrderProps {
  price: bigint | undefined;
  quantity: number | undefined; // Positive for Buy, Negative for Sell
  enabled?: boolean; // Set to false to disable automatic fetching (call refetch() manually)
}

export interface SimulatePerpsOrderResult {
  filledQuantity: bigint;
  averageFillPrice: bigint;
  remainingQuantity: bigint;
}

/**
 * Calls the on-chain simulateOrder view function to preview how an order would
 * fill — without submitting a transaction.
 *
 * @param props.price    - Order price as a bigint (contract units)
 * @param props.quantity - Order quantity as a decimal number; positive = buy, negative = sell
 */
export function useSimulatePerpsOrder({ price, quantity, enabled: externalEnabled = true }: SimulatePerpsOrderProps) {
  const quantityBigInt =
    quantity !== undefined ? BigInt(Math.round(quantity * QUANTITY_SCALE_NUM)) : undefined;

  // Args are always wired up when data is available so that refetch() works even when
  // auto-fetching is disabled via externalEnabled = false.
  const argsReady = price !== undefined && quantityBigInt !== undefined;
  const autoFetchEnabled = externalEnabled && argsReady;

  const result = useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
    abi: HashPowerPerpsDEXAbi,
    functionName: "simulateOrder",
    args: argsReady ? [price!, quantityBigInt!] : undefined,
    query: {
      enabled: autoFetchEnabled,
    },
  });

  const [filledQuantity, averageFillPrice, remainingQuantity] = result.data ?? [];

  return {
    ...result,
    filledQuantity,
    averageFillPrice,
    remainingQuantity,
  };
}
