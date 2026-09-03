import { tokens } from "../../../styles/tokens";
import { useState, useMemo, useEffect } from "react";
import styled from "@mui/material/styles/styled";
import Modal from "@mui/material/Modal";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import { SmallWidget } from "../../Cards/Cards.styled";
import { ModalCard } from "../../Modal.styled";
import { TabSwitch } from "../../TabSwitch";
import { useCancelPerpsOrder } from "../../../hooks/data/perps/useCancelPerpsOrder";
import { useQueryClient } from "@tanstack/react-query";
import { USER_PERPS_ORDERS_QK } from "../../../hooks/data/perps/useUserPerpsOrders";
import { USER_POSITION_SESSIONS_QK } from "../../../hooks/data/perps/useUserPositionSessions";
import { PERPS_ORDER_HISTORY_QK } from "../../../hooks/data/perps/usePerpsOrderHistory";
import { PERPS_POSITION_HISTORY_QK } from "../../../hooks/data/perps/usePerpsPositionHistory";
import { USER_TRADES_QK } from "../../../hooks/data/perps/useUserTrades";
import { invalidatePortfolioPnl } from "../../../hooks/data/pnl/invalidate";
import { getOrderBookQueryKey, waitForOrderBookBlockNumber } from "../../../hooks/data/orderBookHelpers";
import type { TransactionReceipt } from "viem";
import { TransactionFormV2 as TransactionForm } from "../../Forms/Shared/MultistepForm";
import { PerpsModalCard } from "./PerpsOrderFormFields";
import type { PositionSession } from "../../../hooks/data/perps/useUserPositionSessions";
import { useUserTrades } from "../../../hooks/data/perps/useUserTrades";
import type { UserTrade } from "../../../hooks/data/perps/useUserTrades";
import { usePerpsOrderHistory } from "../../../hooks/data/perps/usePerpsOrderHistory";
import { usePerpsPositionHistory } from "../../../hooks/data/perps/usePerpsPositionHistory";
import { ClosePerpsPositionModal } from "./ClosePerpsPositionModal";
import { ModifyPerpsOrderModal } from "./ModifyPerpsOrderModal";
import type { PerpsOrder } from "../../../hooks/data/perps/useUserPerpsOrders";
import { DateTimeCell } from "../../DateTimeCell";
import { LoadMoreButton } from "../../LoadMoreButton";
import { PAYMENT_TOKEN_SCALE_NUM, QUANTITY_SCALE } from "../../../lib/units";
import { getTxUrl } from "../../../lib/indexer";
import {
  LiquidationChip,
  formatLiquidatedQty,
  describeLiquidationLevel,
  LIQUIDATION_ROW_BG,
} from "../../../lib/liquidation";
import type { LiquidationDirection } from "../../../lib/portfolioMargin";

type TabType = "OPEN_ORDERS" | "POSITIONS" | "TRADES" | "POSITION_HISTORY" | "ORDER_HISTORY";

interface PerpsOrdersPositionsTabWidgetProps {
  participantAddress?: `0x${string}`;
  marketPrice?: bigint;
  positionSessions: PositionSession[];
  positionSessionsLoading?: boolean;
  /** Account-wide, cross-product price at which the portfolio becomes liquidatable. */
  liqPrice?: bigint;
  /** Which way spot has to move to reach `liqPrice`. */
  liqDirection?: LiquidationDirection;
  /** Balance is already under maintenance margin at the current mark. */
  isUnderwater?: boolean;
  // Lifted from this widget into Futures.tsx so the parent can derive
  // `hasOpenPerpsOrders` and gate polling cadence for perps orders + positions.
  perpsOpenOrders: PerpsOrder[];
  perpsOpenOrdersLoading?: boolean;
  onPositionClosed?: () => void | Promise<void>;
}

