import { tokens } from "../../../styles/tokens";
import styled from "@mui/material/styles/styled";
import { SmallWidget } from "../../Cards/Cards.styled";
import type { HistoricalOrder } from "../../../hooks/data/useHistoricalOrders";
import { DateTimeCell } from "../../DateTimeCell";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
import { LoadMoreButton } from "../../LoadMoreButton";
import { LiquidationChip, formatLiquidatedQty, LIQUIDATION_ROW_BG } from "../../../lib/liquidation";

interface HistoricalOrdersListWidgetProps {
  orders: HistoricalOrder[];
  isLoading?: boolean;
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onLoadMore?: () => void;
}

export const HistoricalOrdersListWidget = ({
  orders,
  isLoading,
  hasMore = false,
  isFetchingMore,
  onLoadMore,
}: HistoricalOrdersListWidgetProps) => {
  const formatPrice = (price: bigint) => {
    return (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  };

  const formatStatus = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "Active";
      case "PARTIAL":
        return "Partial";
      case "FILLED":
        return "Filled";
      case "PARTIALLY_FILLED":
        return "Partially Filled";
      case "CANCELLED":
        return "Cancelled";
      case "LIQUIDATED":
        return "Liquidated";
      default:
        return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return tokens.trading.long;
      case "PARTIAL":
        return tokens.trading.warning;
      case "FILLED":
        return tokens.text.muted;
      case "PARTIALLY_FILLED":
        return tokens.text.muted;
      case "CANCELLED":
        return tokens.trading.short;
      case "LIQUIDATED":
        return tokens.status.error;
      default:
        return tokens.text.muted;
    }
  };

  if (isLoading) {
    return (
      <OrdersContainer>
        <h3>Historical Orders</h3>
        <div style={{ textAlign: "center", padding: "2rem", color: tokens.text.muted }}>
          <p>Loading historical orders...</p>
        </div>
      </OrdersContainer>
    );
  }

  return (
    <OrdersContainer>
      <h3>Historical Orders</h3>

      <TableContainer>
        <Table>
          <thead>
            <tr>
              <th>Contract Expiration</th>
              <th>Side</th>
              <th>Price (USDC)</th>
              <th>Quantity</th>
              <th>Status</th>
              <th>Created</th>
              <th>Closed</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <TableRow
                key={order.id}
                style={order.wasLiquidated ? { backgroundColor: LIQUIDATION_ROW_BG } : undefined}
              >
                <td><DateTimeCell timestamp={order.expirationAt} /></td>
                <td>
                  <TypeBadge $type={order.isBuy ? "Long" : "Short"}>
                    {order.isBuy ? "Long" : "Short"}
                  </TypeBadge>
                </td>
                <td>{formatPrice(order.pricePerDay)}</td>
                <td>{order.originalQuantity}</td>
                <td>
                  {order.wasLiquidated ? (
                    <LiquidationChip
                      title={formatLiquidatedQty(
                        order.liquidatedQuantity,
                        order.originalQuantity - order.liquidatedQuantity,
                      )}
                    >
                      {formatLiquidatedQty(
                        order.liquidatedQuantity,
                        order.originalQuantity - order.liquidatedQuantity,
                      )}
                    </LiquidationChip>
                  ) : (
                    <StatusBadge $status={order.status} $color={getStatusColor(order.status)}>
                      {formatStatus(order.status)}
                    </StatusBadge>
                  )}
                </td>
                <td><DateTimeCell timestamp={order.timestamp} /></td>
                <td>{order.closedAt ? <DateTimeCell timestamp={order.closedAt} /> : "-"}</td>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableContainer>

      {orders.length === 0 ? (
        <EmptyState>
          <p>No historical orders found</p>
        </EmptyState>
      ) : (
        <LoadMoreButton
          hasMore={hasMore}
          isLoading={isFetchingMore}
          onClick={() => onLoadMore?.()}
        />
      )}
    </OrdersContainer>
  );
};

const OrdersContainer = styled(SmallWidget)`
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

const StatusBadge = styled("span")<{ $status: string; $color: string }>`
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background-color: ${(props) => `${props.$color}33`};
  color: ${(props) => props.$color};
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
