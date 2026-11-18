import hre from "hardhat";
import { getAddress } from "viem";
import { encodeFunctionData } from "viem/utils";
import { OperationType } from "@safe-global/types-kit";
import { readOptionalAddress, requireAddress, requireEnvsSet } from "../lib/env.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logPrompt, logStep, logSuccess, logTitle } from "../lib/log.ts";
import { SafeWallet } from "../lib/safe.ts";
import { writeAndWait } from "../lib/writeContract.ts";

/**
 * Point HashPowerFutures at a new mark oracle (`HashpriceGlideUSD`) and the index it is built on.
 *
 * Env:
 *   FUTURES_ADDRESS      — venue proxy (required)
 *   MARK_ORACLE_ADDRESS  — new mark oracle (required); futures adopts its `hashpriceUsd()` index
 *   SAFE_OWNER_ADDRESS   — optional Safe; when set, propose via Safe
 */
async function main() {
  logTitle("HashPowerFutures setOracle");

  const { viem } = await hre.network.getOrCreate();
  const futuresAddress = requireAddress("FUTURES_ADDRESS");
  const oracleAddress = requireAddress("MARK_ORACLE_ADDRESS");
  const SAFE_OWNER_ADDRESS = readOptionalAddress("SAFE_OWNER_ADDRESS");

  const [deployer, proposer] = await viem.getWalletClients();
  const pc = await viem.getPublicClient();
  logInfo("deployer", { Address: addrUrl(pc, deployer.account.address) });

  const futures = await viem.getContractAt("HashPowerFutures", futuresAddress);
  const markOracle = await viem.getContractAt("IMarkRangeOracle", oracleAddress);
  const owner = await futures.read.owner();
  const current = await futures.read.markOracle();
  const version = await futures.read.VERSION().catch(() => "unknown");
  logInfo("setOracle", {
    HashPowerFutures: addrUrl(pc, futuresAddress),
    Owner: owner,
    Version: version,
    From: addrUrl(pc, current),
    "MARK_ORACLE (to)": addrUrl(pc, oracleAddress),
    "HASHPRICE_USD (to)": addrUrl(pc, await markOracle.read.hashpriceUsd()),
  });

  if (getAddress(current) === getAddress(oracleAddress)) {
    logSuccess("No change — oracle already set");
    return;
  }

  await logPrompt("Proceed?");

  if (SAFE_OWNER_ADDRESS) {
    if (!proposer) {
      throw new Error("PROPOSER_PRIVATEKEY is required when SAFE_OWNER_ADDRESS is set");
    }
    const data = encodeFunctionData({
      abi: futures.abi,
      functionName: "setOracle",
      args: [oracleAddress],
    });
    const { SAFE_API_KEY } = requireEnvsSet("SAFE_API_KEY");
    const safe = new SafeWallet(SAFE_OWNER_ADDRESS, proposer, SAFE_API_KEY);
    const txHash = await safe.proposeTransaction({
      to: futuresAddress,
      value: "0",
      data,
      operation: OperationType.Call,
    });
    logStep("Safe TX hash", txHash);
    logStep("Safe UI URL", safe.getSafeUITxUrl(txHash));
    logSuccess(`Proposed setOracle → MARK_ORACLE ${oracleAddress}`);
    return;
  }

  if (getAddress(owner) !== getAddress(deployer.account.address)) {
    throw new Error(`Deployer ${deployer.account.address} is not the futures owner ${owner}`);
  }

  const sim = await futures.simulate.setOracle([oracleAddress]);
  const receipt = await writeAndWait(deployer, sim);
  logStep("Done", txUrl(pc, receipt.transactionHash));
  logSuccess(`MARK_ORACLE → ${oracleAddress}`);
}

main();
