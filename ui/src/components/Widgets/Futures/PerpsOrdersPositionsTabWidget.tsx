import { tokens } from "../../../styles/tokens";
import { useState, useMemo, useCallback, useEffect } from "react";
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
import { computeLiquidationState } from "../../../hooks/data/perps/positionHelper";
import { ClosePerpsPositionModal } from "./ClosePerpsPositionModal";
import { ModifyPerpsOrderModal } from "./ModifyPerpsOrderModal";
import type { PerpsOrder } from "../../../hooks/data/perps/useUserPerpsOrders";

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
  perpsBalance?: bigint;
  maintenanceMarginPercent?: bigint;
  onPositionClosed?: () => void | Promise<void>;
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
  perpsBalance,
  maintenanceMarginPercent,
  onPositionClosed,
}: PerpsOrdersPositionsTabWidgetProps) => {
  const [activeTab, setActiveTab] = useState<TabType>("OPEN_ORDERS");
  const [openOrdersVisibleCount, setOpenOrdersVisibleCount] = useState(10);
  const [tradesVisibleCount, setTradesVisibleCount] = useState(10);
  const [positionHistoryVisibleCount, setPositionHistoryVisibleCount] = useState(10);
  const [orderHistoryVisibleCount, setOrderHistoryVisibleCount] = useState(10);
  const [closePositionSession, setClosePositionSession] = useState<PositionSession | null>(null);
  const [modifyOrder, setModifyOrder] = useState<PerpsOrder | null>(null);
  const queryClient = useQueryClient();
  const { cancelOrderAsync, isPending: isCancelling } = useCancelPerpsOrder();

  // Fetch perps orders for Open Orders tab (ACTIVE + FILLED)
  const openOrdersQuery = useUserPerpsOrders(participantAddress, {
    statuses: ["ACTIVE", "PARTIAL"],
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
        (order.status === "ACTIVE" || order.status === "PARTIAL") &&
        order.filledQuantity !== order.originalQuantity
    ).length;
  }, [openOrdersQuery.data?.data?.orders]);
  
  // Count unique positions
  const positionsCount = useMemo(() => {
    // Count open positions (status === "OPEN")
    return positionSessions.filter((session) => session.status === "OPEN").length;
  }, [positionSessions]);

  // Auto-switch to Positions tab when there are no open orders but there are open positions
  useEffect(() => {
    if (!openOrdersQuery.isLoading && !positionSessionsLoading) {
      if (ordersCount === 0 && positionsCount > 0) {
        setActiveTab("POSITIONS");
      }
    }
  }, [openOrdersQuery.isLoading, positionSessionsLoading, ordersCount, positionsCount]);

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
              onModifyOrder={setModifyOrder}
              isCancelling={isCancelling}
              visibleCount={openOrdersVisibleCount}
              onLoadMore={() => setOpenOrdersVisibleCount(c => c + 10)}
            />
          </OrdersWrapper>
        )}
        {activeTab === "POSITIONS" && (
          <PositionsWrapper>
            <PerpsPositionsTable
              positionSessions={positionSessions}
              isLoading={positionSessionsLoading}
              marketPrice={marketPrice}
              collateral={perpsBalance}
              totalMaintenanceMargin={minMargin ?? undefined}
              maintenanceMarginPercent={maintenanceMarginPercent}
              onClosePosition={setClosePositionSession}
            />
          </PositionsWrapper>
        )}
        {activeTab === "TRADES" && (
          <TradesWrapper>
            <PerpsTradesTable
              trades={tradesQuery.data?.trades || []}
              isLoading={tradesQuery.isLoading}
              userAddress={participantAddress}
              visibleCount={tradesVisibleCount}
              onLoadMore={() => setTradesVisibleCount(c => c + 10)}
            />
          </TradesWrapper>
        )}
        {activeTab === "POSITION_HISTORY" && (
          <PositionsWrapper>
            <PerpsPositionHistoryTable
              positionSessions={positionSessions}
              isLoading={positionSessionsLoading}
              visibleCount={positionHistoryVisibleCount}
              onLoadMore={() => setPositionHistoryVisibleCount(c => c + 10)}
            />
          </PositionsWrapper>
        )}
        {activeTab === "ORDER_HISTORY" && (
          <OrdersWrapper>
            <PerpsOrderHistoryTable
              orders={orderHistoryQuery.data?.data?.orders || []}
              isLoading={orderHistoryQuery.isLoading}
              visibleCount={orderHistoryVisibleCount}
              onLoadMore={() => setOrderHistoryVisibleCount(c => c + 10)}
            />
          </OrdersWrapper>
        )}
      </Content>

      <ClosePerpsPositionModal
        open={closePositionSession !== null}
        onClose={() => setClosePositionSession(null)}
        session={closePositionSession}
        marketPrice={marketPrice}
        participantAddress={participantAddress}
        onConfirmed={onPositionClosed}
      />

      <ModifyPerpsOrderModal
        open={modifyOrder !== null}
        onClose={() => setModifyOrder(null)}
        order={modifyOrder}
        marketPrice={marketPrice}
        participantAddress={participantAddress}
      />
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
  onModifyOrder: (order: PerpsOrder) => void;
  isCancelling: boolean;
  visibleCount: number;
  onLoadMore: () => void;
}

