import { waitForOrderBookBlockNumber } from "../../hooks/data/orderBookHelpers";
import { useQueryClient } from "@tanstack/react-query";
import { TransactionFormV2 as TransactionForm } from "./Shared/MultistepForm";
import type { TransactionReceipt } from "viem";
import { useAccount } from "wagmi";
import { type FC, useState } from "react";
import type { ContractMode } from "../../types/types";
import { PAYMENT_TOKEN_SCALE_NUM, QUANTITY_SCALE_NUM } from "../../lib/units";
import { useExitAll } from "../../hooks/data/useExitAll";
import { closingIntent, totalSize, type ExitAllIntent } from "../../lib/exitAll";
import { refreshVenueViews } from "../../hooks/data/refreshVenueViews";
import { summarizeOrderExecution, type OrderExecution } from "../../lib/orderExecution";
import type { CancellableOrder } from "./CancelAllOrdersForm";

/** How far past the mark a closing fill may go before the remainder is dropped. */
export const EXIT_ALL_SLIPPAGE = 0.05;

/** One open position as the widgets know it. */
export interface ExitAllPosition {
  /** Signed native quantity: long > 0, short < 0. */
  netQuantity: bigint;
  entryPrice: bigint;
  /** Futures only. */
  expirationAt?: bigint;
}

export interface ExitAllFormProps {
  contractMode: ContractMode;
  orders: CancellableOrder[];
  positions: ExitAllPosition[];
  /** Native-unit mark; without one the form cannot price the closes. */
  marketPrice: bigint | undefined;
  /** Native-unit tick. */
  priceStep: bigint;
  closeForm: () => void;
  onConfirmed?: () => void | Promise<void>;
}

/**
 * Leave the market in one transaction: cancel every open order, then close
 * every position with an immediate-or-cancel order capped a fixed distance
 * from the mark. The result screen is decoded from the receipt, so it reports
 * what actually closed rather than what was asked for.
 */
