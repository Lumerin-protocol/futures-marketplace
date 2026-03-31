import { tokens } from "../../../styles/tokens";
import styled from "@mui/material/styles/styled";
import { useMemo } from "react";
import { formatHashrateTHPS } from "../../../lib/units";
import { useGetDeliveryDates } from "../../../hooks/data/useGetDeliveryDates";
import { useFuturesContractConstants } from "../../../hooks/data/useFuturesContractConstants";
import { useFuturesTokenInfo } from "../../../hooks/data/useFuturesTokenInfo";
import type { FuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
import type { ContractMode } from "../../../types/types";

interface DetailedSpecsModalProps {
  closeForm: () => void;
  contractSpecs: FuturesContractSpecs | null | undefined;
  contractMode?: ContractMode;
}

export const DetailedSpecsModal = ({ closeForm, contractSpecs, contractMode = "futures" }: DetailedSpecsModalProps) => {
  const { data: deliveryDatesRaw } = useGetDeliveryDates();
  const contractConstants = useFuturesContractConstants();
  const tokenInfo = useFuturesTokenInfo();

  // Get the first available delivery date (filtered and sorted)
  const firstDeliveryDate = useMemo(() => {
    if (!deliveryDatesRaw) return null;
    const now = Math.floor(Date.now() / 1000);
    const validDates = deliveryDatesRaw
      .map((date) => Number(date))
      .filter((deliveryDate) => deliveryDate >= now)
      .sort((a, b) => a - b);
    return validDates.length > 0 ? validDates[0] : null;
  }, [deliveryDatesRaw]);

  // Format time only from timestamp (UTC)
  const formatExpirationTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
  };

  const formatSpeed = (speedHps: bigint) => {
    return formatHashrateTHPS(speedHps).full;
  };

  // Calculate TH/s (speedHps / 10^12)
  const formatSpeedTHs = (speedHps: bigint) => {
    const thps = Number(speedHps) / 10 ** 12;
    return thps.toFixed(0);
  };

  if (!contractSpecs && contractMode === "futures") {
    return (
      <ModalContainer>
        <h2>Contract Specifications</h2>
        <LoadingText>Loading contract specifications...</LoadingText>
      </ModalContainer>
    );
  }
  if (contractMode === "perpetual") {
    return (
      <ModalContainer>
        <h2>Statistics</h2>

        {/* MARKET STATISTICS */}
        <SpecSection>
          <SectionTitle>MARKET STATISTICS</SectionTitle>
          <SpecItem>
            <SpecLabel>Total Volume</SpecLabel>
            <SpecValue>1,234,567 USDC</SpecValue>
          </SpecItem>

          <SpecItem>
            <SpecLabel>Total Order Count</SpecLabel>
            <SpecValue>8,523</SpecValue>
          </SpecItem>

          <SpecItem>
            <SpecLabel>24h Volume</SpecLabel>
            <SpecValue>456,789 USDC</SpecValue>
          </SpecItem>

          <SpecItem>
            <SpecLabel>24h Trades</SpecLabel>
            <SpecValue>3,241</SpecValue>
          </SpecItem>
        </SpecSection>

        {/* FUNDING */}
        <SpecSection>
          <SectionTitle>FUNDING</SectionTitle>
          <SpecItem>
            <SpecLabel>Current Funding Rate</SpecLabel>
            <SpecValue>0%</SpecValue>
          </SpecItem>

          <SpecItem>
            <SpecLabel>Next Funding</SpecLabel>
            <SpecValue>In 7h 23m</SpecValue>
          </SpecItem>
        </SpecSection>

        {/* LIQUIDITY */}
        <SpecSection>
          <SectionTitle>LIQUIDITY</SectionTitle>
          <SpecItem>
            <SpecLabel>Open Interest</SpecLabel>
            <SpecValue>2,345,678 USDC</SpecValue>
          </SpecItem>

          <SpecItem>
            <SpecLabel>Active Orders</SpecLabel>
            <SpecValue>1,256</SpecValue>
          </SpecItem>
        </SpecSection>
      </ModalContainer>
    );
  }

  // For futures mode, check if contractSpecs exist
  if (!contractSpecs) {
    return (
      <ModalContainer>
        <h2>Contract Specifications</h2>
        <LoadingText>Loading contract specifications...</LoadingText>
      </ModalContainer>
    );
  }

  const tokenSymbol = tokenInfo.symbol || "USDC";
  const tokenName = tokenInfo.name || "USD Coin";
  const contractAddress = process.env.REACT_APP_FUTURES_TOKEN_ADDRESS;
  const docsUrl = process.env.REACT_APP_FUTURES_DOCS_URL;

  // Calculate tick value: minimumPriceIncrement * deliveryDurationDays
  const tickSize = Number(contractSpecs.minimumPriceIncrement) / 1e6;
  const tickValue = tickSize * contractSpecs.deliveryDurationDays;

  // Calculate total coverage days
  const totalCoverageDays =
    contractConstants.futureDeliveryDatesCount && contractConstants.deliveryIntervalDays
      ? contractConstants.futureDeliveryDatesCount * contractConstants.deliveryIntervalDays
      : null;

  return (
    <ModalContainer>
      <h2>Contract Specifications</h2>

      {/* CONTRACT SPECIFICATIONS */}
      <SpecSection>
        <SectionTitle>CONTRACT SPECIFICATIONS</SectionTitle>
        <SpecItem>
          <SpecLabel>Contract Unit</SpecLabel>
          <SpecValue>{formatSpeedTHs(contractSpecs.speedHps)} TH/s per day</SpecValue>
        </SpecItem>

        <SpecItem>
          <SpecLabel>Margin Requirement</SpecLabel>
          <SpecValue>{contractSpecs.liquidationMarginPercent}%</SpecValue>
        </SpecItem>

        <SpecItem>
          <SpecLabel>Expiration Time</SpecLabel>
          <SpecValue>
            {firstDeliveryDate ? `${formatExpirationTime(firstDeliveryDate)} (UTC)` : "No dates available"} on each
            contract date
          </SpecValue>
        </SpecItem>

        <SpecItem>
          <SpecLabel>Contract Address</SpecLabel>
          <SpecValueMono>{contractAddress}</SpecValueMono>
        </SpecItem>
      </SpecSection>

      {/* CONTRACT FREQUENCY */}
      <SpecSection>
        <SectionTitle>CONTRACT FREQUENCY</SectionTitle>
        <SpecItem>
          <SpecLabel>Available Expirations</SpecLabel>
          <SpecValue>
            {contractConstants.futureDeliveryDatesCount ?? "..."} contract
            {contractConstants.futureDeliveryDatesCount !== 1 ? "s" : ""}
          </SpecValue>
        </SpecItem>

        <SpecItem>
          <SpecLabel>Expiration Interval</SpecLabel>
          <SpecValue>
            Every {contractConstants.deliveryIntervalDays ?? "..."} days
            {/* {totalCoverageDays && ` (${totalCoverageDays} days)`} */}
          </SpecValue>
        </SpecItem>
      </SpecSection>

      {/* PRICING & SETTLEMENT */}
      <SpecSection>
        <SectionTitle>PRICING & SETTLEMENT</SectionTitle>
        <SpecItem>
          <SpecLabel>Settlement Currency</SpecLabel>
          <SpecValue>
            {tokenName} ({tokenSymbol})
          </SpecValue>
        </SpecItem>

        <SpecItem>
          <SpecLabel>Tick Size</SpecLabel>
          <SpecValue>
            {tickSize.toFixed(2)} {tokenSymbol}
          </SpecValue>
        </SpecItem>

        <SpecItem>
          <SpecLabel>Tick Value</SpecLabel>
          <SpecValue>
            {tickValue.toFixed(2)} {tokenSymbol}
          </SpecValue>
        </SpecItem>

        <SpecItem>
          <SpecLabel>Delivery Duration</SpecLabel>
          <SpecValue>
            {contractSpecs.deliveryDurationDays} day{contractSpecs.deliveryDurationDays !== 1 ? "s" : ""}
          </SpecValue>
        </SpecItem>
      </SpecSection>

      {/* FEES & LIMITS */}
      <SpecSection>
        <SectionTitle>FEES & LIMITS</SectionTitle>
        <SpecItem>
          <SpecLabel>Order Fee</SpecLabel>
          <SpecValue>
            {contractConstants.orderFeeFormatted?.toFixed(2) ?? "..."} {tokenSymbol}
          </SpecValue>
        </SpecItem>

        <SpecItem>
          <SpecLabel>Max Open Orders</SpecLabel>
          <SpecValue>{contractConstants.maxOrdersPerParticipant ?? "..."}</SpecValue>
        </SpecItem>
      </SpecSection>
      {/* MORE DETAILS */}
      <SpecSection>
        <SectionTitle>MORE DETAILS</SectionTitle>
        <SpecItem>
          <SpecLabel>Futures Documentation</SpecLabel>
          <SpecLink href={docsUrl} target="_blank" rel="noopener noreferrer">
            View Documentation ↗
          </SpecLink>
        </SpecItem>
      </SpecSection>
    </ModalContainer>
  );
};

