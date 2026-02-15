import { useState, useMemo } from "react";
import styled from "@mui/material/styles/styled";
import { SmallWidget } from "../../Cards/Cards.styled";
import { TabSwitch } from "../../TabSwitch";
import type { ParticipantOrder } from "../../../hooks/data/useParticipant";
import type { PositionBookPosition } from "../../../hooks/data/usePositionBook";
import { useHistoricalOrders } from "../../../hooks/data/useHistoricalOrders";
import type { AccountBalance } from "../../../types/types";
import { useUserPerpsOrders } from "../../../hooks/data/perps/useUserPerpsOrders";
import { useCancelPerpsOrder } from "../../../hooks/data/perps/useCancelPerpsOrder";
import { useQueryClient } from "@tanstack/react-query";
import { USER_PERPS_ORDERS_QK } from "../../../hooks/data/perps/useUserPerpsOrders";
import { useUserPositionSnapshots } from "../../../hooks/data/perps/useUserPositionSnapshots";
import { useUserPerpsTrades } from "../../../hooks/data/perps/useUserPerpsTrades";

type TabType = "OPEN_ORDERS" | "POSITIONS" | "TRADES" | "ORDERS_HISTORY";

interface PerpsOrdersPositionsTabWidgetProps {
  orders: ParticipantOrder[];
  positions: PositionBookPosition[];
  ordersLoading?: boolean;
  positionsLoading?: boolean;
  participantAddress?: `0x${string}`;
  onClosePosition?: (price: string, amount: number, isBuy: boolean) => void;
  participantData?: any;
  minMargin?: bigint | null;
  accountBalance?: AccountBalance;
}

export const PerpsOrdersPositionsTabWidget = ({
  orders,
  positions,
  ordersLoading,
  positionsLoading,
  participantAddress,
  onClosePosition,
  participantData,
  minMargin,
  accountBalance,
}: PerpsOrdersPositionsTabWidgetProps) => {
  const [activeTab, setActiveTab] = useState<TabType>("OPEN_ORDERS");
  const queryClient = useQueryClient();
  const { cancelOrderAsync, isPending: isCancelling } = useCancelPerpsOrder();

  // Fetch perps orders for Open Orders tab
  const perpsOrdersQuery = useUserPerpsOrders(
    participantAddress
  );

  // Fetch historical orders for Orders History tab
  const historicalOrdersQuery = useHistoricalOrders(
    participantAddress,
    activeTab === "ORDERS_HISTORY"
  );

  // Fetch position snapshots for Positions tab
  const positionSnapshotsQuery = useUserPositionSnapshots(
    participantAddress,
    { refetch: activeTab === "POSITIONS" }
  );

  // Fetch trades for Trades tab
  const tradesQuery = useUserPerpsTrades(
    participantAddress,
    { refetch: activeTab === "TRADES" }
  );

  // Handle cancel order
  const handleCancelOrder = async (orderId: string) => {
    try {
      await cancelOrderAsync({ orderId: orderId as `0x${string}` });
      // Invalidate queries to refetch data
      queryClient.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, participantAddress] });
    } catch (error) {
      console.error("Failed to cancel order:", error);
    }
  };

  // Count perps orders (only open/active orders)
  const ordersCount = useMemo(() => {
    const perpsOrders = perpsOrdersQuery.data?.data?.orders || [];
    return perpsOrders.filter((order) => order.status === "ACTIVE").length;
  }, [perpsOrdersQuery.data?.data?.orders]);

  // Count unique positions
  const positionsCount = useMemo(() => {
    const snapshots = positionSnapshotsQuery.data?.positionSnapshots || [];
    // Count positions that have non-zero net quantity (open positions)
    const openPositions = snapshots.filter((snapshot) => snapshot.netQuantityAfter !== 0n);
    // Get latest snapshot for count
    return openPositions.length > 0 ? 1 : 0;
  }, [positionSnapshotsQuery.data?.positionSnapshots]);

  // Count trades
  const tradesCount = useMemo(() => {
    const trades = tradesQuery.data?.trades || [];
    return trades.length;
  }, [tradesQuery.data?.trades]);

  // Count historical orders
  const ordersHistoryCount = useMemo(() => {
    if (activeTab !== "ORDERS_HISTORY") return 0;
    const historicalOrders = historicalOrdersQuery.data?.data || [];
    const unique = new Set<string>();
    historicalOrders.forEach((order) => {
      unique.add(`${order.pricePerDay.toString()}`);
    });
    return unique.size;
  }, [activeTab, historicalOrdersQuery.data?.data]);

  return (
    <TabContainer>
      <Header>
        <TabSwitch
          values={[
            { text: "Open Orders", value: "OPEN_ORDERS", count: ordersCount },
            { text: "Positions", value: "POSITIONS", count: positionsCount },
            { text: "Trades", value: "TRADES", count: tradesCount },
            { text: "Orders History", value: "ORDERS_HISTORY", count: ordersHistoryCount },
          ]}
          value={activeTab}
          setValue={setActiveTab}
        />
      </Header>

      <Content>
        {activeTab === "OPEN_ORDERS" && (
          <OrdersWrapper>
            <PerpsOpenOrdersTable
              orders={perpsOrdersQuery.data?.data?.orders || []}
              isLoading={perpsOrdersQuery.isLoading}
              onCancelOrder={handleCancelOrder}
              isCancelling={isCancelling}
            />
          </OrdersWrapper>
        )}
        {activeTab === "POSITIONS" && (
          <PositionsWrapper>
            <PerpsPositionsTable
              positionSnapshots={positionSnapshotsQuery.data?.positionSnapshots || []}
              isLoading={positionSnapshotsQuery.isLoading}
            />
          </PositionsWrapper>
        )}
        {activeTab === "TRADES" && (
          <TradesWrapper>
            <PerpsTradesTable
              trades={tradesQuery.data?.trades || []}
              isLoading={tradesQuery.isLoading}
              userAddress={participantAddress}
            />
          </TradesWrapper>
        )}
        {activeTab === "ORDERS_HISTORY" && (
          <OrdersWrapper>
            {/* HistoricalOrdersListWidget will be added here */}
            <PlaceholderText>Orders History content</PlaceholderText>
          </OrdersWrapper>
        )}
      </Content>
    </TabContainer>
  );
};

