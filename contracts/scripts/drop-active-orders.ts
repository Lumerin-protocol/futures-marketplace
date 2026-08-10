import { OperationType } from "@safe-global/types-kit";
import hre from "hardhat";
import { encodeFunctionData, getAddress } from "viem";
import { estimateContractGas, simulateContract, writeContract } from "viem/actions";
import { readOptionalAddress, readOptionalBigInt, requireAddress } from "../lib/env.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logPrompt, logStep, logSuccess, logTitle } from "../lib/log.ts";
import { SafeWallet } from "../lib/safe.ts";
import {
  discoverOrderCacheCandidates,
  readDiscoverySource,
} from "./lib/order-aggregate-cache.ts";

const DEFAULT_EVENT_CHUNK_SIZE = 100_000n;
const DEFAULT_MAX_INDEXER_LAG_BLOCKS = 100n;
const DEFAULT_SAFE_GAS_OVERHEAD = 150_000n;
const CONFIRMATIONS = 5;

async function main(): Promise<void> {
  logTitle("Drop Active Legacy HashPowerFutures Orders");

  const { viem } = await hre.network.getOrCreate();
  const pc = await viem.getPublicClient();
  const [deployer, proposer] = await viem.getWalletClients();
  const futuresAddress = requireAddress("FUTURES_ADDRESS");
  const safeOwnerAddress = readOptionalAddress("SAFE_OWNER_ADDRESS");
  const futures = await viem.getContractAt("HashPowerFutures", futuresAddress);
  const owner = getAddress(await futures.read.owner());
  const caller = getAddress(safeOwnerAddress ?? deployer.account.address);
  const latestBlock = await pc.getBlock();

  const discovery = await discoverOrderCacheCandidates(pc, futuresAddress, {
    source: readDiscoverySource(
      process.env.ORDER_CLEANUP_DISCOVERY_SOURCE,
      "ORDER_CLEANUP_DISCOVERY_SOURCE",
    ),
    indexerUrl: process.env.FUTURES_INDEXER_URL ?? process.env.SUBGRAPH_URL,
    latestBlock: latestBlock.number,
    startBlock: readOptionalBigInt("FUTURES_START_BLOCK"),
    eventChunkSize: readOptionalBigInt("EVENT_SCAN_CHUNK_SIZE") ?? DEFAULT_EVENT_CHUNK_SIZE,
    maxIndexerLagBlocks:
      readOptionalBigInt("MAX_INDEXER_LAG_BLOCKS") ?? DEFAULT_MAX_INDEXER_LAG_BLOCKS,
    etherscanApiKey: process.env.ETHERSCAN_API_KEY,
    onIndexerFallback: (error) =>
      console.warn(`Indexer discovery failed; falling back to events: ${String(error)}`),
    onEventProgress: (from, to, count) =>
      logStep(`scan ${from}-${to}`, `${count} participant(s)`),
    onEventRetry: (from, to, nextChunk) =>
      console.warn(`Log query ${from}-${to} failed; retrying with ${nextChunk}-block chunks`),
  });
  const users = discovery.addresses;

  logInfo("cutover", {
    HashPowerFutures: addrUrl(pc, futuresAddress),
    Version: await futures.read.VERSION().catch(() => "unknown"),
    Owner: addrUrl(pc, owner),
    Caller: caller,
    Discovery: discovery.source,
    "Discovered participants": users.length,
    "Latest block": latestBlock.number,
  });
  for (const user of users) console.log(`  ${user}`);

  if (users.length === 0) {
    logSuccess("No participants discovered; no active legacy orders to drop");
    return;
  }
  if (caller !== owner) {
    throw new Error(`Configured caller ${caller} is not HashPowerFutures owner ${owner}`);
  }
  if (safeOwnerAddress && !proposer) {
    throw new Error("PROPOSER_PRIVATEKEY is required when SAFE_OWNER_ADDRESS is set");
  }

  const request = {
    address: futuresAddress,
    abi: futures.abi,
    functionName: "dropActiveOrders" as const,
    args: [users] as const,
    account: caller,
  };
  await simulateContract(pc, request);
  const estimatedGas = await estimateContractGas(pc, request);
  const configuredMaxGas = readOptionalBigInt("MAX_ACTIVE_ORDER_DROP_GAS");
  const maxGas =
    configuredMaxGas !== undefined && configuredMaxGas < latestBlock.gasLimit
      ? configuredMaxGas
      : latestBlock.gasLimit;
  const safeOverhead = safeOwnerAddress
    ? readOptionalBigInt("SAFE_EXECUTION_GAS_OVERHEAD") ?? DEFAULT_SAFE_GAS_OVERHEAD
    : 0n;
  const requiredGas = estimatedGas + safeOverhead;
  if (requiredGas > maxGas) {
    throw new Error(
      `Single cleanup transaction cannot fit: estimate ${estimatedGas} + Safe overhead ` +
        `${safeOverhead} = ${requiredGas}, limit ${maxGas}.`,
    );
  }
  logInfo("single-transaction preflight", {
    "Estimated gas": estimatedGas,
    "Safe overhead": safeOverhead,
    "Required gas": requiredGas,
    "Enforced limit": maxGas,
  });

  if (process.env.DRY_RUN === "true") {
    logSuccess(`Dry run complete — one transaction would process ${users.length} participant(s)`);
    return;
  }

  await logPrompt(`Drop active legacy orders for all ${users.length} discovered participant(s)?`);
  if (safeOwnerAddress) {
    const safe = new SafeWallet(safeOwnerAddress, proposer!);
    const data = encodeFunctionData({
      abi: futures.abi,
      functionName: "dropActiveOrders",
      args: [users],
    });
    const safeTxHash = await safe.proposeTransaction({
      data,
      to: futuresAddress,
      value: "0",
      operation: OperationType.Call,
    });
    logStep("Safe TX hash", safeTxHash);
    logSuccess(`Proposed one cleanup transaction: ${safe.getSafeUITxUrl(safeTxHash)}`);
    return;
  }

  const simulation = await simulateContract(pc, {
    ...request,
    account: deployer.account,
  });
  const hash = await writeContract(deployer, simulation.request);
  const receipt = await pc.waitForTransactionReceipt({ hash, confirmations: CONFIRMATIONS });
  if (receipt.status !== "success") {
    throw new Error(`Active-order cleanup reverted: ${txUrl(pc, receipt.transactionHash)}`);
  }
  logSuccess(
    `Dropped active legacy orders for ${users.length} participant(s): ` +
      `${txUrl(pc, receipt.transactionHash)} gas=${receipt.gasUsed}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
