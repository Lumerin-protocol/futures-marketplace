import type { FC } from "react";
import { styled } from "next-yak";
import { tokens } from "../../styles/tokens";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../lib/units";

// Points per 1 USDC of trade size, i.e. weight / WEIGHT_SCALE. This collapses
// the raw fixed-point weights (which carry a lot of trailing zeros) into a
// readable multiplier.
const formatRate = (weight?: bigint, scale?: bigint) => {
  if (weight === undefined || scale === undefined || scale === 0n) {
    return "—";
  }
  const rate = Number(weight) / Number(scale);
  return rate.toLocaleString("en-US", { maximumFractionDigits: 4 });
};

/** The leaderboard's "How To Earn Points" rules, from the live `PointsHook` parameters. */
export const PointsRules: FC<{
  wMaker: bigint | undefined;
  wTaker: bigint | undefined;
  weightScale: bigint | undefined;
  /** `PointsHook.minFee`, raw token units. */
  minFee: bigint | undefined;
}> = ({ wMaker, wTaker, weightScale, minFee }) => (
  <RulesList>
    <RuleItem>
      <RuleHeader>
        <RuleAction>Trade rewards</RuleAction>
      </RuleHeader>
      <RuleDescription>
        Earn points based on the size (USDC notional) of your trades. Points are only credited
        once your order is matched and becomes a position — resting or unmatched orders don't
        earn anything.
        {minFee !== undefined && minFee > 0n && (
          <>
            {" "}
            Each fill earns only if the fee you pay on it is at least{" "}
            {Number(minFee) / PAYMENT_TOKEN_SCALE_NUM} USDC.
          </>
        )}{" "}
        Maker fills earn only while the maker fee is above zero.
      </RuleDescription>
      <RateList>
        <RateRow>
          <RateLabel>Maker fills</RateLabel>
          <RatePoints>{formatRate(wMaker, weightScale)} pts / USDC</RatePoints>
        </RateRow>
        <RateRow>
          <RateLabel>Taker fills</RateLabel>
          <RatePoints>{formatRate(wTaker, weightScale)} pts / USDC</RatePoints>
        </RateRow>
      </RateList>
    </RuleItem>
  </RulesList>
);

const RulesList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
`;

const RuleItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem;
  border: 1px solid ${tokens.border.muted04};
  border-radius: ${tokens.radius.md};
  background-color: ${tokens.overlay.white02};
`;

const RuleHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
`;

const RuleAction = styled.span`
  font-size: 0.9rem;
  font-weight: 600;
  color: ${tokens.text.onDark};
`;

const RateList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.25rem;
`;

const RateRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  border-radius: ${tokens.radius.sm};
  background-color: ${tokens.overlay.white02};
`;

const RateLabel = styled.span`
  font-size: 0.8rem;
  font-weight: 500;
  color: ${tokens.text.secondary};
`;

const RatePoints = styled.span`
  font-size: 0.85rem;
  font-weight: 700;
  color: ${tokens.trading.profit};
`;

const RuleDescription = styled.span`
  font-size: 0.8rem;
  color: ${tokens.text.secondary};
  line-height: 1.4;
`;
