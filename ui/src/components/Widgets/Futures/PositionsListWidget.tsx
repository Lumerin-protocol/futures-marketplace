import { tokens } from "../../../styles/tokens";
import styled from "@mui/material/styles/styled";
import Tooltip from "@mui/material/Tooltip";
import { SmallWidget } from "../../Cards/Cards.styled";
import type { PositionBookPosition } from "../../../hooks/data/getUserFuturesPositions";
import { useCreateOrder } from "../../../hooks/data/useCreateOrder";
import { useCreatePerpsOrder } from "../../../hooks/data/perps/useCreatePerpsOrder";
import { useGetMarketPrice } from "../../../hooks/data/useGetMarketPrice";
import { useSettlePositions } from "../../../hooks/data/useSettlePositions";
import { useState } from "react";
import { getMinMarginForPositionManual } from "../../../hooks/data/getMinMarginForPositionManual";
import { useFuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
import type { ContractMode } from "../../../types/types";
import { DateTimeCell } from "../../DateTimeCell";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
import { FuturesTradesModal, type FuturesTradesModalSelection } from "./FuturesTradesModal";
import { LiquidationChip, formatLiquidatedQty } from "../../../lib/liquidation";

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
  onClosePosition?: (price: string, amount: number, isBuy: boolean, deliveryAt?: number) => void;
  contractMode?: ContractMode;
  balanceQuery: BalanceQueryResult;
}

