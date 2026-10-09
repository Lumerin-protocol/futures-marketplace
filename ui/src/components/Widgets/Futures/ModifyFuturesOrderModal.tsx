import { useCallback, useEffect } from "react";
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
import { useOrderMargin } from "../../../hooks/data/useOrderMargin";
import { useMakerTakerFees } from "../../../hooks/data/useMakerTakerFees";
import { useFuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
import { formatDateTime } from "../../../lib/dates";
import { planShrink, type RestingOrder } from "../../../lib/orderUpdatePlan";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
import type { AccountBalance, ContractMode } from "../../../types/types";
import { TransactionFormV2 as TransactionForm } from "../../Forms/Shared/MultistepForm";
import { showAlert, showConfirm } from "../../AlertModal";
import { usePerpsOrderForm, PerpsOrderFormFields, PerpsModalCard } from "./PerpsOrderFormFields";
import { Modal } from "../../Modal";
import { ModalCloseButton, ModalCloseIcon } from "../../Modal.styled";

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
  participantData?: Participant | null;
  newestItemPrice: number | null;
  accountBalance?: AccountBalance;
  contractMode?: ContractMode;
  balanceQuery: BalanceQueryResult;
}

export const ModifyFuturesOrderModal = ({
  open,
  onClose,
  order,
  participantData,
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
  const orderMargin = useOrderMargin();
  const contractSpecsQuery = useFuturesContractSpecs();

  const minimumPriceIncrement = contractSpecsQuery.data?.data?.minimumPriceIncrement;
  const priceStep = minimumPriceIncrement
    ? Number(minimumPriceIncrement) / PAYMENT_TOKEN_SCALE_NUM
    : 0.01;

  // Get high price percentage from environment variable (default 60 for 160%)
  const highPricePercentage = Number(process.env.REACT_APP_FUTURES_HIGH_PRICE_PERCENTAGE || "60");
  const maxPriceMultiplier = 1 + highPricePercentage / 100;

  const isBuy = order?.isBuy ?? false;

  const currentQuantity = Number(order?.quantity ?? 0);

  // `planShrink` works over a list because the contract's cancel/reduce batch
  // does; one table row is one on-chain order, so the list has a single entry.
  const restingOrders: RestingOrder[] = order
    ? [{ id: order.id as `0x${string}`, restingQty: BigInt(order.quantity) }]
    : [];

  const form = usePerpsOrderForm({
    maxQuantity: currentQuantity,
    priceStep,
    // Futures contracts are whole units, so quantity is the natural way in.
    quantityDecimals: 0,
    initialAmountMode: "quantity",
    // Raising the size is a cancel-and-replace, which `validateInput` prices
    // against available margin — so the resting size is a default, not a cap.
    allowAboveMax: true,
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
      await showAlert("Please enter a valid price and quantity");
      return false;
    }
    if (!hasChanges) {
      await showAlert("Please change order terms");
      return false;
    }

    // A shrink at an unchanged price can only free margin and cannot collide
    // with an opposite resting order, so none of the checks below apply.
    if (isReduceOnly(newPrice, newQuantity)) {
      return true;
    }

    const newPriceInWei = BigInt(Math.round(newPrice * PAYMENT_TOKEN_SCALE_NUM));

    // Anything else is a cancel-and-replace, which the contract checks against
    // portfolio IM once at the end of the batch — with the old order already off
    // the book and with no reducing exception, so quote both legs together.
    const absNewQuantity = BigInt(Math.ceil(newQuantity));
    // Reserve the worse of maker/taker fee — see comment on `useMakerTakerFees`.
    const reservedFee = feeFor(newPriceInWei * absNewQuantity);
    const quote = orderMargin.quote(
      {
        cancel: [
          {
            venue: "futures",
            price: order.pricePerDay,
            quantity: isBuy ? BigInt(order.quantity) : -BigInt(order.quantity),
          },
        ],
        place: [
          {
            venue: "futures",
            price: newPriceInWei,
            quantity: isBuy ? absNewQuantity : -absNewQuantity,
          },
        ],
      },
      { reservedFee },
    );

    if (!quote) {
      await showAlert({ message: "Unable to fetch margin data. Please try again.", variant: "error" });
      return false;
    }

    if (!quote.affordable) {
      const usdc = (value: bigint) => (Number(value) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
      await showAlert(
        `Insufficient funds. Please deposit futures account.\n\n` +
          `Added margin for this change: ${usdc(quote.imIncrease)} USDC\n` +
          `Reserved trading fee (max of maker/taker): ${usdc(quote.reservedFee)} USDC\n` +
          `Already committed to open orders and positions: ${usdc(quote.imBefore)} USDC\n` +
          `Total margin required: ${usdc(quote.imAfter + quote.reservedFee)} USDC\n` +
          `Total futures balance: ${usdc(balanceQuery.data ?? 0n)} USDC\n` +
          `Short by: ${usdc(-quote.headroom)} USDC\n` +
          `Available account balance: ${usdc(accountBalanceQuery.data ?? 0n)} USDC`,
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
        await showAlert(
          `Cannot modify order to price ${newPrice.toFixed(2)} USDC. You already have an active ${oppositeAction} order at the same price and expiration date. Please cancel or modify the existing order first.`,
        );
        return false;
      }
    }

    // Check if price exceeds the configured percentage of newest item price (skip for perpetual)
    if (contractMode !== "perpetual" && newestItemPrice) {
      const maxAllowedPrice = newestItemPrice * maxPriceMultiplier;
      if (newPrice > maxAllowedPrice) {
        const percentageOver = ((newPrice / newestItemPrice) * 100).toFixed(1);
        const confirmed = await showConfirm({
          title: "High Price Warning",
          message: `Your price (${newPrice.toFixed(2)} USDC) is ${percentageOver}% of the market price (${newestItemPrice.toFixed(2)} USDC).\n\nThis price is significantly above the current market rate. You may experience difficulty finding a counterparty or may face higher slippage.\n\nDo you want to proceed?`,
          confirmText: "Proceed",
        });
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
      onSliderCommitted={form.handleSliderCommitted}
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
        <ModalCloseButton className="close" onClick={handleClose}>
          <ModalCloseIcon />
        </ModalCloseButton>

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
                      {formatDateTime(order.expirationAt)}
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
