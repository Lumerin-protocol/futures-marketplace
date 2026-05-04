import hre from "hardhat";
import { type Address, type PublicClient, getAddress, parseAbiItem } from "viem";
import { encodeFunctionData } from "viem/utils";
import { OperationType } from "@safe-global/types-kit";
import {
  readOptionalAddress,
  readOptionalBigInt,
  requireAddress,
  requireEnvsSet,
} from "../lib/env.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logPrompt, logStep, logSuccess, logTitle } from "../lib/log.ts";
import { SafeWallet } from "../lib/safe.ts";

const ORDER_CREATED_EVENT = parseAbiItem(
  "event OrderCreated(bytes32 indexed orderId, address indexed participant, string destURL, uint256 pricePerDay, uint256 deliveryAt, bool isBuy)",
);
const POSITION_CREATED_EVENT = parseAbiItem(
  "event PositionCreated(bytes32 indexed positionId, address indexed seller, address indexed buyer, uint256 sellPricePerDay, uint256 buyPricePerDay, uint256 deliveryAt, string destURL, bytes32 orderId, bytes32 takerOrderId)",
);

const DEFAULT_BLOCK_CHUNK = 2_000n;
const DEFAULT_RESET_BATCH = 50;
const MIN_CHUNK_BLOCKS = 1n;

async function main() {
  logTitle("Futures Reset State");

  const { viem } = await hre.network.getOrCreate();
  const pc = await viem.getPublicClient();

  const futuresAddress = requireAddress("FUTURES_ADDRESS");
  const SAFE_OWNER_ADDRESS = readOptionalAddress("SAFE_OWNER_ADDRESS");

  const endBlock = readOptionalBigInt("END_BLOCK") ?? (await pc.getBlockNumber());
  const startBlockOverride = readOptionalBigInt("START_BLOCK");
  const startBlock =
    startBlockOverride ?? (await fetchDeploymentBlockFromEtherscan(pc, futuresAddress));
  const blockChunk = readOptionalBigInt("BLOCK_CHUNK_SIZE") ?? DEFAULT_BLOCK_CHUNK;
  const resetBatch = Number(readOptionalBigInt("RESET_BATCH_SIZE") ?? BigInt(DEFAULT_RESET_BATCH));
  const dryRun = process.env.DRY_RUN === "true";

  const [deployer, proposer] = await viem.getWalletClients();

  logInfo("inputs", {
    Futures: addrUrl(pc, futuresAddress),
    StartBlock: `${startBlock}${startBlockOverride === undefined ? " (deployment block via Etherscan)" : ""}`,
    EndBlock: endBlock.toString(),
    BlockChunk: blockChunk.toString(),
    ResetBatch: resetBatch,
    DryRun: dryRun,
    Caller: SAFE_OWNER_ADDRESS ?? deployer.account.address,
  });

  // ── 1. Scan event logs to collect unique participants ──────────────────
  const participants = await collectParticipants(pc, futuresAddress, {
    startBlock,
    endBlock,
    blockChunk,
  });

  logInfo("participants", {
    Total: participants.length,
    Sample: participants.slice(0, 5).join(", ") || "(none)",
  });

  if (participants.length === 0) {
    logSuccess("No participants found — nothing to reset.");
    return;
  }

  if (dryRun) {
    console.log("\n[participants list]");
    for (const addr of participants) console.log(`  ${addr}`);
    logSuccess(`Dry run complete — ${participants.length} participants would be reset.`);
    return;
  }

  // ── 2. Execute resetState in batches ───────────────────────────────────
  const batches = chunk(participants, resetBatch);
  logInfo("batches", { Count: batches.length, BatchSize: resetBatch });

  await logPrompt(`About to reset state for ${participants.length} participants. Proceed?`);

  const futures = await viem.getContractAt("Futures", futuresAddress);

  if (SAFE_OWNER_ADDRESS) {
    if (!proposer) {
      throw new Error("PROPOSER_PRIVATEKEY is required when SAFE_OWNER_ADDRESS is set");
    }
    const safe = new SafeWallet(SAFE_OWNER_ADDRESS, proposer);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const data = encodeFunctionData({
        abi: futures.abi,
        functionName: "resetState",
        args: [batch],
      });
      const safeTxHash = await safe.proposeTransaction({
        data,
        to: futuresAddress,
        value: "0",
        operation: OperationType.Call,
      });
      logStep(
        `batch ${i + 1}/${batches.length} (${batch.length})`,
        safe.getSafeUITxUrl(safeTxHash),
      );
    }
    logSuccess(`Proposed ${batches.length} resetState transaction(s) to Safe ${SAFE_OWNER_ADDRESS}`);
    return;
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const tx = await futures.write.resetState([batch]);
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    logStep(
      `batch ${i + 1}/${batches.length} (${batch.length})`,
      `${txUrl(pc, receipt.transactionHash)}  gas=${receipt.gasUsed}`,
    );
  }
  logSuccess(
    `Reset state for ${participants.length} participants across ${batches.length} batch(es)`,
  );
}

