import { type FC, useState, useEffect } from "react";
import {
  waitForOrderBookBlockNumber,
  getOrderBookQueryKey,
} from "../../hooks/data/orderBookHelpers";
import { TransactionFormV2 as TransactionForm } from "./Shared/MultistepForm";
import type { TransactionReceipt } from "viem";
import { useCreateOrder } from "../../hooks/data/useCreateOrder";
import { useCreatePerpsOrder } from "../../hooks/data/perps/useCreatePerpsOrder";
import { useUpdateFuturesOrders } from "../../hooks/data/useModifyOrder";
import { useUpdatePerpsOrders } from "../../hooks/data/perps/useUpdatePerpsOrders";
import { PARTICIPANT_QK } from "../../hooks/data/getUserFuturesOrders";
import { POSITION_BOOK_QK } from "../../hooks/data/getUserFuturesPositions";
import { USER_PERPS_ORDERS_QK } from "../../hooks/data/perps/useUserPerpsOrders";
import { USER_POSITION_SESSIONS_QK } from "../../hooks/data/perps/useUserPositionSessions";
import { HISTORICAL_ORDERS_QK } from "../../hooks/data/useHistoricalOrders";
import { FUTURES_POSITION_HISTORY_QK } from "../../hooks/data/useFuturesPositionHistory";
import { USER_FUTURES_TRADES_QK } from "../../hooks/data/useUserFuturesTrades";
import { invalidatePortfolioPnl } from "../../hooks/data/pnl/invalidate";
import { PERPS_ORDER_HISTORY_QK } from "../../hooks/data/perps/usePerpsOrderHistory";
import { PERPS_POSITION_HISTORY_QK } from "../../hooks/data/perps/usePerpsPositionHistory";
import { USER_TRADES_QK } from "../../hooks/data/perps/useUserTrades";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, } from "wagmi";
import type { Participant } from "../../hooks/data/getUserFuturesOrders";
import type { ContractMode } from "../../types/types";
import { useFuturesContractSpecs } from "../../hooks/data/useFuturesContractSpecs";
import { useMarginEngineShocks } from "../../hooks/data/useMarginEngineShocks";
import { getMinMarginForPositionManual } from "../../hooks/data/getMinMarginForPositionManual";
import Tooltip from "@mui/material/Tooltip";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { useMakerTakerFees } from "../../hooks/data/useMakerTakerFees";
import { usePointsHookWeights } from "../../hooks/data/usePointsHookWeights";
import type { PerpsCollection } from "../../hooks/data/perps/usePerpsCollection";
import {
  formatHashratePHPS,
  PAYMENT_TOKEN_SCALE_NUM,
  QUANTITY_SCALE,
  QUANTITY_SCALE_NUM,
} from "../../lib/units";
import { TimeInForce, type TimeInForceValue } from "../../types/timeInForce";

/**
 * How an incoming order nets against the user's own resting orders on the other
 * side of the book. Quantities are in display units — whole contracts for
 * futures, decimal for perps — the same units as the `quantity` prop.
 */
export interface OrderOffsetPlan {
  cancelIds: `0x${string}`[];
  reduces: { orderId: `0x${string}`; newQuantity: bigint }[];
  /** Absorbed by the cancels and reduces. */
  offsetQty: number;
  /** Exceeds the resting size and still has to be placed. */
  leftoverQty: number;
}

interface Props {
  price: bigint;
  expirationAt: bigint;
  quantity: number; // Positive for Buy, Negative for Sell
  participantData?: Participant | null;
  latestPrice: bigint | null;
  onOrderPlaced?: () => void | Promise<void>;
  closeForm: () => void;
  bypassConflictCheck?: boolean; // Allow proceeding despite conflicting orders
  /** Set when the user chose to net against their resting orders instead of placing. */
  offsetPlan?: OrderOffsetPlan | null;
  contractMode?: ContractMode;
  perpsCollection?: PerpsCollection;
  leverage?: number; // Leverage value for perps mode (e.g., 10 for 10x)
  isMarketOrder?: boolean;
  timeInForce?: TimeInForceValue;
}

