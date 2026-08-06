import { BaseError, ContractFunctionRevertedError } from "viem";

/**
 * Retries a read/simulate call that's pinned to a specific `blockNumber`
 * (e.g. the block a prior tx was mined in) while the RPC node it's hitting
 * catches up to that block.
 *
 * `waitForTransactionReceipt` only proves *some* RPC call has seen the tx
 * (`eth_getTransactionReceipt`, looked up by hash). A subsequent `eth_call`
 * pinned to that same block can still fail if the node/replica answering it
 * hasn't indexed that block yet — that shows up as a transport/RPC error, not
 * a contract revert, since state at a fixed past block is deterministic once
 * the node actually has it. Genuine contract reverts (e.g. `InsufficientAllowance`)
 * are rethrown immediately since retrying the exact same historical block will
 * never produce a different result.
 */
export async function retryUntilBlockAvailable<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; delayMs?: number } = {},
): Promise<T> {
  const { retries = 5, delayMs = 400 } = opts;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRevert =
        error instanceof BaseError &&
        error.walk((e) => e instanceof ContractFunctionRevertedError) != null;

      if (isRevert || attempt >= retries) throw error;

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