/**
 * Walk `OrderCreated` and `PositionCreated` logs and return the union of
 * `participant` / `seller` / `buyer` addresses, deduped and checksummed.
 *
 * Both events are queried in one `eth_getLogs` round-trip per window. Windows
 * start at `blockChunk` and adaptively halve down to a single block when the
 * RPC rejects the range (e.g. Alchemy's free-tier "block range too wide" or
 * "log response too large" errors), then gently grow back after a success.
 * This way the script self-tunes to whatever the node accepts.
 */
async function collectParticipants(
  pc: PublicClient,
  contract: Address,
  opts: { startBlock: bigint; endBlock: bigint; blockChunk: bigint },
): Promise<Address[]> {
  const seen = new Set<Address>();
  const { startBlock, endBlock, blockChunk } = opts;
  const totalRange = endBlock >= startBlock ? endBlock - startBlock + 1n : 0n;
  let scanned = 0n;
  let currentChunk = blockChunk;
  let from = startBlock;

  while (from <= endBlock) {
    const desiredTo = from + currentChunk - 1n;
    const to = desiredTo > endBlock ? endBlock : desiredTo;

    try {
      const logs = await pc.getLogs({
        address: contract,
        events: [ORDER_CREATED_EVENT, POSITION_CREATED_EVENT],
        fromBlock: from,
        toBlock: to,
      });

      for (const log of logs) {
        if (log.eventName === "OrderCreated" && log.args.participant) {
          seen.add(getAddress(log.args.participant));
        } else if (log.eventName === "PositionCreated") {
          if (log.args.seller) seen.add(getAddress(log.args.seller));
          if (log.args.buyer) seen.add(getAddress(log.args.buyer));
        }
      }

      scanned += to - from + 1n;
      const pct = totalRange === 0n ? 100 : Number((scanned * 100n) / totalRange);
      process.stdout.write(
        `\r  scanning blocks ${from}–${to}  chunk=${currentChunk}  ${pct}%  found=${seen.size}    `,
      );

      from = to + 1n;
      if (currentChunk < blockChunk) {
        currentChunk = currentChunk * 2n > blockChunk ? blockChunk : currentChunk * 2n;
      }
    } catch (err) {
      if (currentChunk <= MIN_CHUNK_BLOCKS) {
        process.stdout.write("\n");
        throw new Error(
          `eth_getLogs failed at block ${from} even with chunk=${currentChunk}: ${(err as Error).message}`,
        );
      }
      const next = currentChunk / 2n;
      currentChunk = next < MIN_CHUNK_BLOCKS ? MIN_CHUNK_BLOCKS : next;
      process.stdout.write(
        `\n  [warn] RPC rejected window ${from}–${to}; retrying with chunk=${currentChunk}\n`,
      );
    }
  }
  process.stdout.write("\n");

  return Array.from(seen);
}

/**
 * Resolves `address`'s deployment block via Etherscan's v2 unified multichain API
 * (`module=contract&action=getcontractcreation`). Requires `ETHERSCAN_API_KEY` to
 * be set (same key used by `hardhat-verify`) and a connected chain whose ID is
 * supported by Etherscan v2.
 *
 * Throws if the API call fails, the response shape is unexpected, or the
 * contract has no creation record. Set `START_BLOCK` to bypass this lookup
 * entirely.
 */
async function fetchDeploymentBlockFromEtherscan(
  pc: PublicClient,
  address: Address,
): Promise<bigint> {
  const { ETHERSCAN_API_KEY } = requireEnvsSet("ETHERSCAN_API_KEY");
  const chainId = pc.chain?.id;
  if (!chainId) throw new Error("Public client has no chain id; cannot query Etherscan");

  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getcontractcreation");
  url.searchParams.set("contractaddresses", address);
  url.searchParams.set("apikey", ETHERSCAN_API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Etherscan request failed: HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as {
    status: string;
    message: string;
    result: Array<{ contractAddress: string; blockNumber?: string; txHash?: string }> | string;
  };

  if (body.status !== "1" || !Array.isArray(body.result) || body.result.length === 0) {
    const detail = typeof body.result === "string" ? body.result : body.message;
    throw new Error(`Etherscan returned no creation record for ${address}: ${detail}`);
  }

  const entry = body.result[0];
  if (!entry.blockNumber) {
    throw new Error(
      `Etherscan response missing blockNumber for ${address}: ${JSON.stringify(entry)}`,
    );
  }
  return BigInt(entry.blockNumber);
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
