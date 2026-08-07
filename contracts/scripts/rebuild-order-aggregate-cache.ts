import { OperationType } from "@safe-global/types-kit";
import hre from "hardhat";
import { encodeFunctionData, getAddress, type PublicClient } from "viem";
import { simulateContract, writeContract } from "viem/actions";
import { readOptionalAddress, readOptionalBigInt, requireAddress } from "../lib/env.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logPrompt, logStep, logSuccess, logTitle } from "../lib/log.ts";
import { SafeWallet } from "../lib/safe.ts";
import {
  chunk,
  createOnChainVerificationReader,
  discoverOrderCacheCandidates,
  filterUsersWithPhysicalOrders,
  ORDER_CACHE_ABI,
  readPositiveInteger,
  verifyOrderAggregateCache,
} from "./lib/order-aggregate-cache.ts";

const DAY = 24n * 60n * 60n;
const DEFAULT_EVENT_LOOKBACK_SECONDS = 180n * DAY;
const DEFAULT_EVENT_CHUNK_SIZE = 100_000n;
const REBUILD_CONFIRMATIONS = 5;

async function resolveLookbackStartBlock(
  pc: PublicClient,
  latestBlock: bigint,
  lookbackSeconds: bigint,
): Promise<bigint> {
  const latest = await pc.getBlock({ blockNumber: latestBlock });
  const targetTimestamp =
    latest.timestamp > lookbackSeconds ? latest.timestamp - lookbackSeconds : 0n;
  let low = 0n;
  let high = latestBlock;
  while (low < high) {
    const mid = (low + high) / 2n;
    const block = await pc.getBlock({ blockNumber: mid });
    if (block.timestamp < targetTimestamp) low = mid + 1n;
    else high = mid;
  }
  return low;
}

