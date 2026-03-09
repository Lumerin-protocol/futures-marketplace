import { useState, useMemo } from "react";
import styled from "@mui/material/styles/styled";
import Modal from "@mui/material/Modal";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import { SmallWidget } from "../../Cards/Cards.styled";
import { ModalCard } from "../../Modal.styled";
import { TabSwitch } from "../../TabSwitch";
import type { ParticipantOrder } from "../../../hooks/data/useParticipant";
import type { PositionBookPosition } from "../../../hooks/data/usePositionBook";
import { useHistoricalOrders } from "../../../hooks/data/useHistoricalOrders";
import type { AccountBalance } from "../../../types/types";
import { useUserPerpsOrders } from "../../../hooks/data/perps/useUserPerpsOrders";
import { useCancelPerpsOrder } from "../../../hooks/data/perps/useCancelPerpsOrder";
import { useQueryClient } from "@tanstack/react-query";
import { USER_PERPS_ORDERS_QK } from "../../../hooks/data/perps/useUserPerpsOrders";
import type { PositionSession } from "../../../hooks/data/perps/useUserPositionSessions";
import { useUserTrades } from "../../../hooks/data/perps/useUserTrades";
import type { UserTrade } from "../../../hooks/data/perps/useUserTrades";

type TabType = "OPEN_ORDERS" | "POSITIONS" | "TRADES" | "POSITION_HISTORY" | "ORDER_HISTORY";

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
  marketPrice?: bigint;
  positionSessions: PositionSession[];
  positionSessionsLoading?: boolean;
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
  marketPrice,
  positionSessions,
  positionSessionsLoading,
}: PerpsOrdersPositionsTabWidgetProps) => {
  const [activeTab, setActiveTab] = useState<TabType>("OPEN_ORDERS");
  const queryClient = useQueryClient();
  const { cancelOrderAsync, isPending: isCancelling } = useCancelPerpsOrder();

  // Fetch perps orders for Open Orders tab (ACTIVE + FILLED)
  const openOrdersQuery = useUserPerpsOrders(participantAddress, {
    statuses: ["ACTIVE", "FILLED"],
  });
  // Fetch perps orders for Order History tab (all non-ACTIVE)
  const orderHistoryQuery = useUserPerpsOrders(participantAddress, {
    excludeStatuses: ["ACTIVE"],
  });

  // Fetch historical orders for Orders History tab
  const historicalOrdersQuery = useHistoricalOrders(
    participantAddress,
    activeTab === "ORDER_HISTORY"
  );

  // Fetch trades for Trades tab (new query with detailed trade info)
  const tradesQuery = useUserTrades(
    participantAddress,
    { refetch: activeTab === "TRADES" }
  );

  // Handle cancel order
  const handleCancelOrder = async (orderId: string) => {
    try {
      await cancelOrderAsync({ orderId: orderId as `0x${string}` });
      // Invalidate both open orders and history queries
      queryClient.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, participantAddress] });
    } catch (error) {
      console.error("Failed to cancel order:", error);
    }
  };

  // Count perps orders (ACTIVE + FILLED, excluding fully filled)
  const ordersCount = useMemo(() => {
    const orders = openOrdersQuery.data?.data?.orders ?? [];
    return orders.filter(
      (order) =>
        (order.status === "ACTIVE" || order.status === "FILLED") &&
        order.filledQuantity !== order.originalQuantity
    ).length;
  }, [openOrdersQuery.data?.data?.orders]);
  
  // Count unique positions
  const positionsCount = useMemo(() => {
    // Count open positions (status === "OPEN")
    return positionSessions.filter((session) => session.status === "OPEN").length;
  }, [positionSessions]);

  // Count closed positions
  const positionHistoryCount = useMemo(() => {
    // Count closed positions (status === "CLOSED")
    return positionSessions.filter((session) => session.status === "CLOSE").length;
  }, [positionSessions]);

  // Count trades
  const tradesCount = useMemo(() => {
    const trades = tradesQuery.data?.trades || [];
    return trades.length;
  }, [tradesQuery.data?.trades]);

  // Count historical orders (all non-ACTIVE orders)
  const orderHistoryCount = useMemo(() => {
    return orderHistoryQuery.data?.data?.orders.length ?? 0;
  }, [orderHistoryQuery.data?.data?.orders]);

  return (
    <TabContainer>
      <Header>
        <TabSwitchWrapper>
          <TabSwitch
            values={[
              { text: "Open Orders", value: "OPEN_ORDERS", count: ordersCount },
              { text: "Positions", value: "POSITIONS", count: positionsCount },
              { text: "Trades", value: "TRADES", count: tradesCount },
              { text: "Position History", value: "POSITION_HISTORY", count: positionHistoryCount },
              { text: "Order History", value: "ORDER_HISTORY", count: orderHistoryCount },
            ]}
            value={activeTab}
            setValue={setActiveTab}
          />
        </TabSwitchWrapper>
      </Header>

      <Content>
        {activeTab === "OPEN_ORDERS" && (
          <OrdersWrapper>
            <PerpsOpenOrdersTable
              orders={openOrdersQuery.data?.data?.orders || []}
              isLoading={openOrdersQuery.isLoading}
              onCancelOrder={handleCancelOrder}
              isCancelling={isCancelling}
            />
          </OrdersWrapper>
        )}
        {activeTab === "POSITIONS" && (
          <PositionsWrapper>
            <PerpsPositionsTable
              positionSessions={positionSessions}
              isLoading={positionSessionsLoading}
              marketPrice={marketPrice}
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
        {activeTab === "POSITION_HISTORY" && (
          <PositionsWrapper>
            <PerpsPositionHistoryTable
              positionSessions={positionSessions}
              isLoading={positionSessionsLoading}
            />
          </PositionsWrapper>
        )}
        {activeTab === "ORDER_HISTORY" && (
          <OrdersWrapper>
            <PerpsOrderHistoryTable
              orders={orderHistoryQuery.data?.data?.orders || []}
              isLoading={orderHistoryQuery.isLoading}
            />
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

  // Filter to show only active orders and exclude fully filled orders
  const activeOrders = orders.filter(
    (order) => (order.status === "ACTIVE" || order.status === "FILLED") && order.filledQuantity !== order.originalQuantity
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
            <th>Filled / Size (USDC)</th>
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
              <td>
                {((Number(order.price) / 1e6) * (Number(order.filledQuantity) / 1e6)).toFixed(2)}
                {" / "}
                {((Number(order.price) / 1e6) * (Number(order.originalQuantity) / 1e6)).toFixed(2)}
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

// Perps Order History Table Component
interface PerpsOrderHistoryTableProps {
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
    closedAt: string | null;
  }>;
  isLoading?: boolean;
}

const PerpsOrderHistoryTable = ({ orders, isLoading }: PerpsOrderHistoryTableProps) => {
  const formatPrice = (price: bigint) => {
    return (Number(price) / 1e6).toFixed(2); // Convert from wei to USDC
  };

  const formatQuantity = (quantity: bigint) => {
    if(quantity === 0n) {
      return "0";
    }
    return (Number(quantity) / 1e6).toFixed(6);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
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

  const historyOrders = orders.filter(
    (order) => order.status !== "ACTIVE"
  );

  // Sort orders by updatedAt (most recent first)
  const sortedOrders = historyOrders.sort((a, b) => 
    Number(b.updatedAt) - Number(a.updatedAt)
  );

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", color: "#6b7280" }}>
        <p>Loading order history...</p>
      </div>
    );
  }

  if (sortedOrders.length === 0) {
    return (
      <EmptyState>
        <p>No order history found</p>
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
            <th>Filled / Size (USDC)</th>
            <th>Status</th>
            <th>Created</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {sortedOrders.map((order) => (
            <TableRow key={order.id}>
              <td>
                <TypeBadge $type={order.isBuy ? "Long" : "Short"}>
                  {order.isBuy ? "Long" : "Short"}
                </TypeBadge>
              </td>
              <td>{formatPrice(order.price)}</td>
              <td>
                {((Number(order.price) / 1e6) * (Number(order.filledQuantity) / 1e6)).toFixed(2)}
                {" / "}
                {((Number(order.price) / 1e6) * (Number(order.originalQuantity) / 1e6)).toFixed(2)}
              </td>
              <td>
                <StatusBadge $status={order.status} $color={getStatusColor(order.status)}>
                  {formatStatus(order.status)}
                </StatusBadge>
              </td>
              <td>{formatDate(order.createdAt)}</td>
              <td>{formatDate(order.updatedAt)}</td>
            </TableRow>
          ))}
        </tbody>
      </Table>
    </TableContainer>
  );
};

// Perps Positions Table Component
interface PerpsPositionsTableProps {
  positionSessions: PositionSession[];
  isLoading?: boolean;
  marketPrice?: bigint;
}

const PerpsPositionsTable = ({ positionSessions, isLoading, marketPrice }: PerpsPositionsTableProps) => {
  const [selectedSession, setSelectedSession] = useState<PositionSession | null>(null);

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

  const formatFees = (fundingFees: bigint, tradingFees: bigint) => {
    const funding = (Number(fundingFees) / 1e6).toFixed(2);
    const trading = (Number(tradingFees) / 1e6).toFixed(2);
    return `${funding} / ${trading}`;
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

  // Calculate unrealized PnL: (currentMarketPrice - entryPrice) * netQuantity
  const calculateUnrealizedPnL = (entryPrice: bigint, netQuantity: bigint): bigint => {
    if (!marketPrice || netQuantity === 0n) return 0n;
    const priceDiff = marketPrice - entryPrice;
    return priceDiff * netQuantity / 1_000_000n; // Adjust for precision
  };

  // Filter to show only OPEN positions
  const openPositions = positionSessions.filter((session) => session.status === "OPEN");

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", color: "#6b7280" }}>
        <p>Loading positions...</p>
      </div>
    );
  }

  if (openPositions.length === 0) {
    return (
      <EmptyState>
        <p>No open positions found</p>
      </EmptyState>
    );
  }

  return (
    <>
      <TableContainer>
        <Table>
          <thead>
            <tr>
              <th>Opened At</th>
              <th>Type</th>
              <th>Entry Price (USDC)</th>
              <th>Size (USDC)</th>
              <th>Max Size (USDC)</th>
              <th>Fees (F/T)</th>
              <th>Unrealized PnL</th>
              <th>Realized PnL</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {openPositions.map((session) => {
              // For status OPEN, use netQuantity from user object
              const displayQuantity = session.user.netQuantity;
              const isLong = displayQuantity > 0n || (displayQuantity === 0n && session.maxQuantity > 0n);
              const realizedPnlValue = Number(session.realizedPnl) / 1e6;
              const unrealizedPnl = calculateUnrealizedPnL(session.entryPrice, displayQuantity);
              const unrealizedPnlValue = Number(unrealizedPnl) / 1e6;

              return (
                <TableRow key={session.id}>
                  <td>{formatDate(session.openedAt)}</td>
                  <td>
                    <TypeBadge $type={isLong ? "Long" : "Short"}>
                      {isLong ? "Long" : "Short"}
                    </TypeBadge>
                  </td>
                  <td>{formatPrice(session.entryPrice)}</td>
                  <td>{((Number(session.entryPrice) / 1e6) * (Number(displayQuantity < 0n ? -displayQuantity : displayQuantity) / 1e6)).toFixed(2)}</td>
                  <td>{((Number(session.entryPrice) / 1e6) * (Number(session.maxQuantity) / 1e6)).toFixed(2)}</td>
                  <td>{formatFees(session.fundingFees, session.tradingFees)}</td>
                  <td>
                    <PnLText $isPositive={unrealizedPnlValue >= 0}>
                      {unrealizedPnlValue >= 0 ? "+" : ""}{unrealizedPnlValue.toFixed(2)} USDC
                    </PnLText>
                  </td>
                  <td>
                    <PnLText $isPositive={realizedPnlValue >= 0}>
                      {realizedPnlValue >= 0 ? "+" : ""}{realizedPnlValue.toFixed(2)} USDC
                    </PnLText>
                  </td>
                  <td>
                    <ActionButtons>
                      <DetailsButton onClick={() => setSelectedSession(session)}>
                        Trades
                      </DetailsButton>
                    </ActionButtons>
                  </td>
                </TableRow>
              );
            })}
          </tbody>
        </Table>
      </TableContainer>

      {/* Details Modal */}
      {selectedSession && (
        <TradeDetailsModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </>
  );
};

// Perps Position History Table Component
interface PerpsPositionHistoryTableProps {
  positionSessions: PositionSession[];
  isLoading?: boolean;
}

const PerpsPositionHistoryTable = ({ positionSessions, isLoading }: PerpsPositionHistoryTableProps) => {
  const [selectedSession, setSelectedSession] = useState<PositionSession | null>(null);

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

  const formatFees = (fundingFees: bigint, tradingFees: bigint) => {
    const funding = (Number(fundingFees) / 1e6).toFixed(2);
    const trading = (Number(tradingFees) / 1e6).toFixed(2);
    return `${funding} / ${trading}`;
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
    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "OPEN":
        return "#22c55e";
      case "CLOSE":
        return "#6b7280";
      default:
        return "#6b7280";
    }
  };

  // Filter to show only CLOSED positions
  const closedPositions = positionSessions.filter((session) => session.status === "CLOSE");

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", color: "#6b7280" }}>
        <p>Loading position history...</p>
      </div>
    );
  }

  if (closedPositions.length === 0) {
    return (
      <EmptyState>
        <p>No closed positions found</p>
      </EmptyState>
    );
  }

  return (
    <>
      <TableContainer>
        <Table>
          <thead>
            <tr>
              <th>Opened At</th>
              {/* <th>Status</th> */}
              <th>Type</th>
              <th>Entry Price (USDC)</th>
              <th>Close Price (USDC)</th>
              <th>Size (USDC)</th>
              <th>Fees (F/T)</th>
              <th>Realized PnL</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {closedPositions.map((session) => {
              const isLong = session.maxQuantity > 0n;
              const realizedPnlValue = Number(session.realizedPnl) / 1e6;

              return (
                <TableRow key={session.id}>
                  <td>{formatDate(session.openedAt)}</td>
                  {/* <td>
                    <StatusBadge $status={session.status} $color={getStatusColor(session.status)}>
                      {formatStatus(session.status)}
                    </StatusBadge>
                  </td> */}
                  <td>
                    <TypeBadge $type={isLong ? "Long" : "Short"}>
                      {isLong ? "Long" : "Short"}
                    </TypeBadge>
                  </td>
                  <td>{formatPrice(session.entryPrice)}</td>
                  <td>{session.closePrice ? formatPrice(session.closePrice) : "-"}</td>
                  <td>{((Number(session.closePrice ?? session.entryPrice) / 1e6) * (Number(session.closedQuantity < 0n ? -session.closedQuantity : session.closedQuantity) / 1e6)).toFixed(2)}</td>
                  <td>{formatFees(session.fundingFees, session.tradingFees)}</td>
                  <td>
                    <PnLText $isPositive={realizedPnlValue >= 0}>
                      {realizedPnlValue >= 0 ? "+" : ""}{realizedPnlValue.toFixed(2)} USDC
                    </PnLText>
                  </td>
                  <td>
                    <ActionButtons>
                      <DetailsButton onClick={() => setSelectedSession(session)}>
                        Trades
                      </DetailsButton>
                    </ActionButtons>
                  </td>
                </TableRow>
              );
            })}
          </tbody>
        </Table>
      </TableContainer>

      {/* Details Modal */}
      {selectedSession && (
        <TradeDetailsModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </>
  );
};

// Perps Trades Table Component
interface PerpsTradesTableProps {
  trades: UserTrade[];
  isLoading?: boolean;
  userAddress?: `0x${string}`;
}

const PerpsTradesTable = ({ trades, isLoading, userAddress }: PerpsTradesTableProps) => {
  const formatPrice = (price: bigint) => {
    return (Number(price) / 1e6).toFixed(2);
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
      second: "2-digit",
    });
  };

  const formatPnL = (pnl: bigint) => {
    const value = Number(pnl) / 1e6;
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)} USDC`;
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
            <th>Timestamp</th>
            <th>Trade Price</th>
            <th>Size (USDC)</th>
            <th>Size After (USDC)</th>
            <th>Entry Price After</th>
            <th>Trading Fee</th>
            <th>Realized PnL</th>
            <th>Tx Hash</th>
          </tr>
        </thead>
        <tbody>
          {sortedTrades.map((trade) => (
            <TableRow key={trade.id}>
              <td>{formatDate(trade.timestamp)}</td>
              <td>{formatPrice(trade.tradePrice)}</td>
              <td>{((Number(trade.tradePrice) / 1e6) * (Number(trade.tradeQuantity < 0n ? -trade.tradeQuantity : trade.tradeQuantity) / 1e6)).toFixed(2)}</td>
              <td>{((Number(trade.aggregatedEntryPriceAfter) / 1e6) * (Number(trade.netQuantityAfter < 0n ? -trade.netQuantityAfter : trade.netQuantityAfter) / 1e6)).toFixed(2)}</td>
              <td>{formatPrice(trade.aggregatedEntryPriceAfter)}</td>
              <td>{formatPrice(trade.tradingFee)}</td>
              <td>
                <PnLText $isPositive={Number(trade.realizedPnl) >= 0}>
                  {formatPnL(trade.realizedPnl)}
                </PnLText>
              </td>
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
          ))}
        </tbody>
      </Table>
    </TableContainer>
  );
};


// Trade Details Modal Component
interface TradeDetailsModalProps {
  session: PositionSession;
  onClose: () => void;
}

const TradeDetailsModal = ({ session, onClose }: TradeDetailsModalProps) => {
  const formatPrice = (price: bigint) => {
    return (Number(price) / 1e6).toFixed(2);
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
      second: "2-digit",
    });
  };

  const formatPnL = (pnl: bigint) => {
    const value = Number(pnl) / 1e6;
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)} USDC`;
  };

  const sortedTrades = [...session.trades].sort((a, b) => 
    Number(b.timestamp) - Number(a.timestamp)
  );

  return (
    <Modal
      open={true}
      onClose={onClose}
    >
      <TradesModalCard>
        <IconButton 
          className="close" 
          sx={{ color: "white" }} 
          onClick={onClose}
        >
          <CloseIcon />
        </IconButton>
        
        <h2>Trades ({sortedTrades.length})</h2>
        
        <TradesTableContainer>
          <TradesTable>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Trade Price</th>
                <th>Size (USDC)</th>
                <th>Size After (USDC)</th>
                <th>Entry Price After</th>
                <th>Trading Fee</th>
                <th>Realized PnL</th>
                <th>Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {sortedTrades.map((trade) => (
                <TableRow key={trade.id}>
                  <td>{formatDate(trade.timestamp)}</td>
                  <td>{formatPrice(trade.tradePrice)}</td>
                  <td>{((Number(trade.tradePrice) / 1e6) * (Number(trade.tradeQuantity < 0n ? -trade.tradeQuantity : trade.tradeQuantity) / 1e6)).toFixed(2)}</td>
                  <td>{((Number(trade.aggregatedEntryPriceAfter) / 1e6) * (Number(trade.netQuantityAfter < 0n ? -trade.netQuantityAfter : trade.netQuantityAfter) / 1e6)).toFixed(2)}</td>
                  <td>{formatPrice(trade.aggregatedEntryPriceAfter)}</td>
                  <td>{formatPrice(trade.tradingFee)}</td>
                  <td>
                    <PnLText $isPositive={Number(trade.realizedPnl) >= 0}>
                      {formatPnL(trade.realizedPnl)}
                    </PnLText>
                  </td>
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
              ))}
            </tbody>
          </TradesTable>
        </TradesTableContainer>
      </TradesModalCard>
    </Modal>
  );
};


const TabContainer = styled(SmallWidget)`
  width: 100%;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: start;
  border: 1px solid rgba(171, 171, 171, 0.4);
  
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

const TabSwitchWrapper = styled("div")`
  button {
    font-size: 0.875rem;
    padding: 0.1em 0.5em;
  }
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

const DetailsButton = styled("button")`
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

const TradesTableContainer = styled("div")`
  width: 100%;
  overflow-x: auto;
  margin-top: 1rem;
  
  &::-webkit-scrollbar {
    height: 8px;
  }
  
  &::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }
  
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
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
    color: #a7a9b6;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    white-space: nowrap;
  }
  
  td {
    padding: 0.75rem 0.5rem;
    font-size: 0.875rem;
    color: #fff;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  tbody tr:last-child td {
    border-bottom: none;
  }
  
  tbody tr:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }
`;
