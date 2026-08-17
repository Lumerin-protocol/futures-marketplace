import { useEffect, useCallback } from "react";
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
import type { TransactionReceipt } from "viem";
import { TransactionFormV2 as TransactionForm } from "../../Forms/Shared/MultistepForm";
import {
  usePerpsOrderForm,
  PerpsOrderFormFields,
  PerpsModalCard,
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
  const { updateOrdersAsync } = useUpdatePerpsOrders();
  const queryClient = useQueryClient();

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
  }, [open, order]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const newQtyDisplay = form.getCurrentQuantity();
  const newSizeDisplay = form.getCurrentSize();
  const oldPrice = order ? Number(order.price) / PAYMENT_TOKEN_SCALE_NUM : 0;
  const oldQty = maxQuantity;
  const oldSize = oldPrice * oldQty;
  const hasChanges =
    !!order &&
    (form.currentPrice.toFixed(2) !== oldPrice.toFixed(2) ||
      newQtyDisplay.toFixed(6) !== oldQty.toFixed(6));

  const validateInput = async (): Promise<boolean> => {
    if (!order) return false;
    const newQty = form.getCurrentQuantity();
    if (newQty <= 0 || form.currentPrice <= 0) {
      alert("Please enter a valid price and quantity");
      return false;
    }
    if (!hasChanges) {
      alert("Please change order terms");
      return false;
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

  const side = order.isBuy ? "Long" : "Short";

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
          title="Modify Order"
          description="Update the price and quantity for your order"
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
                  {renderChange("Price", `${oldPrice.toFixed(2)} USDC`, `${form.currentPrice.toFixed(2)} USDC`)}
                  {renderChange("Quantity", oldQty.toFixed(6), newQtyDisplay.toFixed(6))}
                  {renderChange("Size", `${oldSize.toFixed(2)} USDC`, `${newSizeDisplay.toFixed(2)} USDC`)}
                </div>
              </div>
              <p className="text-gray-400 text-sm">You are about to modify your order.</p>
            </>
          )}
          resultForm={() => (
            <p className="w-6/6 text-left font-normal text-s mt-5">
              Your order has been updated and will appear in the order book shortly.
            </p>
          )}
          transactionSteps={[
            {
              label: "Modify Order",
              action: async () => {
                const newQty = form.getCurrentQuantity();
                const newPriceBig = BigInt(Math.round(form.currentPrice * PAYMENT_TOKEN_SCALE_NUM));
                const signedQty = order.isBuy ? newQty : -newQty;
                const txhash = await updateOrdersAsync({
                  cancelIds: [order.id as `0x${string}`],
                  creates: [{ price: newPriceBig, quantity: signedQty }],
                });
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