type OpenOrder = PerpsOpenOrdersTableProps["orders"][number];

const PerpsOpenOrdersTable = ({ orders, isLoading, onCancelOrder, onModifyOrder, isCancelling, visibleCount, onLoadMore }: PerpsOpenOrdersTableProps) => {
  const [pendingCancelOrder, setPendingCancelOrder] = useState<OpenOrder | null>(null);

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
      case "PARTIAL":
        return "Partial";
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
        return tokens.trading.long;
      case "PARTIAL":
        return tokens.trading.warning;
      case "FILLED":
        return tokens.text.muted;
      case "CANCELLED":
        return tokens.trading.short;
      default:
        return tokens.text.muted;
    }
  };

  const activeOrders = [...orders]
    .filter((order) => (order.status === "ACTIVE" || order.status === "PARTIAL") && order.filledQuantity !== order.originalQuantity)
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));

  const displayedOrders = activeOrders.slice(0, visibleCount);

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", color: tokens.text.muted }}>
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
            <th>Created</th>
            <th>Side</th>
            <th>Price (USDC)</th>
            <th>Filled / Size (USDC)</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {displayedOrders.map((order) => (
            <TableRow key={order.id}>
              <td>{formatDate(order.createdAt)}</td>
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
              <td>
                <ActionButtons>
                  <ModifyButton
                    onClick={() => onModifyOrder(order as PerpsOrder)}
                    disabled={isCancelling}
                  >
                    Modify
                  </ModifyButton>
                  <CancelButton 
                    onClick={() => setPendingCancelOrder(order)}
                    disabled={isCancelling}
                  >
                    Cancel
                  </CancelButton>
                </ActionButtons>
              </td>
            </TableRow>
          ))}
        </tbody>
      </Table>
      {visibleCount < activeOrders.length && (
        <LoadMoreButton onClick={onLoadMore}>
          Load next 10 items
        </LoadMoreButton>
      )}

      {pendingCancelOrder && (
        <CancelOrderConfirmModal
          open={true}
          order={pendingCancelOrder}
          onClose={() => setPendingCancelOrder(null)}
          onConfirm={async () => {
            await onCancelOrder(pendingCancelOrder.id);
            setPendingCancelOrder(null);
          }}
          isCancelling={isCancelling}
        />
      )}
    </TableContainer>
  );
};

// Cancel Order Confirmation Modal
interface CancelOrderConfirmModalProps {
  open: boolean;
  order: OpenOrder;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isCancelling: boolean;
}