const ModalContainer = styled("div")`
  h2 {
    font-size: 1.5rem;
    font-weight: 600;
    color: ${tokens.text.onDark};
    margin-bottom: 1.5rem;
  }
`;

const LoadingText = styled("div")`
  color: ${tokens.text.secondary};
  font-size: 0.875rem;
`;

const SpecSection = styled("div")`
  margin-bottom: 1.5rem;

  &:last-child {
    margin-bottom: 0;
  }
`;

const SectionTitle = styled("h3")`
  font-size: 0.75rem;
  font-weight: 700;
  color: ${tokens.text.secondary};
  letter-spacing: 0.05em;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid ${tokens.overlay.white10};
`;

const SpecItem = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0.5rem 0;

  &:last-child {
    padding-bottom: 0;
  }
`;

const SpecLabel = styled("span")`
  font-size: 0.875rem;
  color: ${tokens.text.secondary};
  flex-shrink: 0;
`;

const SpecValue = styled("span")`
  font-size: 0.875rem;
  font-weight: 500;
  color: ${tokens.trading.long};
  text-align: right;
  margin-left: 1rem;
`;

const SpecValueMono = styled(SpecValue)`
  font-family: monospace;
  font-size: 0.75rem;
  word-break: break-all;
  max-width: 280px;
`;

const SpecLink = styled("a")`
  font-size: 0.875rem;
  font-weight: 500;
  color: ${tokens.trading.long};
  text-decoration: none;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.8;
    text-decoration: underline;
  }
`;