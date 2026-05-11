import { tokens } from "../../../styles/tokens";
import styled from "@mui/material/styles/styled";
import EastIcon from "@mui/icons-material/East";
import { useModal } from "../../../hooks/useModal";
import { ModalItem } from "../../Modal";
import { DetailedSpecsModal } from "./DetailedSpecsModal";
import { formatHashrateTHPS, PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
import type { UseQueryResult } from "@tanstack/react-query";
import type { GetResponse } from "../../../gateway/interfaces";
import type { FuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
import type { ContractMode } from "../../../types/types";

interface TradingHeaderProps {
  contractMode: ContractMode;
  onContractModeChange: (mode: ContractMode) => void;
  contractSpecsQuery: UseQueryResult<GetResponse<FuturesContractSpecs>, Error>;
  currentPrice?: string | null;
  fundingRate?: string;
  totalVolume?: string;
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
  fundingRate = "0%",
  totalVolume,
}: TradingHeaderProps) => {
  const detailedSpecsModal = useModal();
  const { data: contractSpecs } = contractSpecsQuery;

  const formatSpeed = (speedHps: bigint) => formatHashrateTHPS(speedHps).full;

  const formatDuration = (seconds: number) => {
    const secondsInWeek = 7 * 24 * 60 * 60;
    const secondsInDay = 24 * 60 * 60;
    if (seconds < secondsInWeek) {
      const days = Math.round(seconds / secondsInDay);
      return `${days} day${days !== 1 ? "s" : ""}`;
    }
    const weeks = Math.round(seconds / secondsInWeek);
    return `${weeks} week${weeks !== 1 ? "s" : ""}`;
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
                <StatValue>{currentPrice ?? "—"}</StatValue>
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
                <StatValue>{currentPrice ?? "—"}</StatValue>
                <StatLabel>Current Price (USDC)</StatLabel>
              </StatItem>
              {contractSpecs?.data && (
                <>
                  <Divider />
                  <StatItem>
                    <StatValue>{formatSpeed(contractSpecs.data.speedHps)}</StatValue>
                    <StatLabel>Contract Speed</StatLabel>
                  </StatItem>
                  <Divider />
                  <StatItem>
                    <StatValue>{formatDuration(contractSpecs.data.deliveryDurationSeconds)}</StatValue>
                    <StatLabel>Delivery Duration</StatLabel>
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
