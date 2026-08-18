import { tokens } from "../../../styles/tokens";
import styled from "@mui/material/styles/styled";
import { useMemo, useState } from "react";
import type { HistoricalPosition } from "../../../hooks/data/useHistoricalPositions";
import { DateTimeCell } from "../../DateTimeCell";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
import { FuturesTradesModal, type FuturesTradesModalSelection } from "./FuturesTradesModal";
import { LoadMoreButton } from "../../LoadMoreButton";
import { LiquidationChip, formatLiquidatedQty, LIQUIDATION_ROW_BG } from "../../../lib/liquidation";

interface HistoricalPositionsListWidgetProps {
  positions: HistoricalPosition[];
  isLoading?: boolean;
  participantAddress?: `0x${string}`;
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onLoadMore?: () => void;
}

export const HistoricalPositionsListWidget = ({
  positions,
  isLoading,
  participantAddress,
  hasMore = false,
  isFetchingMore,
  onLoadMore,
}: HistoricalPositionsListWidgetProps) => {
  const [tradesSelection, setTradesSelection] = useState<FuturesTradesModalSelection | null>(null);

  const formatPrice = (price: bigint) => {
    return (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  };

  const formatPnl = (pnl: number) => {
    const pnlValue = pnl / PAYMENT_TOKEN_SCALE_NUM;
    return `${pnlValue.toFixed(2)}`;
  };

  // Each `HistoricalPosition` is one closed `PositionSession` and is treated
  // as a distinct row — no grouping. Sort most-recent first using closedAt
  // when available, falling back to the session's opening timestamp.
  const sortedPositions = useMemo(() => {
    const sortKey = (p: HistoricalPosition) => Number(p.closedAt ?? p.timestamp);
    return [...positions].sort((a, b) => sortKey(b) - sortKey(a));
  }, [positions]);

  if (isLoading) {
    return (
      <PositionsContainer>
        <h3>Historical Positions</h3>
        <div style={{ textAlign: "center", padding: "2rem", color: tokens.text.muted }}>
          <p>Loading historical positions...</p>
        </div>
      </PositionsContainer>
    );
  }

  return (
    <PositionsContainer>
      <h3>Historical Positions</h3>

      <TableContainer>
        <Table>
          <thead>
            <tr>
              <th>Contract Expiration</th>
              <th>Side</th>
              <th>Close Reason</th>
              <th>Price (USDC)</th>
              <th>Max Quantity</th>
              <th>Exit Price (USDC)</th>
              <th>Realized PnL (USDC)</th>
              <th>Created</th>
              <th>Closed</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedPositions.map((position) => {
              const positionType: "Long" | "Short" = position.isLong ? "Long" : "Short";
              const maxQuantity = Math.abs(position.maxQuantity);
              const wasLiquidated = position.liquidatedQuantity > 0;
              return (
                <TableRow
                  key={position.id}
                  style={wasLiquidated ? { backgroundColor: LIQUIDATION_ROW_BG } : undefined}
                >
                  <td><DateTimeCell timestamp={position.expirationAt} /></td>
                  <td>
                    <TypeBadge $type={positionType}>{positionType}</TypeBadge>
                  </td>
                  <td>
                    {wasLiquidated ? (
                      <LiquidationChip
                        title={formatLiquidatedQty(
                          position.liquidatedQuantity,
                          maxQuantity - position.liquidatedQuantity,
                        )}
                      >
                        {formatLiquidatedQty(
                          position.liquidatedQuantity,
                          maxQuantity - position.liquidatedQuantity,
                        )}
                      </LiquidationChip>
                    ) : position.settlementPrice !== null ? (
                      <span style={{ color: tokens.text.muted }}>Settled</span>
                    ) : (
                      <span style={{ color: tokens.text.muted }}>Closed</span>
                    )}
                  </td>
                  <td>{formatPrice(position.pricePerDay)}</td>
                  <td>{maxQuantity}</td>
                  <td>
                    {position.settlementPrice !== null ? (
                      formatPrice(position.settlementPrice)
                    ) : (
                      <span style={{ color: tokens.text.muted }}>—</span>
                    )}
                  </td>
                  <td>
                    <PnLCell $isPositive={position.pnl >= 0} $isZero={position.pnl === 0}>
                      {formatPnl(position.pnl)}
                    </PnLCell>
                  </td>
                  <td><DateTimeCell timestamp={position.timestamp} /></td>
                  <td>{position.closedAt ? <DateTimeCell timestamp={position.closedAt} /> : "-"}</td>
                  <td>
                    <TradesButton
                      onClick={() =>
                        setTradesSelection({
                          pricePerDay: position.pricePerDay,
                          expirationAt: position.expirationAt,
                          positionType,
                        })
                      }
                      title="View matching trades from the last 30 days"
                    >
                      Trades
                    </TradesButton>
                  </td>
                </TableRow>
              );
            })}
          </tbody>
        </Table>
      </TableContainer>

      {sortedPositions.length === 0 ? (
        <EmptyState>
          <p>No historical positions found</p>
        </EmptyState>
      ) : (
        <LoadMoreButton
          hasMore={hasMore}
          isLoading={isFetchingMore}
          onClick={() => onLoadMore?.()}
        />
      )}

      <FuturesTradesModal
        open={tradesSelection !== null}
        onClose={() => setTradesSelection(null)}
        selection={tradesSelection}
        participantAddress={participantAddress}
        contractMode="futures"
      />
    </PositionsContainer>
  );
};

