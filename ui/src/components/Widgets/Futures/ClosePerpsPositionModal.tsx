import { useEffect, useCallback } from "react";
import Modal from "@mui/material/Modal";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import type { PositionSession } from "../../../hooks/data/perps/useUserPositionSessions";
import { useCreatePerpsOrder } from "../../../hooks/data/perps/useCreatePerpsOrder";
import { useSimulatePerpsOrder } from "../../../hooks/data/perps/useSimulatePerpsOrder";
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
  PositionInfoSection,
  InfoRow,
  InfoLabel,
  InfoValue,
  TypeBadge,
  ModalActions,
  ModalCancelButton,
  ModalConfirmButton,
  ModeToggle,
  ModeButton,
} from "./PerpsOrderFormFields";
import { useState } from "react";
import styled from "@mui/material/styles/styled";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";

const MARKET_SLIPPAGE = 0.05;

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
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");

  const { createOrderAsync } = useCreatePerpsOrder();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();

  const netQty = session?.netQuantity ?? 0n;
  const isLong = netQty > 0n;
  const absNetQty = netQty < 0n ? -netQty : netQty;
  const maxQuantity = Number(absNetQty) / PAYMENT_TOKEN_SCALE_NUM;
  const closeSide = isLong ? "Short" : "Long";

  const form = usePerpsOrderForm({ maxQuantity, priceStep });

  // Lazy simulation hook — auto-fetch is disabled; refetch() is called manually on confirm.
  // Args reflect the latest form state at every render so refetch() always uses fresh values.
  const simCloseQty = form.getCurrentQuantity();
  const simSignedQty = simCloseQty > 0 ? (isLong ? -simCloseQty : simCloseQty) : undefined;

  // For market orders, apply slippage so simulation matches the actual order price:
  // closing a long = sell order → price 5% below market
  // closing a short = buy order → price 5% above market
  // Snap to the minimum price increment (priceStep, default 0.01) to avoid contract errors.
  const stepUnits = Math.round(priceStep * PAYMENT_TOKEN_SCALE_NUM);
  const snapBigInt = (raw: number) => BigInt(Math.round(raw / stepUnits) * stepUnits);
  const simMarketPrice =
    marketPrice !== undefined
      ? snapBigInt(Number(marketPrice) * (isLong ? 1 - MARKET_SLIPPAGE : 1 + MARKET_SLIPPAGE))
      : undefined;

  const { refetch: refetchSim } = useSimulatePerpsOrder({
    price: simMarketPrice,
    quantity: simSignedQty,
    enabled: false,
  });

  // Seed the form once per open/session. `marketPrice` is read for the initial
  // value only — listing it would re-reset the form on every price tick and wipe
  // whatever the user has typed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    if (!open || !session) return;
    const initPrice = marketPrice
      ? (Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2)
      : (Number(session.entryPrice) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
    form.reset(initPrice, 100);
  }, [open, session]);

  const handleClose = useCallback(() => {
    setIsClosing(false);
    onClose();
  }, [onClose]);

  // `form.amount` / `form.amountMode` are listed on purpose: the quantity is read
  // through `form.getCurrentQuantity()`, so those are what actually has to
  // invalidate this callback. `snapBigInt` is redefined every render and would
  // defeat the memo entirely.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  const handleConfirm = useCallback(async () => {
    if (!session || netQty === 0n) return;
    const closeQty = form.getCurrentQuantity();
    if (closeQty <= 0) return;

    setIsClosing(true);

    if (orderType === "market") {
      try {
        const simResult = await refetchSim();
        const filledQty = simResult.data?.[0];
        const remainingQty = simResult.data?.[2];
        if (remainingQty !== undefined && remainingQty > 0n) {
          if (!filledQty || filledQty === 0n) {
            alert("There is no liquidity in order book");
          } else {
            const filled = (Number(filledQty) / PAYMENT_TOKEN_SCALE_NUM).toFixed(6);
            const remaining = (Number(remainingQty) / PAYMENT_TOKEN_SCALE_NUM).toFixed(6);
            const total = ((Number(filledQty) + Number(remainingQty)) / PAYMENT_TOKEN_SCALE_NUM).toFixed(6);
            alert(
              `Order would only be partially filled. Requested: ${total} | Will fill: ${filled} | Unfilled: ${remaining}`,
            );
          }
          setIsClosing(false);
          return;
        }
      } catch {
        alert("Failed to check order book liquidity");
        setIsClosing(false);
        return;
      }
    }

    try {
      // For market orders apply 5% slippage so the order crosses the spread:
      // closing a long = sell → price below market; closing a short = buy → price above market
      // Snap to the minimum price increment to avoid contract errors.
      const effectivePrice =
        orderType === "market" && marketPrice
          ? Number(snapBigInt(Number(marketPrice) * (isLong ? 1 - MARKET_SLIPPAGE : 1 + MARKET_SLIPPAGE))) / PAYMENT_TOKEN_SCALE_NUM
          : form.currentPrice;
      const closePriceBig = BigInt(Math.round(effectivePrice * PAYMENT_TOKEN_SCALE_NUM));
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
        // Reset perps history tables back to their newest page.
        queryClient.resetQueries({ queryKey: [PERPS_ORDER_HISTORY_QK, participantAddress] }),
        queryClient.resetQueries({ queryKey: [PERPS_POSITION_HISTORY_QK, participantAddress] }),
        queryClient.resetQueries({ queryKey: [USER_TRADES_QK, participantAddress] }),
      ]);

      if (onConfirmed) await onConfirmed();
      handleClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to close position");
    } finally {
      setIsClosing(false);
    }
  }, [session, netQty, form.currentPrice, isLong, createOrderAsync, queryClient, publicClient, participantAddress, handleClose, form.amount, form.amountMode, onConfirmed, orderType, marketPrice, refetchSim]);

  if (!session) return null;

  const formatPrice = (p: bigint) => (Number(p) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  const closeQtyDisplay = form.getCurrentQuantity();
  const closeSizeDisplay = form.getCurrentSize();

  const entryPriceValue = Number(session.entryPrice) / PAYMENT_TOKEN_SCALE_NUM;
  const effectiveClosePrice =
    orderType === "market" && marketPrice
      ? Number(snapBigInt(Number(marketPrice) * (isLong ? 1 - MARKET_SLIPPAGE : 1 + MARKET_SLIPPAGE))) / PAYMENT_TOKEN_SCALE_NUM
      : form.currentPrice;
  const realizedPnl =
    effectiveClosePrice > 0 && closeQtyDisplay > 0
      ? (effectiveClosePrice - entryPriceValue) * closeQtyDisplay * (isLong ? 1 : -1)
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

        </PositionInfoSection>

        <OrderTypeRow>
          <ModeToggle>
            <ModeButton
              $active={orderType === "limit"}
              onClick={() => setOrderType("limit")}
              disabled={isClosing}
            >
              Limit
            </ModeButton>
            <ModeButton
              $active={orderType === "market"}
              onClick={() => {
                setOrderType("market");
                if (marketPrice) {
                  form.handlePriceChange((Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2));
                }
              }}
              disabled={isClosing || !marketPrice}
            >
              Market
            </ModeButton>
          </ModeToggle>
        </OrderTypeRow>

        <PerpsOrderFormFields
          price={form.price}
          amount={form.amount}
          amountMode={form.amountMode}
          sliderValue={form.sliderValue}
          disabled={isClosing}
          hidePriceInput={orderType === "market"}
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

        <ModalActions>
          <ModalCancelButton onClick={handleClose} disabled={isClosing}>
            Cancel
          </ModalCancelButton>
          <ModalConfirmButton
            onClick={handleConfirm}
            disabled={isClosing || closeQtyDisplay <= 0 || effectiveClosePrice <= 0}
          >
            {isClosing ? "Closing..." : "Confirm"}
          </ModalConfirmButton>
        </ModalActions>
      </PerpsModalCard>
    </Modal>
  );
};

const OrderTypeRow = styled("div")`
  display: flex;
  align-items: center;
  margin-bottom: 1rem;
`;