export const ExitAllForm: FC<ExitAllFormProps> = ({
  contractMode,
  orders,
  positions,
  marketPrice,
  priceStep,
  closeForm,
  onConfirmed,
}) => {
  const qc = useQueryClient();
  const { address } = useAccount();
  const { exitAllAsync } = useExitAll(contractMode);
  const [sent, setSent] = useState<{ cancelled: number; stale: number; intents: ExitAllIntent[] } | null>(null);
  const [execution, setExecution] = useState<OrderExecution | null>(null);

  const isPerps = contractMode === "perpetual";
  const closes = positions.filter((p) => p.netQuantity !== 0n);
  const usdc = (native: bigint | number) => `${(Number(native) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2)} USDC`;
  const qty = (native: bigint) => {
    const abs = native < 0n ? -native : native;
    if (!isPerps) return abs.toString();
    return (Number(abs) / QUANTITY_SCALE_NUM).toFixed(6).replace(/\.?0+$/, "");
  };
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const deliveryLabel = (e: bigint) =>
    new Date(Number(e) * 1000).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

  const previewIntents =
    marketPrice !== undefined
      ? closes.map((p) => closingIntent(p, marketPrice, EXIT_ALL_SLIPPAGE, priceStep))
      : [];

  const requestedAbs = (intents: ExitAllIntent[]) => totalSize(intents.map((i) => i.quantity));

  const resultMessage = () => {
    if (!sent) return "Nothing was left to do — every order had already left the book and no position was open.";
    const lines: string[] = [];
    if (sent.cancelled > 0) {
      lines.push(
        sent.stale > 0
          ? `Cancelled ${sent.cancelled} of ${sent.cancelled + sent.stale} orders; the rest had already been filled or cancelled.`
          : `Cancelled ${plural(sent.cancelled, "order")}.`,
      );
    } else if (sent.stale > 0) {
      lines.push("Your open orders had already been filled or cancelled before this transaction.");
    }
    const requested = requestedAbs(sent.intents);
    if (requested > 0n) {
      if (execution) {
        // Summed on magnitudes, not signs: a long and a short at different
        // deliveries close in opposite directions and would cancel out.
        let closed = 0n;
        let notional = 0n;
        for (const f of execution.fills) {
          const size = f.quantity < 0n ? -f.quantity : f.quantity;
          closed += size;
          notional += f.price * size;
        }
        const left = requested - closed;
        if (closed === 0n) {
          lines.push(
            `No position could be closed: the book had no liquidity within ${EXIT_ALL_SLIPPAGE * 100}% of the mark. Your positions are unchanged.`,
          );
        } else {
          const at = ` at an average of ${usdc(notional / closed)}`;
          lines.push(
            left > 0n
              ? `Closed ${qty(closed)} of ${qty(requested)}${at}. ${qty(left)} could not be filled within the slippage cap and remains open.`
              : `Closed ${qty(closed)}${at}.`,
          );
          if (execution.feePaid !== 0n) {
            lines.push(
              execution.feePaid > 0n
                ? `Trading fee: ${usdc(execution.feePaid)}.`
                : `Fee rebate: ${usdc(-execution.feePaid)}.`,
            );
          }
        }
      } else {
        lines.push("Your closing orders were submitted.");
      }
    }
    return lines.join(" ");
  };

  return (
    <TransactionForm
      onClose={closeForm}
      title="Close All Positions"
      description=""
      executeLabel="Close All"
      reviewForm={() => (
        <>
          <div className="mb-4">
            <div className="space-y-2 text-sm">
              {previewIntents.map((intent, i) => {
                const position = closes[i];
                const side = position.netQuantity > 0n ? "Long" : "Short";
                return (
                  <div
                    className="flex justify-between"
                    key={`${intent.expirationAt?.toString() ?? "perp"}-${side}-${i}`}
                  >
                    <span className="text-gray-300">
                      {side} {qty(position.netQuantity)}
                      {intent.expirationAt !== undefined ? ` · ${deliveryLabel(intent.expirationAt)}` : ""}
                    </span>
                    <span className="text-white">
                      {side === "Long" ? "Sell" : "Buy"} at market, worst {usdc(intent.price)}
                    </span>
                  </div>
                );
              })}
              {orders.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-300">Open orders to cancel:</span>
                  <span className="text-white">{orders.length}</span>
                </div>
              )}
              {marketPrice !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-300">Mark price:</span>
                  <span className="text-white">{usdc(marketPrice)}</span>
                </div>
              )}
            </div>
          </div>
          <p className="text-gray-400 text-sm">
            One transaction: {orders.length > 0 ? "every open order is cancelled first, then " : ""}each position is
            closed with an immediate-or-cancel order capped at {EXIT_ALL_SLIPPAGE * 100}% from the mark. Whatever
            the book cannot fill within that cap is not left resting — it stays open as a position, and the next
            screen shows exactly what closed.
          </p>
        </>
      )}
      resultForm={() => <p className="w-6/6 text-left font-normal text-s mt-5">{resultMessage()}</p>}
      transactionSteps={[
        {
          label: "Close All Positions",
          action: async () => {
            if (marketPrice === undefined) throw new Error("No market price available to close at.");
            if (orders.length === 0 && closes.length === 0) throw new Error("Nothing to close or cancel.");

            const result = await exitAllAsync({
              cancelIds: orders.map((o) => o.id as `0x${string}`),
              closes,
              marketPrice,
              slippage: EXIT_ALL_SLIPPAGE,
              priceStep,
            });
            if (result.status === "not-ready") throw new Error("Wallet not ready. Please try again.");
            if (result.status === "nothing") {
              setSent(null);
              await refreshVenueViews(qc, contractMode, address);
              if (onConfirmed) await onConfirmed();
              return { isSkipped: true };
            }
            setSent({ cancelled: result.cancelledIds.length, stale: result.staleIds.length, intents: result.intents });
            return { txhash: result.txhash, isSkipped: false };
          },
          postConfirmation: async (receipt: TransactionReceipt) => {
            // The receipt is the record; decode it first so the summary is on
            // screen while the indexer catches up.
            if (address) {
              const contractAddress = (
                isPerps ? process.env.REACT_APP_PERPS_TOKEN_ADDRESS : process.env.REACT_APP_FUTURES_TOKEN_ADDRESS
              ) as `0x${string}` | undefined;
              setExecution(
                summarizeOrderExecution({
                  logs: receipt.logs,
                  venue: isPerps ? "perps" : "futures",
                  user: address,
                  contractAddress,
                }),
              );
            }

            if (isPerps) {
              await waitForOrderBookBlockNumber(receipt.blockNumber, qc, contractMode);
            } else {
              const expirations = new Set<bigint>();
              for (const o of orders) if (o.expirationAt !== undefined) expirations.add(o.expirationAt);
              for (const p of closes) if (p.expirationAt !== undefined) expirations.add(p.expirationAt);
              await Promise.all(
                [...expirations].map((e) => waitForOrderBookBlockNumber(receipt.blockNumber, qc, contractMode, Number(e))),
              );
            }
            await refreshVenueViews(qc, contractMode, address);
            if (onConfirmed) await onConfirmed();
          },
        },
      ]}
    />
  );
};