// Perps Open Orders Table Component
interface PerpsOpenOrdersTableProps {
  orders: Array<{
    id: string;
    price: bigint;
    quantity: bigint;
    originalQuantity: bigint;
    filledQuantity: bigint;
    isBuy: boolean;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
  isLoading?: boolean;
  onCancelOrder: (orderId: string) => Promise<void>;
  isCancelling: boolean;
}

const PerpsOpenOrdersTable = ({ orders, isLoading, onCancelOrder, isCancelling }: PerpsOpenOrdersTableProps) => {
  const formatPrice = (price: bigint) => {
    return (Number(price) / 1e6).toFixed(2); // Convert from wei to USDC
  };

  const formatQuantity = (quantity: bigint) => {
    if(quantity === 0n) {
      return "0";
    }
    return (Number(quantity) / 1e6).toFixed(6);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(Number(dateString) * 1000);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatStatus = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "Active";
      case "FILLED":
        return "Filled";
      case "CANCELLED":
        return "Cancelled";
      default:
        return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "#22c55e";
      case "FILLED":
        return "#6b7280";
      case "CANCELLED":
        return "#ef4444";
      default:
        return "#6b7280";
    }
  };

  // Filter to show only active orders
  const activeOrders = orders.filter(
    (order) => order.status === "ACTIVE"
  );

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", color: "#6b7280" }}>
        <p>Loading orders...</p>
      </div>
    );
  }

  if (activeOrders.length === 0) {
    return (
      <EmptyState>
        <p>No open orders found</p>
      </EmptyState>
    );
  }

  return (
    <TableContainer>
      <Table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Price (USDC)</th>
            <th>Quantity</th>
            <th>Filled</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {activeOrders.map((order) => (
            <TableRow key={order.id}>
              <td>
                <TypeBadge $type={order.isBuy ? "Long" : "Short"}>
                  {order.isBuy ? "Long" : "Short"}
                </TypeBadge>
              </td>
              <td>{formatPrice(order.price)}</td>
              <td>{formatQuantity(order.quantity)}</td>
              <td>
                {formatQuantity(order.filledQuantity)} / {formatQuantity(order.originalQuantity)}
              </td>
              <td>
                <StatusBadge $status={order.status} $color={getStatusColor(order.status)}>
                  {formatStatus(order.status)}
                </StatusBadge>
              </td>
              <td>{formatDate(order.createdAt)}</td>
              <td>
                <ActionButtons>
                  <CancelButton 
                    onClick={() => onCancelOrder(order.id)}
                    disabled={isCancelling}
                  >
                    {isCancelling ? "Cancelling..." : "Cancel"}
                  </CancelButton>
                </ActionButtons>
              </td>
            </TableRow>
          ))}
        </tbody>
      </Table>
    </TableContainer>
  );
};

