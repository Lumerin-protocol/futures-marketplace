import hre from "hardhat";
import { type Address, type Hex, type PublicClient, getAddress, parseAbi, parseAbiItem } from "viem";
import { requireAddress, readOptionalBigInt, requireEnvsSet } from "../lib/env.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logPrompt, logStep, logSuccess, logTitle } from "../lib/log.ts";
import {
  type OrderSlot,
  chunk,
  fetchDeploymentBlockFromEtherscan,
  mapConcurrently,
} from "./lib/order-aggregate-cache.ts";

// Closes out a retired 6.8.0 venue while the vault is halted: matured legs settle at their
// settlement price, open legs close at the mark through the insurance fund, then every order is
// cleared. 6.8.0's `resetState` also zeroes positions without paying their PnL, so it only runs
// once every leg is flat. Dry run unless EXECUTE=true.
const RETIRED_VERSION = "6.8.0";
const RETIRED_FUTURES_ABI = parseAbi([
  "function VERSION() view returns (string)",
  "function BACKSTOP() view returns (address)",
  "function getUserPosition(address, uint256) view returns ((int256 netQuantity, int256 netEntryValue))",
  "function getUserOrdersAtExpiration(address, uint256) view returns (bytes32[])",
  "function settlePositions(address[], uint256[])",
  "function forceClosePositions(address[], uint256[])",
  "function resetState(address[])",
  "function removeOutdatedOrders(bytes32[]) returns (uint256)",
]);
const ORDER_CREATED = parseAbiItem(
  "event OrderCreated(bytes32 indexed orderId, address indexed participant, uint256 price, int256 quantity, uint256 expirationAt)",
);
const ORDER_MATCHED = parseAbiItem(
  "event OrderMatched(bytes32 indexed makerOrderId, address indexed maker, address indexed taker, uint256 expirationAt, uint256 tradePrice, int256 takerQuantity, int256 makerFee, int256 takerFee, int256 makerNetQtyAfter, int256 takerNetQtyAfter, uint256 makerEntryPriceAfter, uint256 takerEntryPriceAfter)",
);
const VAULT_ABI = parseAbi([
  "function halted() view returns (bool)",
  "function insuranceFundBalance() view returns (uint256)",
]);
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CHUNK = 10_000n;
const READ_CONCURRENCY = 16;

type Leg = OrderSlot & { netQuantity: bigint; orders: number; orderIds: readonly Hex[] };

/** Every (participant, expiry) pair that ever held an order or a fill. */
async function scanLegs(pc: PublicClient, futures: Address, fromBlock: bigint, toBlock: bigint) {
  const slots = new Map<string, OrderSlot>();
  const add = (participant: Address, expirationAt: bigint) =>
    slots.set(`${participant}:${expirationAt}`, { participant, expirationAt });
  let size = DEFAULT_CHUNK;
  for (let from = fromBlock; from <= toBlock; ) {
    const to = from + size - 1n > toBlock ? toBlock : from + size - 1n;
    try {
      const logs = await pc.getLogs({ address: futures, events: [ORDER_CREATED, ORDER_MATCHED], fromBlock: from, toBlock: to });
      for (const log of logs) {
        if (log.eventName === "OrderCreated") {
          add(getAddress(log.args.participant!), log.args.expirationAt!);
        } else {
          add(getAddress(log.args.maker!), log.args.expirationAt!);
          add(getAddress(log.args.taker!), log.args.expirationAt!);
        }
      }
      from = to + 1n;
      if (size < DEFAULT_CHUNK) size *= 2n;
    } catch (error) {
      if (size === 1n) throw error;
      size /= 2n;
    }
  }
  return [...slots.values()];
}

async function readLegs(pc: PublicClient, futures: Address, slots: readonly OrderSlot[], blockNumber: bigint) {
  return mapConcurrently(slots, READ_CONCURRENCY, async (slot): Promise<Leg> => {
    const args = [slot.participant, slot.expirationAt] as const;
    const [position, orders] = await Promise.all([
      pc.readContract({ address: futures, abi: RETIRED_FUTURES_ABI, functionName: "getUserPosition", args, blockNumber }),
      pc.readContract({ address: futures, abi: RETIRED_FUTURES_ABI, functionName: "getUserOrdersAtExpiration", args, blockNumber }),
    ]);
    return { ...slot, netQuantity: position.netQuantity, orders: orders.length, orderIds: orders };
  });
}

