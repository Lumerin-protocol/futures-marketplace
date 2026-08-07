import { useRef, useState } from "react";
import type { TransactionReceipt } from "viem";
import { usePublicClient } from "wagmi";

export type TransactionStep = {
  label: string;
  action: (txState: Record<number, TxState>) => Promise<ActionResult>;
  postConfirmation?: (receipt: TransactionReceipt) => Promise<void>;
};

/// `state` is an opaque hand-off between steps: a step stores whatever it needs
/// and a later step casts it back to the shape it expects.
export type ActionResult =
  | { isSkipped: false; txhash?: `0x${string}`; state?: unknown }
  | { isSkipped: true; state?: unknown };

export type TxState = {
  state: "pending" | "sending" | "sent" | "confirmed" | "failed" | "skipped";
  error?: Error;
  txhash?: `0x${string}`;
  /**
   * Block the step's tx was mined in (once confirmed). Later steps can pin
   * their reads/simulations to this block instead of `latest` to avoid
   * racing RPC read-after-write lag right after a dependency (e.g. an
   * ERC20 approve) confirms — see `retryUntilBlockAvailable`.
   */
  blockNumber?: bigint;
  /// See `ActionResult.state`.
  customState?: unknown;
};

export function useMultistepTx(props: { steps: TransactionStep[] }) {
  const wc = usePublicClient();

  const [txState, setTxState] = useState(() => {
    return props.steps.reduce<Record<number, TxState>>((acc, _, index) => {
      acc[index] = { state: "pending", txhash: undefined };
      return acc;
    }, {});
  });

  // Ref that always holds the latest state — step actions read from this
  // instead of the React state closure, which may be stale.
  const stateRef = useRef(txState);

  const updateStep = (txNumber: number, update: Partial<TxState>) => {
    stateRef.current = {
      ...stateRef.current,
      [txNumber]: { ...stateRef.current[txNumber], ...update },
    };
    setTxState({ ...stateRef.current });
  };

  // error on any step makes the whole transaction fail
  const isError = Object.values(txState).some((state) => state.state === "failed");
  // success if the last step is confirmed or skipped
  const lastStepState = txState[props.steps.length - 1];
  const isSuccess = lastStepState.state === "confirmed" || lastStepState.state === "skipped";
  const isPending = !isSuccess && !isError;

  // Lifted here so it persists across parent rerenders. The step components in
  // TransactionForm are recreated on every render, which causes React to
  // unmount/remount MultipleTransactionProgress — any local state there would
  // be reset.
  const [showError, setShowError] = useState(false);
  const toggleShowError = () => setShowError((v) => !v);

  const executeNextTransaction = async (txNumber: number) => {
    try {
      const actionPromise = props.steps[txNumber].action(stateRef.current);
      updateStep(txNumber, { state: "sending" });

      const actionResult = await actionPromise;

      updateStep(txNumber, {
        state: "sent",
        txhash: actionResult.isSkipped ? undefined : actionResult.txhash,
        customState: actionResult.state,
      });

      try {
        if (!actionResult.isSkipped && actionResult.txhash) {
          if (!wc) throw new Error("No public client available to await the transaction receipt");
          const receipt = await wc.waitForTransactionReceipt({
            hash: actionResult.txhash,
          });
          updateStep(txNumber, {
            state: receipt.status === "success" ? "confirmed" : "failed",
            txhash: actionResult.txhash,
            blockNumber: receipt.blockNumber,
          });
          if (props.steps[txNumber].postConfirmation) {
            await props.steps[txNumber].postConfirmation(receipt);
          }
        } else if (actionResult.isSkipped) {
          updateStep(txNumber, { state: "skipped" });
        } else {
          updateStep(txNumber, { state: "confirmed" });
        }
        return true;
      } catch (error) {
        console.error(error);
        updateStep(txNumber, { state: "failed", error: error as Error });
        return false;
      }
    } catch (error) {
      console.error(error);
      updateStep(txNumber, { state: "failed", error: error as Error });
      return false;
    }
  };

  return {
    txState,
    executeNextTransaction,
    isSuccess,
    isError,
    isPending,
    showError,
    toggleShowError,
  };
}
