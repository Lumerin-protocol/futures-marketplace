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
import { invalidatePortfolioPnl } from "../../../hooks/data/pnl/invalidate";
import { getOrderBookQueryKey, waitForOrderBookBlockNumber } from "../../../hooks/data/orderBookHelpers";
import type { TransactionReceipt } from "viem";
import { TransactionFormV2 as TransactionForm } from "../../Forms/Shared/MultistepForm";
import { showAlert } from "../../AlertModal";
import {
  usePerpsOrderForm,
  PerpsOrderFormFields,
  PerpsModalCard,
  PositionInfoSection,
  InfoRow,
  InfoLabel,
  InfoValue,
  TypeBadge,
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
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");

  const { createOrderAsync } = useCreatePerpsOrder();
  const queryClient = useQueryClient();

  const netQty = session?.netQuantity ?? 0n;
  const isLong = netQty > 0n;
  const absNetQty = netQty < 0n ? -netQty : netQty;
  const maxQuantity = Number(absNetQty) / PAYMENT_TOKEN_SCALE_NUM;
  const closeSide = isLong ? "Short" : "Long";

  const form = usePerpsOrderForm({ maxQuantity, priceStep });

  const simCloseQty = form.getCurrentQuantity();
  const simSignedQty = simCloseQty > 0 ? (isLong ? -simCloseQty : simCloseQty) : undefined;

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: seed once per open/session.
  useEffect(() => {
    if (!open || !session) return;
    const initPrice = marketPrice
      ? (Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2)
      : (Number(session.entryPrice) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
    form.reset(initPrice, 100);
    setOrderType("limit");
  }, [open, session]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const formatPrice = (p: bigint) => (Number(p) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  const closeQtyDisplay = form.getCurrentQuantity();
  const closeSizeDisplay = form.getCurrentSize();
  const entryPriceValue = session ? Number(session.entryPrice) / PAYMENT_TOKEN_SCALE_NUM : 0;
  const effectiveClosePrice =
    orderType === "market" && marketPrice
      ? Number(snapBigInt(Number(marketPrice) * (isLong ? 1 - MARKET_SLIPPAGE : 1 + MARKET_SLIPPAGE))) /
        PAYMENT_TOKEN_SCALE_NUM
      : form.currentPrice;
  const realizedPnl =
    effectiveClosePrice > 0 && closeQtyDisplay > 0
      ? (effectiveClosePrice - entryPriceValue) * closeQtyDisplay * (isLong ? 1 : -1)
      : null;

  const checkLiquidity = async (): Promise<boolean> => {
    if (orderType !== "market") return true;
    try {
      const simResult = await refetchSim();
      const filledQty = simResult.data?.[0];
      const remainingQty = simResult.data?.[2];
      if (remainingQty !== undefined && remainingQty > 0n) {
        if (!filledQty || filledQty === 0n) {
          await showAlert("There is no liquidity in order book");
        } else {
          const filled = (Number(filledQty) / PAYMENT_TOKEN_SCALE_NUM).toFixed(6);
          const remaining = (Number(remainingQty) / PAYMENT_TOKEN_SCALE_NUM).toFixed(6);
          const total = ((Number(filledQty) + Number(remainingQty)) / PAYMENT_TOKEN_SCALE_NUM).toFixed(6);
          await showAlert(
            `Order would only be partially filled. Requested: ${total} | Will fill: ${filled} | Unfilled: ${remaining}`,
          );
        }
        return false;
      }
      return true;
    } catch {
      await showAlert({ message: "Failed to check order book liquidity", variant: "error" });
      return false;
    }
  };

  const validateInput = async (): Promise<boolean> => {
    if (!session || netQty === 0n) return false;
    const closeQty = form.getCurrentQuantity();
    if (closeQty <= 0 || effectiveClosePrice <= 0) {
      await showAlert("Please enter a valid close quantity and price");
      return false;
    }
    return checkLiquidity();
  };

  // Plain render function, not a component: MultistepForm calls it in place, so
  // memoizing it buys nothing and would only stale-close over form state.
  const inputForm = () => (
    <>
      {session && (
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
      )}

      <OrderTypeRow>
        <ModeToggle>
          <ModeButton $active={orderType === "limit"} onClick={() => setOrderType("limit")}>
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
            disabled={!marketPrice}
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
        hidePriceInput={orderType === "market"}
        priceLabel="Close Price (USDC)"
        quantityLabel="Close Quantity"
        sizeLabel="Close Size (USDC)"
        currentQuantity={form.getCurrentQuantity()}
        currentSize={form.getCurrentSize()}
        realizedPnl={realizedPnl}
        onPriceChange={form.handlePriceChange}
        onAmountChange={form.handleAmountChange}
        onAmountModeChange={form.handleAmountModeChange}
        onSliderChange={form.handleSliderChange}
        onIncrementPrice={form.incrementPrice}
        onDecrementPrice={form.decrementPrice}
      />
    </>
  );

  if (!session) return null;

  return (
    <Modal open={open} onClose={handleClose}>
      <PerpsModalCard>
        <IconButton className="close" sx={{ color: "white" }} onClick={handleClose}>
          <CloseIcon />
        </IconButton>

        <TransactionForm
          onClose={handleClose}
          title="Close Position"
          description=""
          inputForm={inputForm}
          validateInput={validateInput}
          disableReview={closeQtyDisplay <= 0 || effectiveClosePrice <= 0}
          reviewForm={() => (
            <>
              <div className="mb-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-300">Close Side:</span>
                    <span className="text-white">{closeSide}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Type:</span>
                    <span className="text-white">{orderType === "market" ? "Market" : "Limit"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Price:</span>
                    <span className="text-white">{effectiveClosePrice.toFixed(2)} USDC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Quantity:</span>
                    <span className="text-white">{closeQtyDisplay.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Size:</span>
                    <span className="text-white">{closeSizeDisplay.toFixed(2)} USDC</span>
                  </div>
                  {realizedPnl != null && (
                    <div className="flex justify-between">
                      <span className="text-gray-300">Expected Realized PnL:</span>
                      <span className="text-white">
                        {realizedPnl >= 0 ? "+" : ""}
                        {realizedPnl.toFixed(2)} USDC
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-gray-400 text-sm">You are about to close this position.</p>
            </>
          )}
          resultForm={() => (
            <p className="w-6/6 text-left font-normal text-s mt-5">
              Your close order has been submitted and will appear in the order book shortly.
            </p>
          )}
          transactionSteps={[
            {
              label: "Close Position",
              action: async () => {
                const closeQty = form.getCurrentQuantity();
                const closePriceBig = BigInt(Math.round(effectiveClosePrice * PAYMENT_TOKEN_SCALE_NUM));
                const signedQty = isLong ? -closeQty : closeQty;
                const txhash = await createOrderAsync({ price: closePriceBig, quantity: signedQty });
                if (!txhash) throw new Error("Wallet not ready. Please try again.");
                return { txhash, isSkipped: false };
              },
              postConfirmation: async (receipt: TransactionReceipt) => {
                await waitForOrderBookBlockNumber(receipt.blockNumber, queryClient, "perpetual");
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: [getOrderBookQueryKey("perpetual")] }),
                  queryClient.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, participantAddress] }),
                  queryClient.invalidateQueries({ queryKey: [USER_POSITION_SESSIONS_QK, participantAddress] }),
                  queryClient.resetQueries({ queryKey: [PERPS_ORDER_HISTORY_QK, participantAddress] }),
                  queryClient.resetQueries({ queryKey: [PERPS_POSITION_HISTORY_QK, participantAddress] }),
                  queryClient.resetQueries({ queryKey: [USER_TRADES_QK, participantAddress] }),
                  invalidatePortfolioPnl(queryClient),
                ]);
                if (onConfirmed) await onConfirmed();
              },
            },
          ]}
        />
      </PerpsModalCard>
    </Modal>
  );
};

const OrderTypeRow = styled("div")`
  display: flex;
  align-items: center;
  margin-bottom: 1rem;
`;
