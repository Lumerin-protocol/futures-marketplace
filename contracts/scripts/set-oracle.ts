import hre from "hardhat";
import { getAddress } from "viem";
import { encodeFunctionData } from "viem/utils";
import { OperationType } from "@safe-global/types-kit";
import { readOptionalAddress, requireAddress } from "../lib/env.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logPrompt, logStep, logSuccess, logTitle } from "../lib/log.ts";
import { SafeWallet } from "../lib/safe.ts";
import { writeAndWait } from "../lib/writeContract.ts";

/**
 * Point Futures at a new Chainlink-style hashprice oracle.
 *
 * Env:
 *   FUTURES_ADDRESS        — venue proxy (required)
 *   HASHPRICE_USD_ADDRESS  — new AggregatorV3 oracle (required)
 *   SAFE_OWNER_ADDRESS     — optional Safe; when set, propose via Safe
 */
async function main() {
  logTitle("Futures setOracle");

  const { viem } = await hre.network.getOrCreate();
  const futuresAddress = requireAddress("FUTURES_ADDRESS");
  const oracleAddress = requireAddress("HASHPRICE_USD_ADDRESS");
  const SAFE_OWNER_ADDRESS = readOptionalAddress("SAFE_OWNER_ADDRESS");

  const [deployer, proposer] = await viem.getWalletClients();
  const pc = await viem.getPublicClient();
  logInfo("deployer", { Address: addrUrl(pc, deployer.account.address) });

  const futures = await viem.getContractAt("Futures", futuresAddress);
  const owner = await futures.read.owner();
  const current = await futures.read.hashrateOracle();
  const version = await futures.read.VERSION().catch(() => "unknown");
  logInfo("setOracle", {
    Futures: addrUrl(pc, futuresAddress),
    Owner: owner,
    Version: version,
    From: addrUrl(pc, current),
    "HASHPRICE_USD (to)": addrUrl(pc, oracleAddress),
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
    const safe = new SafeWallet(SAFE_OWNER_ADDRESS, proposer);
    const txHash = await safe.proposeTransaction({
      to: futuresAddress,
      value: "0",
      data,
      operation: OperationType.Call,
    });
    logStep("Safe TX hash", txHash);
    logStep("Safe UI URL", safe.getSafeUITxUrl(txHash));
    logSuccess(`Proposed setOracle → HASHPRICE_USD ${oracleAddress}`);
    return;
  }

  if (getAddress(owner) !== getAddress(deployer.account.address)) {
    throw new Error(`Deployer ${deployer.account.address} is not the futures owner ${owner}`);
  }

  const sim = await futures.simulate.setOracle([oracleAddress]);
  const receipt = await writeAndWait(deployer, sim);
  logStep("Done", txUrl(pc, receipt.transactionHash));
  logSuccess(`HASHPRICE_USD → ${oracleAddress}`);
}

main();
