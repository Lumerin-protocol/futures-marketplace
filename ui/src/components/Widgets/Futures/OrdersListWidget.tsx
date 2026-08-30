import { tokens } from "../../../styles/tokens";
import { useState } from "react";
import styled from "@mui/material/styles/styled";
import type { Participant, ParticipantOrder } from "../../../hooks/data/getUserFuturesOrders";
import { useModal } from "../../../hooks/useModal";
import { ModalItem } from "../../Modal";
import { ModifyFuturesOrderModal } from "./ModifyFuturesOrderModal";
import { CloseOrderForm } from "../../Forms/CloseOrderForm";
import { getMinMarginForPositionManual } from "../../../hooks/data/getMinMarginForPositionManual";
import { useGetMarketPrice } from "../../../hooks/data/useGetMarketPrice";
import { useMarginEngineShocks } from "../../../hooks/data/useMarginEngineShocks";
import type { AccountBalance, ContractMode } from "../../../types/types";
import { DateTimeCell } from "../../DateTimeCell";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";

interface BalanceQueryResult {
  data: bigint | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: () => void;
}

interface OrdersListWidgetProps {
  orders: ParticipantOrder[];
  isLoading?: boolean;
  participantData?: Participant | null;
  minMargin?: bigint | null;
  accountBalance?: AccountBalance;
  contractMode?: ContractMode;
  balanceQuery: BalanceQueryResult;
}

