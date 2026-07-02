import styled from "@mui/material/styles/styled";
import Modal from "@mui/material/Modal";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useMemo, useState } from "react";
import { tokens } from "../../../styles/tokens";
import { ModalCard } from "../../Modal.styled";
import { DateTimeCell } from "../../DateTimeCell";
import { LoadMoreButton } from "../../LoadMoreButton";
import { useHistoricalPositions } from "../../../hooks/data/useHistoricalPositions";
import type { PositionBookPosition, FuturesSessionTrade } from "../../../hooks/data/getUserFuturesPositions";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
import { getTxUrl } from "../../../lib/indexer";
import type { ContractMode } from "../../../types/types";

export interface FuturesTradesModalSelection {
  pricePerDay: bigint;
  deliveryAt: string;
  positionType: "Long" | "Short";
}

interface FuturesTradesModalProps {
  open: boolean;
  onClose: () => void;
  selection: FuturesTradesModalSelection | null;
  participantAddress?: `0x${string}`;
  activePositions?: PositionBookPosition[];
  contractMode?: ContractMode;
}

interface TradeRow {
  id: string;
  timestamp: string;
  pricePerDay: bigint;
  positionType: "Long" | "Short";
  realizedPnl: number;
  counterparty: `0x${string}` | null;
  quantity: number;
  hasActive: boolean;
  transactionHash: `0x${string}`;
}

// Normalized shape that unifies active (PositionBookPosition) and historical
// (HistoricalPosition) positions so they can be processed by the same grouping
// pipeline. Direction is collapsed into a single `isLong` flag and the
// row-level pnl is flattened (active rows have no realized pnl yet).
interface NormalizedPosition {
  id: string;
  transactionHash: `0x${string}`;
  timestamp: string;
  deliveryAt: string;
  pricePerDay: bigint;
  isLong: boolean;
  isActive: boolean;
  pnl: number;
  trades: FuturesSessionTrade[];
}

