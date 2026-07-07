import { type FC, useState, useEffect } from "react";
import {
  waitForOrderBookBlockNumber,
  getOrderBookQueryKey,
} from "../../hooks/data/orderBookHelpers";
import { TransactionFormV2 as TransactionForm } from "./Shared/MultistepForm";
import type { TransactionReceipt } from "viem";
import { useCreateOrder } from "../../hooks/data/useCreateOrder";
import { useCreatePerpsOrder } from "../../hooks/data/perps/useCreatePerpsOrder";
import { PARTICIPANT_QK } from "../../hooks/data/getUserFuturesOrders";
import { POSITION_BOOK_QK } from "../../hooks/data/getUserFuturesPositions";
import { USER_PERPS_ORDERS_QK } from "../../hooks/data/perps/useUserPerpsOrders";
import { USER_POSITION_SESSIONS_QK } from "../../hooks/data/perps/useUserPositionSessions";
import { USER_PERPS_TRADES_QK } from "../../hooks/data/perps/useUserPerpsTrades";
import { HISTORICAL_ORDERS_QK } from "../../hooks/data/useHistoricalOrders";
import { FUTURES_POSITION_HISTORY_QK } from "../../hooks/data/useFuturesPositionHistory";
import { USER_FUTURES_TRADES_QK } from "../../hooks/data/useUserFuturesTrades";
import { PERPS_ORDER_HISTORY_QK } from "../../hooks/data/perps/usePerpsOrderHistory";
import { PERPS_POSITION_HISTORY_QK } from "../../hooks/data/perps/usePerpsPositionHistory";
import { USER_TRADES_QK } from "../../hooks/data/perps/useUserTrades";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import type { Participant } from "../../hooks/data/getUserFuturesOrders";
import type { ContractMode } from "../../types/types";
import { useFuturesContractSpecs } from "../../hooks/data/useFuturesContractSpecs";
import { calculateMinMargin } from "../../hooks/data/useGetMinMarginForPosition";
import { getMinMarginForPositionManual } from "../../hooks/data/getMinMarginForPositionManual";
import { predefinedPools } from "./BuyerForms/predefinedPools";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { useMakerTakerFees } from "../../hooks/data/useMakerTakerFees";
import { usePointsHookWeights } from "../../hooks/data/usePointsHookWeights";
import type { PerpsCollection } from "../../hooks/data/perps/usePerpsCollection";
import { PAYMENT_TOKEN_SCALE_NUM, QUANTITY_SCALE, QUANTITY_SCALE_NUM } from "../../lib/units";

interface Props {
  price: bigint;
  deliveryDate: bigint;
  quantity: number; // Positive for Buy, Negative for Sell
  participantData?: Participant | null;
  latestPrice: bigint | null;
  onOrderPlaced?: () => void | Promise<void>;
  closeForm: () => void;
  bypassConflictCheck?: boolean; // Allow proceeding despite conflicting orders
  contractMode?: ContractMode;
  perpsCollection?: PerpsCollection;
  leverage?: number; // Leverage value for perps mode (e.g., 10 for 10x)
  isMarketOrder?: boolean;
}