export const OrdersListWidget = ({ orders, isLoading, participantData, minMargin, accountBalance, contractMode = "futures", balanceQuery }: OrdersListWidgetProps) => {
  const modifyModal = useModal();
  const closeModal = useModal();
  const { data: marketPrice } = useGetMarketPrice();
  const [selectedOrder, setSelectedOrder] = useState<ParticipantOrder | null>(null);
  const [selectedCloseOrder, setSelectedCloseOrder] = useState<ParticipantOrder | null>(null);
  const _getStatusColor = (isActive: boolean, closedAt: string | null) => {
    if (closedAt) {
      return tokens.trading.info; // Filled/Closed
    }
    return isActive ? tokens.trading.long : tokens.trading.short; // Active or Cancelled
  };

  // const getStatusText = (isActive: boolean, closedAt: string | null) => {
  //   if (closedAt) {
  //     return "Filled";
  //   }
  //   return isActive ? "Active" : "Cancelled";
  // };

  const _getTypeColor = (isBuy: boolean) => {
    return isBuy ? tokens.trading.long : tokens.trading.short;
  };

  const formatPrice = (price: bigint) => {
    return (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2); // Convert from wei to USDC
  };


  // Get latest price from market price hook
  const latestPrice = marketPrice ?? null;

  // Maintenance shock from the PortfolioMarginEngine (WAD). Margin is
  // cross-account, so this per-leg figure is a preview, not the requirement.
  const { mmSpotShock } = useMarginEngineShocks();

  // Get newest item price for high price validation
  const newestItemPrice = marketPrice ? Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM : null;

  // Calculate margin for an order
  const calculateMargin = (pricePerDay: bigint, amount: number, isBuy: boolean): bigint | null => {
    if (!latestPrice || mmSpotShock === undefined) return null;
    const qty = isBuy ? amount : -amount;
    return getMinMarginForPositionManual(pricePerDay, qty, latestPrice, mmSpotShock);
  };

  const formatMargin = (margin: bigint | null): string => {
    if (margin === null) return "-";
    return `${(Number(margin) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2)} USDC`;
  };

  // What the order covers today. `originalQuantity` is frozen at creation, so
  // after a reduce it still reports the pre-reduce size — the difference sits in
  // `cancelledQuantity`, which would make the row disagree with Modify/Close.
  const liveQuantity = (order: ParticipantOrder) => order.filledQuantity + order.quantity;

  const handleCloseOrder = (order: ParticipantOrder) => {
    setSelectedCloseOrder(order);
    closeModal.open();
  };

  const handleModifyOrder = (order: ParticipantOrder) => {
    setSelectedOrder(order);
    modifyModal.open();
  };

  return (
    <OrdersContainer>
      <h3>Orders</h3>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "2rem", color: tokens.text.muted }}>
          <p>Loading orders...</p>
        </div>
      ) : (
        <>
          <TableContainer>
            <Table>
              <thead>
                <tr>
                  <th>Contract Expiration</th>
                  <th>Side</th>
                  <th>Price (USDC)</th>
                  <th>Filled / Quantity</th>
                  <th>Margin</th>
                  <th>Time</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <td><DateTimeCell timestamp={order.expirationAt} /></td>
                    <td>
                      <TypeBadge $type={order.isBuy ? "Long" : "Short"}>
                        {order.isBuy ? "Long" : "Short"}
                      </TypeBadge>
                    </td>
                    <td>{formatPrice(order.pricePerDay)}</td>
                    <td>{order.filledQuantity} / {liveQuantity(order)}</td>
                    <td>
                      {formatMargin(calculateMargin(order.pricePerDay, order.quantity, order.isBuy))}
                    </td>
                    <td><DateTimeCell timestamp={order.timestamp} /></td>
                    <td>
                      {order.isActive && !order.closedAt && (
                        <ActionButtons>
                          <ModifyButton onClick={() => handleModifyOrder(order)}>Modify</ModifyButton>
                          <CloseButton onClick={() => handleCloseOrder(order)}>Close</CloseButton>
                        </ActionButtons>
                      )}
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </TableContainer>

          {orders.length === 0 && (
            <EmptyState>
              <p>No orders found</p>
            </EmptyState>
          )}
        </>
      )}

      {selectedOrder && (
        <ModifyFuturesOrderModal
          open={modifyModal.isOpen}
          order={selectedOrder}
          participantData={participantData}
          latestPrice={latestPrice}
          mmSpotShock={mmSpotShock}
          minMargin={minMargin}
          newestItemPrice={newestItemPrice}
          accountBalance={accountBalance}
          contractMode={contractMode}
          balanceQuery={balanceQuery}
          onClose={() => {
            modifyModal.close();
            setSelectedOrder(null);
          }}
        />
      )}

      {selectedCloseOrder && (
        <ModalItem open={closeModal.isOpen} setOpen={closeModal.setOpen}>
          <CloseOrderForm
            isBuy={selectedCloseOrder.isBuy}
            pricePerDay={selectedCloseOrder.pricePerDay}
            expirationAt={selectedCloseOrder.expirationAt}
            amount={selectedCloseOrder.quantity}
            orderIds={[selectedCloseOrder.id]}
            contractMode={contractMode}
            closeForm={() => {
              closeModal.close();
              setSelectedCloseOrder(null);
            }}
          />
        </ModalItem>
      )}
    </OrdersContainer>
  );
};

// Flat section rather than a card: the tab widget already draws the border and
// pads its content, so a SmallWidget here would nest a second card inside it.
const OrdersContainer = styled("div")`
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
  min-width: 400px;
  
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

const _StatusBadge = styled("span")<{ $status: string }>`
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background-color: ${(props) => {
    switch (props.$status) {
      case "Active":
        return tokens.trading.longRowBg;
      case "Filled":
        return tokens.trading.infoRowBg;
      case "Cancelled":
        return tokens.trading.shortRowBg;
      default:
        return tokens.trading.neutralRowBg;
    }
  }};
  color: ${(props) => getStatusColor(props.$status)};
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

const CloseButton = styled("button")`
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

// Helper function for status color
const getStatusColor = (status: string) => {
  switch (status) {
    case "Active":
      return tokens.trading.long;
    case "Filled":
      return tokens.trading.info;
    case "Cancelled":
      return tokens.trading.short;
    default:
      return tokens.text.muted;
  }
};