async function main() {
  logTitle("HashPowerFutures close-out");

  const futures = requireAddress("FUTURES_ADDRESS");
  const vault = requireAddress("VAULT_ADDRESS");
  const execute = process.env.EXECUTE === "true";
  const batchSize = Number(process.env.CLOSE_OUT_BATCH_SIZE ?? DEFAULT_BATCH_SIZE);

  const { viem } = await hre.network.getOrCreate();
  const [deployer] = await viem.getWalletClients();
  const pc = await viem.getPublicClient();

  const version = await pc.readContract({ address: futures, abi: RETIRED_FUTURES_ABI, functionName: "VERSION" });
  if (version !== RETIRED_VERSION) {
    throw new Error(`Futures VERSION is ${version}; this script closes out ${RETIRED_VERSION}`);
  }
  const block = await pc.getBlock();
  if (!(await pc.readContract({ address: vault, abi: VAULT_ABI, functionName: "halted", blockNumber: block.number }))) {
    throw new Error("The vault is not halted; run collateral-margin's vault-halt.ts first");
  }

  const startBlock =
    readOptionalBigInt("START_BLOCK") ??
    (await fetchDeploymentBlockFromEtherscan(pc, futures, requireEnvsSet("ETHERSCAN_API_KEY").ETHERSCAN_API_KEY));
  const traded = await scanLegs(pc, futures, startBlock, block.number);
  // Liquidations hand positions to the backstop without an order event.
  const backstop = getAddress(
    await pc.readContract({ address: futures, abi: RETIRED_FUTURES_ABI, functionName: "BACKSTOP" }),
  );
  const expiries = [...new Set(traded.map((s) => s.expirationAt))];
  const slots = [...traded, ...expiries.map((expirationAt) => ({ participant: backstop, expirationAt }))];
  const participants = [...new Set(slots.map((s) => s.participant))];

  const legs = await readLegs(pc, futures, slots, block.number);
  const open = legs.filter((l) => l.netQuantity !== 0n);
  const matured = open.filter((l) => l.expirationAt <= block.timestamp);
  const live = open.filter((l) => l.expirationAt > block.timestamp);
  // `resetState` only clears orders on live dates; expired ones are inert and need `removeOutdatedOrders`.
  const ordered = [
    ...new Set(legs.filter((l) => l.orders > 0 && l.expirationAt > block.timestamp).map((l) => l.participant)),
  ];
  const outdated = legs.filter((l) => l.expirationAt <= block.timestamp).flatMap((l) => l.orderIds);
  const fundBefore = await pc.readContract({ address: vault, abi: VAULT_ABI, functionName: "insuranceFundBalance" });
  logInfo("close-out plan", {
    Futures: addrUrl(pc, futures),
    "Snapshot block": block.number,
    "Scanned from block": startBlock,
    Participants: participants.length,
    "Legs scanned": legs.length,
    "Matured legs to settle": matured.length,
    "Open legs to force-close": live.length,
    "Users with orders on live dates": ordered.length,
    "Expired orders": outdated.length,
    "Resting orders": legs.reduce((s, l) => s + l.orders, 0),
    "Insurance fund": fundBefore,
  });
  for (const l of legs.filter((l) => l.netQuantity !== 0n || l.orders > 0)) {
    logStep(
      `${l.participant} @ ${new Date(Number(l.expirationAt) * 1000).toISOString()}`,
      `position ${l.netQuantity}, ${l.orders} order(s)`,
    );
  }

  if (!execute) {
    logSuccess("Dry run; set EXECUTE=true to send");
    return;
  }

  await logPrompt("Settle matured legs, force-close open legs, then reset the orders?");
  // A load-balanced RPC can report a head older than the receipts, so verify at the last receipt.
  let after = block.number;
  const send = async (functionName: "settlePositions" | "forceClosePositions", batch: Leg[]) => {
    const hash = await deployer.writeContract({
      address: futures,
      abi: RETIRED_FUTURES_ABI,
      functionName,
      args: [batch.map((l) => l.participant), batch.map((l) => l.expirationAt)],
    });
    const receipt = await pc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${txUrl(pc, hash)}`);
    after = receipt.blockNumber;
    logStep(`${functionName}(${batch.length})`, txUrl(pc, hash));
  };
  for (const batch of chunk(matured, batchSize)) await send("settlePositions", batch);
  for (const batch of chunk(live, batchSize)) await send("forceClosePositions", batch);
  for (const batch of chunk(ordered, batchSize)) {
    const hash = await deployer.writeContract({ address: futures, abi: RETIRED_FUTURES_ABI, functionName: "resetState", args: [batch] });
    const receipt = await pc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`resetState reverted: ${txUrl(pc, hash)}`);
    after = receipt.blockNumber;
    logStep(`resetState(${batch.length})`, txUrl(pc, hash));
  }
  for (const batch of chunk(outdated, batchSize)) {
    const hash = await deployer.writeContract({ address: futures, abi: RETIRED_FUTURES_ABI, functionName: "removeOutdatedOrders", args: [batch] });
    const receipt = await pc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`removeOutdatedOrders reverted: ${txUrl(pc, hash)}`);
    after = receipt.blockNumber;
    logStep(`removeOutdatedOrders(${batch.length})`, txUrl(pc, hash));
  }

  const left = (await readLegs(pc, futures, slots, after)).filter((l) => l.netQuantity !== 0n || l.orders > 0);
  if (left.length > 0) throw new Error(`${left.length} leg(s) still hold a position or orders`);
  const fundAfter = await pc.readContract({ address: vault, abi: VAULT_ABI, functionName: "insuranceFundBalance", blockNumber: after });
  logInfo("closed out", {
    Block: after,
    "Insurance fund before": fundBefore,
    "Insurance fund after": fundAfter,
    "Paid by the fund": fundBefore - fundAfter,
  });
  logSuccess(`No positions or orders left on ${futures}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
