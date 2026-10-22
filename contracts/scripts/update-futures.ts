import { OperationType } from "@safe-global/types-kit";
import hre from "hardhat";
import {
  type Address,
  encodeFunctionData,
  getAddress,
  type PublicClient,
  parseAbi,
  zeroAddress,
} from "viem";
import { estimateContractGas, simulateContract } from "viem/actions";
import {
  readOptionalAddress,
  readOptionalBigInt,
  requireAddress,
  requireEnvsSet,
} from "../lib/env.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logPrompt, logStep, logSuccess, logTitle } from "../lib/log.ts";
import { SafeWallet } from "../lib/safe.ts";
import { verifyContract } from "../lib/verify.ts";
import { ensureVaultHalted } from "./lib/halt.ts";
import {
  chunk,
  discoverOrderSlotsFromEvents,
  fetchDeploymentBlockFromEtherscan,
  filterUsersWithPhysicalOrders,
  readPositiveInteger,
} from "./lib/order-aggregate-cache.ts";
import { assertNoRestingOrders, liveOrdersInSlots } from "./lib/resting-orders.ts";

const DEFAULT_SAFE_GAS_OVERHEAD = 150_000n;
const TARGET_CODE_VERSION = "6.11.0";
const UPGRADE_CONFIRMATIONS = 5;
// 6.8.0 calls the engine's `reduceLimits` / `meetsTradeMargin` on every order. Against an
// older engine every order reverts, so the engine has to be upgraded first.
const MIN_ENGINE_VERSION = "2.2.0";
// 6.10 starts a new resting-order aggregate, so orders placed before it must not survive the
// upgrade. With the shared vault halted: expired orders (outside the tradable window) are
// removed on the old code with `removeOutdatedOrders`, then the upgrade call is
// `forceCancelOrders` for every user with orders in the window (further batches follow while
// still halted). Resume the vault only once every venue is upgraded and verified
// (`VERIFY_ONLY=true` checks a venue without upgrading).
const DEFAULT_FORCE_CANCEL_BATCH_SIZE = 20;
const DEFAULT_REMOVE_EXPIRED_BATCH_SIZE = 50;
const DEFAULT_EVENT_CHUNK = 10_000n;
const DEFAULT_READ_CONCURRENCY = 16;
const VERSION_ABI = parseAbi(["function VERSION() view returns (string)"]);

/** Dotted-version comparison; an unreadable version never passes. */
function versionAtLeast(version: string, min: string): boolean {
  const have = version.split(".").map(Number);
  const want = min.split(".").map(Number);
  for (let i = 0; i < want.length; i++) {
    const part = have[i] ?? 0;
    if (part !== want[i]) return part > want[i];
  }
  return true;
}

async function requireEngineVersion(pc: PublicClient, engine: Address): Promise<void> {
  const version = await pc
    .readContract({ address: engine, abi: VERSION_ABI, functionName: "VERSION" })
    .catch(() => "unknown");
  if (!versionAtLeast(version, MIN_ENGINE_VERSION)) {
    throw new Error(
      `PortfolioMarginEngine ${engine} is at ${version}; upgrade it to ${MIN_ENGINE_VERSION} or later before this venue`,
    );
  }
}

