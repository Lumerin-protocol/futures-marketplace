import fs from "node:fs";
import { encodeFunctionData, getAddress } from "viem";
import hre from "hardhat";
import { readOptionalAddress, requireAddress, requireEnvsSet } from "../lib/env.ts";
import { writeAndWait } from "../lib/writeContract.ts";
import { verifyContract } from "../lib/verify.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logPrompt, logStep, logSuccess, logTitle } from "../lib/log.ts";

async function main() {
  logTitle("Futures Deployment");

  const { viem } = await hre.network.getOrCreate();

  // The Futures contract reads its underlying ERC20 (and decimals) from the
  // collateral vault, so `USDC_TOKEN_ADDRESS` is no longer a deploy-time input.
  const collateralVaultAddress = requireAddress("VAULT_ADDRESS");
  const hashrateOracleAddress = requireAddress("HASHRATE_ORACLE_ADDRESS");
  const validatorAddress = requireAddress("VALIDATOR_ADDRESS");
  const SAFE_OWNER_ADDRESS = readOptionalAddress("SAFE_OWNER_ADDRESS");
  // Optional: when set, wire the Futures contract into the cross-product
  // PortfolioMarginEngine end-to-end (Futures.setMarginEngine + PME.setFutures
  // + Vault.setAuthorizedCaller). When the deployer doesn't own the PME or the
  // vault, the script logs the required calldata for the current owner Safe
  // instead of executing the call.
  const MARGIN_ENGINE_ADDRESS = readOptionalAddress("MARGIN_ENGINE_ADDRESS");

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

  // ── Verify collateral vault & infer payment token ──────────────────────
  const collateralVault = await viem.getContractAt("CollateralVault", collateralVaultAddress);
  const paymentTokenAddress = await collateralVault.read.collateralToken();
  const paymentToken = await viem.getContractAt(
    "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol:IERC20Metadata",
    paymentTokenAddress,
  );
  const vaultOwner = await collateralVault.read.owner();
  const deployerIsVaultOwner = getAddress(vaultOwner) === getAddress(deployer.account.address);
  logInfo("vault", {
    Address: addrUrl(pc, collateralVault.address),
    Owner: vaultOwner,
    "Deployer can wire vault": deployerIsVaultOwner ? "yes" : "no (wire via current owner)",
  });
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

  // ── 4. Wire the PortfolioMarginEngine (optional) ────────────────────────
  if (MARGIN_ENGINE_ADDRESS) {
    const pme = await viem.getContractAt("PortfolioMarginEngine", MARGIN_ENGINE_ADDRESS);
    const pmeOwner = await pme.read.owner();
    const deployerIsPmeOwner = getAddress(pmeOwner) === getAddress(deployer.account.address);

    logInfo("Futures.setMarginEngine", { marginEngine: MARGIN_ENGINE_ADDRESS });
    await logPrompt("Proceed?");
    {
      const sim = await futures.simulate.setMarginEngine([MARGIN_ENGINE_ADDRESS]);
      const receipt = await writeAndWait(deployer, sim);
      logStep("Done", txUrl(pc, receipt.transactionHash));
    }

    if (deployerIsPmeOwner) {
      logInfo("PME.setFutures", { futures: futures.address });
      await logPrompt("Proceed?");
      const sim = await pme.simulate.setFutures([futures.address]);
      const receipt = await writeAndWait(deployer, sim);
      logStep("Done", txUrl(pc, receipt.transactionHash));
    } else {
      const data = encodeFunctionData({
        abi: pme.abi,
        functionName: "setFutures",
        args: [futures.address],
      });
      logInfo("PME wiring (run as PME owner)", { "PME address": pme.address, "PME owner": pmeOwner });
      logStep(`PME.setFutures(${futures.address})`, data);
    }

    if (deployerIsVaultOwner) {
      logInfo("Vault.setAuthorizedCaller(futures)", { caller: futures.address });
      await logPrompt("Proceed?");
      const sim = await collateralVault.simulate.setAuthorizedCaller([futures.address, true]);
      const receipt = await writeAndWait(deployer, sim);
      logStep("Done", txUrl(pc, receipt.transactionHash));
    } else {
      const data = encodeFunctionData({
        abi: collateralVault.abi,
        functionName: "setAuthorizedCaller",
        args: [futures.address, true],
      });
      logInfo("Vault wiring (run as vault owner)", {
        "Vault address": collateralVault.address,
        "Vault owner": vaultOwner,
      });
      logStep(`Vault.setAuthorizedCaller(${futures.address}, true)`, data);
    }
  }

  // ── 5. Transfer ownership (optional) ────────────────────────────────────
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
