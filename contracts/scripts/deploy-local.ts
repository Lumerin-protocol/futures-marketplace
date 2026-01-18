import { run } from "hardhat";
import { deployLocalFixture } from "../tests/fixtures-2";
import { deployOnlyFuturesWithDummyData } from "../tests/fixtures";

async function main() {
  console.log("Starting local deployment...");
  await run("compile");

  const runPromise = run("node");

  const data = await deployLocalFixture();
  const dataFutures = await deployOnlyFuturesWithDummyData(data);
  const { contracts, config } = data;

  console.log("Deployment completed successfully!");

  console.log();
  console.log("Accounts:");
  console.log("Owner:", data.accounts.owner.account.address);
  console.log("Seller:", data.accounts.seller.account.address);
  console.log("Buyer:", data.accounts.buyer.account.address);
  console.log("Buyer2:", data.accounts.buyer2.account.address);
  console.log("Default Buyer:", data.accounts.defaultBuyer.account.address);
  console.log("Validator:", data.accounts.validator.account.address);
  console.log("Validator2:", data.accounts.validator2.account.address);
  console.log();
  console.log("Contract addresses:");
  console.log("Multicall3:", contracts.multicall3.address);
  console.log("USDC Mock:", contracts.usdcMock.address);
  console.log("BTC Price Oracle Mock:", contracts.btcPriceOracleMock.address);
  console.log("HashrateOracle:", contracts.hashrateOracle.address);
  console.log("Futures:", dataFutures.contracts.futures.address);

  console.log();

  await runPromise;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