// Perps Positions Table Component
interface PerpsPositionsTableProps {
  positionSnapshots: Array<{
    id: string;
    aggregatedEntryPriceAfter: bigint;
    blockNumber: number;
    netQuantityAfter: bigint;
    timestamp: string;
    tradePrice: bigint;
    tradeQuantity: bigint;
    transactionHash: string;
    user: {
      id: string;
    };
  }>;
  isLoading?: boolean;
}

const PerpsPositionsTable = ({ positionSnapshots, isLoading }: PerpsPositionsTableProps) => {
  const formatPrice = (price: bigint) => {
    return (Number(price) / 1e6).toFixed(2); // Convert from wei to USDC
  };

  const formatQuantity = (quantity: bigint) => {
    if(quantity === 0n) {
      return "0";
    }
    const absQuantity = quantity < 0n ? -quantity : quantity;
    return (Number(absQuantity) / 1e6).toFixed(6);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(Number(dateString) * 1000);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Get the latest snapshot (most recent position state)
  const latestSnapshot = positionSnapshots.length > 0 
    ? positionSnapshots.reduce((latest, current) => 
        Number(current.timestamp) > Number(latest.timestamp) ? current : latest
      )
    : null;

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", color: "#6b7280" }}>
        <p>Loading positions...</p>
      </div>
    );
  }

  if (!latestSnapshot || latestSnapshot.netQuantityAfter === 0n) {
    return (
      <EmptyState>
        <p>No open positions found</p>
      </EmptyState>
    );
  }

  const isLong = latestSnapshot.netQuantityAfter > 0n;
  const unrealizedPnL = 0; // Would need current market price to calculate this

  return (
    <TableContainer>
      <Table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Size</th>
            <th>Entry Price (USDC)</th>
            <th>Current Price (USDC)</th>
            <th>Unrealized PnL</th>
            <th>Last Updated</th>
          </tr>
        </thead>
        <tbody>
          <TableRow>
            <td>
              <TypeBadge $type={isLong ? "Long" : "Short"}>
                {isLong ? "Long" : "Short"}
              </TypeBadge>
            </td>
            <td>{formatQuantity(latestSnapshot.netQuantityAfter)}</td>
            <td>{formatPrice(latestSnapshot.aggregatedEntryPriceAfter)}</td>
            <td>-</td>
            <td>
              <PnLText $isPositive={unrealizedPnL >= 0}>
                {unrealizedPnL >= 0 ? "+" : ""}{unrealizedPnL.toFixed(2)} USDC
              </PnLText>
            </td>
            <td>{formatDate(latestSnapshot.timestamp)}</td>
          </TableRow>
        </tbody>
      </Table>
    </TableContainer>
  );
};

// Perps Trades Table Component
interface PerpsTradesTableProps {
  trades: Array<{
    id: string;
    blockNumber: number;
    makerOrderId: string;
    price: bigint;
    quantity: bigint;
    timestamp: string;
    transactionHash: string;
    volume: bigint;
    seller: {
      id: string;
    };
    buyer: {
      id: string;
    };
  }>;
  isLoading?: boolean;
  userAddress?: `0x${string}`;
}