export const PlaceOrderForm: FC<Props> = ({
  price,
  expirationAt,
  quantity,
  participantData,
  latestPrice,
  onOrderPlaced,
  closeForm,
  bypassConflictCheck = false,
  offsetPlan = null,
  contractMode = "futures",
  perpsCollection,
  leverage = 10,
  isMarketOrder = false,
  timeInForce = TimeInForce.GTC,
}) => {
  // Conditionally use futures or perps create order hook
  const futuresCreateOrder = useCreateOrder();
  const perpsCreateOrder = useCreatePerpsOrder();
  const { updateOrdersAsync: futuresUpdateOrders } = useUpdateFuturesOrders();
  const { updateOrdersAsync: perpsUpdateOrders } = useUpdatePerpsOrders();
  const qc = useQueryClient();
  const { address } = useAccount();
  const _publicClient = usePublicClient();
  const contractSpecsQuery = useFuturesContractSpecs();
  const { makerFeePercent, takerFeePercent, isLoading: isFeesLoading } = useMakerTakerFees();
  const { wMaker, wTaker, weightScale, isLoading: isWeightsLoading } = usePointsHookWeights();

  // Determine order type from quantity sign
  const isBuy = quantity > 0;
  const absoluteQuantity = Math.abs(quantity);

  // Only the part that outlives the offset reaches the book, so it is the only
  // part that needs margin or shows up as a new resting order.
  const restingQuantity = offsetPlan ? offsetPlan.leftoverQty : absoluteQuantity;

  // Notional size (USDC) of this order — matches the "Size" row below.
  const sizeUSDC = (Number(price) / PAYMENT_TOKEN_SCALE_NUM) * absoluteQuantity;

  // Expected hashrate = order quantity × on-chain contract size (hashes/s·day),
  // formatted as PH/s. One unit settles the value of `contractSizeHpsDay`.
  const contractSizeHpsDay = contractSpecsQuery.data?.data?.contractSizeHpsDay;
  const expectedHashrate =
    contractSizeHpsDay !== undefined
      ? formatHashratePHPS(
          (contractSizeHpsDay * BigInt(Math.round(absoluteQuantity * QUANTITY_SCALE_NUM))) /
            QUANTITY_SCALE,
        ).full
      : null;

  // Estimated points rewards: points = weight * size / WEIGHT_SCALE.
  const makerReward =
    wMaker !== undefined && weightScale ? (Number(wMaker) * sizeUSDC) / Number(weightScale) : null;
  const takerReward =
    wTaker !== undefined && weightScale ? (Number(wTaker) * sizeUSDC) / Number(weightScale) : null;
  // Maintenance shock from the PortfolioMarginEngine (WAD): margin is a
  // cross-account figure, so this only previews a single leg.
  const { mmSpotShock } = useMarginEngineShocks();

  // State for required margin
  const [requiredMargin, setRequiredMargin] = useState<bigint | null>(null);
  const [isLoadingMargin, setIsLoadingMargin] = useState(false);

  // Calculate required margin when price or quantity changes
  useEffect(() => {
    if (!latestPrice || mmSpotShock === undefined) return;
    setIsLoadingMargin(true);

    let margin: bigint;
    if (contractMode === "perpetual") {
      // For perps: calculate margin based on leverage
      // Formula: (price * quantity) * (1 / leverage)
      // Example: 10x leverage = 10% margin, 5x leverage = 20% margin
      const positionValue =
        (price * BigInt(Math.round(restingQuantity * QUANTITY_SCALE_NUM))) / QUANTITY_SCALE;
      const marginPercent = BigInt(Math.round((1 / leverage) * 100)); // Convert leverage to margin %
      margin = (positionValue * marginPercent) / 100n;
    } else {
      // For futures: use the existing calculation with PnL
      margin = getMinMarginForPositionManual(
        price,
        isBuy ? restingQuantity : -restingQuantity,
        latestPrice,
        mmSpotShock,
      );
    }

    setRequiredMargin(margin);
    setIsLoadingMargin(false);
  }, [
    latestPrice,
    price,
    isBuy,
    contractMode,
    restingQuantity,
    mmSpotShock,
    leverage,
  ]);

  // Check for conflicting orders (opposite action, same price, same expiration date)
  const hasConflictingOrder = () => {
    if (!participantData?.orders) return false;

    const priceInWei = price;
    const expirationAtValue = expirationAt;
    const oppositeIsBuy = !isBuy;

    return participantData.orders.some(
      (order) =>
        order.isActive &&
        order.isBuy === oppositeIsBuy &&
        order.pricePerDay === priceInWei &&
        order.expirationAt === expirationAtValue,
    );
  };

  const formatQty = (value: number) => value.toFixed(contractMode === "perpetual" ? 6 : 0);
  const oppositeAction = isBuy ? "Ask" : "Bid";

  return (
    <TransactionForm
      onClose={closeForm}
      title={offsetPlan ? "Offset Order" : isBuy ? "Place Bid Order" : "Place Ask Order"}
      description={""}
      reviewForm={(_props) => (
        <>
          <div className="mb-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-300">
                  {contractMode === "futures" ? "Price Per Day:" : "Price:"}
                </span>
                <span className="text-white">
                  {isMarketOrder ? "Market" : `${Number(price) / PAYMENT_TOKEN_SCALE_NUM} USDC`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Quantity:</span>
                <span className="text-white">{absoluteQuantity.toFixed(6)}</span>
              </div>
              {offsetPlan && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Offsets your {oppositeAction}:</span>
                    <span className="text-white">{formatQty(offsetPlan.offsetQty)} units</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">New resting order:</span>
                    <span className="text-white">
                      {offsetPlan.leftoverQty > 0
                        ? `${formatQty(offsetPlan.leftoverQty)} units`
                        : "None"}
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-gray-300">Time in Force:</span>
                <span className="text-white">
                  {timeInForce === TimeInForce.IOC
                    ? "IOC"
                    : timeInForce === TimeInForce.FOK
                      ? "FOK"
                      : "GTC"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Size:</span>
                <span className="text-white">{sizeUSDC.toFixed(2)} USDC</span>
              </div>
              {contractMode === "futures" && (
                <div className="flex justify-between">
                  <span className="text-gray-300">Delivery Date:</span>
                  <span className="text-white">
                    {new Date(Number(expirationAt) * 1000).toLocaleString()}
                  </span>
                </div>
              )}
              {contractMode === "futures" && (
                <div className="flex justify-between">
                  <span className="text-gray-300">Expected Hashrate:</span>
                  <span className="text-white">{expectedHashrate ?? "—"}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-300">Required Margin:</span>
                <span className="text-white">
                  {requiredMargin !== null
                    ? `${(Math.abs(Number(requiredMargin)) / PAYMENT_TOKEN_SCALE_NUM).toFixed(
                        2,
                      )} USDC`
                    : isLoadingMargin
                    ? "Loading..."
                    : "N/A"}
                </span>
              </div>
              {contractMode === "perpetual" ? (
                <div className="flex justify-between">
                  <span className="text-gray-300">Maker / Taker Fee:</span>
                  <span className="text-white">
                    {perpsCollection?.makerFeeBps !== undefined &&
                    perpsCollection?.takerFeeBps !== undefined
                      ? `${(perpsCollection.makerFeeBps / 100).toFixed(2)}% / ${(
                          perpsCollection.takerFeeBps / 100
                        ).toFixed(2)}%`
                      : "N/A"}
                  </span>
                </div>
              ) : (
                <div className="flex justify-between">
                  <span className="text-gray-300">Maker / Taker Fee:</span>
                  <span className="text-white">
                    {makerFeePercent !== null && takerFeePercent !== null
                      ? `${makerFeePercent.toFixed(2)}% / ${takerFeePercent.toFixed(2)}%`
                      : isFeesLoading
                      ? "Loading..."
                      : "N/A"}
                  </span>
                </div>
              )}
              {isMarketOrder && (
                <div className="flex justify-between">
                  <span className="text-gray-300">Slippage:</span>
                  <span className="text-white">5%</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-300 flex items-center gap-1">
                  Maker / Taker Points:
                  <Tooltip title="Points are only rewarded if your order is matched and becomes a position.">
                    <HelpOutlineIcon sx={{ fontSize: 14, cursor: "help", color: "inherit" }} />
                  </Tooltip>
                </span>
                <span className="text-white">
                  {makerReward !== null && takerReward !== null
                    ? `${makerReward.toFixed(2)} / ${takerReward.toFixed(2)} pts`
                    : isWeightsLoading
                    ? "Loading..."
                    : "N/A"}
                </span>
              </div>
            </div>
          </div>
          <p className="text-gray-400 text-sm">
            {offsetPlan
              ? `You are about to offset your resting ${oppositeAction} order. Please review the details above.`
              : `You are about to place a ${isBuy ? "bid" : "ask"} order. Please review the details above.`}
          </p>
        </>
      )}
      resultForm={(_props) => (
        <>
          <p className="w-6/6 text-left font-normal text-s mt-5">
            {offsetPlan && offsetPlan.leftoverQty === 0
              ? "Your resting order has been offset and will leave the order book shortly."
              : "Your order has been placed and will appear in the order book shortly."}
          </p>
        </>
      )}
      transactionSteps={[
        {
          label: offsetPlan ? "Offset Order" : `Place ${isBuy ? "Bid" : "Ask"} Order`,
          action: async () => {
            // Check for conflicting order before proceeding. The offset path is
            // the deliberate resolution of that conflict, so it never applies.
            if (!offsetPlan && !bypassConflictCheck && hasConflictingOrder()) {
              const priceInUSDC = Number(price) / PAYMENT_TOKEN_SCALE_NUM;
              throw new Error(
                `Cannot create ${
                  isBuy ? "Bid" : "Ask"
                } order at price ${priceInUSDC} USDC. You already have an active ${oppositeAction} order at the same price and expiration date. Please close or modify the existing order first.`,
              );
            }

            let txhash: `0x${string}` | undefined;
            if (offsetPlan) {
              // One transaction: the cancels and reduces retire the overlapping
              // size, and only what exceeds it is placed as a new order.
              const leftover = offsetPlan.leftoverQty;
              if (contractMode === "perpetual") {
                txhash = await perpsUpdateOrders({
                  cancelIds: offsetPlan.cancelIds,
                  reduces: offsetPlan.reduces,
                  creates:
                    leftover > 0 ? [{ price, quantity: isBuy ? leftover : -leftover }] : [],
                });
              } else {
                const leftoverUnits = BigInt(Math.round(leftover));
                txhash = await futuresUpdateOrders({
                  cancelIds: offsetPlan.cancelIds,
                  reduces: offsetPlan.reduces,
                  creates:
                    leftoverUnits > 0n
                      ? [
                          {
                            price,
                            expirationAt,
                            quantity: isBuy ? leftoverUnits : -leftoverUnits,
                            timeInForce,
                          },
                        ]
                      : [],
                });
              }
            } else if (contractMode === "perpetual") {
              // Perps only needs price and quantity
              txhash = await perpsCreateOrder.createOrderAsync({
                price,
                quantity,
                timeInForce,
              });
            } else {
              txhash = await futuresCreateOrder.createOrderAsync({
                price,
                expirationAt,
                quantity,
                timeInForce,
              });
            }
            return {
              isSkipped: false,
              txhash: txhash,
            };
          },
          postConfirmation: async (receipt: TransactionReceipt) => {
            // Wait for block number to ensure indexer has updated
            await waitForOrderBookBlockNumber(
              receipt.blockNumber,
              qc,
              contractMode,
              Number(expirationAt),
            );

            // Invalidate queries based on contract mode
            if (contractMode === "perpetual") {
              // For perps, invalidate perps-specific queries
              await Promise.all([
                qc.invalidateQueries({ queryKey: [getOrderBookQueryKey(contractMode)] }),
                address && qc.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, address] }),
                address && qc.invalidateQueries({ queryKey: [USER_POSITION_SESSIONS_QK, address] }),
                // Reset every perps history table back to its newest page.
                address && qc.resetQueries({ queryKey: [PERPS_ORDER_HISTORY_QK, address] }),
                address && qc.resetQueries({ queryKey: [PERPS_POSITION_HISTORY_QK, address] }),
                address && qc.resetQueries({ queryKey: [USER_TRADES_QK, address] }),
                // address && qc.invalidateQueries({ queryKey: [PARTICIPANT_QK] }),
                invalidatePortfolioPnl(qc),
              ]);
            } else {
              // For futures, invalidate futures-specific queries
              await Promise.all([
                qc.invalidateQueries({ queryKey: [getOrderBookQueryKey(contractMode)] }),
                address && qc.invalidateQueries({ queryKey: [POSITION_BOOK_QK] }),
                address && qc.invalidateQueries({ queryKey: [PARTICIPANT_QK] }),
                // Reset every futures history table back to its newest page.
                address && qc.resetQueries({ queryKey: [HISTORICAL_ORDERS_QK, address] }),
                address && qc.resetQueries({ queryKey: [FUTURES_POSITION_HISTORY_QK, address] }),
                address && qc.resetQueries({ queryKey: [USER_FUTURES_TRADES_QK, address] }),
                invalidatePortfolioPnl(qc),
              ]);
            }

            if (onOrderPlaced) {
              await onOrderPlaced();
            }
          },
        },
      ]}
    />
  );
};