export const PerpsOrdersPositionsTabWidget = ({
  participantAddress,
  marketPrice,
  positionSessions,
  positionSessionsLoading,
  liqPrice,
  liqDirection,
  isUnderwater,
  perpsOpenOrders,
  perpsOpenOrdersLoading,
  onPositionClosed,
}: PerpsOrdersPositionsTabWidgetProps) => {
  const [activeTab, setActiveTab] = useState<TabType>("OPEN_ORDERS");
  const [openOrdersVisibleCount, setOpenOrdersVisibleCount] = useState(10);
  const [closePositionSession, setClosePositionSession] = useState<PositionSession | null>(null);
  const [modifyOrder, setModifyOrder] = useState<PerpsOrder | null>(null);
  const [cancelOrder, setCancelOrder] = useState<PerpsOrder | null>(null);

  // Paginated ("Load More") Order History — all non-ACTIVE perps orders.
  const orderHistoryQuery = usePerpsOrderHistory(participantAddress);

  // Paginated ("Load More") Position History — closed perps position sessions.
  const positionHistoryQuery = usePerpsPositionHistory(participantAddress);

  // Paginated ("Load More") Trades tab.
  const tradesQuery = useUserTrades(
    participantAddress,
    { refetch: activeTab === "TRADES" }
  );

  const refreshPerpsHistory = () => {
    orderHistoryQuery.refresh();
    positionHistoryQuery.refresh();
    tradesQuery.refresh();
  };

  // Count perps orders still resting on the book, excluding fully filled
  const ordersCount = useMemo(() => {
    return perpsOpenOrders.filter(
      (order) =>
        (order.status === "ACTIVE" || order.status === "PARTIALLY_FILLED") &&
        order.filledQuantity !== order.originalQuantity
    ).length;
  }, [perpsOpenOrders]);

  // Count unique positions
  const positionsCount = useMemo(() => {
    // Count open positions (status === "OPEN")
    return positionSessions.filter((session) => session.status === "OPEN").length;
  }, [positionSessions]);

  // Auto-switch to Positions tab when there are no open orders but there are open positions
  useEffect(() => {
    if (!perpsOpenOrdersLoading && !positionSessionsLoading) {
      if (ordersCount === 0 && positionsCount > 0) {
        setActiveTab("POSITIONS");
      }
    }
  }, [perpsOpenOrdersLoading, positionSessionsLoading, ordersCount, positionsCount]);

  // Loaded-row counts for the tab badges (no totals are exposed by the
  // subgraph, so these reflect how many rows are currently loaded).
  const positionHistoryCount = positionHistoryQuery.data.length;

  const tradesCount = tradesQuery.data.length;

  const orderHistoryCount = orderHistoryQuery.data.length;

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
              orders={perpsOpenOrders}
              isLoading={perpsOpenOrdersLoading}
              onModifyOrder={setModifyOrder}
              onCancelOrder={setCancelOrder}
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
              liqPrice={liqPrice}
              liqDirection={liqDirection}
              isUnderwater={isUnderwater}
              onClosePosition={setClosePositionSession}
            />
          </PositionsWrapper>
        )}
        {activeTab === "TRADES" && (
          <TradesWrapper>
            <PerpsTradesTable
              trades={tradesQuery.data}
              isLoading={tradesQuery.loading}
              userAddress={participantAddress}
              hasMore={tradesQuery.hasMore}
              isFetchingMore={tradesQuery.isFetchingMore}
              onLoadMore={tradesQuery.loadMore}
            />
          </TradesWrapper>
        )}
        {activeTab === "POSITION_HISTORY" && (
          <PositionsWrapper>
            <PerpsPositionHistoryTable
              positionSessions={positionHistoryQuery.data}
              isLoading={positionHistoryQuery.loading}
              hasMore={positionHistoryQuery.hasMore}
              isFetchingMore={positionHistoryQuery.isFetchingMore}
              onLoadMore={positionHistoryQuery.loadMore}
            />
          </PositionsWrapper>
        )}
        {activeTab === "ORDER_HISTORY" && (
          <OrdersWrapper>
            <PerpsOrderHistoryTable
              orders={orderHistoryQuery.data}
              isLoading={orderHistoryQuery.loading}
              hasMore={orderHistoryQuery.hasMore}
              isFetchingMore={orderHistoryQuery.isFetchingMore}
              onLoadMore={orderHistoryQuery.loadMore}
            />
          </OrdersWrapper>
        )}
      </Content>

      {/* Mount only when open so wagmi Hydrate doesn't push store updates into
          idle modals during render (React "setState while rendering Hydrate"). */}
      {closePositionSession && (
        <ClosePerpsPositionModal
          open
          onClose={() => setClosePositionSession(null)}
          session={closePositionSession}
          marketPrice={marketPrice}
          participantAddress={participantAddress}
          onConfirmed={async () => {
            // Closing a position adds history rows — reset every history table
            // back to its newest page rather than merging in-place.
            orderHistoryQuery.refresh();
            positionHistoryQuery.refresh();
            tradesQuery.refresh();
            await onPositionClosed?.();
          }}
        />
      )}

      {modifyOrder && (
        <ModifyPerpsOrderModal
          open
          onClose={() => setModifyOrder(null)}
          order={modifyOrder}
          marketPrice={marketPrice}
          participantAddress={participantAddress}
          onConfirmed={refreshPerpsHistory}
        />
      )}

      {cancelOrder && (
        <CancelOrderConfirmModal
          open
          order={cancelOrder}
          participantAddress={participantAddress}
          onClose={() => setCancelOrder(null)}
          onConfirmed={refreshPerpsHistory}
        />
      )}
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
  onModifyOrder: (order: PerpsOrder) => void;
  onCancelOrder: (order: PerpsOrder) => void;
  visibleCount: number;
  onLoadMore: () => void;
}

