/**
 * Points the hook mints to one side of a fill. Mirrors `PointsHook.onFill`:
 * `notional * weight / WEIGHT_SCALE`, but nothing when the side paid less than
 * `minFee`, and nothing for a maker without a positive fee (a rebate or a
 * zero maker fee earns nothing).
 */
export function fillPoints(args: {
  /** Fill notional in USDC. */
  notionalUSDC: number;
  /** Fee this side pays on the fill, raw token units; negative is a rebate. */
  fee: bigint;
  /** `PointsHook.minFee`, raw token units. */
  minFee: bigint;
  weight: bigint;
  weightScale: bigint;
  side: "maker" | "taker";
}): number {
  const { notionalUSDC, fee, minFee, weight, weightScale, side } = args;
  if (fee < minFee || (side === "maker" && fee <= 0n)) return 0;
  return (Number(weight) * notionalUSDC) / Number(weightScale);
}
