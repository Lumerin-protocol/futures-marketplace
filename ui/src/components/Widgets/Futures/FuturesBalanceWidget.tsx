import styled from "@mui/material/styles/styled";
import Tooltip from "@mui/material/Tooltip";
import { css, keyframes } from "@emotion/react";
import type { ReactNode } from "react";
import { tokens } from "../../../styles/tokens";
import { useAccount } from "wagmi";
import { useModal } from "../../../hooks/useModal";
import { RefreshableValue } from "../../RefreshableValue";
import { formatValue, paymentToken } from "../../../lib/units";
import { REALIZED_PNL_WINDOW_DAYS } from "../../../lib/portfolioPnl";
import {
  formatMarginRatio,
  marginStatusCopy,
  RESTRICTED_STATUS_COPY,
  type MarginTier,
} from "../../../lib/marginRisk";
import type { MarginRiskState } from "../../../hooks/data/useMarginRisk";
import { UsdcIcon } from "../../../images";
import { PrimaryButton } from "../../Forms/FormButtons/Buttons.styled";
import { ModalItem } from "../../Modal";
import { DepositForm } from "../../Forms/DepositForm";
import { WithdrawalForm } from "../../Forms/WithdrawalForm";
import type { AccountBalance } from "../../../types/types";

interface BalanceQueryResult {
  data: bigint | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  isFetching?: boolean;
  refetch: () => void;
}

interface FuturesBalanceWidgetProps {
  /** Everything derived from the margin engine: see `useMarginRisk`. */
  marginRisk: MarginRiskState;
  /** Mark-to-market across every venue, not just the one being traded. */
  unrealizedPnL: bigint | null;
  isLoadingUnrealizedPnL?: boolean;
  isRefreshingUnrealizedPnL?: boolean;
  /** Realized over the trailing window, across every venue. */
  realizedPnLInWindow: bigint | null;
  isLoadingRealizedPnL?: boolean;
  isRefreshingRealizedPnL?: boolean;
  balanceQuery: BalanceQueryResult;
  accountBalance?: AccountBalance;
  /** Account-wide liquidation level, quoted in the Danger status line. */
  liqPrice?: bigint;
}

// Both PnL figures cover the whole account, so they do not change when the user
// switches trading tabs. Spelling that out avoids reading them as futures-only.
const ALL_VENUES_HINT = "Across all venues (Futures and Perpetuals)";

const EQUITY_HINT = "Balance plus unrealized PnL across all venues.";
const MARGIN_USED_HINT = "Initial margin held for open positions and resting orders.";
const AVAILABLE_HINT =
  "Withdrawable and usable for new positions. Unrealized gains are not available until realized.";
const MARGIN_RATIO_HINT = "Maintenance margin ÷ balance. Positions are liquidated at 100%.";

const pnlColor = (pnl: bigint | null) => {
  if (pnl === null || pnl === 0n) return tokens.text.onDark;
  return pnl > 0n ? tokens.trading.long : tokens.trading.short;
};

/// `valueRounded` carries a K/M suffix past five characters, which `Number`
/// cannot parse; the unrounded string always can.
const amount = (value: bigint | null): string | null =>
  value === null ? null : Number(formatValue(value, paymentToken).value).toFixed(2);

/// Every figure on this panel is derived rather than read straight off chain, so
/// each one carries an explanation. A native `title` was too easy to miss for
/// that: it waits about a second and renders in OS chrome rather than the app's.
const HintedLabel = ({ hint, children }: { hint: string; children: ReactNode }) => (
  <Tooltip title={hint} arrow placement="top">
    <MetricLabel>{children}</MetricLabel>
  </Tooltip>
);

const tierColor = (tier: MarginTier) => {
  switch (tier) {
    case "liquidatable":
    case "danger":
      return tokens.trading.short;
    case "caution":
      return tokens.trading.highlight;
    default:
      return tokens.trading.long;
  }
};

/// Semicircle of radius 42 centred at (50, 48), drawn left to right. Sweep is
/// easiest to judge on a constant-curvature arc, and the dial can afford the
/// height now that it sits beside the reading rather than around it.
const GAUGE_PATH = "M 8 48 A 42 42 0 0 1 92 48";