const PerpsOpenOrdersTable = ({
  orders,
  isLoading,
  onModifyOrder,
  onCancelOrder,
  visibleCount,
  onLoadMore,
}: PerpsOpenOrdersTableProps) => {
  const formatPrice = (price: bigint) => {
    return (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  };

  const _formatQuantity = (quantity: bigint) => {
    if(quantity === 0n) {
      return "0";
    }
    return (Number(quantity) / PAYMENT_TOKEN_SCALE_NUM).toFixed(6);
  };

  const formatStatus = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "Active";
      case "PARTIALLY_FILLED":
        return "Partially Filled";
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
      case "PARTIALLY_FILLED":
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
    .filter((order) => (order.status === "ACTIVE" || order.status === "PARTIALLY_FILLED") && order.filledQuantity !== order.originalQuantity)
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
              <td><DateTimeCell timestamp={order.createdAt} /></td>
              <td>
                <TypeBadge $type={order.isBuy ? "Long" : "Short"}>
                  {order.isBuy ? "Long" : "Short"}
                </TypeBadge>
              </td>
              <td>{formatPrice(order.price)}</td>
              <td>
                {((Number(order.price) / PAYMENT_TOKEN_SCALE_NUM) * (Number(order.filledQuantity) / PAYMENT_TOKEN_SCALE_NUM)).toFixed(2)}
                {" / "}
                {((Number(order.price) / PAYMENT_TOKEN_SCALE_NUM) * (Number(order.originalQuantity) / PAYMENT_TOKEN_SCALE_NUM)).toFixed(2)}
              </td>
              <td>
                <StatusBadge $status={order.status} $color={getStatusColor(order.status)}>
                  {formatStatus(order.status)}
                </StatusBadge>
              </td>
              <td>
                <ActionButtons>
                  <ModifyButton onClick={() => onModifyOrder(order as PerpsOrder)}>Modify</ModifyButton>
                  <CancelButton onClick={() => onCancelOrder(order as PerpsOrder)}>Cancel</CancelButton>
                </ActionButtons>
              </td>
            </TableRow>
          ))}
        </tbody>
      </Table>
      <LoadMoreButton hasMore={visibleCount < activeOrders.length} onClick={onLoadMore} />
    </TableContainer>
  );
};

// Cancel Order Confirmation Modal
interface CancelOrderConfirmModalProps {
  open: boolean;
  order: PerpsOrder;
  participantAddress?: `0x${string}`;
  onClose: () => void;
  onConfirmed?: () => void | Promise<void>;
}

