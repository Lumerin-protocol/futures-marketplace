import hre from "hardhat";
import { encodeFunctionData, getAddress, type Address } from "viem";
import { estimateContractGas, simulateContract } from "viem/actions";
import { OperationType } from "@safe-global/types-kit";
import { readOptionalAddress, readOptionalBigInt, requireAddress } from "../lib/env.ts";
import { verifyContract } from "../lib/verify.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logPrompt, logStep, logSuccess, logTitle } from "../lib/log.ts";
import { SafeWallet } from "../lib/safe.ts";
import {
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

const ORDER_CACHE_VERSION = "4.1.0";
const DEFAULT_SAFE_GAS_OVERHEAD = 150_000n;

async function main() {
  logTitle("Futures Upgrade");

  const { viem } = await hre.network.getOrCreate();

  const futuresAddress = requireAddress("FUTURES_ADDRESS");
  const SAFE_OWNER_ADDRESS = readOptionalAddress("SAFE_OWNER_ADDRESS");
  const vaultAddress = requireAddress("VAULT_ADDRESS");
  const marginEngineAddress = readOptionalAddress("MARGIN_ENGINE_ADDRESS");
  const pointsHookAddress = readOptionalAddress("HOOK_ADDRESS");

  const [deployer, proposer] = await viem.getWalletClients();
  const pc = await viem.getPublicClient();
  logInfo("deployer", { Address: addrUrl(pc, deployer.account.address) });
  if (SAFE_OWNER_ADDRESS) {
    logInfo("safe owner", { Address: SAFE_OWNER_ADDRESS });
  }

  const futuresProxy = await viem.getContractAt("Futures", futuresAddress);
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
    throw new Error(`Configured upgrade caller ${upgradeCaller} is not Futures owner ${owner}`);
  }
  if (SAFE_OWNER_ADDRESS && !proposer) {
    throw new Error("PROPOSER_PRIVATEKEY is required when SAFE_OWNER_ADDRESS is set");
  }

  const needsOrderCacheMigration = versionIsBefore(currentVersion, ORDER_CACHE_VERSION);
  let orderCacheUsers: Address[] = [];
  if (needsOrderCacheMigration) {
    if (process.env.FUTURES_ORDER_FLOW_PAUSED !== "true") {
      throw new Error(
        "FUTURES_ORDER_FLOW_PAUSED=true is required for the 4.1.0 migration. " +
          "Pause order creation/removal before discovery and keep it paused through upgrade execution.",
      );
    }

    const readConcurrency = readPositiveInteger("READ_CONCURRENCY", 25);
    const suppliedUsers = parseAddressList(process.env.FUTURES_ORDER_CACHE_USERS);
    let candidates: Address[];
    let usedSource: UsedDiscoverySource;
    let discoveryDetail: string;
    if (suppliedUsers) {
      candidates = suppliedUsers;
      usedSource = "supplied";
      discoveryDetail = "FUTURES_ORDER_CACHE_USERS (declared complete)";
    } else {
      const latestBlock = await pc.getBlockNumber();
      const result = await discoverOrderCacheCandidates(pc, futuresAddress, {
        source: readDiscoverySource(),
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

    // Do not use timestamps here. Expired-but-physical orders must be rebuilt.
    orderCacheUsers = await filterUsersWithPhysicalOrders(
      pc,
      futuresAddress,
      candidates,
      readConcurrency,
    );
    logInfo("4.1.0 atomic order-cache migration", {
      Paused: true,
      Discovery: `${usedSource} (${discoveryDetail})`,
      "Discovered participants": candidates.length,
      "Participants with physical orders": orderCacheUsers.length,
      "Read concurrency": readConcurrency,
    });
    for (const user of orderCacheUsers) console.log(`  ${user}`);
  }

  // 3.x cutover: order/position semantics change; 3.1+ also breaks Order storage layout
  // (safe after resetState). Required order: pause MM/keeper → futures-reset-state →
  // this upgrade → new subgraph from upgrade block → cut over keeper/MM/UI ABI.
  if (typeof currentVersion === "string" && currentVersion.startsWith("2.")) {
    logInfo("3.x cutover reminder", {
      BeforeUpgrade: "run scripts/futures-reset-state.ts (clear orders + positions)",
      AfterUpgrade: "redeploy indexer from upgrade block; point keeper ABI at 3.x",
      Docs: "docs/06.Event-Desing-Spec.md § Cutover notes",
    });
  }

  await logPrompt("Review the configuration above. Proceed with upgrade?");

  // ── 1. Deploy new implementation ────────────────────────────────────────
  logInfo("Deploy new Futures implementation", { contract: "Futures" });
  await logPrompt("Proceed?");
  const futuresImpl = await viem.deployContract("Futures", [vaultAddress], {
    confirmations: 3,
  });

  logStep("Deployed", addrUrl(pc, futuresImpl.address));
  await verifyContract(futuresImpl.address, [vaultAddress], undefined, {
    contract: "contracts/Futures.sol:Futures",
  });
  logStep("Verified", addrUrl(pc, futuresImpl.address));

  const newVersion = await futuresImpl.read.VERSION();
  logInfo("version", { current: currentVersion, new: newVersion });
  if (newVersion === currentVersion) {
    throw new Error("New version is the same as the current version. Aborting.");
  }
  if (needsOrderCacheMigration && versionIsBefore(newVersion, ORDER_CACHE_VERSION)) {
    throw new Error(
      `New implementation VERSION ${newVersion} does not contain the required ${ORDER_CACHE_VERSION} order-cache migration API`,
    );
  }

  const migrationData = needsOrderCacheMigration
    ? encodeFunctionData({
        abi: ORDER_CACHE_ABI,
        functionName: "rebuildOrderAggregateCache",
        args: [orderCacheUsers],
      })
    : "0x";

  // Simulate the exact atomic call from the actual owner and prove it fits
  // before either sending the direct upgrade or creating a Safe proposal.
  const upgradeArgs = [futuresImpl.address, migrationData] as const;
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
    ? readOptionalBigInt("SAFE_EXECUTION_GAS_OVERHEAD") ?? DEFAULT_SAFE_GAS_OVERHEAD
    : 0n;
  const requiredBlockGas = estimatedUpgradeGas + safeGasOverhead;
  if (requiredBlockGas > maxAtomicUpgradeGas) {
    throw new Error(
      `Atomic upgrade cannot fit: estimate ${estimatedUpgradeGas} + Safe overhead ${safeGasOverhead} ` +
        `= ${requiredBlockGas}, limit ${maxAtomicUpgradeGas}. Reduce the complete migration set only by ` +
        "removing users that have no physical orders; do not split the migration after the upgrade.",
    );
  }
  logInfo("atomic upgrade preflight", {
    Simulation: "passed",
    "Migration users": orderCacheUsers.length,
    "Estimated upgrade gas": estimatedUpgradeGas,
    "Safe execution overhead": safeGasOverhead,
    "Enforced gas limit": maxAtomicUpgradeGas,
  });

  // ── 2. Upgrade ──────────────────────────────────────────────────────────
  if (SAFE_OWNER_ADDRESS) {
    logInfo("Propose upgrade via Safe", { safe: SAFE_OWNER_ADDRESS });
    await logPrompt("Proceed?");

    const upgradeData = encodeFunctionData({
      abi: futuresProxy.abi,
      functionName: "upgradeToAndCall",
      args: upgradeArgs,
    });

    const safe = new SafeWallet(SAFE_OWNER_ADDRESS, proposer);
    const txHash = await safe.proposeTransaction({
      data: upgradeData,
      to: futuresAddress,
      value: "0",
      operation: OperationType.Call,
    });
    logStep("Safe TX hash", txHash);
    logStep("Safe UI URL", safe.getSafeUITxUrl(txHash));
    if (needsOrderCacheMigration) {
      logStep(
        "Post-execution verification",
        "run rebuild:order-cache with VERIFY_ONLY=true before resuming order flow",
      );
    }

    if (marginEngineAddress) {
      logInfo("Propose setMarginEngine via Safe", { marginEngine: marginEngineAddress });
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
    logInfo("Upgrade Futures proxy", { newImpl: futuresImpl.address });
    await logPrompt("Proceed?");
    const tx = await futuresProxy.write.upgradeToAndCall(upgradeArgs);
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") {
      throw new Error(`Upgrade tx reverted: ${txUrl(pc, receipt.transactionHash)}`);
    }
    logStep("Upgraded", `${txUrl(pc, receipt.transactionHash)}  block ${receipt.blockNumber}`);

    // Read post-upgrade state at the receipt block — "latest" can still be the
    // pre-upgrade tip on some RPCs right after waitForTransactionReceipt.
    const atUpgradeBlock = { blockNumber: receipt.blockNumber } as const;
    const upgraded = await viem.getContractAt("Futures", futuresAddress);
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
    if (upgradedVersion !== newVersion) {
      throw new Error(
        `Proxy VERSION at block ${receipt.blockNumber} is ${upgradedVersion}, expected ${newVersion}`,
      );
    }
    if (needsOrderCacheMigration) {
      const verification = await verifyOrderAggregateCache(
        orderCacheUsers,
        createOnChainVerificationReader(pc, futuresAddress, receipt.blockNumber),
        readPositiveInteger("READ_CONCURRENCY", 25),
      );
      logStep(
        "Order cache verification",
        `${verification.orders} order(s), ${verification.expirations} expiration(s)`,
      );
    }

    // ── 3. Post-upgrade config ──────────────────────────────────────────
    if (marginEngineAddress) {
      const currentMarginEngine = await upgraded.read.portfolioMargin();
      if (currentMarginEngine.toLowerCase() === marginEngineAddress.toLowerCase()) {
        logStep("setMarginEngine", `skipped (already set to ${marginEngineAddress})`);
      } else {
        logInfo("setMarginEngine", { current: currentMarginEngine, new: marginEngineAddress });
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

  logSuccess(`Futures upgraded ${futuresAddress} → impl ${futuresImpl.address}`);
}

function versionIsBefore(version: unknown, target: string): boolean {
  if (typeof version !== "string") {
    throw new Error(`Cannot determine Futures VERSION (${String(version)}); refusing migration`);
  }
  const parse = (value: string): [number, number, number] => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
    if (!match) throw new Error(`Unsupported Futures VERSION format: ${value}`);
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const current = parse(version);
  const wanted = parse(target);
  for (let index = 0; index < current.length; index++) {
    if (current[index] !== wanted[index]) return current[index] < wanted[index];
  }
  return false;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