/// Authored length for the dash maths. Declaring it frees the sweep from the
/// ellipse's real perimeter, which has no closed form and would otherwise have
/// to be re-derived every time the arc is reshaped.
const GAUGE_PATH_LENGTH = 100;

interface MarginRatioGaugeProps {
  /** `null` when there is no ratio to show: an empty account or a failed read. */
  ratioPercent: number | null;
  tier: MarginTier;
  isLoading: boolean;
  isRefreshing: boolean;
}

/**
 * The margin ratio as a dial whose full sweep is the liquidation threshold.
 *
 * A bare percentage needs the reader to remember what number is fatal; how far
 * round the dial the needle has travelled does not. The arc is deliberately
 * clamped at 100% — past that the account is already liquidatable and the exact
 * overshoot changes nothing.
 */
const MarginRatioGauge = ({
  ratioPercent,
  tier,
  isLoading,
  isRefreshing,
}: MarginRatioGaugeProps) => {
  const swept = ratioPercent === null ? 0 : Math.min(Math.max(ratioPercent, 0), 100) / 100;
  const color = ratioPercent === null ? tokens.text.onDark : tierColor(tier);

  return (
    <GaugeBlock>
      <GaugeSvg
        viewBox="0 0 100 52"
        role="img"
        aria-label={`Margin ratio ${formatMarginRatio(ratioPercent)} of 100%`}
      >
        {/* A solid track rather than the row-highlight tint the old linear bar
            used: the unswept arc is what conveys the remaining headroom, and at
            15% alpha it disappeared into the panel. */}
        <GaugeArc d={GAUGE_PATH} pathLength={GAUGE_PATH_LENGTH} $color={tokens.border.default} />
        {ratioPercent !== null && (
          <GaugeArc
            d={GAUGE_PATH}
            pathLength={GAUGE_PATH_LENGTH}
            $color={color}
            strokeDasharray={GAUGE_PATH_LENGTH}
            strokeDashoffset={GAUGE_PATH_LENGTH * (1 - swept)}
          />
        )}
      </GaugeSvg>
      <GaugeValue $color={color}>
        <RefreshableValue isInitialLoading={isLoading} isRefreshing={isRefreshing}>
          {ratioPercent === null ? null : formatMarginRatio(ratioPercent)}
        </RefreshableValue>
      </GaugeValue>
    </GaugeBlock>
  );
};