// Flat section rather than a card: the tab widget already draws the border and
// pads its content, so a SmallWidget here would nest a second card inside it.
const PositionsContainer = styled("div")`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  
  h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: ${tokens.text.onDark};
  }
`;

const TableContainer = styled("div")`
  width: 100%;
  overflow-x: auto;
  
  &::-webkit-scrollbar {
    height: 4px;
  }
  
  &::-webkit-scrollbar-track {
    background: ${tokens.overlay.white10};
    border-radius: 2px;
  }
  
  &::-webkit-scrollbar-thumb {
    background: ${tokens.overlay.white30};
    border-radius: 2px;
  }
`;

const Table = styled("table")`
  width: 100%;
  border-collapse: collapse;
  min-width: 300px;
  
  th {
    text-align: left;
    padding: 0.75rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: ${tokens.text.secondary};
    border-bottom: 1px solid ${tokens.overlay.white10};
    white-space: nowrap;
    
    &:first-of-type {
      width: 130px;
      min-width: 130px;
    }
  }
  
  td {
    padding: 0.75rem 0.5rem;
    font-size: 0.875rem;
    color: ${tokens.text.onDark};
    border-bottom: 1px solid ${tokens.overlay.white05};
    
    &:first-of-type {
      width: 130px;
      min-width: 130px;
    }
  }
`;

const TableRow = styled("tr")`
  &:hover {
    background-color: ${tokens.overlay.white02};
  }
  
  &:last-child td {
    border-bottom: none;
  }
`;

const TypeBadge = styled("span")<{ $type: string }>`
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background-color: ${(props) => (props.$type === "Long" ? tokens.trading.longRowBg : tokens.trading.shortRowBg)};
  color: ${(props) => (props.$type === "Long" ? tokens.trading.long : tokens.trading.short)};
`;

const PnLCell = styled("span")<{ $isPositive: boolean; $isZero: boolean }>`
  color: ${(props) => (props.$isZero ? "white" : props.$isPositive ? tokens.trading.long : tokens.trading.short)};
  font-weight: 600;
`;

const TradesButton = styled("button")`
  padding: 0.5rem 0.875rem;
  background: ${tokens.neutralButton.bg};
  color: ${tokens.text.onDark};
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.1s ease;

  &:hover:not(:disabled) {
    background: ${tokens.neutralButton.hover};
    transform: translateY(-1px);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    background: ${tokens.text.muted};
    cursor: not-allowed;
    opacity: 0.6;
  }
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