const CancelOrderConfirmModal = ({ open, order, onClose, onConfirm, isCancelling }: CancelOrderConfirmModalProps) => {
  const formatPrice = (price: bigint) => (Number(price) / 1e6).toFixed(2);

  const filledValue = ((Number(order.price) / 1e6) * (Number(order.filledQuantity) / 1e6)).toFixed(2);
  const totalValue = ((Number(order.price) / 1e6) * (Number(order.originalQuantity) / 1e6)).toFixed(2);

  return (
    <Modal open={open} onClose={onClose}>
      <CloseAllModalCard>
        <IconButton className="close" sx={{ color: "white" }} onClick={onClose}>
          <CloseIcon />
        </IconButton>

        <h2>Cancel Order</h2>

        <CloseAllDescription>
          Are you sure you want to cancel this order?
        </CloseAllDescription>

        <CloseAllSummary>
          <SummaryRow>
            <SummaryLabel>Side</SummaryLabel>
            <SummaryValue>
              <TypeBadge $type={order.isBuy ? "Long" : "Short"}>{order.isBuy ? "Long" : "Short"}</TypeBadge>
            </SummaryValue>
          </SummaryRow>
          <SummaryRow>
            <SummaryLabel>Price</SummaryLabel>
            <SummaryValue>{formatPrice(order.price)} USDC</SummaryValue>
          </SummaryRow>
          <SummaryRow>
            <SummaryLabel>Filled / Size (USDC)</SummaryLabel>
            <SummaryValue>{filledValue} / {totalValue}</SummaryValue>
          </SummaryRow>
          <SummaryRow>
            <SummaryLabel>Status</SummaryLabel>
            <SummaryValue>{order.status === "PARTIAL" ? "Partial" : "Active"}</SummaryValue>
          </SummaryRow>
        </CloseAllSummary>

        <CloseAllActions>
          <ModalCancelButton onClick={onClose}>Go Back</ModalCancelButton>
          <ModalConfirmButton onClick={onConfirm} disabled={isCancelling}>
            {isCancelling ? "Cancelling..." : "Confirm"}
          </ModalConfirmButton>
        </CloseAllActions>
      </CloseAllModalCard>
    </Modal>
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
  visibleCount: number;
  onLoadMore: () => void;
}

const PerpsOrderHistoryTable = ({ orders, isLoading, visibleCount, onLoadMore }: PerpsOrderHistoryTableProps) => {
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
      case "PARTIAL":
        return "Partial";
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
        return tokens.trading.long;
      case "PARTIAL":
        return tokens.trading.warning;
      case "FILLED":
        return tokens.text.muted;
      case "CANCELLED":
        return tokens.trading.short;
      default:
        return tokens.text.muted;
    }
  };

  const historyOrders = orders.filter(
    (order) => order.status !== "ACTIVE"
  );

  const sortedOrders = [...historyOrders].sort((a, b) => 
    Number(b.createdAt) - Number(a.createdAt)
  );

  const displayedOrders = sortedOrders.slice(0, visibleCount);

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", color: tokens.text.muted }}>
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
            <th>Created</th>
            <th>Side</th>
            <th>Price (USDC)</th>
            <th>Filled / Size (USDC)</th>
            <th>Status</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {displayedOrders.map((order) => (
            <TableRow key={order.id}>
              <td>{formatDate(order.createdAt)}</td>
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
              <td>{formatDate(order.updatedAt)}</td>
            </TableRow>
          ))}
        </tbody>
      </Table>
      {visibleCount < sortedOrders.length && (
        <LoadMoreButton onClick={onLoadMore}>
          Load next 10 items
        </LoadMoreButton>
      )}
    </TableContainer>
  );
};

// Perps Positions Table Component
interface PerpsPositionsTableProps {
  positionSessions: PositionSession[];
  isLoading?: boolean;
  marketPrice?: bigint;
  collateral?: bigint;
  totalMaintenanceMargin?: bigint;
  maintenanceMarginPercent?: bigint;
  onClosePosition?: (session: PositionSession) => void;
}

const QUANTITY_DECIMALS = 6n;

