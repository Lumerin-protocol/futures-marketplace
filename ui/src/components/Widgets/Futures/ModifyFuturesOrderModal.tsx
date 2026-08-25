import { useCallback, useEffect } from "react";
import Modal from "@mui/material/Modal";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { TransactionReceipt } from "viem";
import type { Participant, ParticipantOrder } from "../../../hooks/data/getUserFuturesOrders";
import { PARTICIPANT_QK } from "../../../hooks/data/getUserFuturesOrders";
import { POSITION_BOOK_QK } from "../../../hooks/data/getUserFuturesPositions";
import { HISTORICAL_ORDERS_QK } from "../../../hooks/data/useHistoricalOrders";
import { FUTURES_POSITION_HISTORY_QK } from "../../../hooks/data/useFuturesPositionHistory";
import { USER_FUTURES_TRADES_QK } from "../../../hooks/data/useUserFuturesTrades";
import { invalidatePortfolioPnl } from "../../../hooks/data/pnl/invalidate";
import { getOrderBookQueryKey, waitForOrderBookBlockNumber } from "../../../hooks/data/orderBookHelpers";
import { useModifyOrder, useUpdateFuturesOrders } from "../../../hooks/data/useModifyOrder";
import { getMinMarginForPositionManual } from "../../../hooks/data/getMinMarginForPositionManual";
import { useMakerTakerFees } from "../../../hooks/data/useMakerTakerFees";
import { useFuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
import { planShrink } from "../../../lib/orderUpdatePlan";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
import type { AccountBalance, ContractMode } from "../../../types/types";
import { TransactionFormV2 as TransactionForm } from "../../Forms/Shared/MultistepForm";
import { usePerpsOrderForm, PerpsOrderFormFields, PerpsModalCard } from "./PerpsOrderFormFields";

interface BalanceQueryResult {
  data: bigint | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: () => void;
}

interface ModifyFuturesOrderModalProps {
  open: boolean;
  onClose: () => void;
  order: ParticipantOrder | null;
  /** Every order collapsed into the row being modified. */
  groupOrders: ParticipantOrder[];
  participantData?: Participant | null;
  latestPrice: bigint | null;
  /// Maintenance spot shock from the PortfolioMarginEngine, WAD-scaled.
  mmSpotShock: bigint | undefined;
  minMargin?: bigint | null;
  newestItemPrice: number | null;
  accountBalance?: AccountBalance;
  contractMode?: ContractMode;
  balanceQuery: BalanceQueryResult;
}

export const ModifyFuturesOrderModal = ({
  open,
  onClose,
  order,
  groupOrders,
  participantData,
  latestPrice,
  mmSpotShock,
  minMargin,
  newestItemPrice,
  accountBalance,
  contractMode = "futures",
  balanceQuery,
}: ModifyFuturesOrderModalProps) => {
  const { modifyOrderAsync } = useModifyOrder();
  const { updateOrdersAsync } = useUpdateFuturesOrders();
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const accountBalanceQuery = accountBalance ?? { data: undefined, isLoading: false };
  const { feeFor } = useMakerTakerFees();
  const contractSpecsQuery = useFuturesContractSpecs();

  const minimumPriceIncrement = contractSpecsQuery.data?.data?.minimumPriceIncrement;
  const priceStep = minimumPriceIncrement
    ? Number(minimumPriceIncrement) / PAYMENT_TOKEN_SCALE_NUM
    : 0.01;

  // Get high price percentage from environment variable (default 60 for 160%)
  const highPricePercentage = Number(process.env.REACT_APP_FUTURES_HIGH_PRICE_PERCENTAGE || "60");
  const maxPriceMultiplier = 1 + highPricePercentage / 100;

  const isBuy = order?.isBuy ?? false;

  // Still-resting contracts across every order the row collapsed together.
  const currentQuantity = groupOrders.reduce(
    (total, groupOrder) => total + Number(groupOrder.quantity),
    0,
  );

  // Oldest first: a reduce holds the order's slot in the price queue while a
  // cancel gives it up, so the plan trims the newest and leaves the oldest be.
  const restingOrders = [...groupOrders]
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
    .map((groupOrder) => ({
      id: groupOrder.id as `0x${string}`,
      restingQty: BigInt(groupOrder.quantity),
    }));

  const form = usePerpsOrderForm({
    maxQuantity: currentQuantity,
    priceStep,
    // Futures contracts are whole units, so quantity is the natural way in.
    quantityDecimals: 0,
    initialAmountMode: "quantity",
  });

  // Seed the form once per open/order; `form.reset` is recreated every render, so
  // listing it would re-reset the form continuously and discard user input.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    if (!open || !order) return;
    const initPrice = (Number(order.pricePerDay) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
    form.reset(initPrice, 100);
  }, [open, order]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const newQtyDisplay = form.getCurrentQuantity();
  const newSizeDisplay = form.getCurrentSize();
  const oldPrice = order ? Number(order.pricePerDay) / PAYMENT_TOKEN_SCALE_NUM : 0;
  const oldQty = currentQuantity;
  const oldSize = oldPrice * oldQty;
  const hasChanges =
    !!order && (form.currentPrice.toFixed(2) !== oldPrice.toFixed(2) || newQtyDisplay !== oldQty);

  /**
   * Same price, strictly less quantity — the contract can shrink the orders in
   * place instead of cancelling and re-placing them. That keeps queue position
   * and, because a batch without creates skips the portfolio IM check, it also
   * works while the account is margin-constrained.
   */
  const isReduceOnly = (priceUsd: number, quantity: number): boolean => {
    if (!order) return false;
    return (
      BigInt(Math.round(priceUsd * PAYMENT_TOKEN_SCALE_NUM)) === order.pricePerDay &&
      quantity > 0 &&
      quantity < currentQuantity
    );
  };

  const isReducing = isReduceOnly(form.currentPrice, newQtyDisplay);
  const title = isReducing ? "Reduce Order" : "Modify Order";

  const validateInput = async (): Promise<boolean> => {
    if (!order) return false;

    const newQuantity = form.getCurrentQuantity();
    const newPrice = form.currentPrice;
    if (newQuantity <= 0 || newPrice <= 0) {
      alert("Please enter a valid price and quantity");
      return false;
    }
    if (!hasChanges) {
      alert("Please change order terms");
      return false;
    }

    // A shrink at an unchanged price can only free margin and cannot collide
    // with an opposite resting order, so none of the checks below apply.
    if (isReduceOnly(newPrice, newQuantity)) {
      return true;
    }

    const newPriceInWei = BigInt(Math.round(newPrice * PAYMENT_TOKEN_SCALE_NUM));
    const totalBalance = balanceQuery.data ?? 0n;
    const lockedBalance = minMargin ?? 0n;
    const availableBalance = totalBalance - lockedBalance;

    if (!latestPrice || mmSpotShock === undefined) {
      alert("Unable to fetch market data. Please try again.");
      return false;
    }

    // Calculate required margin for the new order
    const newSignedQuantity = isBuy ? newQuantity : -newQuantity;
    const requiredMargin = getMinMarginForPositionManual(
      newPriceInWei,
      newSignedQuantity,
      latestPrice,
      mmSpotShock,
    );

    // Reserve the worse of maker/taker fee — see comment on `useMakerTakerFees`.
    const reservedFee = feeFor(newPriceInWei * BigInt(Math.ceil(newQuantity)));
    const totalRequired = requiredMargin + reservedFee;

    if (totalRequired > availableBalance) {
      const requiredMarginFormatted = (Number(requiredMargin) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
      const reservedFeeFormatted = (Number(reservedFee) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
      const totalRequiredFormatted = (Number(totalRequired) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
      const totalBalanceFormatted = (Number(totalBalance) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
      const lockedBalanceFormatted = (Number(lockedBalance) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
      const availableBalanceFormatted = (Number(availableBalance) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
      const accountBalanceValue = accountBalanceQuery.data ?? 0n;
      const accountBalanceFormatted = (Number(accountBalanceValue) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
      alert(
        `Insufficient funds. Please deposit futures account.\n\nRequired margin: ${requiredMarginFormatted} USDC\nReserved trading fee (max of maker/taker): ${reservedFeeFormatted} USDC\nTotal required: ${totalRequiredFormatted} USDC\nTotal futures balance: ${totalBalanceFormatted} USDC\nLocked balance: ${lockedBalanceFormatted} USDC\nAvailable balance: ${availableBalanceFormatted} USDC\nAvailable account balance: ${accountBalanceFormatted} USDC`,
      );
      return false;
    }

    // Check for conflicting orders (opposite action, same price, same expiration date)
    if (participantData?.orders) {
      const conflictingOrder = participantData.orders.find(
        (existingOrder) =>
          existingOrder.isActive &&
          existingOrder.isBuy !== isBuy && // Opposite action
          existingOrder.pricePerDay === newPriceInWei &&
          existingOrder.expirationAt === order.expirationAt &&
          existingOrder.id !== order.id, // Exclude the current order being modified
      );

      if (conflictingOrder) {
        const oppositeAction = isBuy ? "Sell" : "Buy";
        alert(
          `Cannot modify order to price ${newPrice.toFixed(2)} USDC. You already have an active ${oppositeAction} order at the same price and expiration date. Please close or modify the existing order first.`,
        );
        return false;
      }
    }

    // Check if price exceeds the configured percentage of newest item price (skip for perpetual)
    if (contractMode !== "perpetual" && newestItemPrice) {
      const maxAllowedPrice = newestItemPrice * maxPriceMultiplier;
      if (newPrice > maxAllowedPrice) {
        const percentageOver = ((newPrice / newestItemPrice) * 100).toFixed(1);
        const confirmed = window.confirm(
          `⚠️ High Price Warning\n\nYour price (${newPrice.toFixed(2)} USDC) is ${percentageOver}% of the market price (${newestItemPrice.toFixed(2)} USDC).\n\nThis price is significantly above the current market rate. You may experience difficulty finding a counterparty or may face higher slippage.\n\nDo you want to proceed?`,
        );
        if (!confirmed) {
          return false;
        }
      }
    }

    return true;
  };

  // Plain render function, not a component: MultistepForm calls it in place, so
  // memoizing it buys nothing and would only stale-close over form state.
  const inputForm = () => (
    <PerpsOrderFormFields
      price={form.price}
      amount={form.amount}
      amountMode={form.amountMode}
      sliderValue={form.sliderValue}
      priceLabel="New Price (USDC)"
      quantityLabel="New Quantity"
      sizeLabel="New Size (USDC)"
      quantityDecimals={0}
      currentQuantity={form.getCurrentQuantity()}
      currentSize={form.getCurrentSize()}
      onPriceChange={form.handlePriceChange}
      onAmountChange={form.handleAmountChange}
      onAmountModeChange={form.handleAmountModeChange}
      onSliderChange={form.handleSliderChange}
      onIncrementPrice={form.incrementPrice}
      onDecrementPrice={form.decrementPrice}
    />
  );

  if (!order) return null;

  const side = isBuy ? "Long" : "Short";

  const renderChange = (label: string, oldValue: string, newValue: string) => (
    <div className="flex justify-between">
      <span className="text-gray-300">{label}:</span>
      <span className="text-white">
        {oldValue === newValue ? (
          newValue
        ) : (
          <>
            <span className="text-gray-400 line-through">{oldValue}</span>
            {" → "}
            <span>{newValue}</span>
          </>
        )}
      </span>
    </div>
  );

  return (
    <Modal open={open} onClose={handleClose}>
      <PerpsModalCard>
        <IconButton className="close" sx={{ color: "white" }} onClick={handleClose}>
          <CloseIcon />
        </IconButton>

        <TransactionForm
          onClose={handleClose}
          title={title}
          description={
            isReducing
              ? "Shrink your order without giving up its place in the queue"
              : "Update the price and quantity for your order"
          }
          inputForm={inputForm}
          validateInput={validateInput}
          disableReview={!hasChanges}
          reviewForm={() => (
            <>
              <div className="mb-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-300">Side:</span>
                    <span className="text-white">{side}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Expiration Date:</span>
                    <span className="text-white">
                      {new Date(Number(order.expirationAt) * 1000).toLocaleString()}
                    </span>
                  </div>
                  {renderChange("Price", `${oldPrice.toFixed(2)} USDC`, `${form.currentPrice.toFixed(2)} USDC`)}
                  {renderChange("Quantity", `${oldQty} units`, `${newQtyDisplay} units`)}
                  {renderChange("Size", `${oldSize.toFixed(2)} USDC`, `${newSizeDisplay.toFixed(2)} USDC`)}
                </div>
              </div>
              <p className="text-gray-400 text-sm">
                {isReducing
                  ? "You are about to reduce your order. It keeps its price and its place in the queue."
                  : "You are about to modify your order."}
              </p>
            </>
          )}
          resultForm={() => (
            <p className="w-6/6 text-left font-normal text-s mt-5">
              Your order has been updated and will appear in the order book shortly.
            </p>
          )}
          transactionSteps={[
            {
              label: title,
              action: async () => {
                const newQuantity = form.getCurrentQuantity();
                const newPriceBig = BigInt(Math.round(form.currentPrice * PAYMENT_TOKEN_SCALE_NUM));

                let txhash: `0x${string}` | undefined;
                if (isReduceOnly(form.currentPrice, newQuantity)) {
                  const plan = planShrink(restingOrders, BigInt(newQuantity), isBuy);
                  txhash = await updateOrdersAsync({
                    cancelIds: plan.cancelIds,
                    reduces: plan.reduces,
                  });
                } else {
                  txhash = await modifyOrderAsync({
                    orderIds: restingOrders.map((resting) => resting.id),
                    newPrice: newPriceBig,
                    newQuantity: isBuy ? newQuantity : -newQuantity,
                    expirationAt: order.expirationAt,
                  });
                }

                return { txhash, isSkipped: false };
              },
              postConfirmation: async (receipt: TransactionReceipt) => {
                // Wait for block number to ensure indexer has updated
                await waitForOrderBookBlockNumber(
                  receipt.blockNumber,
                  queryClient,
                  contractMode,
                  Number(order.expirationAt),
                );

                // Refetch order book, positions, and participant data
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: [getOrderBookQueryKey(contractMode)] }),
                  address && queryClient.invalidateQueries({ queryKey: [POSITION_BOOK_QK] }),
                  address && queryClient.invalidateQueries({ queryKey: [PARTICIPANT_QK] }),
                  // Reset futures history tables back to their newest page.
                  address && queryClient.resetQueries({ queryKey: [HISTORICAL_ORDERS_QK, address] }),
                  address && queryClient.resetQueries({ queryKey: [FUTURES_POSITION_HISTORY_QK, address] }),
                  address && queryClient.resetQueries({ queryKey: [USER_FUTURES_TRADES_QK, address] }),
                  invalidatePortfolioPnl(queryClient),
                ]);
              },
            },
          ]}
        />
      </PerpsModalCard>
    </Modal>
  );
};
