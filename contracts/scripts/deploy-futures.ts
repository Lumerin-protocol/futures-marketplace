import fs from "node:fs";
import { encodeFunctionData } from "viem";
import hre from "hardhat";
import { readOptionalAddress, requireAddress, requireEnvsSet } from "../lib/env.ts";
import { writeAndWait } from "../lib/writeContract.ts";
import { verifyContract } from "../lib/verify.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logPrompt, logStep, logSuccess, logTitle } from "../lib/log.ts";

async function main() {
  logTitle("Futures Deployment");

  const { viem } = await hre.network.getOrCreate();

  const usdcAddress = requireAddress("USDC_TOKEN_ADDRESS");
  const collateralVaultAddress = requireAddress("VAULT_ADDRESS");
  const hashrateOracleAddress = requireAddress("HASHRATE_ORACLE_ADDRESS");
  const validatorAddress = requireAddress("VALIDATOR_ADDRESS");
  const SAFE_OWNER_ADDRESS = readOptionalAddress("SAFE_OWNER_ADDRESS");

  const env = requireEnvsSet(
    "LIQUIDATION_MARGIN_PERCENT",
    "SPEED_HPS",
    "MINIMUM_PRICE_INCREMENT",
    "DELIVERY_DURATION_DAYS",
    "DELIVERY_INTERVAL_DAYS",
    "FUTURE_DELIVERY_DATES_COUNT",
    "VALIDATOR_URL",
  );

  const [deployer] = await viem.getWalletClients();
  const pc = await viem.getPublicClient();
  logInfo("deployer", { Address: addrUrl(pc, deployer.account.address) });

  // ── Verify token contracts ──────────────────────────────────────────────
  const paymentToken = await viem.getContractAt(
    "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol:IERC20Metadata",
    usdcAddress,
  );
  logInfo("payment token", {
    Address: paymentToken.address,
    Name: await paymentToken.read.name(),
    Symbol: await paymentToken.read.symbol(),
    Decimals: await paymentToken.read.decimals(),
  });

  const hashrateOracle = await viem.getContractAt("HashrateOracle", hashrateOracleAddress);
  logInfo("hashrate oracle", {
    Address: addrUrl(pc, hashrateOracle.address),
    HashesForBTC: await hashrateOracle.read.getHashesForBTC(),
  });

  if (SAFE_OWNER_ADDRESS) {
    logInfo("ownership", { willTransferTo: SAFE_OWNER_ADDRESS });
  }

  await logPrompt("Review the configuration above. Proceed with deployment?");

  // ── 1. Deploy implementation ────────────────────────────────────────────
  logInfo("Deploy Futures implementation", {
    contract: "Futures",
    collateralVault: collateralVaultAddress,
  });
  await logPrompt("Proceed?");
  const futuresImpl = await viem.deployContract("Futures", [collateralVaultAddress], {
    confirmations: 5,
  });
  logStep("Deployed", addrUrl(pc, futuresImpl.address));
  await verifyContract(futuresImpl.address, [collateralVaultAddress]);
  logStep("Verified", addrUrl(pc, futuresImpl.address));

  // ── 2. Deploy proxy ─────────────────────────────────────────────────────
  const nearestMonday = new Date();
  nearestMonday.setUTCDate(nearestMonday.getUTCDate() + 8 - nearestMonday.getUTCDay());
  nearestMonday.setUTCHours(12, 0, 0, 0);
  const firstFutureDeliveryDate = BigInt(Math.floor(nearestMonday.getTime() / 1000));

  const initData = encodeFunctionData({
    abi: futuresImpl.abi,
    functionName: "initialize",
    args: [
      usdcAddress,
      hashrateOracleAddress,
      validatorAddress,
      Number(env.LIQUIDATION_MARGIN_PERCENT),
      BigInt(env.SPEED_HPS),
      BigInt(env.MINIMUM_PRICE_INCREMENT),
      Number(env.DELIVERY_DURATION_DAYS),
      Number(env.DELIVERY_INTERVAL_DAYS),
      Number(env.FUTURE_DELIVERY_DATES_COUNT),
      firstFutureDeliveryDate,
    ],
  });

  logInfo("Deploy Futures proxy", {
    implementation: futuresImpl.address,
    firstDeliveryDate: nearestMonday.toISOString(),
  });
  await logPrompt("Proceed?");
  const futuresProxy = await viem.deployContract("ERC1967Proxy", [futuresImpl.address, initData], {
    confirmations: 5,
  });
  logStep("Deployed", addrUrl(pc, futuresProxy.address));
  await verifyContract(futuresProxy.address, [futuresImpl.address, initData]);
  logStep("Verified", addrUrl(pc, futuresProxy.address));

  const futures = await viem.getContractAt("Futures", futuresProxy.address);

  // ── 3. Set validator URL ────────────────────────────────────────────────
  logInfo("Futures.setValidatorURL", { url: env.VALIDATOR_URL });
  await logPrompt("Proceed?");
  {
    const sim = await futures.simulate.setValidatorURL([env.VALIDATOR_URL]);
    const receipt = await writeAndWait(deployer, sim);
    logStep("Done", txUrl(pc, receipt.transactionHash));
  }

  // ── 4. Transfer ownership (optional) ────────────────────────────────────
  if (SAFE_OWNER_ADDRESS) {
    logInfo("Transfer Futures ownership", { owner: SAFE_OWNER_ADDRESS });
    await logPrompt("Proceed?");
    const sim = await futures.simulate.transferOwnership([SAFE_OWNER_ADDRESS]);
    const receipt = await writeAndWait(deployer, sim);
    logStep("Futures ownership", txUrl(pc, receipt.transactionHash));
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  logInfo("addresses", {
    Futures: futures.address,
    "  futures impl": futuresImpl.address,
  });

  logSuccess(`Futures ${futures.address}`);

  fs.writeFileSync("futures-addr.tmp", futures.address);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