export const FuturesBalanceWidget = ({
  marginRisk,
  unrealizedPnL,
  isLoadingUnrealizedPnL = false,
  isRefreshingUnrealizedPnL = false,
  realizedPnLInWindow,
  isLoadingRealizedPnL,
  isRefreshingRealizedPnL = false,
  balanceQuery,
  accountBalance,
  liqPrice,
}: FuturesBalanceWidgetProps) => {
  const { address } = useAccount();
  const depositModal = useModal();
  const withdrawalModal = useModal();

  const handleDepositSuccess = () => {
    balanceQuery.refetch();
    depositModal.close();
  };

  const handleWithdrawalSuccess = () => {
    balanceQuery.refetch();
    withdrawalModal.close();
  };

  const { tier, ratioPercent, belowIM, isError } = marginRisk;
  const statusCopy = marginStatusCopy(tier, { ratioPercent, liqPrice });
  // An empty account and a failed read both have no ratio, and neither should be
  // coloured as though it had passed a health check.
  const hasRatio = !isError && ratioPercent !== null;

  return (
    <>
      <PanelSection $tier={tier}>
        {/* Header row */}
        <SectionHeader>
          <UsdcIcon style={{ width: "14px", flexShrink: 0 }} />
          <SectionTitle>Account Portfolio (USDC)</SectionTitle>
        </SectionHeader>

        {/* Not connected */}
        {!address && <DisconnectedMsg>Connect wallet to view balance</DisconnectedMsg>}

        {/* Metrics stay mounted — no full-panel spinner. Values blink / skeleton while loading. */}
        {!!address && (
          <>
            <MetricsGrid>
              <MetricColumn>
                <MetricCell>
                  <HintedLabel hint={EQUITY_HINT}>Equity</HintedLabel>
                  <MetricValue>
                    <RefreshableValue
                      isInitialLoading={marginRisk.isLoading}
                      isRefreshing={marginRisk.isRefreshing}
                    >
                      {amount(marginRisk.equity)}
                    </RefreshableValue>
                  </MetricValue>
                </MetricCell>
                <MetricCell>
                  <HintedLabel hint={ALL_VENUES_HINT}>Unrealized PnL</HintedLabel>
                  <MetricValue>
                    <RefreshableValue
                      isInitialLoading={isLoadingUnrealizedPnL}
                      isRefreshing={isRefreshingUnrealizedPnL}
                      style={{ color: pnlColor(unrealizedPnL) }}
                    >
                      {amount(unrealizedPnL)}
                    </RefreshableValue>
                  </MetricValue>
                </MetricCell>
                <MetricCell>
                  <HintedLabel hint={MARGIN_USED_HINT}>Margin Used</HintedLabel>
                  <MetricValue>
                    <RefreshableValue
                      isInitialLoading={marginRisk.isLoading}
                      isRefreshing={marginRisk.isRefreshing}
                    >
                      {amount(marginRisk.marginUsed)}
                    </RefreshableValue>
                  </MetricValue>
                </MetricCell>
              </MetricColumn>

              <MetricColumn>
                <MetricCell>
                  <HintedLabel hint={AVAILABLE_HINT}>Available</HintedLabel>
                  <MetricValue>
                    <RefreshableValue
                      isInitialLoading={marginRisk.isLoading}
                      isRefreshing={marginRisk.isRefreshing}
                      style={{
                        color:
                          marginRisk.available === 0n ? tokens.text.muted : tokens.text.onDark,
                      }}
                    >
                      {amount(marginRisk.available)}
                    </RefreshableValue>
                  </MetricValue>
                  {belowIM && !isError && <CellNote>Below initial margin</CellNote>}
                </MetricCell>
                <MetricCell>
                  <HintedLabel hint={ALL_VENUES_HINT}>
                    Realized PnL ({REALIZED_PNL_WINDOW_DAYS}D)
                  </HintedLabel>
                  <MetricValue>
                    <RefreshableValue
                      isInitialLoading={!!isLoadingRealizedPnL}
                      isRefreshing={isRefreshingRealizedPnL}
                      style={{ color: pnlColor(realizedPnLInWindow) }}
                    >
                      {amount(realizedPnLInWindow)}
                    </RefreshableValue>
                  </MetricValue>
                </MetricCell>
                {/* Built like every other cell — label, then value — so the dial
                    reads as one more metric rather than as a decoration. */}
                <GaugeCell>
                  <HintedLabel hint={MARGIN_RATIO_HINT}>Margin Ratio</HintedLabel>
                  <MarginRatioGauge
                    ratioPercent={hasRatio ? ratioPercent : null}
                    tier={tier}
                    isLoading={marginRisk.isLoading}
                    isRefreshing={marginRisk.isRefreshing}
                  />
                </GaugeCell>
              </MetricColumn>
            </MetricsGrid>

            <ActionButtons>
              <ActionButton onClick={depositModal.open}>Deposit</ActionButton>
              <ActionButton onClick={withdrawalModal.open}>Withdraw</ActionButton>
            </ActionButtons>

            {/* Restricted is a capability block rather than a risk level, so it
                stacks above the tier line instead of replacing it. */}
            {belowIM && !isError && <RestrictedNote>{RESTRICTED_STATUS_COPY}</RestrictedNote>}

            {!isError && statusCopy && tier === "caution" && (
              <CautionNote>{statusCopy}</CautionNote>
            )}
            {!isError && statusCopy && tier !== "caution" && (
              <DangerBanner $pulsing={tier === "liquidatable"}>⚠️ {statusCopy}</DangerBanner>
            )}
          </>
        )}
      </PanelSection>

      <ModalItem open={depositModal.isOpen} setOpen={depositModal.setOpen}>
        <DepositForm closeForm={handleDepositSuccess} accountBalance={accountBalance} />
      </ModalItem>

      <ModalItem open={withdrawalModal.isOpen} setOpen={withdrawalModal.setOpen}>
        <WithdrawalForm
          closeForm={handleWithdrawalSuccess}
          lockedAmount={marginRisk.im}
          isLoadingLockedAmount={marginRisk.isLoading}
          isLockedAmountError={marginRisk.isError}
          lockedTooltip={MARGIN_USED_HINT}
          balanceQuery={balanceQuery}
        />
      </ModalItem>
    </>
  );
};

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`;

// Replaces SmallWidget — renders as a flat panel section (no outer border/card)
const PanelSection = styled("div")<{ $tier: MarginTier }>`
  padding: 0.875rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  background: ${({ $tier }) => {
    if ($tier === "caution") return tokens.perps.yellowRadial;
    if ($tier === "danger" || $tier === "liquidatable") return tokens.perps.redRadial;
    return "transparent";
  }};
  border-left: ${({ $tier }) =>
    $tier === "healthy" ? "none" : `2px solid ${tierColor($tier)}`} !important;
