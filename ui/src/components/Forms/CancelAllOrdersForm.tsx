import { waitForOrderBookBlockNumber, getOrderBookQueryKey } from "../../hooks/data/orderBookHelpers";
import { useQueryClient } from "@tanstack/react-query";
import { TransactionFormV2 as TransactionForm } from "./Shared/MultistepForm";
import type { TransactionReceipt } from "viem";
import { useCancelOrders } from "../../hooks/data/useCancelOrders";
import { useAccount } from "wagmi";
import { PARTICIPANT_QK } from "../../hooks/data/getUserFuturesOrders";
import { POSITION_BOOK_QK } from "../../hooks/data/getUserFuturesPositions";
import { HISTORICAL_ORDERS_QK } from "../../hooks/data/useHistoricalOrders";
import { FUTURES_POSITION_HISTORY_QK } from "../../hooks/data/useFuturesPositionHistory";
import { USER_FUTURES_TRADES_QK } from "../../hooks/data/useUserFuturesTrades";
import { invalidatePortfolioPnl } from "../../hooks/data/pnl/invalidate";
import { USER_PERPS_ORDERS_QK } from "../../hooks/data/perps/useUserPerpsOrders";
import { USER_POSITION_SESSIONS_QK } from "../../hooks/data/perps/useUserPositionSessions";
import { PERPS_ORDER_HISTORY_QK } from "../../hooks/data/perps/usePerpsOrderHistory";
import { PERPS_POSITION_HISTORY_QK } from "../../hooks/data/perps/usePerpsPositionHistory";
import { USER_TRADES_QK } from "../../hooks/data/perps/useUserTrades";
import { type FC, useState } from "react";
import type { ContractMode } from "../../types/types";

/** One resting order the user is about to pull. */
export interface CancellableOrder {
  /** On-chain bytes32 order id. */
  id: string;
  isBuy: boolean;
  /** Futures only: which delivery the order sits in, for the post-tx book wait. */
  expirationAt?: bigint;
}

export interface CancelAllOrdersFormProps {
  orders: CancellableOrder[];
  closeForm: () => void;
  contractMode?: ContractMode;
  /** Runs after the caches are refreshed, e.g. to re-pull paginated history. */
  onConfirmed?: () => void | Promise<void>;
}

/**
 * Cancel every resting order the user has on one venue in a single
 * `updateOrders` transaction. Ids that have already left the book (filled or
 * cancelled since the list was fetched) are dropped rather than failing the
 * whole batch, and the result screen says how many actually went.
 */
export const CancelAllOrdersForm: FC<CancelAllOrdersFormProps> = ({
  orders,
  closeForm,
  contractMode = "futures",
  onConfirmed,
}) => {
  const qc = useQueryClient();
  const { address } = useAccount();
  const { cancelOrdersAsync } = useCancelOrders(contractMode);
  const [outcome, setOutcome] = useState<{ cancelled: number; stale: number } | null>(null);

  const bids = orders.filter((o) => o.isBuy).length;
  const asks = orders.length - bids;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const sideSummary = [bids > 0 && plural(bids, "bid"), asks > 0 && plural(asks, "ask")]
    .filter(Boolean)
    .join(" and ");

  const refreshOrderViews = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: [getOrderBookQueryKey(contractMode)] }),
      invalidatePortfolioPnl(qc),
      ...(address
        ? contractMode === "perpetual"
          ? [
              qc.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, address] }),
              qc.invalidateQueries({ queryKey: [USER_POSITION_SESSIONS_QK, address] }),
              qc.resetQueries({ queryKey: [PERPS_ORDER_HISTORY_QK, address] }),
              qc.resetQueries({ queryKey: [PERPS_POSITION_HISTORY_QK, address] }),
              qc.resetQueries({ queryKey: [USER_TRADES_QK, address] }),
            ]
          : [
              qc.invalidateQueries({ queryKey: [POSITION_BOOK_QK] }),
              qc.invalidateQueries({ queryKey: [PARTICIPANT_QK] }),
              qc.resetQueries({ queryKey: [HISTORICAL_ORDERS_QK, address] }),
              qc.resetQueries({ queryKey: [FUTURES_POSITION_HISTORY_QK, address] }),
              qc.resetQueries({ queryKey: [USER_FUTURES_TRADES_QK, address] }),
            ]
        : []),
    ]);
  };

  const resultMessage = () => {
    if (outcome && outcome.cancelled === 0) {
      return "None of these orders were still on the book — they had been filled or cancelled before your request, so there was nothing to sign. The list has been refreshed.";
    }
    if (outcome && outcome.stale > 0) {
      return `Cancelled ${outcome.cancelled} of ${outcome.cancelled + outcome.stale} orders — the rest had already been filled or cancelled.`;
    }
    return `All ${plural(orders.length, "order")} have been cancelled. Locked margin and fees are back in your available balance.`;
  };

  return (
    <TransactionForm
      onClose={closeForm}
      title="Cancel All Orders"
      description=""
      executeLabel="Cancel All"
      reviewForm={() => (
        <>
          <div className="mb-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-300">Open orders:</span>
                <span className="text-white">{orders.length}</span>
              </div>
              {sideSummary && (
                <div className="flex justify-between">
                  <span className="text-gray-300">Sides:</span>
                  <span className="text-white">{sideSummary}</span>
                </div>
              )}
            </div>
          </div>
          <p className="text-gray-400 text-sm">
            You are about to cancel every resting order you have in this market, in one transaction. Any order
            that fills before the transaction lands is left as is. Margin and fees locked for the cancelled orders
            are released back to your available balance.
          </p>
        </>
      )}
      resultForm={() => <p className="w-6/6 text-left font-normal text-s mt-5">{resultMessage()}</p>}
      transactionSteps={[
        {
          label: "Cancel All Orders",
          action: async () => {
            if (orders.length === 0) throw new Error("No open orders to cancel");
            const ids = orders.map((o) => o.id as `0x${string}`);

            const result = await cancelOrdersAsync({ orderIds: ids });
            if (result.status === "not-ready") {
              throw new Error("Wallet not ready. Please try again.");
            }
            if (result.status === "already-closed") {
              setOutcome({ cancelled: 0, stale: result.staleIds.length });
              await refreshOrderViews();
              if (onConfirmed) await onConfirmed();
              return { isSkipped: true };
            }
            setOutcome({ cancelled: result.cancelledIds.length, stale: result.staleIds.length });
            return { txhash: result.txhash, isSkipped: false };
          },
          postConfirmation: async (receipt: TransactionReceipt) => {
            if (contractMode === "perpetual") {
              await waitForOrderBookBlockNumber(receipt.blockNumber, qc, contractMode);
            } else {
              // Futures books are cached per delivery; wait on each one touched.
              const expirations = new Set(
                orders.map((o) => o.expirationAt).filter((e): e is bigint => e !== undefined),
              );
              await Promise.all(
                [...expirations].map((e) => waitForOrderBookBlockNumber(receipt.blockNumber, qc, contractMode, Number(e))),
              );
            }
            await refreshOrderViews();
            if (onConfirmed) await onConfirmed();
          },
        },
      ]}
    />
  );
};
