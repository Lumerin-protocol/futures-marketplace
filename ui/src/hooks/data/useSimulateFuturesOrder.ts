import { useReadContract } from "wagmi";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { withErrors } from "../../lib/withErrors";

interface SimulateFuturesOrderProps {
  expirationAt: bigint | undefined;
  price: bigint | undefined;
  /** Signed whole-contract quantity: positive = buy, negative = sell. */
  quantity: number | undefined;
  enabled?: boolean;
}

/**
 * Calls HashPowerFutures.simulateOrder to preview fill without submitting a transaction.
 */
export function useSimulateFuturesOrder({
  expirationAt,
  price,
  quantity,
  enabled: externalEnabled = true,
}: SimulateFuturesOrderProps) {
  const quantityBigInt = quantity !== undefined ? BigInt(quantity) : undefined;
  const argsReady =
    expirationAt !== undefined && price !== undefined && quantityBigInt !== undefined;
  const autoFetchEnabled = externalEnabled && argsReady;

  const result = useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
    abi: withErrors(HashPowerFuturesAbi),
    functionName: "simulateOrder",
    args: argsReady ? [expirationAt!, price!, quantityBigInt!] : undefined,
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
