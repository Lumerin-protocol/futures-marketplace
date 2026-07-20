import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/** Pre-3.0 and 3.0 OrderCreated — scan both shapes so cutover logs still find users. */
const ORDER_CREATED_V2_EVENT = parseAbiItem(
  "event OrderCreated(bytes32 indexed orderId, address indexed participant, string destURL, uint256 pricePerDay, uint256 expirationAt, bool isBuy)",
);
const ORDER_CREATED_V3_EVENT = parseAbiItem(
  "event OrderCreated(bytes32 indexed orderId, address indexed participant, uint256 price, int256 quantity, uint256 expirationAt)",
);
/** Legacy bilateral lot / position create (pre-3.0). */
const POSITION_CREATED_EVENT = parseAbiItem(
  "event PositionCreated(bytes32 indexed positionId, address indexed seller, address indexed buyer, uint256 sellPricePerDay, uint256 buyPricePerDay, uint256 expirationAt, string destURL, bytes32 orderId, bytes32 takerOrderId)",
);
const ORDER_MATCHED_V3_EVENT = parseAbiItem(
  "event OrderMatched(bytes32 indexed makerOrderId, address indexed maker, address indexed taker, uint256 expirationAt, uint256 tradePrice, int256 takerQuantity, int256 makerFee, int256 takerFee, int256 makerNetQtyAfter, int256 takerNetQtyAfter, uint256 makerEntryPriceAfter, uint256 takerEntryPriceAfter)",
);

const DEFAULT_BLOCK_CHUNK = 10_000n;
const DEFAULT_RESET_BATCH = 50;
const MIN_CHUNK_BLOCKS = 1n;
const CACHE_VERSION = 1;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_DIR = join(SCRIPT_DIR, "..", ".cache", "futures-reset-participants");

type SerializedRange = { from: string; to: string };

