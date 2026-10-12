import { styled } from "next-yak";
import { useEffect, useMemo, useState } from "react";
import { tokens } from "../../../styles/tokens";
import { Modal } from "../../Modal";
import { ModalCard, ModalCloseButton, ModalCloseIcon } from "../../Modal.styled";
import { DateTimeCell } from "../../DateTimeCell";
import { LoadMoreButton } from "../../LoadMoreButton";
import { useHistoricalPositions } from "../../../hooks/data/useHistoricalPositions";
import { useSessionTrades } from "../../../hooks/data/useSessionTrades";
import type { PositionBookPosition } from "../../../hooks/data/getUserFuturesPositions";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
import { getTxUrl } from "../../../lib/indexer";
import type { ContractMode } from "../../../types/types";

export interface FuturesTradesModalSelection {
  pricePerDay: bigint;
  expirationAt: string;
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
  /// Null on the perpetual path, which has no fill to point at.
  transactionHash: `0x${string}` | null;
}

// Normalized shape that unifies active (PositionBookPosition) and historical
// (HistoricalPosition) positions so they can be processed by the same grouping
// pipeline. Direction is collapsed into a single `isLong` flag and the
// row-level pnl is flattened (active rows have no realized pnl yet).
interface NormalizedPosition {
  id: string;
  timestamp: string;
  expirationAt: string;
  pricePerDay: bigint;
  isLong: boolean;
  isActive: boolean;
  pnl: number;
}

const _truncateAddress = (address: string) => {
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

  // Which sessions the selected row stands for. Matching is on session-level
  // fields alone, so it does not need the fills — which is what lets them be
  // fetched afterwards, for these sessions only.
  const matchingPositions = useMemo<NormalizedPosition[]>(() => {
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
          timestamp: p.timestamp,
          expirationAt: p.expirationAt,
          pricePerDay: isLong ? p.buyPricePerDay : p.sellPricePerDay,
          isLong,
          isActive: p.isActive,
          pnl: 0,
        };
      }),
      ...historical.map<NormalizedPosition>((p) => ({
        id: p.id,
        timestamp: p.timestamp,
        expirationAt: p.expirationAt,
        pricePerDay: p.pricePerDay,
        isLong: p.isLong,
        isActive: p.isActive,
        pnl: p.pnl,
      })),
    ];

    return normalized.filter((p) => {
      if (p.expirationAt !== selection.expirationAt) return false;
      const positionType: "Long" | "Short" = p.isLong ? "Long" : "Short";
      if (positionType !== selection.positionType) return false;
      return p.pricePerDay === selection.pricePerDay;
    });
  }, [selection, historicalPositionsQuery.data?.data, activePositions, participantAddress]);

  // The only place in the UI that renders fills, so the only place that fetches
  // them. Scoped to the sessions behind the row that was clicked.
  const sessionTradesQuery = useSessionTrades(
    matchingPositions.map((p) => p.id),
    open && contractMode === "futures",
  );

  const matchingTrades = useMemo<TradeRow[]>(() => {
    if (!selection) return [];

    // Futures mode: render one row per real on-chain Trade rather than
    // synthesising rows from positions.
    if (contractMode === "futures") {
      const bySession = sessionTradesQuery.data;
      const seen = new Set<string>();
      const rows: TradeRow[] = [];
      for (const p of matchingPositions) {
        for (const trade of bySession?.get(p.id) ?? []) {
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
    // outside futures, but the `contractMode` prop allows for it). One row per
    // session, since without fills there is nothing finer to group by.
    const rows = matchingPositions.map<TradeRow>((p) => ({
      id: p.id,
      timestamp: p.timestamp,
      pricePerDay: p.pricePerDay,
      positionType: p.isLong ? "Long" : "Short",
      realizedPnl: p.pnl,
      counterparty: null,
      quantity: 1,
      hasActive: p.isActive,
      transactionHash: null,
    }));
    rows.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    return rows;
  }, [selection, matchingPositions, sessionTradesQuery.data, contractMode]);

  const formatPrice = (price: bigint) => (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  const formatPnl = (pnlRaw: number) => {
    const value = pnlRaw / PAYMENT_TOKEN_SCALE_NUM;
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)} USDC`;
  };

  // Client-side "Load More" paging (the full set is already in memory).
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Reset to the first page whenever the modal opens or the selection changes.
  // `open` and `selection` are triggers rather than values read in the body.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [open, selection]);

  const displayedTrades = matchingTrades.slice(0, visibleCount);

  const isLoading =
    open && (historicalPositionsQuery.isLoading || sessionTradesQuery.isLoading);

  return (
    <Modal open={open} onClose={onClose}>
      <TradesModalCard>
        <ModalCloseButton className="close" onClick={onClose}>
          <ModalCloseIcon />
        </ModalCloseButton>

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
                      {trade.transactionHash ? (
                        <TxLink
                          href={getTxUrl(trade.transactionHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {trade.transactionHash.slice(0, 6)}...{trade.transactionHash.slice(-4)}
                        </TxLink>
                      ) : (
                        "—"
                      )}
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
  width: calc(100% - 2rem);
  max-width: 1000px;
  max-height: calc(100dvh - 6rem);
  overflow: hidden;
  box-sizing: border-box;

  @media (max-width: 600px) {
    max-height: calc(100dvh - 2rem);
    margin: 1rem auto;
  }

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

const _SelectionSummary = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  padding: 0.75rem 1rem;
  background: ${tokens.overlay.white05};
  border-radius: 8px;
  margin-bottom: 1rem;
`;

const _SummaryItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

const _SummaryLabel = styled.span`
  color: ${tokens.text.secondary};
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const _SummaryValue = styled.span`
  color: ${tokens.text.onDark};
  font-size: 0.875rem;
  font-weight: 600;
`;

const TradesTableContainer = styled.div`
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  overflow: auto;
  margin-top: 0.5rem;

  &::-webkit-scrollbar {
    width: 8px;
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

const TradesTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  min-width: 800px;

  th {
    position: sticky;
    top: 0;
    z-index: 1;
    text-align: left;
    padding: 0.75rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: ${tokens.text.secondary};
    background: ${tokens.modal.bg};
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

const TableRow = styled.tr``;

const TypeBadge = styled.span<{ $type: string }>`
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background-color: ${(props) =>
    props.$type === "Long" ? tokens.trading.longRowBg : tokens.trading.shortRowBg};
  color: ${(props) => (props.$type === "Long" ? tokens.trading.long : tokens.trading.short)};
`;

const _CounterpartyAddress = styled.span`
  font-family: monospace;
  font-size: 0.8125rem;
  color: ${tokens.text.secondary};
  cursor: help;
`;

const TxLink = styled.a`
  color: ${tokens.trading.info};
  text-decoration: none;
  font-family: monospace;
  font-size: 0.8rem;

  &:hover {
    text-decoration: underline;
  }
`;

const PnLCell = styled.span<{ $isPositive: boolean; $isZero: boolean }>`
  color: ${(props) =>
    props.$isZero ? tokens.text.onDark : props.$isPositive ? tokens.trading.long : tokens.trading.short};
  font-weight: 600;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 2rem;
  color: ${tokens.text.muted};

  p {
    margin: 0;
    font-size: 0.875rem;
  }
`;

const LoadingState = styled.div`
  text-align: center;
  padding: 2rem;
  color: ${tokens.text.muted};
  font-size: 0.875rem;
`;
