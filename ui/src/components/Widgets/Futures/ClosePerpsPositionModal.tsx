import { useEffect, useCallback, useMemo } from "react";
import Modal from "@mui/material/Modal";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import type { PositionSession } from "../../../hooks/data/perps/useUserPositionSessions";
import { useCreatePerpsOrder } from "../../../hooks/data/perps/useCreatePerpsOrder";
import { useSimulatePerpsOrder } from "../../../hooks/data/perps/useSimulatePerpsOrder";
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
  ModeToggle,
  ModeButton,
} from "./PerpsOrderFormFields";
import { useState } from "react";
import styled from "@mui/material/styles/styled";

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
  const [closeError, setCloseError] = useState<string | null>(null);
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");

  const { createOrderAsync } = useCreatePerpsOrder();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();

  const netQty = session?.user.netQuantity ?? 0n;
  const isLong = netQty > 0n;
  const absNetQty = netQty < 0n ? -netQty : netQty;
  const maxQuantity = Number(absNetQty) / 1e6;
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
  const stepUnits = Math.round(priceStep * 1e6);
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

    if (orderType === "market") {
      try {
        const simResult = await refetchSim();
        const filledQty = simResult.data?.[0];
        const remainingQty = simResult.data?.[2];
        if (remainingQty !== undefined && remainingQty > 0n) {
          if (!filledQty || filledQty === 0n) {
            setCloseError("There is no liquidity in order book");
          } else {
            const filled = (Number(filledQty) / 1e6).toFixed(6);
            const remaining = (Number(remainingQty) / 1e6).toFixed(6);
            const total = ((Number(filledQty) + Number(remainingQty)) / 1e6).toFixed(6);
            setCloseError(
              `Order would only be partially filled. Requested: ${total} | Will fill: ${filled} | Unfilled: ${remaining}`,
            );
          }
          setIsClosing(false);
          return;
        }
      } catch {
        setCloseError("Failed to check order book liquidity");
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
          ? Number(snapBigInt(Number(marketPrice) * (isLong ? 1 - MARKET_SLIPPAGE : 1 + MARKET_SLIPPAGE))) / 1e6
          : form.currentPrice;
      const closePriceBig = BigInt(Math.round(effectivePrice * 1e6));
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
  }, [session, netQty, form.currentPrice, isLong, createOrderAsync, queryClient, publicClient, participantAddress, handleClose, form.amount, form.amountMode, onConfirmed, orderType, marketPrice, refetchSim]);

  if (!session) return null;

  const formatPrice = (p: bigint) => (Number(p) / 1e6).toFixed(2);
  const closeQtyDisplay = form.getCurrentQuantity();
  const closeSizeDisplay = form.getCurrentSize();

  const entryPriceValue = Number(session.entryPrice) / 1e6;
  const effectiveClosePrice =
    orderType === "market" && marketPrice
      ? Number(snapBigInt(Number(marketPrice) * (isLong ? 1 - MARKET_SLIPPAGE : 1 + MARKET_SLIPPAGE))) / 1e6
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
          <InfoRow>
            <InfoLabel>Unrealized PnL</InfoLabel>
            <InfoValue>
              <PnLText $isPositive={unrealizedPnlValue >= 0}>
                {unrealizedPnlValue >= 0 ? "+" : ""}{unrealizedPnlValue.toFixed(2)} USDC
              </PnLText>
            </InfoValue>
          </InfoRow>
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
                  form.handlePriceChange((Number(marketPrice) / 1e6).toFixed(2));
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

        {closeError && <ErrorText>{closeError}</ErrorText>}

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
