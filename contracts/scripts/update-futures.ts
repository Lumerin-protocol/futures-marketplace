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
    Token: await futuresProxy.read.token(),
    HashrateOracle: await futuresProxy.read.hashrateOracle(),
    Validator: await futuresProxy.read.validatorAddress(),
  });

  await logPrompt("Review the configuration above. Proceed with upgrade?");

  // ── 1. Deploy new implementation ────────────────────────────────────────
  logInfo("Deploy new Futures implementation", { contract: "Futures" });
  await logPrompt("Proceed?");
  const futuresImpl = await viem.deployContract("Futures", [], { confirmations: 5 });
  logStep("Deployed", addrUrl(pc, futuresImpl.address));
  await verifyContract(futuresImpl.address, []);
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
  } else {
    logInfo("Upgrade Futures proxy", { newImpl: futuresImpl.address });
    await logPrompt("Proceed?");
    const tx = await futuresProxy.write.upgradeToAndCall([futuresImpl.address, "0x"]);
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    logStep("Upgraded", txUrl(pc, receipt.transactionHash));

    const upgraded = await viem.getContractAt("Futures", futuresAddress);
    logInfo("upgraded futures", {
      Token: await upgraded.read.token(),
      HashrateOracle: await upgraded.read.hashrateOracle(),
      Validator: await upgraded.read.validatorAddress(),
      Owner: await upgraded.read.owner(),
      Version: await upgraded.read.VERSION(),
    });
  }

  logSuccess(`Futures upgraded ${futuresAddress} → impl ${futuresImpl.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