const PerpsTradesTable = ({ trades, isLoading, userAddress }: PerpsTradesTableProps) => {
  const formatPrice = (price: bigint) => {
    return (Number(price) / 1e6).toFixed(2); // Convert from wei to USDC
  };

  const formatQuantity = (quantity: bigint) => {
    if(quantity === 0n) {
      return "0";
    }
    return (Number(quantity) / 1e6).toFixed(6);
  };

  const formatVolume = (volume: bigint) => {
    return (Number(volume) / 1e6).toFixed(2);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(Number(dateString) * 1000);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getUserSide = (trade: PerpsTradesTableProps['trades'][0]) => {
    if (!userAddress) return "-";
    const isBuyer = trade.buyer.id.toLowerCase() === userAddress.toLowerCase();
    return isBuyer ? "Long" : "Short";
  };

  const sortedTrades = [...trades].sort((a, b) => 
    Number(b.timestamp) - Number(a.timestamp)
  );

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", color: "#6b7280" }}>
        <p>Loading trades...</p>
      </div>
    );
  }

  if (sortedTrades.length === 0) {
    return (
      <EmptyState>
        <p>No trades found</p>
      </EmptyState>
    );
  }

  return (
    <TableContainer>
      <Table>
        <thead>
          <tr>
            <th>Side</th>
            <th>Price (USDC)</th>
            <th>Quantity</th>
            <th>Volume (USDC)</th>
            <th>Date</th>
            <th>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {sortedTrades.map((trade) => {
            const side = getUserSide(trade);
            return (
              <TableRow key={trade.id}>
                <td>
                  <TypeBadge $type={side}>
                    {side}
                  </TypeBadge>
                </td>
                <td>{formatPrice(trade.price)}</td>
                <td>{formatQuantity(trade.quantity)}</td>
                <td>{formatVolume(trade.volume)}</td>
                <td>{formatDate(trade.timestamp)}</td>
                <td>
                  <TxLink 
                    href={`https://etherscan.io/tx/${trade.transactionHash}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
                    {trade.transactionHash.slice(0, 6)}...{trade.transactionHash.slice(-4)}
                  </TxLink>
                </td>
              </TableRow>
            );
          })}
        </tbody>
      </Table>
    </TableContainer>
  );
};


const TabContainer = styled(SmallWidget)`
  width: 100%;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: start;
  
  h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: #fff;
  }
`;

const Header = styled("div")`
  padding: 1.5rem 1.5rem 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
`;

const Content = styled("div")`
  width: 100%;
  padding: 0 1.5rem 1.5rem 1.5rem;
`;

const OrdersWrapper = styled("div")`
  width: 100%;
  
  /* Hide the widget's header since we have tabs */
  h3 {
    display: none;
  }
`;

const PositionsWrapper = styled("div")`
  width: 100%;
  
  /* Hide the widget's header since we have tabs */
  h3 {
    display: none;
  }
`;

const TradesWrapper = styled("div")`
  width: 100%;
`;

const PlaceholderText = styled("div")`
  padding: 2rem;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.875rem;
`;

const TableContainer = styled("div")`
  width: 100%;
  overflow-x: auto;
  
  &::-webkit-scrollbar {
    height: 4px;
  }
  
  &::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
  }
  
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
    border-radius: 2px;
  }
`;

const Table = styled("table")`
  width: 100%;
  border-collapse: collapse;
  min-width: 600px;
  
  th {
    text-align: left;
    padding: 0.75rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: #a7a9b6;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    white-space: nowrap;
  }
  
  td {
    padding: 0.75rem 0.5rem;
    font-size: 0.875rem;
    color: #fff;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
`;

const TableRow = styled("tr")`
  &:hover {
    background-color: rgba(255, 255, 255, 0.02);
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
  background-color: ${(props) => (props.$type === "Long" ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)")};
  color: ${(props) => (props.$type === "Long" ? "#22c55e" : "#ef4444")};
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

const ActionButtons = styled("div")`
  display: flex;
  gap: 0.5rem;
  align-items: center;
`;

const CancelButton = styled("button")`
  padding: 0.5rem 0.875rem;
  background: #4c5a5f;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.1s ease;
  
  &:hover:not(:disabled) {
    background: #5a6b70;
    transform: translateY(-1px);
  }
  
  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    background: #6b7280;
    cursor: not-allowed;
    opacity: 0.6;
  }
`;

const EmptyState = styled("div")`
  text-align: center;
  padding: 2rem;
  color: #6b7280;
  
  p {
    margin: 0;
    font-size: 0.875rem;
  }
`;

const PnLText = styled("span")<{ $isPositive: boolean }>`
  color: ${(props) => (props.$isPositive ? "#22c55e" : "#ef4444")};
  font-weight: 600;
`;

const TxLink = styled("a")`
  color: #3b82f6;
  text-decoration: none;
  font-family: monospace;
  font-size: 0.8rem;
  
  &:hover {
    text-decoration: underline;
  }
`;
