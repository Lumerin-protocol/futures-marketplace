import { useEffect, useCallback, useState } from "react";
import Modal from "@mui/material/Modal";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import type { PerpsOrder } from "../../../hooks/data/perps/useUserPerpsOrders";
import { useUpdatePerpsOrders } from "../../../hooks/data/perps/useUpdatePerpsOrders";
import { useQueryClient } from "@tanstack/react-query";
import { USER_PERPS_ORDERS_QK } from "../../../hooks/data/perps/useUserPerpsOrders";
import { USER_POSITION_SESSIONS_QK } from "../../../hooks/data/perps/useUserPositionSessions";
import { PERPS_ORDER_HISTORY_QK } from "../../../hooks/data/perps/usePerpsOrderHistory";
import { PERPS_POSITION_HISTORY_QK } from "../../../hooks/data/perps/usePerpsPositionHistory";
import { USER_TRADES_QK } from "../../../hooks/data/perps/useUserTrades";
import { getOrderBookQueryKey, waitForOrderBookBlockNumber } from "../../../hooks/data/orderBookHelpers";
import { usePublicClient } from "wagmi";
import {
  usePerpsOrderForm,
  PerpsOrderFormFields,
  PerpsModalCard,
  ErrorText,
  ModalActions,
  ModalCancelButton,
  ModalConfirmButton,
} from "./PerpsOrderFormFields";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";

interface ModifyPerpsOrderModalProps {
  open: boolean;
  onClose: () => void;
  order: PerpsOrder | null;
  marketPrice?: bigint;
  participantAddress?: `0x${string}`;
  priceStep?: number;
  onConfirmed?: () => void | Promise<void>;
}

