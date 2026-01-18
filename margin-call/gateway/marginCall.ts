import pino from "pino";
import * as viem from "viem";
import { encodeFunctionData } from "viem";
import { Multicall3ABI } from "../abi/Multicall3";
import { FuturesABI } from "../abi/Futures";
import { config } from "../config/env";
import { writeContract, waitForTransactionReceipt } from "viem/actions";
import { BalanceEntry } from "./balanceEntry";

export async function executeMarginCalls(
  entries: BalanceEntry[],
  ethClient: viem.Client,
  log: pino.Logger
) {
  if (entries.length === 0) {
    log.info("No entries to execute margin calls");
    return;
  }
  const multicall = viem.getContract({
    address: config.MULTICALL_ADDRESS,
    abi: Multicall3ABI,
    client: ethClient,
  });

  const batchSize = 100;
  const batches = Math.ceil(entries.length / batchSize);

  for (let i = 0; i < batches; i++) {
    const batch = entries.slice(i * batchSize, (i + 1) * batchSize);
    const calls = batch.map((entry) => ({
      target: entry.address,
      allowFailure: false,
      callData: encodeFunctionData({
        abi: FuturesABI,
        functionName: "marginCall",
        args: [entry.address],
      }),
    }));
    const tx = await multicall.simulate.aggregate3([calls], {
      account: config.MULTICALL_ADDRESS,
      chain: ethClient.chain,
    });

    const txhash = await writeContract(ethClient, tx.request);
    await waitForTransactionReceipt(ethClient, { hash: txhash });
    log.info(`Executed margin call for ${batch.length} entries`);
  }
}