export const PositionsListWidget = ({
  positions,
  isLoading,
  participantAddress,
  onClosePosition,
  contractMode = "futures",
}: PositionsListWidgetProps) => {
  // Conditionally use futures or perps create order hook
  const futuresCreateOrder = useCreateOrder();
  const perpsCreateOrder = useCreatePerpsOrder();
  const { createOrderAsync, isPending } = contractMode === "perpetual" ? perpsCreateOrder : futuresCreateOrder;
  const { data: marketPrice } = useGetMarketPrice();
  const contractSpecsQuery = useFuturesContractSpecs();
  const [tradesSelection, setTradesSelection] = useState<FuturesTradesModalSelection | null>(null);
  const { settlePositionsAsync, isPending: isSettling } = useSettlePositions();
  // deliveryAt currently being claimed, plus any per-expiration claim error message.
  const [claimingDeliveryAt, setClaimingDeliveryAt] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<{ deliveryAt: string; message: string } | null>(null);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const isMatured = (deliveryAt: string) =>
    contractMode === "futures" && Number(deliveryAt) > 0 && Number(deliveryAt) < nowSeconds;

  const handleClaim = async (deliveryAt: string) => {
    setClaimError(null);
    setClaimingDeliveryAt(deliveryAt);
    try {
      await settlePositionsAsync({
        deliveryAt: BigInt(deliveryAt),
        participant: participantAddress,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // Surface the common, recoverable cases in plain language.
      let message = "Failed to settle. Please try again.";
      if (/OracleStale/i.test(raw)) {
        message = "Price feed is stale — settlement will be possible once the oracle refreshes.";
      } else if (/No open positions/i.test(raw)) {
        message = "Already settled.";
      } else if (/User rejected|denied/i.test(raw)) {
        message = "Transaction rejected.";
      }
      setClaimError({ deliveryAt, message });
    } finally {
      setClaimingDeliveryAt(null);
    }
  };

  const getPositionType = (position: PositionBookPosition) => {
    if (!participantAddress) return "Unknown";
    return position.buyer.address.toLowerCase() === participantAddress.toLowerCase() ? "Long" : "Short";
  };

  const getPriceForPosition = (position: PositionBookPosition) => {
    const positionType = getPositionType(position);
    return positionType === "Long" ? position.buyPricePerDay : position.sellPricePerDay;
  };

  const formatPrice = (price: bigint) => {
    return (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2); // Convert from wei to USDC
  };


  // Get latest price from market price hook
  const latestPrice = marketPrice ? Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM : null;
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
    return `${(Number(margin) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2)} USDC`;
  };

  // PnL = (mark - entry) * signedQty * deliveryDays, mirroring the on-chain
  // settlement math in `getMinMarginForPositionManual`. Signed `netQuantity`
  // encodes side (long > 0, short < 0), so the sign of the result falls out
  // naturally. The percentage is taken against entry notional (fixed at fill
  // time) so it doesn't drift with the market price the way a mark-notional
  // denominator does.
  const calculatePnL = (
    entryPrice: bigint,
    netQuantity: number,
    // When the expiration's settlement price is pinned, PnL is frozen at that price
    // instead of drifting with the live mark.
    markOverride?: bigint | null,
  ): { pnl: number | null; percentage: number | null } => {
    const mark = markOverride ?? latestPriceBigInt;
    if (!mark) return { pnl: null, percentage: null };
    if (netQuantity === 0) return { pnl: 0, percentage: 0 };

    const signedQty = BigInt(netQuantity);
    const absQty = signedQty < 0n ? -signedQty : signedQty;
    const days = BigInt(deliveryDurationDays);

    const pnlScaled = (mark - entryPrice) * signedQty * days;
    const entryNotionalScaled = entryPrice * absQty * days;

    const pnl = Number(pnlScaled) / PAYMENT_TOKEN_SCALE_NUM;
    const percentage =
      entryNotionalScaled === 0n ? 0 : (Number(pnlScaled) / Number(entryNotionalScaled)) * 100;

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
    netQuantity: number;
    positions: PositionBookPosition[];
  }) => {
    // Determine order type to close the position
    // If it's a Long position, create a Sell order (negative quantity)
    // If it's a Short position, create a Buy order (positive quantity)
    // Quantity sign: positive = Buy, negative = Sell.
    // Size is taken from the session-level `netQuantity` (the actual signed
    // position size), not `groupedPosition.amount` (a count of how many
    // PositionBookPosition rows fell into this group — usually 1, since
    // sessions are per-(user, deliveryAt) and one session collapses to one
    // PositionBookPosition).
    const positionSize = Math.abs(groupedPosition.netQuantity);
    const quantity =
      groupedPosition.positionType === "Short"
        ? positionSize // Buy order (positive)
        : -positionSize; // Sell order (negative)

    // Use market price instead of position price for closing
    const priceString = latestPrice ? latestPrice.toFixed(2) : formatPrice(groupedPosition.pricePerDay);

    // Determine isBuy for callback compatibility
    const isBuy = quantity > 0;

    // If callback provided, use it to populate place order widget
    if (onClosePosition) {
      onClosePosition(priceString, Math.abs(quantity), isBuy, Number(groupedPosition.deliveryAt));
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
          amount: 0,
          // Sessions are per (user, deliveryAt), so every position rolling up
          // into this group shares the same session-level net qty. Take it
          // from the first one we see; subsequent ones would just duplicate it.
          netQuantity: position.netQuantity,
          liquidatedQuantity: position.liquidatedQuantity,
          isActive: position.isActive,
          closedAt: position.closedAt,
          timestamp: position.timestamp,
          settlementPrice: position.settlementPrice,
          settledAt: position.settledAt,
          positions: [] as PositionBookPosition[],
        };
      }

      acc[key].amount += 1;
      acc[key].positions.push(position);

      return acc;
    },
    {} as Record<
      string,
      {
        pricePerDay: bigint;
        deliveryAt: string;
        positionType: string;
        amount: number;
        netQuantity: number;
        liquidatedQuantity: number;
        isActive: boolean;
        closedAt: string | null;
        timestamp: string;
        settlementPrice: bigint | null;
        settledAt: string | null;
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
              <th>Quantity</th>
              <th>Margin</th>
              <th>Unrealized PnL (USDC)</th>
              <th>Time</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {groupedPositionsArray.map((groupedPosition, index) => (
              <TableRow
                key={`${groupedPosition.pricePerDay}-${groupedPosition.deliveryAt}-${groupedPosition.positionType}-${index}`}
              >
                {(() => {
                  const matured = isMatured(groupedPosition.deliveryAt);
                  const settlementPrice = groupedPosition.settlementPrice;
                  const pricePinned = settlementPrice !== null;
                  // PnL freezes at the pinned settlement price the moment it's recorded.
                  const { pnl, percentage } = calculatePnL(
                    groupedPosition.pricePerDay,
                    groupedPosition.netQuantity,
                    pricePinned ? settlementPrice : null,
                  );
                  const rowClaimError =
                    claimError?.deliveryAt === groupedPosition.deliveryAt ? claimError.message : null;
                  const isRowClaiming = claimingDeliveryAt === groupedPosition.deliveryAt;
                  return (
                    <>
                      <td style={matured ? { color: "#EF4444" } : undefined}><DateTimeCell timestamp={groupedPosition.deliveryAt} /></td>
                      <td>
                        <SideCell>
                          <TypeBadge $type={groupedPosition.positionType}>{groupedPosition.positionType}</TypeBadge>
                          {groupedPosition.liquidatedQuantity > 0 && (
                            <LiquidationChip
                              title={formatLiquidatedQty(
                                groupedPosition.liquidatedQuantity,
                                groupedPosition.netQuantity,
                              )}
                            >
                              {formatLiquidatedQty(
                                groupedPosition.liquidatedQuantity,
                                groupedPosition.netQuantity,
                              )}
                            </LiquidationChip>
                          )}
                        </SideCell>
                      </td>
                      <td>{formatPrice(groupedPosition.pricePerDay)}</td>
                      <td>{Math.abs(groupedPosition.netQuantity)}</td>
                      <td>
                        {formatMargin(
                          calculateMargin(
                            groupedPosition.pricePerDay,
                            groupedPosition.amount,
                            groupedPosition.positionType,
                          ),
                        )}
                      </td>
                      <td>
                        <PnLCell $isPositive={pnl !== null && pnl >= 0}>{formatPnL(pnl, percentage)}</PnLCell>
                      </td>
                      <td><DateTimeCell timestamp={groupedPosition.timestamp} /></td>
                      <td>
                        <ActionButtons>
                          <TradesButton
                            onClick={() =>
                              setTradesSelection({
                                pricePerDay: groupedPosition.pricePerDay,
                                deliveryAt: groupedPosition.deliveryAt,
                                positionType: groupedPosition.positionType as "Long" | "Short",
                              })
                            }
                            title="View matching trades from the last 30 days"
                          >
                            Trades
                          </TradesButton>
                          {groupedPosition.isActive && !groupedPosition.closedAt && !matured && (
                            <CloseButton
                              onClick={() => handleClosePosition(groupedPosition)}
                              disabled={isPending}
                              title="By creating opposite order"
                            >
                              Close
                            </CloseButton>
                          )}
                          {groupedPosition.isActive && !groupedPosition.closedAt && matured && (
                            <Tooltip
                              title="Cash-settle this matured position now (normally the keeper does this automatically)"
                              arrow
                            >
                              <span style={{ display: "inline-flex" }}>
                                <ClaimButton
                                  onClick={() => handleClaim(groupedPosition.deliveryAt)}
                                  disabled={isSettling && isRowClaiming}
                                >
                                  {isRowClaiming ? "Claiming…" : <><span>Claim</span><ClaimHintIcon>?</ClaimHintIcon></>}
                                </ClaimButton>
                              </span>
                            </Tooltip>
                          )}
                          {rowClaimError && <ClaimErrorText>{rowClaimError}</ClaimErrorText>}
                        </ActionButtons>
                      </td>
                    </>
                  );
                })()}
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

      <FuturesTradesModal
        open={tradesSelection !== null}
        onClose={() => setTradesSelection(null)}
        selection={tradesSelection}
        participantAddress={participantAddress}
        activePositions={positions}
        contractMode={contractMode}
      />
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

const SideCell = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
`;

const PnLCell = styled("span")<{ $isPositive: boolean }>`
  color: ${(props) => (props.$isPositive ? tokens.trading.long : tokens.trading.short)};
  font-weight: 600;
`;


const ActionButtons = styled("div")`
  display: flex;
  gap: 0.5rem;
  align-items: center;
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

const ClaimButton = styled("button")`
  display: inline-flex;
  align-items: center;
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

const ClaimHintIcon = styled("span")`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  margin-left: 5px;
  vertical-align: middle;
  opacity: 0.75;
`;

const ClaimErrorText = styled("span")`
  color: ${tokens.trading.short};
  font-size: 0.75rem;
  max-width: 180px;
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

