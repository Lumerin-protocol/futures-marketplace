import { useEffect, useCallback, useMemo } from "react";
import Modal from "@mui/material/Modal";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import type { PositionSession } from "../../../hooks/data/perps/useUserPositionSessions";
import { useCreatePerpsOrder } from "../../../hooks/data/perps/useCreatePerpsOrder";
import { useQueryClient } from "@tanstack/react-query";
import { USER_PERPS_ORDERS_QK } from "../../../hooks/data/perps/useUserPerpsOrders";
import { USER_POSITION_SESSIONS_QK } from "../../../hooks/data/perps/useUserPositionSessions";
import { USER_PERPS_TRADES_QK } from "../../../hooks/data/perps/useUserPerpsTrades";
import { getOrderBookQueryKey, waitForOrderBookBlockNumber } from "../../../hooks/data/orderBookHelpers";
import { usePublicClient } from "wagmi";
import {
  usePerpsOrderForm,
  PerpsOrderFormFields,
  PerpsModalCard,
  PositionInfoSection,
  InfoRow,
  InfoLabel,
  InfoValue,
  TypeBadge,
  PnLText,
  ErrorText,
  ModalActions,
  ModalCancelButton,
  ModalConfirmButton,
} from "./PerpsOrderFormFields";
import { useState } from "react";

interface ClosePerpsPositionModalProps {
  open: boolean;
  onClose: () => void;
  session: PositionSession | null;
  marketPrice?: bigint;
  participantAddress?: `0x${string}`;
  priceStep?: number;
  onConfirmed?: () => void | Promise<void>;
}

export const ClosePerpsPositionModal = ({
  open,
  onClose,
  session,
  marketPrice,
  participantAddress,
  priceStep = 0.01,
  onConfirmed,
}: ClosePerpsPositionModalProps) => {
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const { createOrderAsync } = useCreatePerpsOrder();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();

  const netQty = session?.user.netQuantity ?? 0n;
  const isLong = netQty > 0n;
  const absNetQty = netQty < 0n ? -netQty : netQty;
  const maxQuantity = Number(absNetQty) / 1e6;
  const closeSide = isLong ? "Short" : "Long";

  const form = usePerpsOrderForm({ maxQuantity, priceStep });

  useEffect(() => {
    if (!open || !session) return;
    const initPrice = marketPrice
      ? (Number(marketPrice) / 1e6).toFixed(2)
      : (Number(session.entryPrice) / 1e6).toFixed(2);
    form.reset(initPrice, 100);
    setCloseError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session]);

  const unrealizedPnl = useMemo(() => {
    if (!session || !marketPrice || netQty === 0n) return 0n;
    const priceDiff = marketPrice - session.entryPrice;
    return (priceDiff * netQty) / 1_000_000n;
  }, [session, marketPrice, netQty]);

  const unrealizedPnlValue = Number(unrealizedPnl) / 1e6;

  const handleClose = useCallback(() => {
    setCloseError(null);
    setIsClosing(false);
    onClose();
  }, [onClose]);

  const handleConfirm = useCallback(async () => {
    if (!session || netQty === 0n) return;
    const closeQty = form.getCurrentQuantity();
    if (closeQty <= 0) return;

    setIsClosing(true);
    setCloseError(null);

    try {
      const closePriceBig = BigInt(Math.round(form.currentPrice * 1e6));
      const signedQty = isLong ? -closeQty : closeQty;

      const txHash = await createOrderAsync({ price: closePriceBig, quantity: signedQty });

      if (txHash && publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        await waitForOrderBookBlockNumber(receipt.blockNumber, queryClient, "perpetual");
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [getOrderBookQueryKey("perpetual")] }),
        queryClient.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, participantAddress] }),
        queryClient.invalidateQueries({ queryKey: [USER_POSITION_SESSIONS_QK, participantAddress] }),
        queryClient.invalidateQueries({ queryKey: [USER_PERPS_TRADES_QK, participantAddress] }),
      ]);

      if (onConfirmed) await onConfirmed();
      handleClose();
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : "Failed to close position");
    } finally {
      setIsClosing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, netQty, form.currentPrice, isLong, createOrderAsync, queryClient, publicClient, participantAddress, handleClose, form.amount, form.amountMode, onConfirmed]);

  if (!session) return null;

  const formatPrice = (p: bigint) => (Number(p) / 1e6).toFixed(2);
  const closeQtyDisplay = form.getCurrentQuantity();
  const closeSizeDisplay = form.getCurrentSize();

  const entryPriceValue = Number(session.entryPrice) / 1e6;
  const realizedPnl =
    form.currentPrice > 0 && closeQtyDisplay > 0
      ? (form.currentPrice - entryPriceValue) * closeQtyDisplay * (isLong ? 1 : -1)
      : null;

  return (
    <Modal open={open} onClose={handleClose}>
      <PerpsModalCard>
        <IconButton className="close" sx={{ color: "white" }} onClick={handleClose}>
          <CloseIcon />
        </IconButton>

        <h2>Close Position</h2>

        <PositionInfoSection>
          <InfoRow>
            <InfoLabel>Close Order Side</InfoLabel>
            <InfoValue>
              <TypeBadge $type={closeSide}>{closeSide}</TypeBadge>
            </InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>Entry Price</InfoLabel>
            <InfoValue>{formatPrice(session.entryPrice)} USDC</InfoValue>
          </InfoRow>
          {marketPrice !== undefined && (
            <InfoRow>
              <InfoLabel>Market Price</InfoLabel>
              <InfoValue>{formatPrice(marketPrice)} USDC</InfoValue>
            </InfoRow>
          )}
          <InfoRow>
            <InfoLabel>Unrealized PnL</InfoLabel>
            <InfoValue>
              <PnLText $isPositive={unrealizedPnlValue >= 0}>
                {unrealizedPnlValue >= 0 ? "+" : ""}{unrealizedPnlValue.toFixed(2)} USDC
              </PnLText>
            </InfoValue>
          </InfoRow>
        </PositionInfoSection>

        <PerpsOrderFormFields
          price={form.price}
          amount={form.amount}
          amountMode={form.amountMode}
          sliderValue={form.sliderValue}
          disabled={isClosing}
          priceLabel="Close Price (USDC)"
          quantityLabel="Close Quantity"
          sizeLabel="Close Size (USDC)"
          currentQuantity={closeQtyDisplay}
          currentSize={closeSizeDisplay}
          realizedPnl={realizedPnl}
          onPriceChange={form.handlePriceChange}
          onAmountChange={form.handleAmountChange}
          onAmountModeChange={form.handleAmountModeChange}
          onSliderChange={form.handleSliderChange}
          onIncrementPrice={form.incrementPrice}
          onDecrementPrice={form.decrementPrice}
        />

        {closeError && <ErrorText>{closeError}</ErrorText>}

        <ModalActions>
          <ModalCancelButton onClick={handleClose} disabled={isClosing}>
            Cancel
          </ModalCancelButton>
          <ModalConfirmButton
            onClick={handleConfirm}
            disabled={isClosing || closeQtyDisplay <= 0 || form.currentPrice <= 0}
          >
            {isClosing ? "Closing..." : "Confirm"}
          </ModalConfirmButton>
        </ModalActions>
      </PerpsModalCard>
    </Modal>
  );
};

