import { tokens } from "../../../styles/tokens";
import styled from "@mui/material/styles/styled";
import Tooltip from "@mui/material/Tooltip";
import { useMemo, useState, type ReactNode } from "react";
import { formatHashratePHPS, PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
import { useGetExpirationDates } from "../../../hooks/data/useGetExpirationDates";
import { useFuturesContractConstants } from "../../../hooks/data/useFuturesContractConstants";
import { useFuturesTokenInfo } from "../../../hooks/data/useFuturesTokenInfo";
import { usePerpsCollection } from "../../../hooks/data/perps/usePerpsCollection";
import { usePerpsContractConstants } from "../../../hooks/data/perps/usePerpsContractConstants";
import { usePerpsTokenInfo } from "../../../hooks/data/perps/usePerpsTokenInfo";
import { useFundingRate } from "../../../hooks/data/perps/useFundingRate";
import { useMarginEngineShocks } from "../../../hooks/data/useMarginEngineShocks";
import type { FuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
import type { ContractMode } from "../../../types/types";

// Shock parameters are WAD-scaled (1e18) fractions. Spot shocks render as a
// percentage (e.g. 0.1e18 -> "±10%"); vol shocks render as vol points using the
// same magnitude (e.g. 0.1e18 -> "±10 vol pts").
const formatSpotShock = (value: bigint | undefined) =>
  value === undefined ? "..." : `${(Number(value) / 1e18) * 100}%`;

const formatVolShock = (value: bigint | undefined) =>
  value === undefined ? "..." : `${(Number(value) / 1e18) * 100} vol pts`;

// Shared RISK PARAMETERS section rendered in both futures and perpetual views.
const RiskParametersSection = () => {
  const shocks = useMarginEngineShocks();
  return (
    <SpecSection>
      <SectionTitle>RISK PARAMETERS</SectionTitle>
      <SpecItem>
        <SpecLabel>Initial Margin</SpecLabel>
        <SpecValue>{formatSpotShock(shocks.imSpotShock)}</SpecValue>
      </SpecItem>
      <SpecItem>
        <SpecLabel>Maintenance Margin</SpecLabel>
        <SpecValue>{formatSpotShock(shocks.mmSpotShock)}</SpecValue>
      </SpecItem>
      <SpecItem>
        <SpecLabel>Initial Margin (Vol)</SpecLabel>
        <SpecValue>{formatVolShock(shocks.imVolShock)}</SpecValue>
      </SpecItem>
      <SpecItem>
        <SpecLabel>Maintenance Margin (Vol)</SpecLabel>
        <SpecValue>{formatVolShock(shocks.mmVolShock)}</SpecValue>
      </SpecItem>
    </SpecSection>
  );
};

interface DetailedSpecsModalProps {
  closeForm: () => void;
  contractSpecs: FuturesContractSpecs | null | undefined;
  contractMode?: ContractMode;
}

// `closeForm` is accepted but never invoked — see ui/TECH_DEBT.md.
export const DetailedSpecsModal = ({ contractSpecs, contractMode = "futures" }: DetailedSpecsModalProps) => {
  const { data: expirationDatesRaw } = useGetExpirationDates();
  const contractConstants = useFuturesContractConstants();
  const tokenInfo = useFuturesTokenInfo();

  // Get the first available expiration date (filtered and sorted)
  const firstExpirationAt = useMemo(() => {
    if (!expirationDatesRaw) return null;
    const now = Math.floor(Date.now() / 1000);
    const validDates = expirationDatesRaw
      .map((date) => Number(date))
      .filter((expirationAt) => expirationAt >= now)
      .sort((a, b) => a - b);
    return validDates.length > 0 ? validDates[0] : null;
  }, [expirationDatesRaw]);

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

  if (!contractSpecs && contractMode === "futures") {
    return (
      <SpecsShell>
        <LoadingText>Loading contract specifications...</LoadingText>
      </SpecsShell>
    );
  }
  if (contractMode === "perpetual") {
    return <PerpetualStatistics />;
  }

  // For futures mode, check if contractSpecs exist
  if (!contractSpecs) {
    return (
      <SpecsShell>
        <LoadingText>Loading contract specifications...</LoadingText>
      </SpecsShell>
    );
  }

  const tokenSymbol = tokenInfo.symbol || "USDC";
  const tokenName = tokenInfo.name || "USD Coin";
  const contractAddress = process.env.REACT_APP_FUTURES_TOKEN_ADDRESS;
  const docsUrl = process.env.REACT_APP_FUTURES_DOCS_URL;

  const tickSize = Number(contractSpecs.minimumPriceIncrement) / PAYMENT_TOKEN_SCALE_NUM;

  // Calculate total coverage days
  const _totalCoverageDays =
    contractConstants.futureExpirationDatesCount && contractConstants.expirationIntervalDays
      ? contractConstants.futureExpirationDatesCount * contractConstants.expirationIntervalDays
      : null;

  return (
    <SpecsShell>
      {/* CONTRACT SPECIFICATIONS */}
      <SpecSection>
        <SectionTitle>CONTRACT DETAILS</SectionTitle>
        <SpecItem>
          <SpecLabel>Contract Unit</SpecLabel>
          <SpecValue>{formatHashratePHPS(contractSpecs.contractSizeHpsDay).full} per day</SpecValue>
        </SpecItem>


        <SpecItem>
          <SpecLabel>Expiration Time</SpecLabel>
          <SpecValue>
            {firstExpirationAt ? `${formatExpirationTime(firstExpirationAt)} (UTC)` : "No dates available"} on each
            contract date
          </SpecValue>
        </SpecItem>

        <SpecItem>
          <SpecLabel>Contract Address</SpecLabel>
          {contractAddress ? <AddressDisplay address={contractAddress} /> : <SpecValue>—</SpecValue>}
        </SpecItem>
      </SpecSection>

      {/* CONTRACT FREQUENCY */}
      <SpecSection>
        <SectionTitle>CONTRACT FREQUENCY</SectionTitle>
        <SpecItem>
          <SpecLabel>Forward Expirations</SpecLabel>
          <SpecValue>
            {contractConstants.futureExpirationDatesCount ?? "..."} contract
            {contractConstants.futureExpirationDatesCount !== 1 ? "s" : ""}
          </SpecValue>
        </SpecItem>

        <SpecItem>
          <SpecLabel>Expiration Interval</SpecLabel>
          <SpecValue>
            Every {contractConstants.expirationIntervalDays ?? "..."} days
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
      </SpecSection>

      {/* FEES & LIMITS */}
      <SpecSection>
        <SectionTitle>FEES & LIMITS</SectionTitle>
        <SpecItem>
          <SpecLabel>Maker Fee</SpecLabel>
          <SpecValue>{contractConstants.makerFeeBps ?? "..."} bps</SpecValue>
        </SpecItem>
        <SpecItem>
          <SpecLabel>Taker Fee</SpecLabel>
          <SpecValue>{contractConstants.takerFeeBps ?? "..."} bps</SpecValue>
        </SpecItem>

        <SpecItem>
          <SpecLabel>Max Open Orders</SpecLabel>
          <SpecValue>{contractConstants.maxOrdersPerParticipant ?? "..."}</SpecValue>
        </SpecItem>
      </SpecSection>

      {/* RISK PARAMETERS */}
      <RiskParametersSection />

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
    </SpecsShell>
  );
};

// Trim an address to `0x12345....67890` form (7 leading chars, 5 trailing).
const trimAddress = (address: string) =>
  address.length > 12 ? `${address.slice(0, 7)}....${address.slice(-5)}` : address;

const CopyIconSvg = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIconSvg = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const AddressDisplay = ({ address }: { address: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write can fail (e.g. insecure context); silently ignore.
    }
  };

  return (
    <AddressWrapper>
      <Tooltip title={address} arrow>
        <AddressMono>{trimAddress(address)}</AddressMono>
      </Tooltip>
      <Tooltip title={copied ? "Copied!" : "Copy to clipboard"} arrow>
        <CopyButton type="button" onClick={handleCopy} aria-label="Copy address to clipboard">
          {copied ? <CheckIconSvg /> : <CopyIconSvg />}
        </CopyButton>
      </Tooltip>
    </AddressWrapper>
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
  const _minMarginPerOrder = perpsCollection ? perpsCollection.minimumMarginPerOrder / PAYMENT_TOKEN_SCALE_NUM : null;

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
      <SpecsShell>
        <LoadingText>Loading contract specifications...</LoadingText>
      </SpecsShell>
    );
  }

  return (
    <SpecsShell>
      {/* CONTRACT SPECIFICATIONS */}
      <SpecSection>
        <SectionTitle>CONTRACT DETAILS</SectionTitle>
        <SpecItem>
          <SpecLabel>Contract Type</SpecLabel>
          <SpecValue>Perpetual</SpecValue>
        </SpecItem>


        {contractAddress && (
          <SpecItem>
            <SpecLabel>Contract Address</SpecLabel>
            <AddressDisplay address={contractAddress} />
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

        {perpsConstants.liquidationFeeBps !== undefined && (
          <SpecItem>
            <SpecLabel>Liquidation Fee</SpecLabel>
            <SpecValue>{perpsConstants.liquidationFeeBps} bps</SpecValue>
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

      {/* RISK PARAMETERS */}
      <RiskParametersSection />

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
    </SpecsShell>
  );
};

// Pins the "Contract Specifications" heading while only the body scrolls.
const SpecsShell = ({ children }: { children: ReactNode }) => (
  <ModalContainer>
    <ModalHeader>
      <h2>Contract Specifications</h2>
    </ModalHeader>
    <ScrollBody>{children}</ScrollBody>
  </ModalContainer>
);

const ModalContainer = styled("div")`
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ModalHeader = styled("div")`
  flex-shrink: 0;
  padding: 0 1rem;

  h2 {
    font-size: 1.5rem;
    font-weight: 600;
    color: ${tokens.text.onDark};
    margin-bottom: 1.5rem;
  }
`;

const ScrollBody = styled("div")`
  flex: 1;
  overflow-y: auto;
  /* Extra right padding so content doesn't sit under the scrollbar when it appears. */
  padding: 0 1.75rem 0 1rem;
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

const AddressWrapper = styled("div")`
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-left: 1rem;
`;

const AddressMono = styled("span")`
  font-family: monospace;
  font-size: 0.75rem;
  font-weight: 500;
  color: ${tokens.text.onDark};
  cursor: default;
`;

const CopyButton = styled("button")`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.15rem;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: ${tokens.text.secondary};
  cursor: pointer;
  transition: color 0.2s ease, background-color 0.2s ease;

  &:hover {
    color: ${tokens.text.onDark};
    background-color: ${tokens.overlay.white10};
  }
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
