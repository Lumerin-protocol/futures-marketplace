import type { FC } from "react";
import { HeadlineStat, HelpTip } from "./Shared/ReviewPrimitives";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../lib/units";

/** The order review's estimated points, from `fillPoints` for each side. */
export const PointsEstimateStat: FC<{
  canRest: boolean;
  makerReward: number | null;
  takerReward: number | null;
  /** `PointsHook.minFee`, raw token units. */
  minFee: bigint | undefined;
  isLoading: boolean;
}> = ({ canRest, makerReward, takerReward, minFee, isLoading }) => {
  const feeRule =
    minFee !== undefined && minFee > 0n
      ? ` A fill earns points only if its fee is at least ${Number(minFee) / PAYMENT_TOKEN_SCALE_NUM} USDC, and a maker fill only while the maker fee is above zero.`
      : " A maker fill earns points only while the maker fee is above zero.";
  return (
    <HeadlineStat>
      <span>
        Points
        <HelpTip
          title={
            (canRest
              ? "Estimated points for a full fill, credited as the order is matched. Maker points for the part that rests on the book until filled, taker points for the part matched immediately — a partial match earns a mix. A resting order earns nothing until it fills."
              : "Estimated points, credited when the order is matched. This order cannot rest on the book, so it earns taker points.") +
            feeRule
          }
        />
      </span>
      <strong>
        {makerReward !== null && takerReward !== null
          ? canRest
            ? `${makerReward.toFixed(2)} / ${takerReward.toFixed(2)} pts`
            : `${takerReward.toFixed(2)} pts`
          : isLoading
            ? "Loading…"
            : "—"}
      </strong>
    </HeadlineStat>
  );
};
