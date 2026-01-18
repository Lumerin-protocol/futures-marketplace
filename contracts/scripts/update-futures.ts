import { requireEnvsSet } from "../lib/env";
import { viem } from "hardhat";
import { verifyContract } from "../lib/verify";
import { encodeFunctionData } from "viem/utils";
import { SafeWallet } from "../lib/safe";
import { OperationType } from "@safe-global/types-kit";

async function main() {
  console.log("Futures contract update script");
  console.log();

  const env = <{ FUTURES_ADDRESS: `0x${string}` }>requireEnvsSet("FUTURES_ADDRESS");

  const SAFE_OWNER_ADDRESS = process.env.SAFE_OWNER_ADDRESS as `0x${string}` | undefined;

  const [deployer, proposer] = await viem.getWalletClients();
  const pc = await viem.getPublicClient();
  console.log("Deployer:", deployer.account.address);
  console.log("Safe owner address:", SAFE_OWNER_ADDRESS);

  console.log();
  console.log();

  console.log("Checking existing Futures contract...");
  const futuresProxy = await viem.getContractAt("Futures", env.FUTURES_ADDRESS);
  console.log("Current implementation:", futuresProxy.address);
  console.log("Owner:", await futuresProxy.read.owner());
  console.log("Payment token:", await futuresProxy.read.token());
  console.log("Hashrate oracle:", await futuresProxy.read.hashrateOracle());
  console.log("Validator address:", await futuresProxy.read.validatorAddress());
  console.log();

  console.log("Deploying new Futures implementation...");
  const futuresImpl = await viem.deployContract("contracts/marketplace/Futures.sol:Futures", []);
  console.log("Deployed at:", futuresImpl.address);
  await verifyContract(futuresImpl.address, []);
  // const futuresImpl = await viem.getContractAt(
  //   "Futures",
  //   "0x080f8eab214a56d16b16035788bdfe92552c480f"
  // );

  if (SAFE_OWNER_ADDRESS) {
    console.log();
    console.log("Proposing upgrade to Safe wallet...");

    const upgradeData = encodeFunctionData({
      abi: futuresProxy.abi,
      functionName: "upgradeToAndCall",
      args: [futuresImpl.address, "0x"],
    });

    const safe = new SafeWallet(SAFE_OWNER_ADDRESS, proposer);
    const txHash = await safe.proposeTransaction({
      data: upgradeData,
      to: env.FUTURES_ADDRESS,
      value: "0",
      operation: OperationType.Call,
    });

    console.log("Transaction proposed!");
    console.log("Safe TX Hash:", txHash);
    console.log("Transaction URL:", safe.getSafeUITxUrl(txHash));
  } else {
    console.log();
    console.log("Upgrading Futures proxy to new implementation...");
    const tx = await futuresProxy.write.upgradeToAndCall([futuresImpl.address, "0x"]);

    await pc.waitForTransactionReceipt({ hash: tx });
    console.log("Upgrade transaction completed!");

    console.log();
    console.log("Verifying upgrade...");
    const upgradedFutures = await viem.getContractAt("Futures", env.FUTURES_ADDRESS);

    console.log("Payment token:", await upgradedFutures.read.token());
    console.log("Hashrate oracle:", await upgradedFutures.read.hashrateOracle());
    console.log("Validator address:", await upgradedFutures.read.validatorAddress());
    console.log("Owner:", await upgradedFutures.read.owner());
  }
  console.log();
  console.log("---");
  console.log("SUCCESS");
  console.log("FUTURES address:", env.FUTURES_ADDRESS);
  console.log("New implementation:", futuresImpl.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