const truncateAddress = (address: string) => {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export const FuturesTradesModal = ({
  open,
  onClose,
  selection,
  participantAddress,
  activePositions,
  contractMode = "futures",
}: FuturesTradesModalProps) => {
  // Lazily fetch historical positions when the modal is opened. The query is
  // cached by react-query so re-using it elsewhere on the page does not
  // trigger a refetch.
  const historicalPositionsQuery = useHistoricalPositions(participantAddress, open);

  const matchingTrades = useMemo<TradeRow[]>(() => {
    if (!selection) return [];

    // Side determination follows the same approach as `HistoricalPositionsListWidget`
    // for visual consistency. In futures mode the data is stored against the
    // simulate account, but on this page `participantAddress` resolves to that
    // same address, so either works for display.
    const sideLookupAddress = participantAddress?.toLowerCase();

    const historical = historicalPositionsQuery.data?.data ?? [];
    const active = activePositions ?? [];

    // Normalize active (buyer/seller-shaped) and historical (single-user-shaped)
    // positions into one shape keyed by `isLong` + `pricePerDay`. Active rows
    // resolve direction from `participantAddress` against the buyer/seller
    // pair, historical rows already carry `isLong` from the indexer session.
    const normalized: NormalizedPosition[] = [
      ...active.map<NormalizedPosition>((p) => {
        const isLong = sideLookupAddress
          ? p.buyer.address.toLowerCase() === sideLookupAddress
          : p.buyPricePerDay > 0n;
        return {
          id: p.id,
          transactionHash: p.transactionHash,
          timestamp: p.timestamp,
          deliveryAt: p.deliveryAt,
          pricePerDay: isLong ? p.buyPricePerDay : p.sellPricePerDay,
          isLong,
          isActive: p.isActive,
          pnl: 0,
          trades: p.trades ?? [],
        };
      }),
      ...historical.map<NormalizedPosition>((p) => ({
        id: p.id,
        transactionHash: p.transactionHash,
        timestamp: p.timestamp,
        deliveryAt: p.deliveryAt,
        pricePerDay: p.pricePerDay,
        isLong: p.isLong,
        isActive: p.isActive,
        pnl: p.pnl,
        trades: p.trades ?? [],
      })),
    ];

    const matchingPositions = normalized.filter((p) => {
      if (p.deliveryAt !== selection.deliveryAt) return false;
      const positionType: "Long" | "Short" = p.isLong ? "Long" : "Short";
      if (positionType !== selection.positionType) return false;
      return p.pricePerDay === selection.pricePerDay;
    });

    // Futures mode: every position row carries the underlying
    // PositionSession.trades[] (see usePositionBook / useHistoricalPositions).
    // Render one row per real on-chain Trade instead of synthesising rows
    // from positions.
    if (contractMode === "futures") {
      const seen = new Set<string>();
      const rows: TradeRow[] = [];
      for (const p of matchingPositions) {
        for (const trade of p.trades) {
          if (seen.has(trade.id)) continue;
          seen.add(trade.id);
          // Each fill has its own signed `tradeQuantity`. A session opened
          // long with +5 and exited via -2 / -3 generates trades on both
          // sides — so per-row side comes from the fill itself, not the
          // parent group's `selection.positionType`.
          const isLong = trade.tradeQuantity >= 0;
          rows.push({
            id: trade.id,
            timestamp: trade.timestamp,
            pricePerDay: trade.tradePrice,
            positionType: isLong ? "Long" : "Short",
            realizedPnl: Number(trade.realizedPnl),
            counterparty: null,
            quantity: Math.abs(trade.tradeQuantity),
            hasActive: p.isActive,
            transactionHash: trade.transactionHash,
          });
        }
      }
      rows.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
      return rows;
    }

    // Perpetual fallback (kept for safety; this modal isn't currently opened
    // outside futures, but the `contractMode` prop allows for it). Group one
    // row per (transactionHash, deliveryAt, pricePerDay) tuple.
    const groups = new Map<string, TradeRow>();
    for (const p of matchingPositions) {
      const positionType: "Long" | "Short" = p.isLong ? "Long" : "Short";
      const key = `${p.transactionHash}-${p.deliveryAt}-${p.pricePerDay}`;

      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          id: key,
          timestamp: p.timestamp,
          pricePerDay: p.pricePerDay,
          positionType,
          realizedPnl: p.pnl,
          counterparty: null,
          quantity: 1,
          hasActive: p.isActive,
          transactionHash: p.transactionHash,
        });
        continue;
      }

      existing.quantity += 1;
      existing.realizedPnl += p.pnl;
      if (p.isActive) {
        existing.hasActive = true;
      }
    }

    const rows = Array.from(groups.values());
    rows.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    return rows;
  }, [
    selection,
    historicalPositionsQuery.data?.data,
    activePositions,
    participantAddress,
    contractMode,
  ]);

  const formatPrice = (price: bigint) => (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  const formatPnl = (pnlRaw: number) => {
    const value = pnlRaw / PAYMENT_TOKEN_SCALE_NUM;
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)} USDC`;
  };

  // Client-side "Load More" paging (the full set is already in memory).
  const PAGE_SIZE = 15;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Reset to the first page whenever the modal opens or the selection changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [open, selection]);

  const displayedTrades = matchingTrades.slice(0, visibleCount);

  const isLoading = open && historicalPositionsQuery.isLoading;

  return (
    <Modal open={open} onClose={onClose}>
      <TradesModalCard>
        <IconButton className="close" sx={{ color: "white" }} onClick={onClose}>
          <CloseIcon />
        </IconButton>

        <h2>Trades ({matchingTrades.length})</h2>

        <TradesTableContainer>
          {isLoading ? (
            <LoadingState>Loading trades...</LoadingState>
          ) : matchingTrades.length === 0 ? (
            <EmptyState>
              <p>No matching trades found in the last 30 days</p>
            </EmptyState>
          ) : (
            <TradesTable>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Side</th>
                  <th>Price (USDC)</th>
                  <th>Quantity</th>
                  {/* <th>Counterparty</th> */}
                  <th>Realized PnL</th>
                  <th>Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {displayedTrades.map((trade) => (
                  <TableRow key={trade.id}>
                    <td>
                      <DateTimeCell timestamp={trade.timestamp} />
                    </td>
                    <td>
                      <TypeBadge $type={trade.positionType}>{trade.positionType}</TypeBadge>
                    </td>
                    <td>{formatPrice(trade.pricePerDay)}</td>
                    <td>{trade.quantity}</td>
                    {/* <td>
                      {trade.counterparty ? (
                        <Tooltip title={trade.counterparty}>
                          <CounterpartyAddress>{truncateAddress(trade.counterparty)}</CounterpartyAddress>
                        </Tooltip>
                      ) : (
                        <CounterpartyAddress>Multiple</CounterpartyAddress>
                      )}
                    </td> */}
                    <td>
                      <PnLCell
                        $isPositive={trade.realizedPnl >= 0}
                        $isZero={trade.realizedPnl === 0}
                      >
                        {formatPnl(trade.realizedPnl)}
                      </PnLCell>
                    </td>
                    <td>
                      <TxLink
                        href={getTxUrl(trade.transactionHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {trade.transactionHash.slice(0, 6)}...{trade.transactionHash.slice(-4)}
                      </TxLink>
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </TradesTable>
          )}
        </TradesTableContainer>

        {!isLoading && (
          <LoadMoreButton
            hasMore={visibleCount < matchingTrades.length}
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          />
        )}
      </TradesModalCard>
    </Modal>
  );
};

const TradesModalCard = styled(ModalCard)`
  max-width: 1000px;

  h2 {
    font-size: 2rem;
    font-weight: 500;
    padding-bottom: 1rem;
    margin-bottom: 1rem;

    @media (max-width: 600px) {
      font-size: 1.5rem;
    }
  }
