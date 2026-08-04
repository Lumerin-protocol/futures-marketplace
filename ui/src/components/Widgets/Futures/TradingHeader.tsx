import { tokens } from "../../../styles/tokens";
import styled from "@mui/material/styles/styled";
import Tooltip from "@mui/material/Tooltip";
import EastIcon from "@mui/icons-material/East";
import { useModal } from "../../../hooks/useModal";
import { ModalItem } from "../../Modal";
import { DetailedSpecsModal } from "./DetailedSpecsModal";
import { useSettlementPrice } from "../../../hooks/data/useSettlementPrice";
import { formatHashratePHPS, PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
import { describeLiquidationLevels } from "../../../lib/liquidation";
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { GetResponse } from "../../../gateway/interfaces";
import type { FuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
import type { ContractMode } from "../../../types/types";

interface TradingHeaderProps {
  contractMode: ContractMode;
  onContractModeChange: (mode: ContractMode) => void;
  contractSpecsQuery: UseQueryResult<GetResponse<FuturesContractSpecs>, Error>;
  currentPrice?: string | null;
  /// Change of the current market price vs the previous polled value. Used to
  /// render a green (up) / red (down) delta next to the current price.
  priceChange?: { delta: number; pct: number | null } | null;
  fundingRate?: string;
  totalVolume?: string;
  /// Currently-selected expiration (unix seconds). Used to surface the pinned
  /// cash-settlement price once that expiration has matured and been settled.
  selectedExpirationAt?: number;
  /// Account-wide price at or below which the portfolio becomes liquidatable.
  liqDown?: bigint;
  /// Account-wide price at or above which the portfolio becomes liquidatable.
  liqUp?: bigint;
  /// Balance is already under maintenance margin at the current mark.
  isUnderwater?: boolean;
  /// MOBILE-ONLY (see FuturesMobileLayout): controls pinned to the right end of
  /// the contract-mode row, currently the chart show/hide toggle. Left undefined
  /// by the desktop layout, which renders the header exactly as before.
  mobileActions?: ReactNode;
}

const formatVolume = (raw: string): string => {
  const num = Number(raw) / PAYMENT_TOKEN_SCALE_NUM;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return `${num.toFixed(2)}`;
};

export const TradingHeader = ({
  contractMode,
  onContractModeChange,
  contractSpecsQuery,
  currentPrice,
  priceChange,
  fundingRate = "0%",
  totalVolume,
  selectedExpirationAt,
  liqDown,
  liqUp,
  isUnderwater,
  mobileActions,
}: TradingHeaderProps) => {
  const detailedSpecsModal = useModal();
  const { data: contractSpecs } = contractSpecsQuery;

  const { data: settlementPriceRaw } = useSettlementPrice(
    contractMode === "futures" && selectedExpirationAt ? BigInt(selectedExpirationAt) : undefined,
  );
  // Only show a settlement price once it's been pinned on-chain (non-zero).
  const settlementPrice =
    settlementPriceRaw && settlementPriceRaw > 0n
      ? (Number(settlementPriceRaw) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2)
      : null;

  const formatSpeed = (contractSizeHpsDay: bigint) => `${formatHashratePHPS(contractSizeHpsDay).full} per day`;

  const renderHashPriceStat = () => (
    <Tooltip title="Underlying price" arrow>
      <StatItem>
        <StatValue>
          {currentPrice ?? "—"}
          {renderPriceChange()}
        </StatValue>
        <StatLabel>Hash Price (USDC)</StatLabel>
      </StatItem>
    </Tooltip>
  );

  /// Account-wide liquidation levels, sitting next to Hash Price so the mark can
  /// be read against them directly. Margin is pooled across every futures and
  /// perps position, so these are the same numbers in both contract modes.
  ///
  /// `MM(P)` is a tent in price, so there can be a threshold below the mark,
  /// above it, or both. A flat account has neither and the stat is dropped
  /// rather than rendered as a placeholder.
  const renderLiquidationStat = () => {
    const tooltip = describeLiquidationLevels({ liqDown, liqUp, isUnderwater });

    if (isUnderwater) {
      return (
        <>
          <Divider />
          <Tooltip title={tooltip} arrow>
            <StatItem>
              <StatValue style={{ color: tokens.trading.short }}>Liquidatable</StatValue>
              <StatLabel>Liquidation</StatLabel>
            </StatItem>
          </Tooltip>
        </>
      );
    }

    if (liqDown === undefined && liqUp === undefined) return null;

    const format = (value: bigint) => (Number(value) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
    return (
      <>
        <Divider />
        <Tooltip title={tooltip} arrow>
          <StatItem>
            <StatValue>
              {liqDown !== undefined && <LiqLevel>↓ {format(liqDown)}</LiqLevel>}
              {liqUp !== undefined && <LiqLevel>↑ {format(liqUp)}</LiqLevel>}
            </StatValue>
            <StatLabel>Liquidation (USDC)</StatLabel>
          </StatItem>
        </Tooltip>
      </>
    );
  };

  const renderPriceChange = () => {
    if (!priceChange) return null;
    const isUp = priceChange.delta >= 0;
    const sign = isUp ? "+" : "";
    const pctText = priceChange.pct != null ? ` (${sign}${priceChange.pct.toFixed(2)}%)` : "";
    return (
      <PriceChange $up={isUp}>
        {isUp ? "▲" : "▼"} {sign}
        {priceChange.delta.toFixed(2)}
        {pctText}
      </PriceChange>
    );
  };

  const modeToggle = (
    <ModeToggle>
      <ModeButton
        $active={contractMode === "futures"}
        onClick={() => onContractModeChange("futures")}
      >
        Futures
      </ModeButton>
      <ModeButton
        $active={contractMode === "perpetual"}
        onClick={() => onContractModeChange("perpetual")}
      >
        Perpetuals
      </ModeButton>
    </ModeToggle>
  );

  return (
    <>
      <HeaderBar>
        {/* Left: contract mode toggle. On mobile it shares a full-width row with
            the layout's controls, which sit in the right corner. */}
        {mobileActions ? (
          <ModeRow>
            {modeToggle}
            {mobileActions}
          </ModeRow>
        ) : (
          modeToggle
        )}

        {/* Center: market stats */}
        <StatsRow>
          {contractMode === "perpetual" ? (
            <>
              {renderHashPriceStat()}
              {renderLiquidationStat()}
              <Divider />
              <StatItem>
                <StatValue>{fundingRate}</StatValue>
                <StatLabel>Funding Rate</StatLabel>
              </StatItem>
              {totalVolume && (
                <>
                  <Divider />
                  <StatItem>
                    <StatValue>{formatVolume(totalVolume)}</StatValue>
                    <StatLabel>Total Volume</StatLabel>
                  </StatItem>
                </>
              )}
            </>
          ) : (
            <>
              {renderHashPriceStat()}
              {renderLiquidationStat()}
              {contractSpecs?.data && (
                <>
                  <Divider />
                  <StatItem>
                    <StatValue>{formatSpeed(contractSpecs.data.contractSizeHpsDay)}</StatValue>
                    <StatLabel>Contract Size</StatLabel>
                  </StatItem>
                </>
              )}
              {settlementPrice && (
                <>
                  <Divider />
                  <StatItem>
                    <StatValue>{settlementPrice}</StatValue>
                    <StatLabel>Exit Price (USDC)</StatLabel>
                  </StatItem>
                </>
              )}
            </>
          )}
        </StatsRow>

        {/* Right: details link */}
        <DetailsLink
          href="#"
          onClick={(e) => {
            e.preventDefault();
            detailedSpecsModal.open();
          }}
        >
          View Details <EastIcon style={{ fontSize: "0.75rem" }} />
        </DetailsLink>
      </HeaderBar>

      <ModalItem open={detailedSpecsModal.isOpen} setOpen={detailedSpecsModal.setOpen}>
        <DetailedSpecsModal
          closeForm={detailedSpecsModal.close}
          contractSpecs={contractSpecs?.data}
          contractMode={contractMode}
        />
      </ModalItem>
    </>
  );
};

const HeaderBar = styled("div")`
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid ${tokens.border.default};
  border-radius: ${tokens.radius.md};
  background: ${tokens.surface.card};
  flex-wrap: wrap;

  @media (max-width: 768px) {
    gap: 0.75rem;
  }
`;

// MOBILE-ONLY wrapper (only rendered when `mobileActions` is passed): claims a
// full flex line so the contract-mode toggle and the layout controls sit on their
// own row, with the controls pushed to the right corner and the stats below.
const ModeRow = styled("div")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex: 1 1 100%;
`;

const ModeToggle = styled("div")`
  display: flex;
  gap: 0;
  border: 1px solid ${tokens.border.default};
  border-radius: ${tokens.radius.sm};
  overflow: hidden;
  flex-shrink: 0;
`;

const ModeButton = styled("button")<{ $active: boolean }>`
  padding: 0.4rem 1rem;
  background: ${(props) => (props.$active ? tokens.surface.tabActive : "transparent")};
  color: ${tokens.text.onDark};
  border: none;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
  white-space: nowrap;

  &:hover {
    background: ${(props) => (props.$active ? tokens.surface.tabHover : tokens.surface.tabInactiveHover)};
  }

  &:not(:last-child) {
    border-right: 1px solid ${tokens.border.muted05};
  }
`;

const StatsRow = styled("div")`
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
`;

const StatItem = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
`;

const StatValue = styled("span")`
  font-size: 1rem;
  font-weight: 600;
  color: ${tokens.text.onDark};
  line-height: 1.2;
`;

// Deliberately inherits StatValue's neutral colour: a threshold applies equally
// to longs and shorts, so it must not borrow the long/short or PnL-sign palette.
// Red is reserved for the already-liquidatable state.
const LiqLevel = styled("span")`
  white-space: nowrap;

  &:not(:last-of-type) {
    margin-right: 0.5rem;
  }
`;

const PriceChange = styled("span")<{ $up: boolean }>`
  margin-left: 0.4rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: ${(props) => (props.$up ? tokens.trading.long : tokens.trading.short)};
`;

const StatLabel = styled("span")`
  font-size: 0.6rem;
  font-weight: 500;
  color: ${tokens.text.secondary};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const Divider = styled("div")`
  width: 1px;
  height: 28px;
  background: ${tokens.border.muted03};
  flex-shrink: 0;
`;

const DetailsLink = styled("a")`
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: ${tokens.text.secondary};
  text-decoration: none;
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: auto;
  transition: color 0.2s;

  &:hover {
    color: ${tokens.text.onDark};
  }
`;
