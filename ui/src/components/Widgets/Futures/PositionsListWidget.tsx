import { tokens } from "../../../styles/tokens";
import styled from "@mui/material/styles/styled";
import Tooltip from "@mui/material/Tooltip";
import { SmallWidget } from "../../Cards/Cards.styled";
import type { PositionBookPosition } from "../../../hooks/data/usePositionBook";
import { useCreateOrder } from "../../../hooks/data/useCreateOrder";
import { useCreatePerpsOrder } from "../../../hooks/data/perps/useCreatePerpsOrder";
import { useGetMarketPrice } from "../../../hooks/data/useGetMarketPrice";
import { ServerStackIcon, CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { useModal } from "../../../hooks/useModal";
import { ModalItem } from "../../Modal";
import { DepositDeliveryPaymentForm } from "../../Forms/DepositDeliveryPaymentForm";
import { useState } from "react";
import { getMinMarginForPositionManual } from "../../../hooks/data/getMinMarginForPositionManual";
import { useFuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
import type { ContractMode } from "../../../types/types";

interface BalanceQueryResult {
  data: bigint | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: () => void;
}

interface PositionsListWidgetProps {
  positions: PositionBookPosition[];
  isLoading?: boolean;
  participantAddress?: `0x${string}`;
  onClosePosition?: (price: string, amount: number, isBuy: boolean) => void;
  contractMode?: ContractMode;
  balanceQuery: BalanceQueryResult;
}

export const PositionsListWidget = ({
  positions,
  isLoading,
  participantAddress,
  onClosePosition,
  contractMode = "futures",
  balanceQuery,
}: PositionsListWidgetProps) => {
  // Conditionally use futures or perps create order hook
  const futuresCreateOrder = useCreateOrder();
  const perpsCreateOrder = useCreatePerpsOrder();
  const { createOrderAsync, isPending } = contractMode === "perpetual" ? perpsCreateOrder : futuresCreateOrder;
  const { data: marketPrice } = useGetMarketPrice();
  const contractSpecsQuery = useFuturesContractSpecs();
  const depositModal = useModal();
  const [selectedDeliveryDate, setSelectedDeliveryDate] = useState<bigint | null>(null);
  const [selectedPricePerDay, setSelectedPricePerDay] = useState<bigint | null>(null);
  const [selectedTotalContracts, setSelectedTotalContracts] = useState<number | null>(null);
  const [selectedPositions, setSelectedPositions] = useState<PositionBookPosition[]>([]);

  const getStatusColor = (isActive: boolean, closedAt: string | null) => {
    if (closedAt) {
      return tokens.text.muted; // Closed
    }
    return isActive ? tokens.trading.long : tokens.trading.short; // Active or Cancelled
  };

  const getStatusText = (isActive: boolean, closedAt: string | null) => {
    if (closedAt) {
      return "Closed";
    }
    return isActive ? "Open" : "Cancelled";
  };

  const getPositionType = (position: PositionBookPosition) => {
    if (!participantAddress) return "Unknown";
    return position.buyer.address.toLowerCase() === participantAddress.toLowerCase() ? "Long" : "Short";
  };

  const getTypeColor = (position: PositionBookPosition) => {
    const type = getPositionType(position);
    return type === "Long" ? tokens.trading.long : tokens.trading.short;
  };

  const getPriceForPosition = (position: PositionBookPosition) => {
    const positionType = getPositionType(position);
    return positionType === "Long" ? position.buyPricePerDay : position.sellPricePerDay;
  };

  const formatPrice = (price: bigint) => {
    return (Number(price) / 1e6).toFixed(2); // Convert from wei to USDC
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(Number(timestamp) * 1000);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Get latest price from market price hook
  const latestPrice = marketPrice ? Number(marketPrice) / 1e6 : null;
  const latestPriceBigInt = marketPrice ?? null;

  // Get contract specs
  const marginPercent = contractSpecsQuery.data?.data?.liquidationMarginPercent ?? 20;
  const deliveryDurationDays = contractSpecsQuery.data?.data?.deliveryDurationDays ?? 7;

  // Calculate margin for a position
  const calculateMargin = (pricePerDay: bigint, amount: number, positionType: string): bigint | null => {
    if (!latestPriceBigInt) return null;
    const qty = positionType === "Long" ? amount : -amount;
    return getMinMarginForPositionManual(pricePerDay, qty, latestPriceBigInt, marginPercent, deliveryDurationDays);
  };

  const formatMargin = (margin: bigint | null): string => {
    if (margin === null) return "-";
    return `${(Number(margin) / 1e6).toFixed(2)} USDC`;
  };

  // Calculate PnL for a position
  const calculatePnL = (
    entryPrice: bigint,
    positionType: string,
    amount: number,
  ): { pnl: number | null; percentage: number | null } => {
    if (!latestPrice) return { pnl: null, percentage: null };

    const entryPriceNum = Number(entryPrice) / 1e6;
    const priceDiff = latestPrice - entryPriceNum;

    // Long: profit when price goes up (current > entry)
    // Short: profit when price goes down (entry > current)
    // Multiply by deliveryDurationDays to get total PnL for the contract period
    const pnl = (positionType === "Long" ? priceDiff * amount : -priceDiff * amount) * deliveryDurationDays;
    // Calculate percentage based on PnL and initial investment (entry value)
    const entryValue = latestPrice * amount * deliveryDurationDays;
    const percentage = entryValue !== 0 ? (pnl / entryValue) * 100 : 0;

    return { pnl, percentage };
  };

  const formatPnL = (pnl: number | null, percentage: number | null): string => {
    if (pnl === null || percentage === null) return "-";
    return `${pnl.toFixed(2)} (${percentage.toFixed(2)}%)`;
  };

  const handleClosePosition = async (groupedPosition: {
    pricePerDay: bigint;
    deliveryAt: string;
    positionType: string;
    amount: number;
    positions: PositionBookPosition[];
  }) => {
    // Determine order type to close the position
    // If it's a Long position, create a Sell order (negative quantity)
    // If it's a Short position, create a Buy order (positive quantity)
    // Quantity sign: positive = Buy, negative = Sell
    const quantity =
      groupedPosition.positionType === "Short"
        ? groupedPosition.amount // Buy order (positive)
        : -groupedPosition.amount; // Sell order (negative)

    // Use market price instead of position price for closing
    const priceString = latestPrice ? latestPrice.toFixed(2) : formatPrice(groupedPosition.pricePerDay);

    // Determine isBuy for callback compatibility
    const isBuy = quantity > 0;

    // If callback provided, use it to populate place order widget
    if (onClosePosition) {
      onClosePosition(priceString, Math.abs(quantity), isBuy);
      return;
    }

    // Otherwise, create order directly (fallback behavior)
    try {
      // Use deliveryAt directly (it's already a timestamp)
      const deliveryDate = BigInt(groupedPosition.deliveryAt);

      // Use market price for the order
      const closePrice = latestPriceBigInt ?? groupedPosition.pricePerDay;

      if (contractMode === "perpetual") {
        // Perps only needs price and quantity
        await createOrderAsync({
          price: closePrice,
          quantity: quantity,
        });
      } else {
        // Futures needs price, deliveryDate, quantity, and destUrl
        await createOrderAsync({
          price: closePrice,
          deliveryDate: deliveryDate,
          quantity: quantity,
          destUrl: "",
        });
      }

      console.log(
        `Created ${isBuy ? "buy" : "sell"} order to close ${Math.abs(quantity)} ${groupedPosition.positionType} positions at market price`,
      );
    } catch (err) {
      console.error("Failed to close position:", err);
    }
  };

  // Group positions by price (based on position type), deliveryAt, and position type
  const groupedPositions = positions.reduce(
    (acc, position) => {
      const positionType = getPositionType(position);
      const pricePerDay = getPriceForPosition(position);
      const key = `${pricePerDay}-${position.deliveryAt}-${positionType}`;

      if (!acc[key]) {
        acc[key] = {
          pricePerDay: pricePerDay,
          deliveryAt: position.deliveryAt,
          positionType: positionType,
          destURL: position.destURL,
          amount: 0,
          paidCount: 0,
          isActive: position.isActive,
          closedAt: position.closedAt,
          positions: [] as PositionBookPosition[],
        };
      }

      acc[key].amount += 1;
      if (position.isPaid) {
        acc[key].paidCount += 1;
      }
      acc[key].positions.push(position);

      return acc;
    },
    {} as Record<
      string,
      {
        pricePerDay: bigint;
        deliveryAt: string;
        positionType: string;
        destURL: string;
        amount: number;
        paidCount: number;
        isActive: boolean;
        closedAt: string | null;
        positions: PositionBookPosition[];
      }
    >,
  );

  const groupedPositionsArray = Object.values(groupedPositions);

  if (isLoading) {
    return (
      <PositionsContainer>
        <h3>Positions</h3>
        <div style={{ textAlign: "center", padding: "2rem", color: tokens.text.muted }}>
          <p>Loading positions...</p>
        </div>
      </PositionsContainer>
    );
  }

  return (
    <PositionsContainer>
      <h3>Positions</h3>

      <TableContainer>
        <Table>
          <thead>
            <tr>
              <th>Contract Expiration</th>
              <th>Side</th>
              <th>Price (USDC)</th>
              <th>Size (USDC)</th>
              <th>Margin</th>
              <th>Unrealized PnL (USDC)</th>
              <th>Destination</th>
              <th>Payment</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {groupedPositionsArray.map((groupedPosition, index) => (
              <TableRow
                key={`${groupedPosition.pricePerDay}-${groupedPosition.deliveryAt}-${groupedPosition.positionType}-${index}`}
              >
                <td>{formatTimestamp(groupedPosition.deliveryAt)}</td>
                <td>
                  <TypeBadge $type={groupedPosition.positionType}>{groupedPosition.positionType}</TypeBadge>
                </td>
                <td>{formatPrice(groupedPosition.pricePerDay)}</td>
                <td>{((Number(groupedPosition.pricePerDay) / 1e6) * groupedPosition.amount).toFixed(2)}</td>
                <td>
                  {formatMargin(
                    calculateMargin(groupedPosition.pricePerDay, groupedPosition.amount, groupedPosition.positionType),
                  )}
                </td>
                <td>
                  {(() => {
                    const { pnl, percentage } = calculatePnL(
                      groupedPosition.pricePerDay,
                      groupedPosition.positionType,
                      groupedPosition.amount,
                    );
                    return <PnLCell $isPositive={pnl !== null && pnl >= 0}>{formatPnL(pnl, percentage)}</PnLCell>;
                  })()}
                </td>
                <td>
                  {groupedPosition.destURL ? (
                    <Tooltip title={groupedPosition.destURL}>
                      <DestURLCell>
                        <ServerStackIcon width={20} height={20} />
                      </DestURLCell>
                    </Tooltip>
                  ) : (
                    <span>---</span>
                  )}
                </td>
                <td>
                  {groupedPosition.destURL ? (
                    <PaymentStatusCell>
                      {groupedPosition.paidCount === groupedPosition.amount ? (
                        <CheckCircleIcon width={20} height={20} color={tokens.trading.long} />
                      ) : (
                        <XCircleIcon width={20} height={20} color={tokens.trading.short} />
                      )}
                      <PaymentText>
                        {groupedPosition.paidCount}/{groupedPosition.amount}
                      </PaymentText>
                    </PaymentStatusCell>
                  ) : (
                    <span>---</span>
                  )}
                </td>
                <td>
                  <ActionButtons>
                    {groupedPosition.destURL &&
                      groupedPosition.positionType !== "Short" &&
                      groupedPosition.paidCount < groupedPosition.amount && (
                        <DepositButton
                          onClick={() => {
                            setSelectedDeliveryDate(BigInt(groupedPosition.deliveryAt));
                            setSelectedPricePerDay(groupedPosition.pricePerDay);
                            setSelectedTotalContracts(groupedPosition.amount);
                            setSelectedPositions(groupedPosition.positions);
                            depositModal.open();
                          }}
                          title="Deposit delivery payment"
                        >
                          Deposit
                        </DepositButton>
                      )}
                    {groupedPosition.isActive && !groupedPosition.closedAt && (
                      <CloseButton
                        onClick={() => handleClosePosition(groupedPosition)}
                        disabled={isPending}
                        title="By creating opposite order"
                      >
                        Close
                      </CloseButton>
                    )}
                  </ActionButtons>
                </td>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableContainer>

      {groupedPositionsArray.length === 0 && (
        <EmptyState>
          <p>No positions found</p>
        </EmptyState>
      )}

      <ModalItem open={depositModal.isOpen} setOpen={depositModal.setOpen}>
        {selectedDeliveryDate !== null &&
          selectedPricePerDay !== null &&
          selectedTotalContracts !== null &&
          selectedPositions.length > 0 && (
            <DepositDeliveryPaymentForm
              closeForm={() => {
                depositModal.close();
                setSelectedDeliveryDate(null);
                setSelectedPricePerDay(null);
                setSelectedTotalContracts(null);
                setSelectedPositions([]);
              }}
              deliveryDate={selectedDeliveryDate}
              pricePerDay={selectedPricePerDay}
              totalContracts={selectedTotalContracts}
              positions={selectedPositions}
              balanceQuery={balanceQuery}
            />
          )}
      </ModalItem>
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
  min-width: 600px;
  
  th {
    text-align: left;
    padding: 0.75rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: ${tokens.text.secondary};
    border-bottom: 1px solid ${tokens.overlay.white10};
    white-space: nowrap;
    
    &:first-child {
      width: 200px;
      min-width: 200px;
    }
  }
  
  td {
    padding: 0.75rem 0.5rem;
    font-size: 0.875rem;
    color: ${tokens.text.onDark};
    border-bottom: 1px solid ${tokens.overlay.white05};
    
    &:first-child {
      width: 200px;
      min-width: 200px;
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

const PnLCell = styled("span")<{ $isPositive: boolean }>`
  color: ${(props) => (props.$isPositive ? tokens.trading.long : tokens.trading.short)};
  font-weight: 600;
`;

const DestURLCell = styled("span")`
  display: inline-block;
  max-width: 200px;
  overflow: hidden;
  cursor: pointer;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${tokens.text.secondary};
  font-size: 0.875rem;
`;

const PaymentStatusCell = styled("span")`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const PaymentText = styled("span")`
  font-size: 0.875rem;
  color: ${tokens.text.onDark};
`;

const StatusBadge = styled("span")<{ $status: string }>`
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background-color: ${(props) => {
    switch (props.$status) {
      case "Open":
        return tokens.trading.longRowBg;
      case "Closed":
        return tokens.trading.neutralRowBg;
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

const DepositButton = styled("button")`
  padding: 0.5rem 0.875rem;
  background: ${tokens.surface.tabActive};
  color: ${tokens.text.onDark};
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.1s ease;
  
  &:hover {
    background: ${tokens.surface.tabHover};
    transform: translateY(-1px);
  }
  
  &:active {
    transform: translateY(0);
  }
`;

const CloseButton = styled("button")`
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

// Helper function for status color
const getStatusColor = (status: string) => {
  switch (status) {
    case "Open":
      return tokens.trading.long;
    case "Closed":
      return tokens.text.muted;
    default:
      return tokens.text.muted;
  }
};
