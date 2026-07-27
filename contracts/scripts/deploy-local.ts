import hre from "hardhat";
import {
  deployOnlyFuturesWithDummyData,
  deployTokenOraclesAndMulticall3,
} from "../tests/fixtures.ts";
import { logInfo, logSuccess, logTitle } from "../lib/log.ts";

async function main() {
  logTitle("Local deployment with dummy data");

  console.log("Starting local deployment...");
  await hre.tasks.getTask("compile").run();

  const run = hre.tasks.getTask("node").run({ hostname: "0.0.0.0" });

  const conn = await hre.network.getOrCreate("hardhat");
  const base = await deployTokenOraclesAndMulticall3(conn);
  const futures = await deployOnlyFuturesWithDummyData(conn, base);

  logInfo("accounts", {
    Owner: base.accounts.owner.account.address,
    Seller: base.accounts.seller.account.address,
    Buyer: base.accounts.buyer.account.address,
    Buyer2: base.accounts.buyer2.account.address,
    DefaultBuyer: base.accounts.defaultBuyer.account.address,
    Validator: base.accounts.validator.account.address,
    Validator2: base.accounts.validator2.account.address,
  });

  logInfo("contracts", {
    Multicall3: base.contracts.multicall3.address,
    USDCMock: base.contracts.usdcMock.address,
    HASHPRICE_USD: base.contracts.hashpriceUsd.address,
    Futures: futures.contracts.futures.address,
    CollateralVault: futures.contracts.collateralVault.address,
    PortfolioMarginEngine: futures.contracts.portfolioMarginEngine.address,
  });

  logSuccess("Local deployment complete. Run `hardhat node` separately to keep the network alive.");

  await run;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
