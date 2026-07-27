import hre from "hardhat";
import { encodeFunctionData } from "viem/utils";
import { OperationType } from "@safe-global/types-kit";
import { readOptionalAddress, requireAddress } from "../lib/env.ts";
import { verifyContract } from "../lib/verify.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logPrompt, logStep, logSuccess, logTitle } from "../lib/log.ts";
import { SafeWallet } from "../lib/safe.ts";

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
  logInfo("current futures", {
    Address: addrUrl(pc, futuresProxy.address),
    Owner: await futuresProxy.read.owner(),
    Version: currentVersion,
    HASHPRICE_USD: await futuresProxy.read.hashrateOracle(),
  });

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

  // ── 2. Upgrade ──────────────────────────────────────────────────────────
  if (SAFE_OWNER_ADDRESS) {
    logInfo("Propose upgrade via Safe", { safe: SAFE_OWNER_ADDRESS });
    await logPrompt("Proceed?");

    if (!proposer) {
      throw new Error("PROPOSER_PRIVATEKEY is required when SAFE_OWNER_ADDRESS is set");
    }

    const upgradeData = encodeFunctionData({
      abi: futuresProxy.abi,
      functionName: "upgradeToAndCall",
      args: [futuresImpl.address, "0x"],
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
        functionName: "setMarginEngine",
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
    const tx = await futuresProxy.write.upgradeToAndCall([futuresImpl.address, "0x"]);
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
      Vault: await upgraded.read.collateralVault(atUpgradeBlock),
      MarginEngine: await upgraded.read.marginEngine(atUpgradeBlock),
      HASHPRICE_USD: await upgraded.read.hashrateOracle(atUpgradeBlock),
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

    // ── 3. Post-upgrade config ──────────────────────────────────────────
    if (marginEngineAddress) {
      const currentMarginEngine = await upgraded.read.marginEngine();
      if (currentMarginEngine.toLowerCase() === marginEngineAddress.toLowerCase()) {
        logStep("setMarginEngine", `skipped (already set to ${marginEngineAddress})`);
      } else {
        logInfo("setMarginEngine", { current: currentMarginEngine, new: marginEngineAddress });
        await logPrompt("Proceed?");
        const setTx = await upgraded.write.setMarginEngine([marginEngineAddress]);
        const setReceipt = await pc.waitForTransactionReceipt({ hash: setTx });
        logStep("setMarginEngine", txUrl(pc, setReceipt.transactionHash));
        logStep("MarginEngine", await upgraded.read.marginEngine());
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
