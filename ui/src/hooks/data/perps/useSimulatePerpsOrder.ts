import { useReadContract } from "wagmi";
import { PerpsABI } from "../../../abi/Perps";

interface SimulatePerpsOrderProps {
  price: bigint | undefined;
  quantity: number | undefined; // Positive for Buy, Negative for Sell
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
export function useSimulatePerpsOrder({ price, quantity }: SimulatePerpsOrderProps) {
  const quantityBigInt =
    quantity !== undefined ? BigInt(Math.round(quantity * 1e6)) : undefined;

  const enabled = price !== undefined && quantityBigInt !== undefined;

  const result = useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
    abi: PerpsABI,
    functionName: "simulateOrder",
    args: enabled ? [price!, quantityBigInt!] : undefined,
    query: {
      enabled,
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
