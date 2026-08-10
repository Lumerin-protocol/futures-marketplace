import hre from "hardhat";
import { encodeFunctionData, getAddress } from "viem";
import { estimateContractGas, simulateContract } from "viem/actions";
import { OperationType } from "@safe-global/types-kit";
import { readOptionalAddress, readOptionalBigInt, requireAddress } from "../lib/env.ts";
import { verifyContract } from "../lib/verify.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logPrompt, logStep, logSuccess, logTitle } from "../lib/log.ts";
import { SafeWallet } from "../lib/safe.ts";

const DEFAULT_SAFE_GAS_OVERHEAD = 150_000n;
const TARGET_CODE_VERSION = "6.5.0";
const UPGRADE_CONFIRMATIONS = 5;

async function main() {
  logTitle("HashPowerFutures Upgrade");

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
    throw new Error(`Configured upgrade caller ${upgradeCaller} is not HashPowerFutures owner ${owner}`);
  }
  if (SAFE_OWNER_ADDRESS && !proposer) {
    throw new Error("PROPOSER_PRIVATEKEY is required when SAFE_OWNER_ADDRESS is set");
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
  logInfo("Deploy new HashPowerFutures implementation", { contract: "HashPowerFutures" });
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
  const upgradeArgs = [futuresImpl.address, "0x"] as const;
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
      `Upgrade cannot fit: estimate ${estimatedUpgradeGas} + Safe overhead ${safeGasOverhead} ` +
        `= ${requiredBlockGas}, limit ${maxAtomicUpgradeGas}.`,
    );
  }
  logInfo("upgrade preflight", {
    Simulation: "passed",
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

  logSuccess(`HashPowerFutures upgraded ${futuresAddress} → impl ${futuresImpl.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
