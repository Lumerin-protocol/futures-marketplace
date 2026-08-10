import fs from "node:fs";
import { encodeFunctionData, getAddress, formatUnits } from "viem";
import hre from "hardhat";
import { readOptionalAddress, requireAddress, requireEnvsSet } from "../lib/env.ts";
import { writeAndWait } from "../lib/writeContract.ts";
import { verifyContract } from "../lib/verify.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logPrompt, logStep, logSuccess, logTitle } from "../lib/log.ts";

const TARGET_CODE_VERSION = "5.0.0";

/** Minimal AggregatorV3 slice used to sanity-check HashpriceUSD before deploy. */
const aggregatorV3Abi = [
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "latestRoundData",
    inputs: [],
    outputs: [
      { type: "uint80" },
      { type: "int256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint80" },
    ],
    stateMutability: "view",
  },
] as const;

async function main() {
  logTitle("Futures Deployment");

  const { viem } = await hre.network.getOrCreate();

  // The Futures contract reads its underlying ERC20 (and decimals) from the
  // collateral vault, so `USDC_TOKEN_ADDRESS` is no longer a deploy-time input.
  const collateralVaultAddress = requireAddress("VAULT_ADDRESS");
  const hashpriceUsdAddress = requireAddress("HASHPRICE_USD_ADDRESS");
  const SAFE_OWNER_ADDRESS = readOptionalAddress("SAFE_OWNER_ADDRESS");
  // Optional: when set, wire the Futures contract into the cross-product
  // PortfolioMarginEngine end-to-end (Futures.setPortfolioMargin + PME.addLinearMarket
  // + Vault.setAuthorizedCaller). When the deployer doesn't own the PME or the
  // vault, the script logs the required calldata for the current owner Safe
  // instead of executing the call.
  const MARGIN_ENGINE_ADDRESS = readOptionalAddress("MARGIN_ENGINE_ADDRESS");

  const env = requireEnvsSet(
    "LIQUIDATION_MARGIN_PERCENT",
    "FUTURE_DELIVERY_DATES_COUNT",
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

  const decimals = await pc.readContract({
    address: hashpriceUsdAddress,
    abi: aggregatorV3Abi,
    functionName: "decimals",
  });
  const [, answer] = await pc.readContract({
    address: hashpriceUsdAddress,
    abi: aggregatorV3Abi,
    functionName: "latestRoundData",
  });
  logInfo("HASHPRICE_USD", {
    Address: addrUrl(pc, hashpriceUsdAddress),
    Decimals: decimals,
    Answer: formatUnits(answer, decimals),
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
  const implementationVersion = await futuresImpl.read.VERSION();
  if (implementationVersion !== TARGET_CODE_VERSION) {
    throw new Error(
      `Implementation VERSION is ${implementationVersion}, expected ${TARGET_CODE_VERSION}`,
    );
  }
  await verifyContract(futuresImpl.address, [collateralVaultAddress]);
  logStep("Verified", addrUrl(pc, futuresImpl.address));

  // ── 2. Deploy proxy ─────────────────────────────────────────────────────
  const nearestMonday = new Date();
  nearestMonday.setUTCDate(nearestMonday.getUTCDate() + 8 - nearestMonday.getUTCDay());
  nearestMonday.setUTCHours(12, 0, 0, 0);
  const firstFutureExpirationDate = BigInt(Math.floor(nearestMonday.getTime() / 1000));

  const initData = encodeFunctionData({
    abi: futuresImpl.abi,
    functionName: "initialize",
    args: [
      hashpriceUsdAddress,
      Number(env.LIQUIDATION_MARGIN_PERCENT),
      Number(env.FUTURE_DELIVERY_DATES_COUNT),
      firstFutureExpirationDate,
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

  // ── 3. Wire the PortfolioMarginEngine (optional) ────────────────────────
  if (MARGIN_ENGINE_ADDRESS) {
    const pme = await viem.getContractAt("PortfolioMarginEngine", MARGIN_ENGINE_ADDRESS);
    const pmeOwner = await pme.read.owner();
    const deployerIsPmeOwner = getAddress(pmeOwner) === getAddress(deployer.account.address);

    logInfo("Futures.setPortfolioMargin", { portfolioMargin: MARGIN_ENGINE_ADDRESS });
    await logPrompt("Proceed?");
    {
      const sim = await futures.simulate.setPortfolioMargin([MARGIN_ENGINE_ADDRESS]);
      const receipt = await writeAndWait(deployer, sim);
      logStep("Done", txUrl(pc, receipt.transactionHash));
    }

    if (deployerIsPmeOwner) {
      logInfo("PME.addLinearMarket (futures)", { market: futures.address });
      await logPrompt("Proceed?");
      const sim = await pme.simulate.addLinearMarket([futures.address]);
      const receipt = await writeAndWait(deployer, sim);
      logStep("Done", txUrl(pc, receipt.transactionHash));

      logInfo("PME.setOracle", { oracle: hashpriceUsdAddress });
      await logPrompt("Proceed?");
      const oracleSim = await pme.simulate.setOracle([hashpriceUsdAddress]);
      const oracleReceipt = await writeAndWait(deployer, oracleSim);
      logStep("Done", txUrl(pc, oracleReceipt.transactionHash));
    } else {
      const data = encodeFunctionData({
        abi: pme.abi,
        functionName: "addLinearMarket",
        args: [futures.address],
      });
      const oracleData = encodeFunctionData({
        abi: pme.abi,
        functionName: "setOracle",
        args: [hashpriceUsdAddress],
      });
      logInfo("PME wiring (run as PME owner)", { "PME address": pme.address, "PME owner": pmeOwner });
      logStep(`PME.addLinearMarket(${futures.address})`, data);
      logStep(`PME.setOracle(${hashpriceUsdAddress})`, oracleData);
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
    HASHPRICE_USD: hashpriceUsdAddress,
  });

  logSuccess(`Futures ${futures.address}`);

  fs.writeFileSync("futures-addr.tmp", futures.address);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