`;

const SelectionSummary = styled("div")`
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  padding: 0.75rem 1rem;
  background: ${tokens.overlay.white05};
  border-radius: 8px;
  margin-bottom: 1rem;
`;

const SummaryItem = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

const SummaryLabel = styled("span")`
  color: ${tokens.text.secondary};
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const SummaryValue = styled("span")`
  color: ${tokens.text.onDark};
  font-size: 0.875rem;
  font-weight: 600;
`;

const TradesTableContainer = styled("div")`
  width: 100%;
  overflow-x: auto;
  margin-top: 0.5rem;

  &::-webkit-scrollbar {
    height: 8px;
  }

  &::-webkit-scrollbar-track {
    background: ${tokens.overlay.white10};
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: ${tokens.overlay.white30};
    border-radius: 4px;
  }
`;

const TradesTable = styled("table")`
  width: 100%;
  border-collapse: collapse;
  min-width: 800px;

  th {
    text-align: left;
    padding: 0.75rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: ${tokens.text.secondary};
    border-bottom: 1px solid ${tokens.overlay.white20};
    white-space: nowrap;
  }

  td {
    padding: 0.75rem 0.5rem;
    font-size: 0.875rem;
    color: ${tokens.text.onDark};
    border-bottom: 1px solid ${tokens.overlay.white10};
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:hover {
    background-color: ${tokens.overlay.white05};
  }
`;

const TableRow = styled("tr")``;

const TypeBadge = styled("span")<{ $type: string }>`
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background-color: ${(props) =>
    props.$type === "Long" ? tokens.trading.longRowBg : tokens.trading.shortRowBg};
  color: ${(props) => (props.$type === "Long" ? tokens.trading.long : tokens.trading.short)};
`;

const CounterpartyAddress = styled("span")`
  font-family: monospace;
  font-size: 0.8125rem;
  color: ${tokens.text.secondary};
  cursor: help;
`;

const TxLink = styled("a")`
  color: ${tokens.trading.info};
  text-decoration: none;
  font-family: monospace;
  font-size: 0.8rem;

  &:hover {
    text-decoration: underline;
  }
`;

const PnLCell = styled("span")<{ $isPositive: boolean; $isZero: boolean }>`
  color: ${(props) =>
    props.$isZero ? tokens.text.onDark : props.$isPositive ? tokens.trading.long : tokens.trading.short};
  font-weight: 600;
`;

const EmptyState = styled("div")`
  text-align: center;
  padding: 2rem;
  color: ${tokens.text.muted};

  p {
    margin: 0;
    font-size: 0.875rem;
  }
`;

const LoadingState = styled("div")`
  text-align: center;
  padding: 2rem;
  color: ${tokens.text.muted};
  font-size: 0.875rem;
`;