type ParticipantScanCache = {
  version: number;
  chainId: number;
  contract: Address;
  participants: Address[];
  scannedRanges: SerializedRange[];
};

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
    Cache:
      process.env.NO_CACHE === "true"
        ? "disabled (NO_CACHE)"
        : participantCachePath(pc, futuresAddress),
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
    logSuccess(
      `Proposed ${batches.length} resetState transaction(s) to Safe ${SAFE_OWNER_ADDRESS}`,
    );
    return;
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const tx = await futures.write.resetState([batch]);
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    logStep(
      `batch ${i + 1}/${batches.length} (${batch.length})`,
      `${txUrl(pc, receipt.transactionHash)}  gas=${receipt.gasUsed} block ${receipt.blockNumber}`,
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
 * Results are cached on disk (per chain + contract). Reruns only `eth_getLogs`
 * for block ranges not yet covered by the cache. Set `NO_CACHE=true` to force a
 * full rescan; `PARTICIPANT_CACHE_DIR` overrides the default cache directory.
 *
 * Both events are queried in one `eth_getLogs` round-trip per window. Windows
 * start at `blockChunk` and adaptively halve down to a single block when the
 * RPC rejects the range, then gently grow back after a success.
 */
async function collectParticipants(
  pc: PublicClient,
  contract: Address,
  opts: { startBlock: bigint; endBlock: bigint; blockChunk: bigint },
): Promise<Address[]> {
  const chainId = pc.chain?.id;
  if (chainId === undefined) {
    throw new Error("Public client has no chain id; cannot use participant scan cache");
  }

  const { startBlock, endBlock, blockChunk } = opts;
  const seen = new Set<Address>();
  let scannedRanges: Array<{ from: bigint; to: bigint }> = [];
  const useCache = process.env.NO_CACHE !== "true";

  if (useCache) {
    const cached = await loadParticipantCache(chainId, contract);
    if (cached) {
      for (const addr of cached.participants) seen.add(getAddress(addr));
      scannedRanges = cached.scannedRanges.map((r) => ({
        from: BigInt(r.from),
        to: BigInt(r.to),
      }));
      logInfo("participant cache", {
        File: participantCachePath(pc, contract),
        Participants: cached.participants.length,
        ScannedRanges: cached.scannedRanges.length,
      });
    }
  }

  const gaps = findMissingRanges(startBlock, endBlock, scannedRanges);
  const totalRange = endBlock >= startBlock ? endBlock - startBlock + 1n : 0n;
  const gapBlocks = gaps.reduce((sum, g) => sum + (g.to - g.from + 1n), 0n);

  if (gaps.length === 0) {
    console.log("  cache covers requested block range — skipping eth_getLogs");
    return Array.from(seen);
  }

  logInfo("participant scan", {
    MissingRanges: gaps.length,
    BlocksToFetch: gapBlocks.toString(),
    BlocksTotal: totalRange.toString(),
  });

  for (let i = 0; i < gaps.length; i++) {
    const gap = gaps[i];
    await scanParticipantLogs(pc, contract, gap.from, gap.to, blockChunk, seen, {
      gapIndex: i + 1,
      gapCount: gaps.length,
      gapBlocks,
    });
    scannedRanges = mergeRanges([...scannedRanges, gap]);
    // Persist after each gap so a failed run can resume without re-fetching.
    if (useCache) {
      await writeParticipantCache(chainId, contract, seen, scannedRanges);
    }
  }

  if (useCache && gaps.length > 0) {
    logInfo("participant cache", { Saved: participantCachePath(pc, contract) });
  }

  return Array.from(seen);
}

/**
 * Scan a contiguous block range and add discovered addresses to `seen`.
 */
async function scanParticipantLogs(
  pc: PublicClient,
  contract: Address,
  rangeStart: bigint,
  rangeEnd: bigint,
  blockChunk: bigint,
  seen: Set<Address>,
  progress: { gapIndex: number; gapCount: number; gapBlocks: bigint },
): Promise<void> {
  let scannedInGap = 0n;
  let currentChunk = blockChunk;
  let from = rangeStart;

  while (from <= rangeEnd) {
    const desiredTo = from + currentChunk - 1n;
    const to = desiredTo > rangeEnd ? rangeEnd : desiredTo;

    try {
      const logs = await pc.getLogs({
        address: contract,
        events: [
          ORDER_CREATED_V2_EVENT,
          ORDER_CREATED_V3_EVENT,
          POSITION_CREATED_EVENT,
          ORDER_MATCHED_V3_EVENT,
        ],
        fromBlock: from,
        toBlock: to,
      });

      for (const log of logs) {
        if (log.eventName === "OrderCreated" && log.args.participant) {
          seen.add(getAddress(log.args.participant));
        } else if (log.eventName === "PositionCreated") {
          if (log.args.seller) seen.add(getAddress(log.args.seller));
          if (log.args.buyer) seen.add(getAddress(log.args.buyer));
        } else if (log.eventName === "OrderMatched") {
          if (log.args.maker) seen.add(getAddress(log.args.maker));
          if (log.args.taker) seen.add(getAddress(log.args.taker));
        }
      }

      scannedInGap += to - from + 1n;
      const pct =
        progress.gapBlocks === 0n ? 100 : Number((scannedInGap * 100n) / progress.gapBlocks);
      process.stdout.write(
        `\r  gap ${progress.gapIndex}/${progress.gapCount}  blocks ${from}–${to}  chunk=${currentChunk}  ${pct}%  found=${seen.size}    `,
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
}

function cacheFilePath(chainId: number, contract: Address): string {
  const dir = process.env.PARTICIPANT_CACHE_DIR ?? DEFAULT_CACHE_DIR;
  return join(dir, `${chainId}-${getAddress(contract).toLowerCase()}.json`);
}

function participantCachePath(pc: PublicClient, contract: Address): string {
  return cacheFilePath(pc.chain?.id ?? 0, contract);
}

async function loadParticipantCache(
  chainId: number,
  contract: Address,
): Promise<ParticipantScanCache | null> {
  const path = cacheFilePath(chainId, contract);
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as ParticipantScanCache;
    if (parsed.version !== CACHE_VERSION) return null;
    if (parsed.chainId !== chainId) return null;
    if (getAddress(parsed.contract) !== getAddress(contract)) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeParticipantCache(
  chainId: number,
  contract: Address,
  seen: Set<Address>,
  scannedRanges: Array<{ from: bigint; to: bigint }>,
): Promise<void> {
  const mergedRanges = mergeRanges(scannedRanges);
  const path = cacheFilePath(chainId, contract);
  await mkdir(dirname(path), { recursive: true });
  const data: ParticipantScanCache = {
    version: CACHE_VERSION,
    chainId,
    contract: getAddress(contract),
    participants: Array.from(seen).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    scannedRanges: mergedRanges.map((r) => ({
      from: r.from.toString(),
      to: r.to.toString(),
    })),
  };
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function mergeRanges(
  ranges: Array<{ from: bigint; to: bigint }>,
): Array<{ from: bigint; to: bigint }> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: Array<{ from: bigint; to: bigint }> = [{ from: sorted[0].from, to: sorted[0].to }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = out[out.length - 1];
    if (cur.from <= last.to + 1n) {
      if (cur.to > last.to) last.to = cur.to;
    } else {
      out.push({ from: cur.from, to: cur.to });
    }
  }
  return out;
}

/** Block ranges in `[start, end]` not already covered by `scanned`. */
function findMissingRanges(
  start: bigint,
  end: bigint,
  scanned: Array<{ from: bigint; to: bigint }>,
): Array<{ from: bigint; to: bigint }> {
  if (start > end) return [];
  const clipped = scanned
    .map((r) => ({
      from: r.from < start ? start : r.from,
      to: r.to > end ? end : r.to,
    }))
    .filter((r) => r.from <= r.to);
  const merged = mergeRanges(clipped);
  if (merged.length === 0) return [{ from: start, to: end }];

  const gaps: Array<{ from: bigint; to: bigint }> = [];
  let cursor = start;
  for (const r of merged) {
    if (cursor < r.from) gaps.push({ from: cursor, to: r.from - 1n });
    cursor = r.to + 1n;
  }
  if (cursor <= end) gaps.push({ from: cursor, to: end });
  return gaps;
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
