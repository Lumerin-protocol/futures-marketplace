import { tokens } from "../../../styles/tokens";
import styled from "@mui/material/styles/styled";
import EastIcon from "@mui/icons-material/East";
import { useModal } from "../../../hooks/useModal";
import { ModalItem } from "../../Modal";
import { DetailedSpecsModal } from "./DetailedSpecsModal";
import { useSettlementPrice } from "../../../hooks/data/useSettlementPrice";
import { formatHashratePHPS, PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
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

  return (
    <>
      <HeaderBar>
        {/* Left: contract mode toggle */}
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

        {/* Center: market stats */}
        <StatsRow>
          {contractMode === "perpetual" ? (
            <>
              <StatItem>
                <StatValue>
                  {currentPrice ?? "—"}
                  {renderPriceChange()}
                </StatValue>
                <StatLabel>Current Price (USDC)</StatLabel>
              </StatItem>
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
              <StatItem>
                <StatValue>
                  {currentPrice ?? "—"}
                  {renderPriceChange()}
                </StatValue>
                <StatLabel>Current Price (USDC)</StatLabel>
              </StatItem>
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
