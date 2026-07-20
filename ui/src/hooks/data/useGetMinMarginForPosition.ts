import type { PublicClient } from "viem";
import { getMinMarginForPositionManual } from "./getMinMarginForPositionManual";

interface CalculateMinMarginProps {
  entryPricePerDay: bigint;
  quantity: number;
  marketPricePerDay: bigint;
  marginPercent: number;
}

/**
 * Off-chain estimate of futures order margin for a single (price, qty) intent.
 * On-chain `getMinMarginForPosition` was removed in 3.0 — portfolio IM/MM comes
 * from the Portfolio Margin Engine; this helper is only for UI previews.
 */
export async function calculateMinMargin(
  _publicClient: PublicClient,
  props: CalculateMinMarginProps,
): Promise<bigint> {
  return getMinMarginForPositionManual(
    props.entryPricePerDay,
    props.quantity,
    props.marketPricePerDay,
    props.marginPercent,
  );
}
