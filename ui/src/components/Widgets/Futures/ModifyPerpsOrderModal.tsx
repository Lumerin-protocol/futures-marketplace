import { useEffect, useCallback, useState } from "react";
import Modal from "@mui/material/Modal";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import type { PerpsOrder } from "../../../hooks/data/perps/useUserPerpsOrders";
import { useCreatePerpsOrder } from "../../../hooks/data/perps/useCreatePerpsOrder";
import { useCancelPerpsOrder } from "../../../hooks/data/perps/useCancelPerpsOrder";
import { useQueryClient } from "@tanstack/react-query";
import { USER_PERPS_ORDERS_QK } from "../../../hooks/data/perps/useUserPerpsOrders";
import { USER_POSITION_SESSIONS_QK } from "../../../hooks/data/perps/useUserPositionSessions";
import { USER_PERPS_TRADES_QK } from "../../../hooks/data/perps/useUserPerpsTrades";
import { getOrderBookQueryKey } from "../../../hooks/data/orderBookHelpers";
import {
  usePerpsOrderForm,
  PerpsOrderFormFields,
  PerpsModalCard,
  PositionInfoSection,
  InfoRow,
  InfoLabel,
  InfoValue,
  TypeBadge,
  ErrorText,
  ModalActions,
  ModalCancelButton,
} from "./PerpsOrderFormFields";

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
  marketPrice,
  participantAddress,
  priceStep = 0.01,
  onConfirmed,
}: ModifyPerpsOrderModalProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { createOrderAsync } = useCreatePerpsOrder();
  const { cancelOrderAsync } = useCancelPerpsOrder();
  const queryClient = useQueryClient();

  // Remaining (unfilled) quantity: works for both ACTIVE (filled=0) and PARTIAL.
  const remainingQtyBig = order
    ? order.originalQuantity - order.filledQuantity
    : 0n;
  const maxQuantity = Number(remainingQtyBig) / 1e6;

  const form = usePerpsOrderForm({ maxQuantity, priceStep });

  useEffect(() => {
    if (!open || !order) return;
    const initPrice = (Number(order.price) / 1e6).toFixed(2);
    form.reset(initPrice, 100);
    setSubmitError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order]);

  const handleClose = useCallback(() => {
    setSubmitError(null);
    setIsSubmitting(false);
    onClose();
  }, [onClose]);

  const handleConfirm = useCallback(async () => {
    if (!order) return;
    const newQty = form.getCurrentQuantity();
    if (newQty <= 0 || form.currentPrice <= 0) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // 1. Cancel the existing order
      await cancelOrderAsync({ orderId: order.id as `0x${string}` });

      // 2. Place a new order with the updated price & quantity (same side)
      const newPriceBig = BigInt(Math.round(form.currentPrice * 1e6));
      // Positive quantity = Buy (Long), negative = Sell (Short)
      const signedQty = order.isBuy ? newQty : -newQty;
      await createOrderAsync({ price: newPriceBig, quantity: signedQty });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [getOrderBookQueryKey("perpetual")] }),
        queryClient.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, participantAddress] }),
        queryClient.invalidateQueries({ queryKey: [USER_POSITION_SESSIONS_QK, participantAddress] }),
        queryClient.invalidateQueries({ queryKey: [USER_PERPS_TRADES_QK, participantAddress] }),
      ]);

      if (onConfirmed) await onConfirmed();
      handleClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to modify order");
    } finally {
      setIsSubmitting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, form.currentPrice, form.amount, form.amountMode, createOrderAsync, cancelOrderAsync, queryClient, participantAddress, handleClose, onConfirmed]);

  if (!order) return null;

  const side = order.isBuy ? "Long" : "Short";
  const formatPrice = (p: bigint) => (Number(p) / 1e6).toFixed(2);
  const newQtyDisplay = form.getCurrentQuantity();
  const newSizeDisplay = form.getCurrentSize();

  return (
    <Modal open={open} onClose={handleClose}>
      <PerpsModalCard>
        <IconButton className="close" sx={{ color: "white" }} onClick={handleClose}>
          <CloseIcon />
        </IconButton>

        <h2>Modify Order</h2>

        <PositionInfoSection>
          <InfoRow>
            <InfoLabel>Side</InfoLabel>
            <InfoValue>
              <TypeBadge $type={side}>{side}</TypeBadge>
            </InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>Original Price</InfoLabel>
            <InfoValue>{formatPrice(order.price)} USDC</InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>Filled / Original Qty</InfoLabel>
            <InfoValue>
              {(Number(order.filledQuantity) / 1e6).toFixed(6)}
              {" / "}
              {(Number(order.originalQuantity) / 1e6).toFixed(6)}
            </InfoValue>
          </InfoRow>
          {marketPrice !== undefined && (
            <InfoRow>
              <InfoLabel>Market Price</InfoLabel>
              <InfoValue>{formatPrice(marketPrice)} USDC</InfoValue>
            </InfoRow>
          )}
        </PositionInfoSection>

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
          <ModalCancelButton
            onClick={handleConfirm}
            disabled={isSubmitting || newQtyDisplay <= 0 || form.currentPrice <= 0}
          >
            {isSubmitting ? "Modifying..." : "Confirm"}
          </ModalCancelButton>
        </ModalActions>
      </PerpsModalCard>
    </Modal>
  );
};