const PerpsPositionsTable = ({ positionSessions, isLoading, marketPrice, collateral, totalMaintenanceMargin, maintenanceMarginPercent, onClosePosition }: PerpsPositionsTableProps) => {
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

  const calculateLiquidationPrice = (entryPrice: bigint, netQuantity: bigint): bigint | null => {
    if (!marketPrice || !collateral || netQuantity === 0n || maintenanceMarginPercent === undefined) return null;

    const { liquidationPrice } = computeLiquidationState(
      netQuantity,
      entryPrice,
      collateral,
      totalMaintenanceMargin ?? 0n,
      marketPrice,
      maintenanceMarginPercent,
      QUANTITY_DECIMALS,
    );
    return liquidationPrice;
  };

  const openPositions = [...positionSessions]
    .filter((session) => session.status === "OPEN")
    .sort((a, b) => Number(b.openedAt) - Number(a.openedAt));

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", color: tokens.text.muted }}>
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
              <th>Side</th>
              <th>Entry Price</th>
              <th>Size / Max Size</th>
              <th>Net Quantity</th>
              <th>Fees (F/T)</th>
              <th>Unrealized PnL</th>
              <th>Realized PnL</th>
              <th>Liquidation Price</th>
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
              const liquidationPrice = calculateLiquidationPrice(session.entryPrice, displayQuantity);

              return (
                <TableRow key={session.id}>
                  <td>{formatDate(session.openedAt)}</td>
                  <td>
                    <TypeBadge $type={isLong ? "Long" : "Short"}>
                      {isLong ? "Long" : "Short"}
                    </TypeBadge>
                  </td>
                  <td>{formatPrice(session.entryPrice)}</td>
                  <td>
                    {((Number(session.entryPrice) / 1e6) * (Number(displayQuantity < 0n ? -displayQuantity : displayQuantity) / 1e6)).toFixed(2)}
                    {" / "}
                    {((Number(session.entryPrice) / 1e6) * (Number(session.maxQuantity) / 1e6)).toFixed(2)}
                  </td>
                  <td>{(Number(displayQuantity < 0n ? -displayQuantity : displayQuantity) / 1e6).toFixed(6)}</td>
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
                    {liquidationPrice !== null && liquidationPrice > 0n
                      ? formatPrice(liquidationPrice)
                      : "N/A"}
                  </td>
                  <td>
                    <ActionButtons>
                      <DetailsButton onClick={() => onClosePosition?.(session)}>
                        Close
                      </DetailsButton>
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
  visibleCount: number;
  onLoadMore: () => void;
}

const PerpsPositionHistoryTable = ({ positionSessions, isLoading, visibleCount, onLoadMore }: PerpsPositionHistoryTableProps) => {
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
        return tokens.trading.long;
      case "CLOSE":
        return tokens.text.muted;
      default:
        return tokens.text.muted;
    }
  };

  const closedPositions = [...positionSessions]
    .filter((session) => session.status === "CLOSE")
    .sort((a, b) => Number(b.openedAt) - Number(a.openedAt));
  const displayedPositions = closedPositions.slice(0, visibleCount);

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", color: tokens.text.muted }}>
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
              <th>Side</th>
              <th>Entry Price (USDC)</th>
              <th>Close Price (USDC)</th>
              <th>Size (USDC)</th>
              <th>Fees (F/T)</th>
              <th>Realized PnL</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayedPositions.map((session) => {
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
        {visibleCount < closedPositions.length && (
          <LoadMoreButton onClick={onLoadMore}>
          Load next 10 items
        </LoadMoreButton>
      )}
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
  visibleCount: number;
  onLoadMore: () => void;
}

const PerpsTradesTable = ({ trades, isLoading, userAddress, visibleCount, onLoadMore }: PerpsTradesTableProps) => {
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

  const displayedTrades = sortedTrades.slice(0, visibleCount);

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", color: tokens.text.muted }}>
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
            <th>Side</th>
            <th>Trade Price</th>
            <th>Size (USDC)</th>
            <th>Entry Price After</th>
            <th>Trading Fee</th>
            <th>Realized PnL</th>
            <th>Tx Hash</th>
          </tr>
        </thead>
        <tbody>
          {displayedTrades.map((trade) => (
            <TableRow key={trade.id}>
              <td>{formatDate(trade.timestamp)}</td>
              <td>
                <TypeBadge $type={trade.tradeQuantity >= 0n ? "Long" : "Short"}>
                  {trade.tradeQuantity >= 0n ? "Buy" : "Sell"}
                </TypeBadge>
              </td>
              <td>{formatPrice(trade.tradePrice)}</td>
              <td>{((Number(trade.tradePrice) / 1e6) * (Number(trade.tradeQuantity < 0n ? -trade.tradeQuantity : trade.tradeQuantity) / 1e6)).toFixed(2)}</td>
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
      {visibleCount < sortedTrades.length && (
        <LoadMoreButton onClick={onLoadMore}>
          Load next 10 items
        </LoadMoreButton>
      )}
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
                <th>Side</th>
                <th>Trade Price</th>
                <th>Size (USDC)</th>
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
                  <td>
                    <TypeBadge $type={trade.tradeQuantity >= 0n ? "Long" : "Short"}>
                      {trade.tradeQuantity >= 0n ? "Buy" : "Sell"}
                    </TypeBadge>
                  </td>
                  <td>{formatPrice(trade.tradePrice)}</td>
                  <td>{((Number(trade.tradePrice) / 1e6) * (Number(trade.tradeQuantity < 0n ? -trade.tradeQuantity : trade.tradeQuantity) / 1e6)).toFixed(2)}</td>
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
  border: 1px solid ${tokens.border.muted04};
  
  h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: ${tokens.text.onDark};
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
  width: 100%;
  min-width: 0;

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
  color: ${tokens.overlay.white50};
  font-size: 0.875rem;
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
  min-width: 600px;
  
  th {
    text-align: left;
    padding: 0.75rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: ${tokens.text.secondary};
    border-bottom: 1px solid ${tokens.overlay.white10};
    white-space: nowrap;
  }
  
  td {
    padding: 0.75rem 0.5rem;
    font-size: 0.875rem;
    color: ${tokens.text.onDark};
    border-bottom: 1px solid ${tokens.overlay.white05};
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

const ActionButtons = styled("div")`
  display: flex;
  gap: 0.5rem;
  align-items: center;
`;

const ModifyButton = styled("button")`
  padding: 0.5rem 0.875rem;
  background: ${tokens.surface.tabActive};
  color: ${tokens.text.onDark};
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.1s ease;

  &:hover:not(:disabled) {
    background: ${tokens.surface.tabHover};
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

const CancelButton = styled("button")`
  padding: 0.5rem 0.875rem;
  background: ${tokens.surface.tabActive};
  color: ${tokens.text.onDark};
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.1s ease;
  
  &:hover:not(:disabled) {
    background: ${tokens.surface.tabHover};
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

const PnLText = styled("span")<{ $isPositive: boolean }>`
  color: ${(props) => (props.$isPositive ? tokens.trading.long : tokens.trading.short)};
  font-weight: 600;
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

const DetailsButton = styled("button")`
  padding: 0.5rem 0.875rem;
  background: ${tokens.surface.tabActive};
  color: ${tokens.text.onDark};
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.1s ease;
  
  &:hover:not(:disabled) {
    background: ${tokens.surface.tabHover};
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
    background: ${tokens.overlay.white10};
    border-radius: 4px;
  }
  
  &::-webkit-scrollbar-thumb {
    background: ${tokens.overlay.white30};
    border-radius: 4px;
  }
`;

const LoadMoreButton = styled("button")`
  display: block;
  width: 100%;
  padding: 0.75rem;
  margin-top: 0.5rem;
  background: transparent;
  color: ${tokens.text.secondary};
  border: none;
  font-size: 0.875rem;
  cursor: pointer;
  text-align: center;
  transition: color 0.2s ease;

  &:hover {
    color: ${tokens.text.onDark};
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

const CloseAllModalCard = styled(ModalCard)`
  max-width: 700px;

  h2 {
    font-size: 1.5rem;
    font-weight: 500;
    padding-bottom: 0.5rem;
    margin-bottom: 0.5rem;
  }
`;

const CloseAllDescription = styled("p")`
  color: ${tokens.text.secondary};
  font-size: 0.875rem;
  margin: 0 0 1.25rem 0;
`;

const CloseAllSummary = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: ${tokens.overlay.white05};
  border-radius: 8px;
  margin-bottom: 1.25rem;
`;

const SummaryRow = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const SummaryLabel = styled("span")`
  color: ${tokens.text.secondary};
  font-size: 0.875rem;
`;

const SummaryValue = styled("span")`
  color: ${tokens.text.onDark};
  font-size: 0.875rem;
  font-weight: 600;
`;

const ErrorText = styled("p")`
  color: ${tokens.trading.short};
  font-size: 0.8125rem;
  margin: 0 0 1rem 0;
`;

const CloseAllActions = styled("div")`
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.25rem;
`;

const ModalCancelButton = styled("button")`
  padding: 0.5rem 1rem;
  background: ${tokens.surface.tabActive};
  color: ${tokens.text.onDark};
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background: ${tokens.surface.tabHover};
  }
`;

const ModalConfirmButton = styled("button")`
  padding: 0.5rem 1rem;
  background: ${tokens.trading.short};
  color: ${tokens.text.onDark};
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover:not(:disabled) {
    background: ${tokens.trading.shortHover};
  }

  &:disabled {
    background: ${tokens.text.muted};
    cursor: not-allowed;
    opacity: 0.6;
  }
`;

const SimulatingText = styled("p")`
  color: ${tokens.text.secondary};
  font-size: 0.875rem;
  margin: 0;
  text-align: center;
`;

const SimResultsContainer = styled("div")`
  width: 100%;
  overflow-x: auto;
  margin-top: 0.5rem;

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
