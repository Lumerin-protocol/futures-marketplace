import { tokens } from "../../../styles/tokens";
import styled from "@mui/material/styles/styled";
import { SmallWidget } from "../../Cards/Cards.styled";
import type { HistoricalPosition } from "../../../hooks/data/useHistoricalPositions";
import { DateTimeCell } from "../../DateTimeCell";

interface HistoricalPositionsListWidgetProps {
  positions: HistoricalPosition[];
  isLoading?: boolean;
  participantAddress?: `0x${string}`;
}

export const HistoricalPositionsListWidget = ({
  positions,
  isLoading,
  participantAddress,
}: HistoricalPositionsListWidgetProps) => {
  const getPositionType = (position: HistoricalPosition) => {
    if (!participantAddress) return "Unknown";
    return position.buyer.address.toLowerCase() === participantAddress.toLowerCase() ? "Long" : "Short";
  };

  const getPriceForPosition = (position: HistoricalPosition) => {
    const positionType = getPositionType(position);
    return positionType === "Long" ? position.buyPricePerDay : position.sellPricePerDay;
  };

  const getPnlForPosition = (position: HistoricalPosition) => {
    const positionType = getPositionType(position);
    return positionType === "Long" ? position.buyerPnl : position.sellerPnl;
  };

  const formatPrice = (price: bigint) => {
    return (Number(price) / 1e6).toFixed(2);
  };

  const formatPnl = (pnl: number) => {
    const pnlValue = pnl / 1e6;
    return `${pnlValue.toFixed(2)}`;
  };


  // Group positions by price (based on position type), deliveryAt, and position type
  const groupedPositions = positions.reduce(
    (acc, position) => {
      const positionType = getPositionType(position);
      const pricePerDay = getPriceForPosition(position);
      const pnl = getPnlForPosition(position);
      const key = `${pricePerDay}-${position.deliveryAt}-${positionType}`;

      if (!acc[key]) {
        acc[key] = {
          pricePerDay: pricePerDay,
          deliveryAt: position.deliveryAt,
          positionType: positionType,
          amount: 0,
          realizedPnl: 0,
          closedAt: position.closedAt,
          timestamp: position.timestamp,
        };
      }

      acc[key].amount += 1;
      acc[key].realizedPnl += pnl;

      return acc;
    },
    {} as Record<
      string,
      {
        pricePerDay: bigint;
        deliveryAt: string;
        positionType: string;
        amount: number;
        realizedPnl: number;
        closedAt: string | null;
        timestamp: string;
      }
    >,
  );

  const groupedPositionsArray = Object.values(groupedPositions);

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
              <th>Price (USDC)</th>
              <th>Quantity</th>
              <th>Realized PnL (USDC)</th>
              <th>Created</th>
              <th>Closed</th>
            </tr>
          </thead>
          <tbody>
            {groupedPositionsArray.map((groupedPosition, index) => (
              <TableRow
                key={`${groupedPosition.pricePerDay}-${groupedPosition.deliveryAt}-${groupedPosition.positionType}-${index}`}
              >
                <td><DateTimeCell timestamp={groupedPosition.deliveryAt} /></td>
                <td>
                  <TypeBadge $type={groupedPosition.positionType}>{groupedPosition.positionType}</TypeBadge>
                </td>
                <td>{formatPrice(groupedPosition.pricePerDay)}</td>
                <td>{groupedPosition.amount}</td>
                <td>
                  <PnLCell $isPositive={groupedPosition.realizedPnl >= 0} $isZero={groupedPosition.realizedPnl === 0}>
                    {formatPnl(groupedPosition.realizedPnl)}
                  </PnLCell>
                </td>
                <td><DateTimeCell timestamp={groupedPosition.timestamp} /></td>
                <td>{groupedPosition.closedAt ? <DateTimeCell timestamp={groupedPosition.closedAt} /> : "-"}</td>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableContainer>

      {groupedPositionsArray.length === 0 && (
        <EmptyState>
          <p>No historical positions found in the last 30 days</p>
        </EmptyState>
      )}
    </PositionsContainer>
  );
};

const PositionsContainer = styled(SmallWidget)`
  width: 100%;
  padding: 1.5rem;
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
    
    &:first-child {
      width: 130px;
      min-width: 130px;
    }
  }
  
  td {
    padding: 0.75rem 0.5rem;
    font-size: 0.875rem;
    color: ${tokens.text.onDark};
    border-bottom: 1px solid ${tokens.overlay.white05};
    
    &:first-child {
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

const EmptyState = styled("div")`
  text-align: center;
  padding: 2rem;
  color: ${tokens.text.muted};
  
  p {
    margin: 0;
    font-size: 0.875rem;
  }
`;
