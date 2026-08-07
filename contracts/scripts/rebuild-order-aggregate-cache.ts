import { OperationType } from "@safe-global/types-kit";
import hre from "hardhat";
import { encodeFunctionData, getAddress, type Address } from "viem";
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
  parseAddressList,
  readDiscoverySource,
  readNonNegativeBigInt,
  readPositiveInteger,
  type UsedDiscoverySource,
  verifyOrderAggregateCache,
} from "./lib/order-aggregate-cache.ts";

async function main(): Promise<void> {
  logTitle("Rebuild Futures Order Aggregate Cache");

  const { viem } = await hre.network.getOrCreate();
  const pc = await viem.getPublicClient();
  const [deployer, proposer] = await viem.getWalletClients();
  const futuresAddress = requireAddress("FUTURES_ADDRESS");
  const safeOwnerAddress = readOptionalAddress("SAFE_OWNER_ADDRESS");
  const futures = await viem.getContractAt("Futures", futuresAddress);
  const owner = getAddress(await futures.read.owner());

  const source = readDiscoverySource();
  const readConcurrency = readPositiveInteger("READ_CONCURRENCY", 25);
  const writeBatchSize = readPositiveInteger("ORDER_CACHE_WRITE_BATCH_SIZE", 50);
  const latestBlock = await pc.getBlockNumber();
  const suppliedUsers = parseAddressList(process.env.FUTURES_ORDER_CACHE_USERS);
  const dryRun = process.env.DRY_RUN === "true";
  const verifyOnly = process.env.VERIFY_ONLY === "true";

  let candidates: Address[];
  let usedSource: UsedDiscoverySource;
  let discoveryDetail = "";
  if (suppliedUsers) {
    candidates = suppliedUsers;
    usedSource = "supplied";
    discoveryDetail = "FUTURES_ORDER_CACHE_USERS (declared complete)";
  } else {
    const result = await discoverOrderCacheCandidates(pc, futuresAddress, {
      source,
      indexerUrl: process.env.FUTURES_INDEXER_URL ?? process.env.SUBGRAPH_URL,
      latestBlock,
      startBlock:
        readOptionalBigInt("FUTURES_START_BLOCK") ?? readOptionalBigInt("START_BLOCK"),
      endBlock: readOptionalBigInt("END_BLOCK"),
      eventChunkSize:
        readOptionalBigInt("EVENT_SCAN_CHUNK_SIZE") ??
        readOptionalBigInt("BLOCK_CHUNK_SIZE") ??
        5_000n,
      maxIndexerLagBlocks: readNonNegativeBigInt("MAX_INDEXER_LAG_BLOCKS", 50n),
      etherscanApiKey: process.env.ETHERSCAN_API_KEY,
      onIndexerFallback: (error) => {
        console.warn(`Indexer discovery failed: ${(error as Error).message}`);
        console.warn("Falling back to OrderCreated event scan");
      },
      onEventProgress: (from, to, count) =>
        logStep(`scan ${from}-${to}`, `${count} participant(s)`),
      onEventRetry: (from, to, nextChunk) =>
        console.warn(`Log query ${from}-${to} failed; retrying with ${nextChunk}-block chunks`),
    });
    candidates = result.addresses;
    usedSource = result.source;
    discoveryDetail =
      result.source === "indexer"
        ? `snapshot block ${result.indexedBlock}`
        : `blocks ${result.startBlock}-${result.endBlock}`;
  }

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
    Discovery: `${usedSource} (${discoveryDetail})`,
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
    const receipt = await pc.waitForTransactionReceipt({ hash });
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