async function main(): Promise<void> {
  logTitle("Rebuild Futures Order Aggregate Cache");

  const { viem } = await hre.network.getOrCreate();
  const pc = await viem.getPublicClient();
  const [deployer, proposer] = await viem.getWalletClients();
  const futuresAddress = requireAddress("FUTURES_ADDRESS");
  const safeOwnerAddress = readOptionalAddress("SAFE_OWNER_ADDRESS");
  const futures = await viem.getContractAt("Futures", futuresAddress);
  const owner = getAddress(await futures.read.owner());

  const readConcurrency = readPositiveInteger("READ_CONCURRENCY", 25);
  const writeBatchSize = readPositiveInteger("ORDER_CACHE_WRITE_BATCH_SIZE", 50);
  const latestBlock = await pc.getBlockNumber();
  const dryRun = process.env.DRY_RUN === "true";
  const verifyOnly = process.env.VERIFY_ONLY === "true";

  const lookbackSeconds = process.env.EVENT_LOOKBACK_DAYS
    ? BigInt(readPositiveInteger("EVENT_LOOKBACK_DAYS", 0)) * DAY
    : DEFAULT_EVENT_LOOKBACK_SECONDS;
  const startBlock = await resolveLookbackStartBlock(pc, latestBlock, lookbackSeconds);
  const discovery = await discoverOrderCacheCandidates(pc, futuresAddress, {
    source: "events",
    latestBlock,
    startBlock,
    endBlock: latestBlock,
    eventChunkSize:
      readOptionalBigInt("EVENT_SCAN_CHUNK_SIZE") ??
      readOptionalBigInt("BLOCK_CHUNK_SIZE") ??
      DEFAULT_EVENT_CHUNK_SIZE,
    maxIndexerLagBlocks: 0n,
    onEventProgress: (from, to, count) => logStep(`scan ${from}-${to}`, `${count} participant(s)`),
    onEventRetry: (from, to, nextChunk) =>
      console.warn(`Log query ${from}-${to} failed; retrying with ${nextChunk}-block chunks`),
  });
  const candidates = discovery.addresses;

  // This is intentionally the only "active" filter. Do not compare expiration
  // timestamps: expired orders remain migration-relevant until physically removed.
  const users = await filterUsersWithPhysicalOrders(
    pc,
    futuresAddress,
    candidates,
    readConcurrency,
  );

  logInfo("migration", {
    Futures: addrUrl(pc, futuresAddress),
    Version: await futures.read.VERSION().catch(() => "unknown"),
    Owner: addrUrl(pc, owner),
    Caller: safeOwnerAddress ?? deployer.account.address,
    Discovery: `OrderCreated events blocks ${startBlock}-${latestBlock}`,
    "Latest block": latestBlock,
    "Discovered participants": candidates.length,
    "Participants with physical orders": users.length,
    "Read concurrency": readConcurrency,
    "Write batch size": writeBatchSize,
    "Dry run": dryRun,
    "Verify only": verifyOnly,
  });
  for (const user of users) console.log(`  ${user}`);

  if (verifyOnly) {
    const result = await verifyOrderAggregateCache(
      users,
      createOnChainVerificationReader(pc, futuresAddress),
      readConcurrency,
    );
    logSuccess(
      `Verified ${result.users} user(s), ${result.orders} order(s), ${result.expirations} expiration aggregate(s)`,
    );
    return;
  }

  if (users.length === 0) {
    logSuccess("No physical order caches require rebuilding");
    return;
  }
  if (dryRun) {
    logSuccess(`Dry run complete — ${users.length} user cache(s) would be rebuilt`);
    return;
  }

  const caller = getAddress(safeOwnerAddress ?? deployer.account.address);
  if (caller !== owner) {
    throw new Error(`Configured caller ${caller} is not Futures owner ${owner}`);
  }
  if (safeOwnerAddress && !proposer) {
    throw new Error("PROPOSER_PRIVATEKEY is required when SAFE_OWNER_ADDRESS is set");
  }

  const batches = chunk(users, writeBatchSize);
  // Preflight every batch before submitting the first mutation/proposal.
  for (const batch of batches) {
    await simulateContract(pc, {
      address: futuresAddress,
      abi: ORDER_CACHE_ABI,
      functionName: "rebuildOrderAggregateCache",
      args: [batch],
      account: caller,
    });
  }

  await logPrompt(
    `Submit ${batches.length} rebuild transaction(s) for ${users.length} participant(s)?`,
  );
  if (safeOwnerAddress) {
    const safe = new SafeWallet(safeOwnerAddress, proposer!);
    for (let index = 0; index < batches.length; index++) {
      const data = encodeFunctionData({
        abi: ORDER_CACHE_ABI,
        functionName: "rebuildOrderAggregateCache",
        args: [batches[index]],
      });
      const safeTxHash = await safe.proposeTransaction({
        data,
        to: futuresAddress,
        value: "0",
        operation: OperationType.Call,
      });
      logStep(
        `batch ${index + 1}/${batches.length} (${batches[index].length})`,
        safe.getSafeUITxUrl(safeTxHash),
      );
    }
    logSuccess(
      `Proposed ${batches.length} rebuild transaction(s); execute them, then rerun with VERIFY_ONLY=true`,
    );
    return;
  }

  for (let index = 0; index < batches.length; index++) {
    const simulation = await simulateContract(pc, {
      address: futuresAddress,
      abi: ORDER_CACHE_ABI,
      functionName: "rebuildOrderAggregateCache",
      args: [batches[index]],
      account: deployer.account,
    });
    const hash = await writeContract(deployer, simulation.request);
    const receipt = await pc.waitForTransactionReceipt({
      hash,
      confirmations: REBUILD_CONFIRMATIONS,
    });
    if (receipt.status !== "success") {
      throw new Error(`Rebuild transaction reverted: ${txUrl(pc, receipt.transactionHash)}`);
    }
    logStep(
      `batch ${index + 1}/${batches.length} (${batches[index].length})`,
      `${txUrl(pc, receipt.transactionHash)} gas=${receipt.gasUsed}`,
    );
  }

  const result = await verifyOrderAggregateCache(
    users,
    createOnChainVerificationReader(pc, futuresAddress),
    readConcurrency,
  );
  logSuccess(
    `Rebuilt and verified ${result.users} user(s), ${result.orders} order(s), ${result.expirations} expiration aggregate(s)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
