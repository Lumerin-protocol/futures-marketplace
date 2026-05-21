import { tokens } from "../../../styles/tokens";
import styled from "@mui/material/styles/styled";
import { useMemo } from "react";
import { formatHashrateTHPS, HASHRATE_TH_SCALE_NUM, PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
import { useGetDeliveryDates } from "../../../hooks/data/useGetDeliveryDates";
import { useFuturesContractConstants } from "../../../hooks/data/useFuturesContractConstants";
import { useFuturesTokenInfo } from "../../../hooks/data/useFuturesTokenInfo";
import { usePerpsCollection } from "../../../hooks/data/perps/usePerpsCollection";
import { usePerpsContractConstants } from "../../../hooks/data/perps/usePerpsContractConstants";
import { usePerpsTokenInfo } from "../../../hooks/data/perps/usePerpsTokenInfo";
import { useFundingRate } from "../../../hooks/data/perps/useFundingRate";
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

  // Calculate TH/s (speedHps / HASHRATE_TH_SCALE_NUM)
  const formatSpeedTHs = (speedHps: bigint) => {
    const thps = Number(speedHps) / HASHRATE_TH_SCALE_NUM;
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
    return <PerpetualStatistics />;
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
  const tickSize = Number(contractSpecs.minimumPriceIncrement) / PAYMENT_TOKEN_SCALE_NUM;
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
          <SpecLabel>Maker Fee</SpecLabel>
          <SpecValue>
            {contractConstants.makerFeeFormatted?.toFixed(2) ?? "..."} {tokenSymbol}
          </SpecValue>
        </SpecItem>
        <SpecItem>
          <SpecLabel>Taker Fee</SpecLabel>
          <SpecValue>
            {contractConstants.takerFeeFormatted?.toFixed(2) ?? "..."} {tokenSymbol}
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

const PerpetualStatistics = () => {
  const { data: perpsCollectionData } = usePerpsCollection();
  const perpsConstants = usePerpsContractConstants();
  const perpsTokenInfo = usePerpsTokenInfo();
  const fundingRateQuery = useFundingRate();
  const perpsCollection = perpsCollectionData?.data;
  const tokenSymbol = perpsTokenInfo.symbol || "USDC";
  const tokenName = perpsTokenInfo.name || "USD Coin";
  const contractAddress = process.env.REACT_APP_PERPS_TOKEN_ADDRESS;
  const docsUrl = process.env.REACT_APP_FUTURES_DOCS_URL;

  const tickSize = perpsCollection ? perpsCollection.minimumPriceIncrement / PAYMENT_TOKEN_SCALE_NUM : null;
  const minMarginPerOrder = perpsCollection ? perpsCollection.minimumMarginPerOrder / PAYMENT_TOKEN_SCALE_NUM : null;

  const formatFundingPeriod = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
  };

  const nextFundingCountdown = useMemo(() => {
    if (!perpsConstants.lastFundingUpdateTime || !perpsConstants.fundingPeriodSeconds) return null;
    const nextFundingTime = perpsConstants.lastFundingUpdateTime + perpsConstants.fundingPeriodSeconds;
    const now = Math.floor(Date.now() / 1000);
    const remaining = nextFundingTime - now;
    if (remaining <= 0) return "Now";
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    if (hours > 0 && minutes > 0) return `In ${hours}h ${minutes}m`;
    if (hours > 0) return `In ${hours}h`;
    return `In ${minutes}m`;
  }, [perpsConstants.lastFundingUpdateTime, perpsConstants.fundingPeriodSeconds]);

  if (!perpsCollection) {
    return (
      <ModalContainer>
        <h2>Contract Specifications</h2>
        <LoadingText>Loading contract specifications...</LoadingText>
      </ModalContainer>
    );
  }

  return (
    <ModalContainer>
      <h2>Contract Specifications</h2>

      {/* CONTRACT SPECIFICATIONS */}
      <SpecSection>
        <SectionTitle>CONTRACT SPECIFICATIONS</SectionTitle>
        <SpecItem>
          <SpecLabel>Contract Type</SpecLabel>
          <SpecValue>Perpetual</SpecValue>
        </SpecItem>

        {perpsCollection && (
          <SpecItem>
            <SpecLabel>Initial Margin</SpecLabel>
            <SpecValue>{perpsCollection.marginPercent}%</SpecValue>
          </SpecItem>
        )}

        {perpsCollection && (
          <SpecItem>
            <SpecLabel>Maintenance Margin</SpecLabel>
            <SpecValue>{perpsCollection.maintenanceMarginPercent}%</SpecValue>
          </SpecItem>
        )}

        {minMarginPerOrder !== null && (
          <SpecItem>
            <SpecLabel>Min Margin Per Order</SpecLabel>
            <SpecValue>
              {minMarginPerOrder.toFixed(2)} {tokenSymbol}
            </SpecValue>
          </SpecItem>
        )}

        {contractAddress && (
          <SpecItem>
            <SpecLabel>Contract Address</SpecLabel>
            <SpecValueMono>{contractAddress}</SpecValueMono>
          </SpecItem>
        )}
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

        {tickSize !== null && (
          <SpecItem>
            <SpecLabel>Tick Size</SpecLabel>
            <SpecValue>
              {tickSize.toFixed(2)} {tokenSymbol}
            </SpecValue>
          </SpecItem>
        )}

      </SpecSection>

      {/* FUNDING */}
      <SpecSection>
        <SectionTitle>FUNDING</SectionTitle>
        <SpecItem>
          <SpecLabel>Current Funding Rate</SpecLabel>
          <SpecValue>{fundingRateQuery.data?.formattedRate ?? "0%"}</SpecValue>
        </SpecItem>

        {perpsConstants.fundingPeriodSeconds !== null && (
          <SpecItem>
            <SpecLabel>Funding Period</SpecLabel>
            <SpecValue>{formatFundingPeriod(perpsConstants.fundingPeriodSeconds)}</SpecValue>
          </SpecItem>
        )}

        {nextFundingCountdown && (
          <SpecItem>
            <SpecLabel>Next Funding</SpecLabel>
            <SpecValue>{nextFundingCountdown}</SpecValue>
          </SpecItem>
        )}

        {perpsConstants.fundingRateMaxBpsFormatted !== null && (
          <SpecItem>
            <SpecLabel>Max Funding Rate</SpecLabel>
            <SpecValue>{perpsConstants.fundingRateMaxBpsFormatted} bps</SpecValue>
          </SpecItem>
        )}
      </SpecSection>

      {/* FEES & LIMITS */}
      <SpecSection>
        <SectionTitle>FEES & LIMITS</SectionTitle>
        {perpsCollection && (
          <SpecItem>
            <SpecLabel>Taker Fee</SpecLabel>
            <SpecValue>{perpsCollection.takerFeeBps} bps</SpecValue>
          </SpecItem>
        )}

        {perpsCollection && (
          <SpecItem>
            <SpecLabel>Maker Fee</SpecLabel>
            <SpecValue>{perpsCollection.makerFeeBps} bps</SpecValue>
          </SpecItem>
        )}

        {perpsConstants.liquidationFeeFormatted !== null && (
          <SpecItem>
            <SpecLabel>Liquidation Fee</SpecLabel>
            <SpecValue>
              {perpsConstants.liquidationFeeFormatted.toFixed(2)} {tokenSymbol}
            </SpecValue>
          </SpecItem>
        )}

        {perpsConstants.maxOrdersPerParticipant !== undefined && (
          <SpecItem>
            <SpecLabel>Max Open Orders</SpecLabel>
            <SpecValue>{perpsConstants.maxOrdersPerParticipant}</SpecValue>
          </SpecItem>
        )}

        {perpsConstants.maxPriceLevelsPerSide !== null && (
          <SpecItem>
            <SpecLabel>Max Price Levels Per Side</SpecLabel>
            <SpecValue>{perpsConstants.maxPriceLevelsPerSide}</SpecValue>
          </SpecItem>
        )}
      </SpecSection>

      {/* MORE DETAILS */}
      {docsUrl && (
        <SpecSection>
          <SectionTitle>MORE DETAILS</SectionTitle>
          <SpecItem>
            <SpecLabel>Documentation</SpecLabel>
            <SpecLink href={docsUrl} target="_blank" rel="noopener noreferrer">
              View Documentation ↗
            </SpecLink>
          </SpecItem>
        </SpecSection>
      )}
    </ModalContainer>
  );
};

const ModalContainer = styled("div")`
  max-height: 70vh;
  overflow-y: auto;
  padding: 0 1rem;

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
  color: ${tokens.text.onDark};
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
  color: ${tokens.text.onDark};
  text-decoration: none;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.8;
    text-decoration: underline;
  }
`;