const CancelOrderConfirmModal = ({ open, order, participantAddress, onClose, onConfirmed }: CancelOrderConfirmModalProps) => {
  const { cancelOrderAsync } = useCancelPerpsOrder();
  const queryClient = useQueryClient();

  const price = Number(order.price) / PAYMENT_TOKEN_SCALE_NUM;
  const filledValue = (price * (Number(order.filledQuantity) / PAYMENT_TOKEN_SCALE_NUM)).toFixed(2);
  const totalValue = (price * (Number(order.originalQuantity) / PAYMENT_TOKEN_SCALE_NUM)).toFixed(2);
  const remainingQty = Number(order.originalQuantity - order.filledQuantity) / PAYMENT_TOKEN_SCALE_NUM;

  return (
    <Modal open={open} onClose={onClose}>
      <PerpsModalCard>
        <IconButton className="close" sx={{ color: "white" }} onClick={onClose}>
          <CloseIcon />
        </IconButton>

        <TransactionForm
          onClose={onClose}
          title="Cancel Order"
          description=""
          reviewForm={() => (
            <>
              <div className="mb-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-300">Side:</span>
                    <span className="text-white">{order.isBuy ? "Long" : "Short"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Price:</span>
                    <span className="text-white">{price.toFixed(2)} USDC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Filled / Size:</span>
                    <span className="text-white">
                      {filledValue} / {totalValue} USDC
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Quantity to Cancel:</span>
                    <span className="text-white">{remainingQty.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Status:</span>
                    <span className="text-white">
                      {order.status === "PARTIALLY_FILLED" ? "Partially Filled" : "Active"}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-gray-400 text-sm">You are about to cancel this order.</p>
            </>
          )}
          resultForm={() => (
            <p className="w-6/6 text-left font-normal text-s mt-5">
              Your order has been cancelled and will disappear from the order book shortly.
            </p>
          )}
          transactionSteps={[
            {
              label: "Cancel Order",
              action: async () => {
                const txhash = await cancelOrderAsync({ orderId: order.id as `0x${string}` });
                if (!txhash) throw new Error("Wallet not ready. Please try again.");
                return { txhash, isSkipped: false };
              },
              postConfirmation: async (receipt: TransactionReceipt) => {
                await waitForOrderBookBlockNumber(receipt.blockNumber, queryClient, "perpetual");
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: [getOrderBookQueryKey("perpetual")] }),
                  queryClient.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, participantAddress] }),
                  queryClient.invalidateQueries({ queryKey: [USER_POSITION_SESSIONS_QK, participantAddress] }),
                  queryClient.resetQueries({ queryKey: [PERPS_ORDER_HISTORY_QK, participantAddress] }),
                  queryClient.resetQueries({ queryKey: [PERPS_POSITION_HISTORY_QK, participantAddress] }),
                  queryClient.resetQueries({ queryKey: [USER_TRADES_QK, participantAddress] }),
                  invalidatePortfolioPnl(queryClient),
                ]);
                if (onConfirmed) await onConfirmed();
              },
            },
          ]}
        />
      </PerpsModalCard>
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
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onLoadMore: () => void;
}

const PerpsOrderHistoryTable = ({ orders, isLoading, hasMore = false, isFetchingMore, onLoadMore }: PerpsOrderHistoryTableProps) => {
  const formatPrice = (price: bigint) => {
    return (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  };

  const _formatQuantity = (quantity: bigint) => {
    if(quantity === 0n) {
      return "0";
    }
    return (Number(quantity) / PAYMENT_TOKEN_SCALE_NUM).toFixed(6);
  };

  const formatStatus = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "Active";
      case "PARTIALLY_FILLED":
        return "Partially Filled";
      case "FILLED":
        return "Filled";
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
      case "PARTIALLY_FILLED":
        return tokens.trading.warning;
      case "FILLED":
        return tokens.text.muted;
      case "CANCELLED":
        return tokens.trading.short;
      case "LIQUIDATED":
        return tokens.status.error;
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

  const displayedOrders = sortedOrders;

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
              <td><DateTimeCell timestamp={order.createdAt} /></td>
              <td>
                <TypeBadge $type={order.isBuy ? "Long" : "Short"}>
                  {order.isBuy ? "Long" : "Short"}
                </TypeBadge>
              </td>
              <td>{formatPrice(order.price)}</td>
              <td>
                {((Number(order.price) / PAYMENT_TOKEN_SCALE_NUM) * (Number(order.filledQuantity) / PAYMENT_TOKEN_SCALE_NUM)).toFixed(2)}
                {" / "}
                {((Number(order.price) / PAYMENT_TOKEN_SCALE_NUM) * (Number(order.originalQuantity) / PAYMENT_TOKEN_SCALE_NUM)).toFixed(2)}
              </td>
              <td>
                <StatusBadge $status={order.status} $color={getStatusColor(order.status)}>
                  {formatStatus(order.status)}
                </StatusBadge>
              </td>
              <td><DateTimeCell timestamp={order.updatedAt} /></td>
            </TableRow>
          ))}
        </tbody>
      </Table>
      <LoadMoreButton hasMore={hasMore} isLoading={isFetchingMore} onClick={onLoadMore} />
    </TableContainer>
  );
};

// Perps Positions Table Component
interface PerpsPositionsTableProps {
  positionSessions: PositionSession[];
  isLoading?: boolean;
  marketPrice?: bigint;
  liqPrice?: bigint;
  liqDirection?: LiquidationDirection;
  isUnderwater?: boolean;
  onClosePosition?: (session: PositionSession) => void;
}