`;

const SectionHeader = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.4rem;
`;

const SectionTitle = styled("span")`
  font-size: 0.7rem;
  font-weight: 500;
  color: ${tokens.text.secondary};
  text-transform: uppercase;
  letter-spacing: 0.03em;
`;

const DisconnectedMsg = styled("div")`
  font-size: 0.75rem;
  color: ${tokens.text.secondary};
  text-align: center;
  padding: 0.5rem 0;
`;

// Two columns of their own height rather than a row-major grid: the right-hand
// column carries one more metric than the left.
const MetricsGrid = styled("div")`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem 0.75rem;
`;

const MetricColumn = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const MetricCell = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
`;

const MetricLabel = styled("span")`
  font-size: 0.6rem;
  font-weight: 500;
  color: ${tokens.text.secondary};
  text-transform: uppercase;
  letter-spacing: 0.02em;
  white-space: nowrap;
  /* Every label on this panel is hinted, so the cursor is the affordance. */
  width: fit-content;
  cursor: help;
`;

const MetricValue = styled("span")`
  font-size: 0.95rem;
  font-weight: 600;
  color: ${tokens.text.onDark};
  line-height: 1.2;
`;

const CellNote = styled("span")`
  font-size: 0.6rem;
  color: ${tokens.text.muted};
  line-height: 1.2;
`;

const ActionButtons = styled("div")`
  display: flex;
  gap: 0.5rem;
`;

const ActionButton = styled(PrimaryButton)`
  flex: 1;
  padding: 0.45rem 0.5rem;
  font-size: 0.8rem;
  min-width: 0;
`;

// Pushed to the foot of its column so the dial lines up with Margin Used
// across the grid instead of leaving the gap under it that prompted the chart.
// Pushed to the foot of its column so the reading lines up with Margin Used
// even when Available carries its below-initial-margin note.
const GaugeCell = styled(MetricCell)`
  margin-top: auto;
`;

const GaugeBlock = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.4rem;
`;

// Sized so the arc is exactly as tall as the reading beside it (0.95rem over a
// 1.2 line box is 18px, and the viewBox is 100x52), which keeps the row the
// same height as every other metric value on the panel.
const GaugeSvg = styled("svg")`
  display: block;
  width: 35px;
  height: auto;
  flex-shrink: 0;
  overflow: visible;
`;

// In viewBox units, so it scales with the dial rather than needing a rewrite
// each time the arc is resized. At 35px wide this lands just under 3px.
const GaugeArc = styled("path")<{ $color: string }>`
  fill: none;
  stroke: ${({ $color }) => $color};
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.3s ease;
`;

// Typography copied from MetricValue: the ratio is a metric like any other, and
// the tier colour is enough to set it apart.
const GaugeValue = styled("span")<{ $color: string }>`
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  color: ${({ $color }) => $color};
`;

const RestrictedNote = styled("div")`
  font-size: 0.68rem;
  line-height: 1.35;
  color: ${tokens.text.secondary};
`;

const CautionNote = styled("div")`
  font-size: 0.68rem;
  line-height: 1.35;
  font-weight: 500;
  color: ${tokens.trading.highlight};
`;

const DangerBanner = styled("div")<{ $pulsing: boolean }>`
  padding: 0.35rem 0.5rem;
  background-color: ${tokens.trading.shortRowBgAlt};
  border: 1px solid ${tokens.trading.short};
  border-radius: 6px;
  color: ${tokens.trading.short};
  font-size: 0.7rem;
  line-height: 1.35;
  font-weight: 600;
  text-align: center;
  ${({ $pulsing }) =>
    $pulsing
      ? css`
          animation: ${pulse} 1.4s ease-in-out infinite;
        `
      : undefined}
`;
