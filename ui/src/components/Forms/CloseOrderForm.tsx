import { waitForOrderBookBlockNumber, getOrderBookQueryKey } from "../../hooks/data/orderBookHelpers";
import { useQueryClient } from "@tanstack/react-query";
import { TransactionFormV2 as TransactionForm } from "./Shared/MultistepForm";
import type { TransactionReceipt } from "viem";
import { useCloseOrder } from "../../hooks/data/useCloseOrder";
import { useCancelPerpsOrder } from "../../hooks/data/perps/useCancelPerpsOrder";
import { useAccount } from "wagmi";
import { PARTICIPANT_QK } from "../../hooks/data/getUserFuturesOrders";
import { POSITION_BOOK_QK } from "../../hooks/data/getUserFuturesPositions";
import { HISTORICAL_ORDERS_QK } from "../../hooks/data/useHistoricalOrders";
import { FUTURES_POSITION_HISTORY_QK } from "../../hooks/data/useFuturesPositionHistory";
import { USER_FUTURES_TRADES_QK } from "../../hooks/data/useUserFuturesTrades";
import { invalidatePortfolioPnl } from "../../hooks/data/pnl/invalidate";
import { PERPS_ORDER_HISTORY_QK } from "../../hooks/data/perps/usePerpsOrderHistory";
import { PERPS_POSITION_HISTORY_QK } from "../../hooks/data/perps/usePerpsPositionHistory";
import { USER_TRADES_QK } from "../../hooks/data/perps/useUserTrades";
import { type FC, useState } from "react";
import type { ContractMode } from "../../types/types";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../lib/units";

export interface CloseOrderFormProps {
  isBuy: boolean;
  pricePerDay: bigint;
  expirationAt: bigint;
  amount: number;
  /** On-chain bytes32 order ids collapsed into the grouped row. */
  orderIds: string[];
  closeForm: () => void;
  contractMode?: ContractMode;
}

export const CloseOrderForm: FC<CloseOrderFormProps> = ({
  isBuy,
  pricePerDay,
  expirationAt,
  amount,
  orderIds,
  closeForm,
  contractMode = "futures",
}) => {
  const qc = useQueryClient();
  const { address } = useAccount();
  const { closeOrdersAsync } = useCloseOrder();
  const { cancelOrderAsync } = useCancelPerpsOrder();
  /// How the cancel actually resolved, so the result screen can distinguish a
  /// real cancel from a row that the indexer had simply not caught up on.
  const [outcome, setOutcome] = useState<{ cancelled: number; stale: number } | null>(null);

  const formatPrice = (price: bigint) => {
    return (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  };

  const formatExpirationAt = (expirationAt: bigint) => {
    const date = new Date(Number(expirationAt) * 1000);
    return date.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  };

  const refreshOrderViews = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: [getOrderBookQueryKey(contractMode)] }),
      address && qc.invalidateQueries({ queryKey: [POSITION_BOOK_QK] }),
      address && qc.invalidateQueries({ queryKey: [PARTICIPANT_QK] }),
      ...(contractMode === "perpetual"
        ? [
            address && qc.resetQueries({ queryKey: [PERPS_ORDER_HISTORY_QK, address] }),
            address && qc.resetQueries({ queryKey: [PERPS_POSITION_HISTORY_QK, address] }),
            address && qc.resetQueries({ queryKey: [USER_TRADES_QK, address] }),
          ]
        : [
            address && qc.resetQueries({ queryKey: [HISTORICAL_ORDERS_QK, address] }),
            address && qc.resetQueries({ queryKey: [FUTURES_POSITION_HISTORY_QK, address] }),
            address && qc.resetQueries({ queryKey: [USER_FUTURES_TRADES_QK, address] }),
          ]),
      invalidatePortfolioPnl(qc),
    ]);
  };

  const resultMessage = () => {
    if (outcome && outcome.cancelled === 0) {
      return "This order had already left the order book — it was filled or cancelled before your request, so there was nothing to sign. The list has been refreshed.";
    }
    if (outcome && outcome.stale > 0) {
      return `Cancelled ${outcome.cancelled} of ${outcome.cancelled + outcome.stale} orders in this row — the rest had already been filled or cancelled.`;
    }
    return "Your order has been cancelled and will be removed from the order book shortly.";
  };

  return (
    <TransactionForm
      onClose={closeForm}
      title="Close Order"
      description=""
      reviewForm={(_props) => (
        <>
          <div className="mb-4">
            <h3 className="font-semibold mb-2">Order Details:</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-300">Type:</span>
                <span className="text-white">{isBuy ? "Buy" : "Sell"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Price:</span>
                <span className="text-white">{formatPrice(pricePerDay)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Quantity:</span>
                <span className="text-white">{amount} units</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Delivery Date:</span>
                <span className="text-white">{formatExpirationAt(expirationAt)}</span>
              </div>
            </div>
          </div>
          <p className="text-gray-400 text-sm">
            You are about to cancel this resting order. It will be removed from the order book.
          </p>
        </>
      )}
      resultForm={(_props) => (
        <>
          <p className="w-6/6 text-left font-normal text-s mt-5">{resultMessage()}</p>
        </>
      )}
      transactionSteps={[
        {
          label: "Cancel Order",
          action: async () => {
            if (orderIds.length === 0) {
              throw new Error("No order ids to cancel");
            }
            const ids = orderIds.map((id) => id as `0x${string}`);

            if (contractMode === "perpetual") {
              // Perps cancel is one id per call; cancel the grouped row sequentially.
              let txhash: `0x${string}` | undefined;
              for (const orderId of ids) {
                const hash = await cancelOrderAsync({ orderId });
                if (!hash) throw new Error("Wallet not ready. Please try again.");
                txhash = hash;
              }
              setOutcome({ cancelled: ids.length, stale: 0 });
              return { txhash, isSkipped: false };
            }

            const result = await closeOrdersAsync({ orderIds: ids });
            if (result.status === "not-ready") {
              throw new Error("Wallet not ready. Please try again.");
            }
            if (result.status === "already-closed") {
              // Nothing left on the book to cancel, so there is no transaction
              // to sign — the row was indexer lag. Refresh so it disappears.
              setOutcome({ cancelled: 0, stale: result.staleIds.length });
              await refreshOrderViews();
              return { isSkipped: true };
            }
            setOutcome({ cancelled: result.cancelledIds.length, stale: result.staleIds.length });
            return { txhash: result.txhash, isSkipped: false };
          },
          postConfirmation: async (receipt: TransactionReceipt) => {
            await waitForOrderBookBlockNumber(receipt.blockNumber, qc, contractMode, Number(expirationAt));
            await refreshOrderViews();
          },
        },
      ]}
    />
  );
};
