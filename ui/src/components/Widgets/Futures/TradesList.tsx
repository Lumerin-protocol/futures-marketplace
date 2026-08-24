import styled from "@mui/material/styles/styled";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { tokens } from "../../../styles/tokens";
import { useRecentTrades } from "../../../hooks/data/useRecentTrades";
import { useFuturesTokenInfo } from "../../../hooks/data/useFuturesTokenInfo";
import { usePerpsTokenInfo } from "../../../hooks/data/perps/usePerpsTokenInfo";
import { getTxUrl } from "../../../lib/indexer";
import type { ContractMode } from "../../../types/types";

interface TradesListProps {
  contractMode?: ContractMode;
}

// Compact notation for the notional Size column (e.g. 15.04K, 1.5M) to match
// the perps volume order book layout.
const formatSize = (value: number): string =>
  value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });

// Futures contracts are whole units, so their Quantity column prints as a plain
// grouped integer — same as the futures volume order book.
const formatQuantity = (value: number): string =>
  value.toLocaleString("en-US", { maximumFractionDigits: 0 });

// Local wall-clock time (HH:MM:SS) for the Time column.
const formatTime = (timestampSeconds: number): string =>
  new Date(timestampSeconds * 1000).toLocaleTimeString("en-US", { hour12: false });

export const TradesList = ({ contractMode = "futures" }: TradesListProps) => {
  const { data: trades, isLoading } = useRecentTrades(contractMode, { refetch: true });

  const futuresTokenInfo = useFuturesTokenInfo();
  const perpsTokenInfo = usePerpsTokenInfo();
  const tokenSymbol =
    (contractMode === "perpetual" ? perpsTokenInfo.symbol : futuresTokenInfo.symbol) || "USDC";

  // Futures fills are quoted in whole contracts; perps keeps the notional.
  const isFutures = contractMode !== "perpetual";

  return (
    <Container>
      <ColumnHeader>
        <span>Price</span>
        <span>{isFutures ? "Quantity" : `Size (${tokenSymbol})`}</span>
        <span>Time</span>
      </ColumnHeader>

      {isLoading ? (
        <StateRow>Loading trades...</StateRow>
      ) : !trades || trades.length === 0 ? (
        <StateRow>No trades yet</StateRow>
      ) : (
        trades.map((trade) => (
          <Row key={trade.id}>
            <PriceCol $side={trade.side}>{trade.price.toFixed(trade.price < 1 ? 5 : 2)}</PriceCol>
            <AmountCol>{isFutures ? formatQuantity(trade.quantity) : formatSize(trade.size)}</AmountCol>
            <TimeCol>
              <span>{formatTime(trade.timestamp)}</span>
              <TxLink
                href={getTxUrl(trade.transactionHash)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View transaction"
              >
                <OpenInNewIcon sx={{ fontSize: 13 }} />
              </TxLink>
            </TimeCol>
          </Row>
        ))
      )}
    </Container>
  );
};

const Container = styled("div")`
  width: 100%;
  display: flex;
  flex-direction: column;
`;

const ColumnHeader = styled("div")`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  position: sticky;
  top: -1px;
  z-index: 2;
  background-color: ${tokens.surface.panel};
  border-bottom: 1px solid ${tokens.overlay.white10};
  padding: 0.3rem 0.5rem;

  span {
    font-size: 0.65rem;
    font-weight: 600;
    color: ${tokens.text.secondary};
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  span:first-of-type {
    text-align: left;
  }

  span:not(:first-of-type) {
    text-align: right;
  }

  /* MOBILE-ONLY (see MOBILE_TRADING_QUERY): the feed shares its row with the
     place-order form, so columns tighten and the timestamp gets extra width. */
  @media (max-width: 768px) {
    grid-template-columns: 0.8fr 0.8fr 1.4fr;
    column-gap: 0.3rem;

    span {
      font-size: 0.55rem;
    }
  }
`;

const Row = styled("div")`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  align-items: center;
  height: 22px;
  padding: 0 0.5rem;
  font-size: 0.75rem;
  font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
  border-bottom: 1px solid transparent;

  &:hover {
    background: ${tokens.overlay.white10};
  }

  /* MOBILE-ONLY: matches the compact ColumnHeader template above. */
  @media (max-width: 768px) {
    grid-template-columns: 0.8fr 0.8fr 1.4fr;
    column-gap: 0.3rem;
    font-size: 0.6rem;
  }
`;

const PriceCol = styled("span")<{ $side: "buy" | "sell" }>`
  text-align: left;
  color: ${(props) => (props.$side === "buy" ? tokens.trading.long : tokens.trading.short)};
`;

const AmountCol = styled("span")`
  text-align: right;
  color: ${tokens.text.onDark};
`;

const TimeCol = styled("div")`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.35rem;
  color: ${tokens.text.secondary};
`;

const TxLink = styled("a")`
  display: inline-flex;
  align-items: center;
  color: ${tokens.trading.info};
  transition: color 0.15s ease;

  &:hover {
    color: ${tokens.text.onDark};
  }
`;

const StateRow = styled("div")`
  text-align: center;
  padding: 2rem 0.5rem;
  color: ${tokens.text.muted};
  font-size: 0.8rem;
`;