export const PlaceOrderForm: FC<Props> = ({
  price,
  deliveryDate,
  quantity,
  participantData,
  latestPrice,
  onOrderPlaced,
  closeForm,
  bypassConflictCheck = false,
  contractMode = "futures",
  perpsCollection,
  leverage = 10,
  isMarketOrder = false,
}) => {
  // Conditionally use futures or perps create order hook
  const futuresCreateOrder = useCreateOrder();
  const perpsCreateOrder = useCreatePerpsOrder();
  const { createOrderAsync } = contractMode == "perpetual" ? perpsCreateOrder : futuresCreateOrder;

  const qc = useQueryClient();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const contractSpecsQuery = useFuturesContractSpecs();
  const { makerFeeUSDC, takerFeeUSDC, isLoading: isFeesLoading } = useMakerTakerFees();
  const { wMaker, wTaker, weightScale, isLoading: isWeightsLoading } = usePointsHookWeights();

  // Determine order type from quantity sign
  const isBuy = quantity > 0;
  const absoluteQuantity = Math.abs(quantity);

  // Notional size (USDC) of this order — matches the "Size" row below.
  const sizeUSDC = (Number(price) / PAYMENT_TOKEN_SCALE_NUM) * absoluteQuantity;

  // Estimated points rewards: points = weight * size / WEIGHT_SCALE.
  const makerReward =
    wMaker !== undefined && weightScale ? (Number(wMaker) * sizeUSDC) / Number(weightScale) : null;
  const takerReward =
    wTaker !== undefined && weightScale ? (Number(wTaker) * sizeUSDC) / Number(weightScale) : null;
  const deliveryDurationDays = contractSpecsQuery.data?.data?.deliveryDurationDays ?? 7;
  const marginPersent = contractSpecsQuery.data?.data?.liquidationMarginPercent ?? 20;

  // State for required margin
  const [requiredMargin, setRequiredMargin] = useState<bigint | null>(null);
  const [isLoadingMargin, setIsLoadingMargin] = useState(false);

  // Calculate required margin when price or quantity changes
  useEffect(() => {
    if (!latestPrice) return;
    setIsLoadingMargin(true);

    let margin: bigint;
    if (contractMode === "perpetual") {
      // For perps: calculate margin based on leverage
      // Formula: (price * quantity) * (1 / leverage)
      // Example: 10x leverage = 10% margin, 5x leverage = 20% margin
      const positionValue =
        (price * BigInt(Math.round(absoluteQuantity * QUANTITY_SCALE_NUM))) / QUANTITY_SCALE;
      const marginPercent = BigInt(Math.round((1 / leverage) * 100)); // Convert leverage to margin %
      margin = (positionValue * marginPercent) / 100n;
    } else {
      // For futures: use the existing calculation with PnL
      margin = getMinMarginForPositionManual(
        price,
        quantity,
        latestPrice,
        marginPersent,
        deliveryDurationDays,
      );
    }

    setRequiredMargin(margin);
    setIsLoadingMargin(false);
  }, [
    latestPrice,
    price,
    quantity,
    contractMode,
    absoluteQuantity,
    marginPersent,
    deliveryDurationDays,
    leverage,
  ]);

  // Check for conflicting orders (opposite action, same price, same delivery date)
  const hasConflictingOrder = () => {
    if (!participantData?.orders) return false;

    const priceInWei = price;
    const deliveryDateValue = deliveryDate;
    const oppositeIsBuy = !isBuy;

    return participantData.orders.some(
      (order) =>
        order.isActive &&
        order.isBuy === oppositeIsBuy &&
        order.pricePerDay === priceInWei &&
        order.deliveryAt === deliveryDateValue,
    );
  };

  return (
    <TransactionForm
      onClose={closeForm}
      title={isBuy ? "Place Bid Order" : "Place Ask Order"}
      description={""}
      reviewForm={(props) => (
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
              <div className="flex justify-between">
                <span className="text-gray-300">Size:</span>
                <span className="text-white">{sizeUSDC.toFixed(2)} USDC</span>
              </div>
              {contractMode === "futures" && (
                <div className="flex justify-between">
                  <span className="text-gray-300">Delivery Date:</span>
                  <span className="text-white">
                    {new Date(Number(deliveryDate) * 1000).toLocaleString()}
                  </span>
                </div>
              )}
              {contractMode === "futures" && (
                <div className="flex justify-between">
                  <span className="text-gray-300">Expected Hashrate:</span>
                  <span className="text-white">{absoluteQuantity * 100} Th/s</span>
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
                <>
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
                  {isMarketOrder && (
                    <div className="flex justify-between">
                      <span className="text-gray-300">Slippage:</span>
                      <span className="text-white">5%</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex justify-between">
                  <span className="text-gray-300">Maker / Taker Fee:</span>
                  <span className="text-white">
                    {makerFeeUSDC !== null && takerFeeUSDC !== null
                      ? `${makerFeeUSDC.toFixed(2)} / ${takerFeeUSDC.toFixed(2)} USDC`
                      : isFeesLoading
                      ? "Loading..."
                      : "N/A"}
                  </span>
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
            You are about to place a {isBuy ? "bid" : "ask"} order. Please review the details above.
          </p>
        </>
      )}
      resultForm={(props) => (
        <>
          <p className="w-6/6 text-left font-normal text-s mt-5">
            Your order has been placed and will appear in the order book shortly.
          </p>
        </>
      )}
      transactionSteps={[
        {
          label: `Place ${isBuy ? "Bid" : "Ask"} Order`,
          action: async () => {
            // Check for conflicting order before proceeding (unless bypassed)
            if (!bypassConflictCheck && hasConflictingOrder()) {
              const oppositeAction = isBuy ? "Ask" : "Bid";
              const priceInUSDC = Number(price) / PAYMENT_TOKEN_SCALE_NUM;
              throw new Error(
                `Cannot create ${
                  isBuy ? "Bid" : "Ask"
                } order at price ${priceInUSDC} USDC. You already have an active ${oppositeAction} order at the same price and delivery date. Please close or modify the existing order first.`,
              );
            }

            let txhash;
            if (contractMode === "perpetual") {
              // Perps only needs price and quantity
              txhash = await (createOrderAsync as any)({
                price,
                quantity,
              });
            } else {
              // Futures cash-settle now; createOrder still takes a destURL arg
              // in the ABI, so pass an empty string to keep the call valid.
              txhash = await (createOrderAsync as any)({
                price,
                deliveryDate,
                quantity,
                destUrl: "",
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
              Number(deliveryDate),
            );

            // Invalidate queries based on contract mode
            if (contractMode === "perpetual") {
              // For perps, invalidate perps-specific queries
              await Promise.all([
                qc.invalidateQueries({ queryKey: [getOrderBookQueryKey(contractMode)] }),
                address && qc.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, address] }),
                address && qc.invalidateQueries({ queryKey: [USER_POSITION_SESSIONS_QK, address] }),
                address && qc.invalidateQueries({ queryKey: [USER_PERPS_TRADES_QK, address] }),
                // Reset every perps history table back to its newest page.
                address && qc.resetQueries({ queryKey: [PERPS_ORDER_HISTORY_QK, address] }),
                address && qc.resetQueries({ queryKey: [PERPS_POSITION_HISTORY_QK, address] }),
                address && qc.resetQueries({ queryKey: [USER_TRADES_QK, address] }),
                // address && qc.invalidateQueries({ queryKey: [PARTICIPANT_QK] }),
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