export const ModifyPerpsOrderModal = ({
  open,
  onClose,
  order,
  participantAddress,
  priceStep = 0.01,
  onConfirmed,
}: ModifyPerpsOrderModalProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);

  const { updateOrdersAsync } = useUpdatePerpsOrders();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();

  // Remaining (unfilled) quantity: works for both ACTIVE (filled=0) and
  // PARTIALLY_FILLED.
  const remainingQtyBig = order
    ? order.originalQuantity - order.filledQuantity
    : 0n;
  const maxQuantity = Number(remainingQtyBig) / PAYMENT_TOKEN_SCALE_NUM;

  const form = usePerpsOrderForm({ maxQuantity, priceStep });

  // Seed the form once per open/order; `form.reset` is recreated every render, so
  // listing it would re-reset the form continuously and discard user input.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    if (!open || !order) return;
    const initPrice = (Number(order.price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
    form.reset(initPrice, 100);
    setSubmitError(null);
    setShowReview(false);
  }, [open, order]);

  const handleClose = useCallback(() => {
    setSubmitError(null);
    setIsSubmitting(false);
    setShowReview(false);
    onClose();
  }, [onClose]);

  // The quantity is read through `form.getCurrentQuantity()`, so `form.amount` and
  // `form.amountMode` are the values that actually have to invalidate this
  // callback; the getter itself is recreated every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  const handleReview = useCallback(() => {
    if (!order) return;
    const newQty = form.getCurrentQuantity();
    if (newQty <= 0 || form.currentPrice <= 0) return;
    setSubmitError(null);
    setShowReview(true);
  }, [order, form.currentPrice, form.amount, form.amountMode]);

  // Same reasoning as `handleReview` above regarding the `form.*` dependencies.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  const handleConfirm = useCallback(async () => {
    if (!order) return;
    const newQty = form.getCurrentQuantity();
    if (newQty <= 0 || form.currentPrice <= 0) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const newPriceBig = BigInt(Math.round(form.currentPrice * PAYMENT_TOKEN_SCALE_NUM));
      // Positive quantity = Buy (Long), negative = Sell (Short)
      const signedQty = order.isBuy ? newQty : -newQty;

      const txHash = await updateOrdersAsync({
        cancelIds: [order.id as `0x${string}`],
        creates: [{ price: newPriceBig, quantity: signedQty }],
      });
      if (txHash && publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        await waitForOrderBookBlockNumber(receipt.blockNumber, queryClient, "perpetual");
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [getOrderBookQueryKey("perpetual")] }),
        queryClient.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, participantAddress] }),
        queryClient.invalidateQueries({ queryKey: [USER_POSITION_SESSIONS_QK, participantAddress] }),
        // Reset perps history tables back to their newest page.
        queryClient.resetQueries({ queryKey: [PERPS_ORDER_HISTORY_QK, participantAddress] }),
        queryClient.resetQueries({ queryKey: [PERPS_POSITION_HISTORY_QK, participantAddress] }),
        queryClient.resetQueries({ queryKey: [USER_TRADES_QK, participantAddress] }),
      ]);

      if (onConfirmed) await onConfirmed();
      handleClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to modify order");
    } finally {
      setIsSubmitting(false);
    }
  }, [order, form.currentPrice, form.amount, form.amountMode, updateOrdersAsync, queryClient, publicClient, participantAddress, handleClose, onConfirmed]);

  if (!order) return null;

  const side = order.isBuy ? "Long" : "Short";
  const newQtyDisplay = form.getCurrentQuantity();
  const newSizeDisplay = form.getCurrentSize();

  const oldPrice = Number(order.price) / PAYMENT_TOKEN_SCALE_NUM;
  const oldQty = maxQuantity;
  const oldSize = oldPrice * oldQty;

  const hasChanges =
    form.currentPrice.toFixed(2) !== oldPrice.toFixed(2) ||
    newQtyDisplay.toFixed(6) !== oldQty.toFixed(6);

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

        <h2>Modify Order</h2>

        {showReview ? (
          <>
            <div className="mb-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-300">Side:</span>
                  <span className="text-white">{side}</span>
                </div>
                {renderChange("Price", `${oldPrice.toFixed(2)} USDC`, `${form.currentPrice.toFixed(2)} USDC`)}
                {renderChange("Quantity", oldQty.toFixed(6), newQtyDisplay.toFixed(6))}
                {renderChange("Size", `${oldSize.toFixed(2)} USDC`, `${newSizeDisplay.toFixed(2)} USDC`)}
              </div>
            </div>

            <p className="text-gray-400 text-sm mb-4">You are about to modify your order.</p>

            {submitError && <ErrorText>{submitError}</ErrorText>}

            <ModalActions>
              <ModalCancelButton onClick={() => setShowReview(false)} disabled={isSubmitting}>
                Back
              </ModalCancelButton>
              <ModalConfirmButton
                onClick={handleConfirm}
                disabled={isSubmitting || newQtyDisplay <= 0 || form.currentPrice <= 0}
              >
                {isSubmitting ? "Modifying..." : "Confirm"}
              </ModalConfirmButton>
            </ModalActions>
          </>
        ) : (
          <>
            <PerpsOrderFormFields
              price={form.price}
              amount={form.amount}
              amountMode={form.amountMode}
              sliderValue={form.sliderValue}
              disabled={isSubmitting}
              priceLabel="New Price (USDC)"
              quantityLabel="New Quantity"
              sizeLabel="New Size (USDC)"
              currentQuantity={newQtyDisplay}
              currentSize={newSizeDisplay}
              onPriceChange={form.handlePriceChange}
              onAmountChange={form.handleAmountChange}
              onAmountModeChange={form.handleAmountModeChange}
              onSliderChange={form.handleSliderChange}
              onIncrementPrice={form.incrementPrice}
              onDecrementPrice={form.decrementPrice}
            />

            {submitError && <ErrorText>{submitError}</ErrorText>}

            <ModalActions>
              <ModalCancelButton onClick={handleClose} disabled={isSubmitting}>
                Cancel
              </ModalCancelButton>
              <ModalConfirmButton
                onClick={handleReview}
                disabled={isSubmitting || newQtyDisplay <= 0 || form.currentPrice <= 0 || !hasChanges}
              >
                Review
              </ModalConfirmButton>
            </ModalActions>
          </>
        )}
      </PerpsModalCard>
    </Modal>
  );
};

