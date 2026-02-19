import { useRef, useState } from "react";
import type { TransactionReceipt } from "viem";
import { useCustomWalletClient } from "./data/useCustomWalletClient";

export type TransactionStep = {
  label: string;
  action: (txState: Record<number, TxState>) => Promise<ActionResult>;
  postConfirmation?: (receipt: TransactionReceipt) => Promise<void>;
};

export type ActionResult =
  | { isSkipped: false; txhash?: `0x${string}`; state?: any }
  | { isSkipped: true; state?: any };

export type TxState = {
  state: "pending" | "sending" | "sent" | "confirmed" | "failed" | "skipped";
  error?: Error;
  txhash?: `0x${string}`;
  customState?: any;
};

export function useMultistepTx(props: { steps: TransactionStep[] }) {
  const wc = useCustomWalletClient();

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
          const receipt = await wc!.waitForTransactionReceipt({
            hash: actionResult.txhash,
          });
          updateStep(txNumber, {
            state: receipt.status === "success" ? "confirmed" : "failed",
            txhash: actionResult.txhash,
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
  };
}
