import { useEffect, useCallback, useState } from "react";
import Modal from "@mui/material/Modal";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import { useQueryClient } from "@tanstack/react-query";
import type { TransactionReceipt } from "viem";
import { useCreateOrder } from "../../../hooks/data/useCreateOrder";
import { useSimulateFuturesOrder } from "../../../hooks/data/useSimulateFuturesOrder";
import { useFuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
import { PARTICIPANT_QK } from "../../../hooks/data/getUserFuturesOrders";
import { POSITION_BOOK_QK } from "../../../hooks/data/getUserFuturesPositions";
import { HISTORICAL_ORDERS_QK } from "../../../hooks/data/useHistoricalOrders";
import { FUTURES_POSITION_HISTORY_QK } from "../../../hooks/data/useFuturesPositionHistory";
import { USER_FUTURES_TRADES_QK } from "../../../hooks/data/useUserFuturesTrades";
import { invalidatePortfolioPnl } from "../../../hooks/data/pnl/invalidate";
import { getOrderBookQueryKey, waitForOrderBookBlockNumber } from "../../../hooks/data/orderBookHelpers";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
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
import styled from "@mui/material/styles/styled";

const MARKET_SLIPPAGE = 0.05;

export interface CloseableFuturesPosition {
  netQuantity: number;
  positionType: string;
  pricePerDay: bigint;
  expirationAt: string;
}

interface CloseFuturesPositionModalProps {
  open: boolean;
  onClose: () => void;
  position: CloseableFuturesPosition | null;
  marketPrice?: bigint;
  participantAddress?: `0x${string}`;
  onConfirmed?: () => void | Promise<void>;
}

export const CloseFuturesPositionModal = ({
  open,
  onClose,
  position,
  marketPrice,
  participantAddress,
  onConfirmed,
}: CloseFuturesPositionModalProps) => {
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");

  const { createOrderAsync } = useCreateOrder();
  const queryClient = useQueryClient();
  const contractSpecsQuery = useFuturesContractSpecs();

  const minimumPriceIncrement = contractSpecsQuery.data?.data?.minimumPriceIncrement;
  const priceStep = minimumPriceIncrement
    ? Number(minimumPriceIncrement) / PAYMENT_TOKEN_SCALE_NUM
    : 0.01;

  const netQty = position?.netQuantity ?? 0;
  const isLong = (position?.positionType ?? "Long") === "Long";
  const maxQuantity = Math.abs(netQty);
  const closeSide = isLong ? "Short" : "Long";
  const expirationAt = position ? BigInt(position.expirationAt) : undefined;

  const form = usePerpsOrderForm({
    maxQuantity,
    priceStep,
    quantityDecimals: 0,
    initialAmountMode: "quantity",
  });

  const simCloseQty = form.getCurrentQuantity();
  const simSignedQty = simCloseQty > 0 ? (isLong ? -Math.round(simCloseQty) : Math.round(simCloseQty)) : undefined;

  const stepUnits = Math.round(priceStep * PAYMENT_TOKEN_SCALE_NUM);
  const snapBigInt = (raw: number) => BigInt(Math.round(raw / stepUnits) * stepUnits);
  const simMarketPrice =
    marketPrice !== undefined
      ? snapBigInt(Number(marketPrice) * (isLong ? 1 - MARKET_SLIPPAGE : 1 + MARKET_SLIPPAGE))
      : undefined;

  const { refetch: refetchSim } = useSimulateFuturesOrder({
    expirationAt,
    price: simMarketPrice,
    quantity: simSignedQty,
    enabled: false,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: seed once per open/position.
  useEffect(() => {
    if (!open || !position) return;
    const initPrice = marketPrice
      ? (Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2)
      : (Number(position.pricePerDay) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
    form.reset(initPrice, 100);
    setOrderType("limit");
  }, [open, position]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const formatPrice = (p: bigint) => (Number(p) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  const formatExpiration = (expirationAtStr: string) =>
    new Date(Number(expirationAtStr) * 1000).toLocaleString();
  const closeQtyDisplay = form.getCurrentQuantity();
  const closeSizeDisplay = form.getCurrentSize();
  const entryPriceValue = position ? Number(position.pricePerDay) / PAYMENT_TOKEN_SCALE_NUM : 0;
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
      if (filledQty === undefined || remainingQty === undefined) {
        await showAlert({ message: "Failed to check order book liquidity", variant: "error" });
        return false;
      }
      const remainingAbs = remainingQty < 0n ? -remainingQty : remainingQty;
      const filledAbs = filledQty < 0n ? -filledQty : filledQty;
      if (remainingAbs > 0n) {
        if (filledAbs === 0n) {
          await showAlert("There is no liquidity in order book");
        } else {
          const filled = filledAbs.toString();
          const remaining = remainingAbs.toString();
          const total = (filledAbs + remainingAbs).toString();
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
    if (!position || netQty === 0) return false;
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
      {position && (
        <PositionInfoSection>
          <InfoRow>
            <InfoLabel>Close Order Side</InfoLabel>
            <InfoValue>
              <TypeBadge $type={closeSide}>{closeSide}</TypeBadge>
            </InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>Entry Price</InfoLabel>
            <InfoValue>{formatPrice(position.pricePerDay)} USDC</InfoValue>
          </InfoRow>
          {marketPrice !== undefined && (
            <InfoRow>
              <InfoLabel>Market Price</InfoLabel>
              <InfoValue>{formatPrice(marketPrice)} USDC</InfoValue>
            </InfoRow>
          )}
          <InfoRow>
            <InfoLabel>Expiration Date</InfoLabel>
            <InfoValue>{formatExpiration(position.expirationAt)}</InfoValue>
          </InfoRow>
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
        quantityDecimals={0}
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

  if (!position) return null;

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
                    <span className="text-gray-300">Expiration Date:</span>
                    <span className="text-white">{formatExpiration(position.expirationAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Price:</span>
                    <span className="text-white">{effectiveClosePrice.toFixed(2)} USDC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-300">Quantity:</span>
                    <span className="text-white">{closeQtyDisplay} units</span>
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
                const signedQty = isLong ? -Math.round(closeQty) : Math.round(closeQty);
                const txhash = await createOrderAsync({
                  price: closePriceBig,
                  expirationAt: BigInt(position.expirationAt),
                  quantity: signedQty,
                });
                if (!txhash) throw new Error("Wallet not ready. Please try again.");
                return { txhash, isSkipped: false };
              },
              postConfirmation: async (receipt: TransactionReceipt) => {
                await waitForOrderBookBlockNumber(
                  receipt.blockNumber,
                  queryClient,
                  "futures",
                  Number(position.expirationAt),
                );
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: [getOrderBookQueryKey("futures")] }),
                  participantAddress && queryClient.invalidateQueries({ queryKey: [POSITION_BOOK_QK] }),
                  participantAddress && queryClient.invalidateQueries({ queryKey: [PARTICIPANT_QK] }),
                  participantAddress &&
                    queryClient.resetQueries({ queryKey: [HISTORICAL_ORDERS_QK, participantAddress] }),
                  participantAddress &&
                    queryClient.resetQueries({ queryKey: [FUTURES_POSITION_HISTORY_QK, participantAddress] }),
                  participantAddress &&
                    queryClient.resetQueries({ queryKey: [USER_FUTURES_TRADES_QK, participantAddress] }),
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