const PerpsPositionsTable = ({ positionSessions, isLoading, marketPrice, liqPrice, liqDirection, isUnderwater, onClosePosition }: PerpsPositionsTableProps) => {
  const [selectedSession, setSelectedSession] = useState<PositionSession | null>(null);

  const formatPrice = (price: bigint) => {
    return (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  };

  const _formatQuantity = (quantity: bigint) => {
    if(quantity === 0n) {
      return "0";
    }
    const absQuantity = quantity < 0n ? -quantity : quantity;
    return (Number(absQuantity) / PAYMENT_TOKEN_SCALE_NUM).toFixed(6);
  };

  const formatFees = (fundingFees: bigint, tradingFees: bigint) => {
    const funding = (Number(fundingFees) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
    const trading = (Number(tradingFees) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
    return `${funding} / ${trading}`;
  };

  // Calculate unrealized PnL: (currentMarketPrice - entryPrice) * netQuantity
  const calculateUnrealizedPnL = (entryPrice: bigint, netQuantity: bigint): bigint => {
    if (!marketPrice || netQuantity === 0n) return 0n;
    const priceDiff = marketPrice - entryPrice;
    return priceDiff * netQuantity / QUANTITY_SCALE; // Adjust for precision
  };

  // Margin is pooled across the whole account, so there is no per-position
  // liquidation price — every row shows the same account-wide level.
  const liquidationPriceLabel = isUnderwater
    ? "Liquidatable"
    : liqPrice !== undefined
    ? `${liqDirection === "up" ? "↑" : "↓"} ${formatPrice(liqPrice)}`
    : "N/A";
  const liquidationTooltip = describeLiquidationLevel({
    price: liqPrice,
    direction: liqDirection,
    isUnderwater,
  });

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
              <th>Status</th>
              <th>Entry Price</th>
              <th>Size / Max Size</th>
              <th>Net Quantity</th>
              <th>Fees (F/T)</th>
              <th>Unrealized PnL</th>
              <th>Realized PnL</th>
              <th title={liquidationTooltip}>Liquidation Price</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {openPositions.map((session) => {
              const displayQuantity = session.netQuantity;
              const isLong = displayQuantity > 0n || (displayQuantity === 0n && session.maxQuantity > 0n);
              const realizedPnlValue = Number(session.realizedPnl) / PAYMENT_TOKEN_SCALE_NUM;
              const unrealizedPnl = calculateUnrealizedPnL(session.entryPrice, displayQuantity);
              const unrealizedPnlValue = Number(unrealizedPnl) / PAYMENT_TOKEN_SCALE_NUM;

              return (
                <TableRow key={session.id}>
                  <td><DateTimeCell timestamp={session.openedAt} /></td>
                  <td>
                    <TypeBadge $type={isLong ? "Long" : "Short"}>
                      {isLong ? "Long" : "Short"}
                    </TypeBadge>
                  </td>
                  <td>
                    {session.liquidatedQuantity > 0n ? (
                      <LiquidationChip
                        title={formatLiquidatedQty(session.liquidatedQuantity, displayQuantity, {
                          scale: PAYMENT_TOKEN_SCALE_NUM,
                          fractionDigits: 2,
                        })}
                      >
                        {formatLiquidatedQty(session.liquidatedQuantity, displayQuantity, {
                          scale: PAYMENT_TOKEN_SCALE_NUM,
                          fractionDigits: 2,
                        })}
                      </LiquidationChip>
                    ) : (
                      <StatusBadge $status="OPEN" $color={tokens.trading.long}>
                        Open
                      </StatusBadge>
                    )}
                  </td>
                  <td>{formatPrice(session.entryPrice)}</td>
                  <td>
                    {((Number(session.entryPrice) / PAYMENT_TOKEN_SCALE_NUM) * (Number(displayQuantity < 0n ? -displayQuantity : displayQuantity) / PAYMENT_TOKEN_SCALE_NUM)).toFixed(2)}
                    {" / "}
                    {((Number(session.entryPrice) / PAYMENT_TOKEN_SCALE_NUM) * (Number(session.maxQuantity) / PAYMENT_TOKEN_SCALE_NUM)).toFixed(2)}
                  </td>
                  <td>{(Number(displayQuantity < 0n ? -displayQuantity : displayQuantity) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2)}</td>
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
                  <td
                    style={isUnderwater ? { color: tokens.trading.short } : undefined}
                    title={liquidationTooltip}
                  >
                    {liquidationPriceLabel}
                  </td>
                  <td>
                    <ActionButtons>
                      <DetailsButton onClick={() => setSelectedSession(session)}>
                        Trades
                      </DetailsButton>
                      <DetailsButton onClick={() => onClosePosition?.(session)}>
                        Close
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
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onLoadMore: () => void;
}

const PerpsPositionHistoryTable = ({ positionSessions, isLoading, hasMore = false, isFetchingMore, onLoadMore }: PerpsPositionHistoryTableProps) => {
  const [selectedSession, setSelectedSession] = useState<PositionSession | null>(null);

  const formatPrice = (price: bigint) => {
    return (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  };

  const _formatQuantity = (quantity: bigint) => {
    if(quantity === 0n) {
      return "0";
    }
    const absQuantity = quantity < 0n ? -quantity : quantity;
    return (Number(absQuantity) / PAYMENT_TOKEN_SCALE_NUM).toFixed(6);
  };

  const formatFees = (fundingFees: bigint, tradingFees: bigint) => {
    const funding = (Number(fundingFees) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
    const trading = (Number(tradingFees) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
    return `${funding} / ${trading}`;
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
  const displayedPositions = closedPositions;

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
              <th>Status</th>
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
              const realizedPnlValue = Number(session.realizedPnl) / PAYMENT_TOKEN_SCALE_NUM;
              const wasLiquidated = session.liquidatedQuantity > 0n;

              return (
                <TableRow
                  key={session.id}
                  style={wasLiquidated ? { backgroundColor: LIQUIDATION_ROW_BG } : undefined}
                >
                  <td><DateTimeCell timestamp={session.openedAt} /></td>
                  <td>
                    {wasLiquidated ? (
                      <LiquidationChip
                        title={formatLiquidatedQty(
                          session.liquidatedQuantity,
                          session.maxQuantity - session.liquidatedQuantity,
                          { scale: PAYMENT_TOKEN_SCALE_NUM, fractionDigits: 2 },
                        )}
                      >
                        {formatLiquidatedQty(
                          session.liquidatedQuantity,
                          session.maxQuantity - session.liquidatedQuantity,
                          { scale: PAYMENT_TOKEN_SCALE_NUM, fractionDigits: 2 },
                        )}
                      </LiquidationChip>
                    ) : (
                      <StatusBadge $status={session.status} $color={getStatusColor(session.status)}>
                        {formatStatus(session.status)}
                      </StatusBadge>
                    )}
                  </td>
                  <td>
                    <TypeBadge $type={isLong ? "Long" : "Short"}>
                      {isLong ? "Long" : "Short"}
                    </TypeBadge>
                  </td>
                  <td>{formatPrice(session.entryPrice)}</td>
                  <td>{session.closePrice ? formatPrice(session.closePrice) : "-"}</td>
                  <td>{((Number(session.closePrice ?? session.entryPrice) / PAYMENT_TOKEN_SCALE_NUM) * (Number(session.closedQuantity < 0n ? -session.closedQuantity : session.closedQuantity) / PAYMENT_TOKEN_SCALE_NUM)).toFixed(2)}</td>
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
        <LoadMoreButton hasMore={hasMore} isLoading={isFetchingMore} onClick={onLoadMore} />
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
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onLoadMore: () => void;
}

const PerpsTradesTable = ({ trades, isLoading, hasMore = false, isFetchingMore, onLoadMore }: PerpsTradesTableProps) => {
  const formatPrice = (price: bigint) => {
    return (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  };

  const _formatQuantity = (quantity: bigint) => {
    if(quantity === 0n) {
      return "0";
    }
    const absQuantity = quantity < 0n ? -quantity : quantity;
    return (Number(absQuantity) / PAYMENT_TOKEN_SCALE_NUM).toFixed(6);
  };

  const formatPnL = (pnl: bigint) => {
    const value = Number(pnl) / PAYMENT_TOKEN_SCALE_NUM;
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)} USDC`;
  };

  const sortedTrades = [...trades].sort((a, b) => 
    Number(b.timestamp) - Number(a.timestamp)
  );

  const displayedTrades = sortedTrades;

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
            <th>Time</th>
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
            <TableRow
              key={trade.id}
              style={trade.isLiquidation ? { backgroundColor: LIQUIDATION_ROW_BG } : undefined}
            >
              <td><DateTimeCell timestamp={trade.timestamp} /></td>
              <td>
                <SideCell>
                  <TypeBadge $type={trade.tradeQuantity >= 0n ? "Long" : "Short"}>
                    {trade.tradeQuantity >= 0n ? "Buy" : "Sell"}
                  </TypeBadge>
                  {trade.isLiquidation && <LiquidationChip>Liquidation</LiquidationChip>}
                </SideCell>
              </td>
              <td>{formatPrice(trade.tradePrice)}</td>
              <td>{((Number(trade.tradePrice) / PAYMENT_TOKEN_SCALE_NUM) * (Number(trade.tradeQuantity < 0n ? -trade.tradeQuantity : trade.tradeQuantity) / PAYMENT_TOKEN_SCALE_NUM)).toFixed(2)}</td>
              <td>{formatPrice(trade.aggregatedEntryPriceAfter)}</td>
              <td>{formatPrice(trade.tradingFee)}</td>
              <td>
                <PnLText
                  $isPositive={Number(trade.realizedPnl) >= 0}
                  $isZero={Number(trade.realizedPnl) === 0}
                >
                  {formatPnL(trade.realizedPnl)}
                </PnLText>
              </td>
              <td>
                <TxLink 
                  href={getTxUrl(trade.transactionHash as `0x${string}`)} 
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
      <LoadMoreButton hasMore={hasMore} isLoading={isFetchingMore} onClick={onLoadMore} />
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
    return (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  };

  const _formatQuantity = (quantity: bigint) => {
    if(quantity === 0n) {
      return "0";
    }
    const absQuantity = quantity < 0n ? -quantity : quantity;
    return (Number(absQuantity) / PAYMENT_TOKEN_SCALE_NUM).toFixed(6);
  };

  const formatPnL = (pnl: bigint) => {
    const value = Number(pnl) / PAYMENT_TOKEN_SCALE_NUM;
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)} USDC`;
  };

  const sortedTrades = [...session.trades].sort((a, b) => 
    Number(b.timestamp) - Number(a.timestamp)
  );

  // Client-side "Load More" paging (the session's trades are already in memory).
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const displayedTrades = sortedTrades.slice(0, visibleCount);

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
                <th>Time</th>
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
                  <td><DateTimeCell timestamp={trade.timestamp} /></td>
                  <td>
                    <TypeBadge $type={trade.tradeQuantity >= 0n ? "Long" : "Short"}>
                      {trade.tradeQuantity >= 0n ? "Buy" : "Sell"}
                    </TypeBadge>
                  </td>
                  <td>{formatPrice(trade.tradePrice)}</td>
                  <td>{((Number(trade.tradePrice) / PAYMENT_TOKEN_SCALE_NUM) * (Number(trade.tradeQuantity < 0n ? -trade.tradeQuantity : trade.tradeQuantity) / PAYMENT_TOKEN_SCALE_NUM)).toFixed(2)}</td>
                  <td>{formatPrice(trade.aggregatedEntryPriceAfter)}</td>
                  <td>{formatPrice(trade.tradingFee)}</td>
                  <td>
                    <PnLText
                      $isPositive={Number(trade.realizedPnl) >= 0}
                      $isZero={Number(trade.realizedPnl) === 0}
                    >
                      {formatPnL(trade.realizedPnl)}
                    </PnLText>
                  </td>
                  <td>
                    <TxLink 
                      href={getTxUrl(trade.transactionHash as `0x${string}`)} 
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

        <LoadMoreButton
          hasMore={visibleCount < sortedTrades.length}
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
        />
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

const _PlaceholderText = styled("div")`
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

const SideCell = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
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

const CancelButton = styled("button")`
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

const PnLText = styled("span")<{ $isPositive: boolean; $isZero?: boolean }>`
  color: ${(props) =>
    props.$isZero
      ? tokens.text.primary
      : props.$isPositive
        ? tokens.trading.long
        : tokens.trading.short};
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

const _ErrorText = styled("p")`
  color: ${tokens.trading.short};
  font-size: 0.8125rem;
  margin: 0 0 1rem 0;
`;

const _SimulatingText = styled("p")`
  color: ${tokens.text.secondary};
  font-size: 0.875rem;
  margin: 0;
  text-align: center;
`;

const _SimResultsContainer = styled("div")`
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
