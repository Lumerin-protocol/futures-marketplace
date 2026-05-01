import hre from "hardhat";
import { encodeFunctionData } from "viem/utils";
import { type Address, type PublicClient, hexToString, numberToHex, slice, trim } from "viem";
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
    HashrateOracle: await futuresProxy.read.hashrateOracle(),
    Validator: await futuresProxy.read.validatorAddress(),
  });

  await logPrompt("Review the configuration above. Proceed with upgrade?");

  // ── 1. Deploy new implementation ────────────────────────────────────────
  logInfo("Deploy new Futures implementation", { contract: "Futures" });
  await logPrompt("Proceed?");
  const futuresImpl = await viem.deployContract("Futures", [vaultAddress], {
    confirmations: 3,
  });

  logStep("Deployed", addrUrl(pc, futuresImpl.address));
  await verifyContract(futuresImpl.address, [vaultAddress]);
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
  } else {
    logInfo("Upgrade Futures proxy", { newImpl: futuresImpl.address });
    await logPrompt("Proceed?");
    const tx = await futuresProxy.write.upgradeToAndCall([futuresImpl.address, "0x"]);
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    logStep("Upgraded", txUrl(pc, receipt.transactionHash));

    const upgraded = await viem.getContractAt("Futures", futuresAddress);
    logInfo("upgraded futures", {
      Vault: await upgraded.read.collateralVault(),
      MarginEngine: await upgraded.read.marginEngine(),
      HashrateOracle: await upgraded.read.hashrateOracle(),
      Validator: await upgraded.read.validatorAddress(),
      Owner: await upgraded.read.owner(),
      Version: await upgraded.read.VERSION(),
    });

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
  }

  logSuccess(`Futures upgraded ${futuresAddress} → impl ${futuresImpl.address}`);
}

/**
 * Dump the first ~26 sequential storage slots of the Futures proxy.
 * Each slot is decoded multiple ways so a layout mismatch (e.g. a variable
 * being read at the wrong slot post-upgrade) is easy to spot:
 *   - raw 32 bytes
 *   - lower-20-byte address (for `address`/contract-typed slots)
 *   - uint256 (for plain numeric slots)
 *   - ASCII (for short `string`/`bytes` short-form slots)
 *   - last byte / 2 (Solidity short-string length tag)
 *
 * The annotation column shows which variable HEAD expects at that slot vs.
 * what the deployed v2.4.0 source had there.
 */
async function dumpFuturesStorage(pc: PublicClient, address: Address): Promise<void> {
  // [HEAD label, v2.4.0-deployed label]. Empty oldLabel means HEAD and v2.4.0 agree on this slot.
  // HEAD reverts the v2.4.0 layout, so from slot 7 onward the two diverge by 2 slots.
  const slotLabels: [string, string][] = [
    ["orders (mapping)", ""],
    ["positions (mapping)", ""],
    ["deliveryDatePriceOrdersLongIdQueue", ""],
    ["deliveryDatePriceOrdersShortIdQueue", ""],
    ["participantPositionIdsIndex", ""],
    ["participantOrderIdsIndex", ""],
    ["participantDeliveryDatePositionIdsIndex", ""],
    [
      "participantDeliveryDatePriceOrderIdsIndex",
      "participantDeliveryDateNetDelta (INSERTED in v2.4)",
    ],
    ["breachPenaltyRatePerDay", "participantDeliveryDateNetEntryValue (INSERTED in v2.4)"],
    ["firstFutureDeliveryDate", "participantDeliveryDatePriceOrderIdsIndex"],
    ["speedHps", "breachPenaltyRatePerDay"],
    ["minimumPriceIncrement", "firstFutureDeliveryDate"],
    ["orderFee", "speedHps"],
    ["nonce", "minimumPriceIncrement"],
    ["_gap (was IERC20 token)", "orderFee"],
    ["hashrateOracle", "nonce"],
    ["validatorAddress + 4×uint8 + _gap3 (packed)", "_gap (was IERC20 token)"],
    ["validatorURL (string)", "hashrateOracle"],
    ["collectedFeesBalance", "validatorAddress + 4×uint8 + _decimals (packed)"],
    ["_gap2 (was reservePoolBalance)", "validatorURL (string)"],
    ["addressFeeDiscountPercent (mapping)", "collectedFeesBalance"],
    ["hashpriceScalingDivisor", "_gap2 (was reservePoolBalance)"],
    ["marginEngine", "addressFeeDiscountPercent (mapping)"],
    ["participantDeliveryDateNetDelta (mapping, NEW in HEAD)", "hashpriceScalingDivisor"],
    ["participantDeliveryDateNetEntryValue (mapping, NEW in HEAD)", "marginEngine"],
    ["(unused)", "(unused)"],
  ];

  console.log(`\n[storage dump] ${address}`);
  console.log(
    `  ${"slot".padEnd(4)}  ${"raw".padEnd(66)}  ${"as uint256".padEnd(22)}  ${"as address".padEnd(42)}  ${"as ascii".padEnd(34)}  HEAD expects   →   deployed v2.4 had`,
  );

  for (let slot = 0; slot < slotLabels.length; slot++) {
    const raw = await pc.getStorageAt({ address, slot: numberToHex(slot) });
    if (raw === undefined) continue;
    const u256 = BigInt(raw).toString();
    const asAddr = `0x${raw.slice(2).slice(-40)}`;
    const ascii = decodePossibleShortString(raw);
    const [headLabel, oldLabel] = slotLabels[slot];
    const annotation = oldLabel === "" ? headLabel : `${headLabel}   →   ${oldLabel}`;
    console.log(
      `  ${String(slot).padEnd(4)}  ${raw}  ${u256.slice(0, 22).padEnd(22)}  ${asAddr.padEnd(42)}  ${ascii.padEnd(34)}  ${annotation}`,
    );
  }
  console.log("");
}

/** Decode a slot as a Solidity ≤31-byte short-form string (high bytes = data, low byte = length*2). */
function decodePossibleShortString(slot: `0x${string}`): string {
  const lengthByte = Number(BigInt(`0x${slot.slice(-2)}`));
  // Short-form strings have an even length tag (length*2) and length ≤ 31, so tag ≤ 62.
  if (lengthByte % 2 !== 0 || lengthByte === 0 || lengthByte > 62) return "";
  const len = lengthByte / 2;
  try {
    const data = slice(slot, 0, len);
    const trimmed = trim(data, { dir: "right" });
    if (trimmed === "0x") return "";
    const decoded = hexToString(data);
    if (!/^[\x20-\x7e]+$/.test(decoded)) return "";
    return JSON.stringify(decoded);
  } catch {
    return "";
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