async function main() {
  logTitle("HashPowerFutures Upgrade");

  const { viem } = await hre.network.getOrCreate();

  const futuresAddress = requireAddress("FUTURES_ADDRESS");
  const SAFE_OWNER_ADDRESS = readOptionalAddress("SAFE_OWNER_ADDRESS");
  const vaultAddress = requireAddress("VAULT_ADDRESS");
  const marginEngineAddress = readOptionalAddress("MARGIN_ENGINE_ADDRESS");
  const pointsHookAddress =
    readOptionalAddress("POINTS_HOOK_ADDRESS") ?? readOptionalAddress("HOOK_ADDRESS");

  // The network config holds a single key, so the deployer proposes unless a
  // second account is configured.
  const [deployer, proposer = deployer] = await viem.getWalletClients();
  const pc = await viem.getPublicClient();
  logInfo("deployer", { Address: addrUrl(pc, deployer.account.address) });
  if (SAFE_OWNER_ADDRESS) {
    logInfo("safe owner", {
      Address: SAFE_OWNER_ADDRESS,
      Proposer: proposer.account.address,
    });
  }

  const futuresProxy = await viem.getContractAt("HashPowerFutures", futuresAddress);
  const currentVersion = await futuresProxy.read.VERSION().catch(() => "unknown");
  const owner = getAddress(await futuresProxy.read.owner());
  const upgradeCaller = getAddress(SAFE_OWNER_ADDRESS ?? deployer.account.address);
  logInfo("current futures", {
    Address: addrUrl(pc, futuresProxy.address),
    Owner: owner,
    Version: currentVersion,
    HASHPRICE_USD: await futuresProxy.read.priceOracle(),
  });
  if (upgradeCaller !== owner) {
    throw new Error(
      `Configured upgrade caller ${upgradeCaller} is not HashPowerFutures owner ${owner}`,
    );
  }
  const wiredEngine = getAddress(
    await futuresProxy.read.portfolioMargin().catch(() => zeroAddress),
  );
  const engines = new Set([wiredEngine, getAddress(marginEngineAddress ?? zeroAddress)]);
  engines.delete(zeroAddress);
  for (const engine of engines) {
    await requireEngineVersion(pc, engine);
  }

  // ── Resting orders: discover and plan the cancellation ─────────────────
  const readConcurrency = readPositiveInteger("READ_CONCURRENCY", DEFAULT_READ_CONCURRENCY);
  const startBlock =
    readOptionalBigInt("START_BLOCK_FUTURES") ??
    (await fetchDeploymentBlockFromEtherscan(
      pc,
      futuresAddress,
      requireEnvsSet("ETHERSCAN_API_KEY").ETHERSCAN_API_KEY,
    ));
  const initialChunkSize = readOptionalBigInt("EVENT_SCAN_CHUNK_SIZE") ?? DEFAULT_EVENT_CHUNK;
  const discoverAt = async (blockNumber?: bigint) => {
    const block = await pc.getBlock(blockNumber === undefined ? {} : { blockNumber });
    const found = await discoverOrderSlotsFromEvents(pc, futuresAddress, {
      startBlock,
      endBlock: block.number,
      initialChunkSize,
      expiredBefore: block.timestamp,
    });
    return { snapshot: block, ...found };
  };
  if (process.env.VERIFY_ONLY === "true") {
    const { snapshot, participants, expiredSlots } = await discoverAt();
    await assertNoRestingOrders(
      pc,
      futuresAddress,
      participants,
      expiredSlots,
      readConcurrency,
      snapshot.number,
    );
    logSuccess(
      `No resting orders at block ${snapshot.number} (${participants.length} participants checked)`,
    );
    return;
  }

  // Listed only once halted, so no user can place an order the cancellation would miss.
  const { snapshot, participants, expiredSlots } = await discoverAt(
    await ensureVaultHalted(pc, vaultAddress, deployer, proposer),
  );
  const expiredOrderIds = await liveOrdersInSlots(
    pc,
    futuresAddress,
    expiredSlots,
    readConcurrency,
    snapshot.number,
  );
  const usersWithOrders = await filterUsersWithPhysicalOrders(
    pc,
    futuresAddress,
    participants,
    readConcurrency,
    snapshot.number,
  );
  const cancelBatches = chunk(
    usersWithOrders,
    readPositiveInteger("FORCE_CANCEL_BATCH_SIZE", DEFAULT_FORCE_CANCEL_BATCH_SIZE),
  );
  const [nextExpiry] = await futuresProxy.read.getExpirationDates({ blockNumber: snapshot.number });
  logInfo("resting orders", {
    "Orders block": snapshot.number,
    "Expired orders to remove first": expiredOrderIds.length,
    "Users with orders in the window": usersWithOrders.length,
    "forceCancelOrders batches": cancelBatches.length,
    "Upgrade before": `${new Date(Number(nextExpiry) * 1000).toISOString()} (next expiry; rerun after it)`,
  });

  // 3.x cutover: order/position semantics change; 3.1+ also breaks Order storage layout
  // (safe after futures-reset-state). Required order: pause MM/keeper → futures-reset-state →
  // this upgrade → new subgraph from upgrade block → cut over keeper/MM/UI ABI.
  if (typeof currentVersion === "string" && currentVersion.startsWith("2.")) {
    logInfo("3.x cutover reminder", {
      BeforeUpgrade: "run scripts/futures-reset-state.ts (clear orders + positions)",
      AfterUpgrade: "redeploy indexer from upgrade block; point keeper ABI at 3.x",
      Docs: "docs/06.Event-Desing-Spec.md § Cutover notes",
    });
  }

  await logPrompt("Review the configuration above. Proceed with upgrade?");

  // ── 1. Remove expired orders on the current implementation ────────────
  for (const [i, batch] of chunk(
    expiredOrderIds,
    readPositiveInteger("REMOVE_EXPIRED_BATCH_SIZE", DEFAULT_REMOVE_EXPIRED_BATCH_SIZE),
  ).entries()) {
    const tx = await deployer.writeContract({
      address: futuresAddress,
      abi: futuresProxy.abi,
      functionName: "removeOutdatedOrders",
      args: [batch],
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") {
      throw new Error(`removeOutdatedOrders reverted: ${txUrl(pc, receipt.transactionHash)}`);
    }
    logStep(
      `removeOutdatedOrders batch ${i + 1} (${batch.length})`,
      txUrl(pc, receipt.transactionHash),
    );
  }

  // ── 2. Deploy new implementation ────────────────────────────────────────
  logInfo("Deploy new HashPowerFutures implementation", {
    contract: "HashPowerFutures",
  });
  await logPrompt("Proceed?");
  const futuresImpl = await viem.deployContract("HashPowerFutures", [vaultAddress], {
    confirmations: UPGRADE_CONFIRMATIONS,
  });

  logStep("Deployed", addrUrl(pc, futuresImpl.address));
  await verifyContract(futuresImpl.address, [vaultAddress], undefined, {
    contract: "contracts/HashPowerFutures.sol:HashPowerFutures",
  });
  logStep("Verified", addrUrl(pc, futuresImpl.address));

  const newVersion = await futuresImpl.read.VERSION();
  logInfo("version", { current: currentVersion, new: newVersion });
  if (newVersion !== TARGET_CODE_VERSION) {
    throw new Error(`Implementation VERSION is ${newVersion}, expected ${TARGET_CODE_VERSION}`);
  }
  if (newVersion === currentVersion) {
    throw new Error("New version is the same as the current version. Aborting.");
  }
  // Simulate the exact upgrade call from the actual owner and prove it fits
  // before either sending the direct upgrade or creating a Safe proposal.
  const [firstBatch, ...followUpBatches] = cancelBatches;
  const upgradeArgs = [
    futuresImpl.address,
    firstBatch
      ? encodeFunctionData({
          abi: futuresImpl.abi,
          functionName: "forceCancelOrders",
          args: [firstBatch],
        })
      : "0x",
  ] as const;
  await simulateContract(pc, {
    address: futuresAddress,
    abi: futuresProxy.abi,
    functionName: "upgradeToAndCall",
    args: upgradeArgs,
    account: upgradeCaller,
  });
  const estimatedUpgradeGas = await estimateContractGas(pc, {
    address: futuresAddress,
    abi: futuresProxy.abi,
    functionName: "upgradeToAndCall",
    args: upgradeArgs,
    account: upgradeCaller,
  });
  const latestBlock = await pc.getBlock();
  const configuredMaxAtomicGas = readOptionalBigInt("MAX_ATOMIC_UPGRADE_GAS");
  if (configuredMaxAtomicGas !== undefined && configuredMaxAtomicGas < 0n) {
    throw new Error("MAX_ATOMIC_UPGRADE_GAS must not be negative");
  }
  const maxAtomicUpgradeGas =
    configuredMaxAtomicGas !== undefined && configuredMaxAtomicGas < latestBlock.gasLimit
      ? configuredMaxAtomicGas
      : latestBlock.gasLimit;
  const safeGasOverhead = SAFE_OWNER_ADDRESS
    ? (readOptionalBigInt("SAFE_EXECUTION_GAS_OVERHEAD") ?? DEFAULT_SAFE_GAS_OVERHEAD)
    : 0n;
  const requiredBlockGas = estimatedUpgradeGas + safeGasOverhead;
  if (requiredBlockGas > maxAtomicUpgradeGas) {
    throw new Error(
      `Upgrade cannot fit: estimate ${estimatedUpgradeGas} + Safe overhead ${safeGasOverhead} ` +
        `= ${requiredBlockGas}, limit ${maxAtomicUpgradeGas}. Lower FORCE_CANCEL_BATCH_SIZE.`,
    );
  }
  logInfo("upgrade preflight", {
    Call: firstBatch ? `forceCancelOrders(${firstBatch.length} users)` : "(none)",
    Simulation: "passed",
    "Estimated upgrade gas": estimatedUpgradeGas,
    "Safe execution overhead": safeGasOverhead,
    "Enforced gas limit": maxAtomicUpgradeGas,
  });

  // ── 3. Upgrade ──────────────────────────────────────────────────────────
  if (SAFE_OWNER_ADDRESS) {
    logInfo("Propose upgrade via Safe", { safe: SAFE_OWNER_ADDRESS });
    await logPrompt("Proceed?");

    const upgradeData = encodeFunctionData({
      abi: futuresProxy.abi,
      functionName: "upgradeToAndCall",
      args: upgradeArgs,
    });

    const { SAFE_API_KEY } = requireEnvsSet("SAFE_API_KEY");
    const safe = new SafeWallet(SAFE_OWNER_ADDRESS, proposer, SAFE_API_KEY);
    const txHash = await safe.proposeTransaction({
      data: upgradeData,
      to: futuresAddress,
      value: "0",
      operation: OperationType.Call,
    });
    logStep("Safe TX hash", txHash);
    logStep("Safe UI URL", safe.getSafeUITxUrl(txHash));

    for (const [i, batch] of followUpBatches.entries()) {
      const cancelTxHash = await safe.proposeTransaction({
        data: encodeFunctionData({
          abi: futuresImpl.abi,
          functionName: "forceCancelOrders",
          args: [batch],
        }),
        to: futuresAddress,
        value: "0",
        operation: OperationType.Call,
      });
      logStep(
        `forceCancelOrders batch ${i + 2}/${cancelBatches.length}`,
        safe.getSafeUITxUrl(cancelTxHash),
      );
    }

    if (marginEngineAddress) {
      logInfo("Propose setMarginEngine via Safe", {
        marginEngine: marginEngineAddress,
      });
      await logPrompt("Proceed?");
      const setMarginEngineData = encodeFunctionData({
        abi: futuresProxy.abi,
        functionName: "setPortfolioMargin",
        args: [marginEngineAddress],
      });
      const setMarginEngineTxHash = await safe.proposeTransaction({
        data: setMarginEngineData,
        to: futuresAddress,
        value: "0",
        operation: OperationType.Call,
      });
      logStep("Safe TX hash", setMarginEngineTxHash);
      logStep("Safe UI URL", safe.getSafeUITxUrl(setMarginEngineTxHash));
    }

    if (pointsHookAddress) {
      logInfo("Propose setHook via Safe", { hook: pointsHookAddress });
      await logPrompt("Proceed?");
      const setHookData = encodeFunctionData({
        abi: futuresProxy.abi,
        functionName: "setHook",
        args: [pointsHookAddress],
      });
      const setHookTxHash = await safe.proposeTransaction({
        data: setHookData,
        to: futuresAddress,
        value: "0",
        operation: OperationType.Call,
      });
      logStep("Safe TX hash", setHookTxHash);
      logStep("Safe UI URL", safe.getSafeUITxUrl(setHookTxHash));
    }
  } else {
    logInfo("Upgrade HashPowerFutures proxy", { newImpl: futuresImpl.address });
    await logPrompt("Proceed?");
    const tx = await futuresProxy.write.upgradeToAndCall(upgradeArgs);
    const receipt = await pc.waitForTransactionReceipt({
      hash: tx,
      confirmations: UPGRADE_CONFIRMATIONS,
    });
    if (receipt.status !== "success") {
      throw new Error(`Upgrade tx reverted: ${txUrl(pc, receipt.transactionHash)}`);
    }
    logStep("Upgraded", `${txUrl(pc, receipt.transactionHash)}  block ${receipt.blockNumber}`);

    // Read post-upgrade state at the receipt block — "latest" can still be the
    // pre-upgrade tip on some RPCs right after waitForTransactionReceipt.
    const atUpgradeBlock = { blockNumber: receipt.blockNumber } as const;
    const upgraded = await viem.getContractAt("HashPowerFutures", futuresAddress);
    const upgradedVersion = await upgraded.read.VERSION(atUpgradeBlock);
    logInfo("upgraded futures", {
      Vault: await upgraded.read.vault(atUpgradeBlock),
      MarginEngine: await upgraded.read.portfolioMargin(atUpgradeBlock),
      HASHPRICE_USD: await upgraded.read.priceOracle(atUpgradeBlock),
      Hook: await upgraded.read.hook(atUpgradeBlock),
      Owner: await upgraded.read.owner(atUpgradeBlock),
      Version: upgradedVersion,
      Block: receipt.blockNumber.toString(),
    });
    if (upgradedVersion !== TARGET_CODE_VERSION) {
      throw new Error(
        `Proxy VERSION at block ${receipt.blockNumber} is ${upgradedVersion}, expected ${TARGET_CODE_VERSION}`,
      );
    }
    let verifyBlock = receipt.blockNumber;
    for (const [i, batch] of followUpBatches.entries()) {
      const cancelTx = await upgraded.write.forceCancelOrders([batch]);
      const cancelReceipt = await pc.waitForTransactionReceipt({ hash: cancelTx });
      if (cancelReceipt.status !== "success") {
        throw new Error(`forceCancelOrders reverted: ${txUrl(pc, cancelReceipt.transactionHash)}`);
      }
      verifyBlock = cancelReceipt.blockNumber;
      logStep(
        `forceCancelOrders batch ${i + 2}/${cancelBatches.length}`,
        txUrl(pc, cancelReceipt.transactionHash),
      );
    }
    await assertNoRestingOrders(
      pc,
      futuresAddress,
      usersWithOrders,
      expiredSlots,
      readConcurrency,
      verifyBlock,
    );
    logStep("Resting orders", `none left (${usersWithOrders.length} users cancelled)`);

    // ── 4. Post-upgrade config ──────────────────────────────────────────
    if (marginEngineAddress) {
      const currentMarginEngine = await upgraded.read.portfolioMargin();
      if (currentMarginEngine.toLowerCase() === marginEngineAddress.toLowerCase()) {
        logStep("setMarginEngine", `skipped (already set to ${marginEngineAddress})`);
      } else {
        logInfo("setMarginEngine", {
          current: currentMarginEngine,
          new: marginEngineAddress,
        });
        await logPrompt("Proceed?");
        const setTx = await upgraded.write.setPortfolioMargin([marginEngineAddress]);
        const setReceipt = await pc.waitForTransactionReceipt({ hash: setTx });
        logStep("setMarginEngine", txUrl(pc, setReceipt.transactionHash));
        logStep("MarginEngine", await upgraded.read.portfolioMargin());
      }
    }

    if (pointsHookAddress) {
      const currentHook = await upgraded.read.hook();
      if (currentHook.toLowerCase() === pointsHookAddress.toLowerCase()) {
        logStep("setHook", `skipped (already set to ${pointsHookAddress})`);
      } else {
        logInfo("setHook", { current: currentHook, new: pointsHookAddress });
        await logPrompt("Proceed?");
        const setTx = await upgraded.write.setHook([pointsHookAddress]);
        const setReceipt = await pc.waitForTransactionReceipt({ hash: setTx });
        logStep("setHook", txUrl(pc, setReceipt.transactionHash));
        logStep("Hook", await upgraded.read.hook());
      }
    }
  }

  logSuccess(`HashPowerFutures upgraded ${futuresAddress} → impl ${futuresImpl.address}`);
  logInfo("next", {
    Resume: "resume the vault once every venue is upgraded and has no resting orders left",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
