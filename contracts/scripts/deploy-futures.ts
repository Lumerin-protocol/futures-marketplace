import fs from "node:fs";
import { requireEnvsSet } from "../lib/env";
import { viem } from "hardhat";
import { encodeFunctionData } from "viem";
import { writeAndWait } from "../lib/writeContract";
import { verifyContract } from "../lib/verify";

async function main() {
  console.log("Futures deployment script");
  console.log();

  const env = requireEnvsSet(
    "LUMERIN_TOKEN_ADDRESS",
    "USDC_TOKEN_ADDRESS",
    "HASHRATE_ORACLE_ADDRESS",
    "VALIDATOR_ADDRESS",
    "LIQUIDATION_MARGIN_PERCENT",
    "SPEED_HPS",
    "MINIMUM_PRICE_INCREMENT",
    "DELIVERY_DURATION_DAYS",
    "DELIVERY_INTERVAL_DAYS",
    "FUTURE_DELIVERY_DATES_COUNT",
    "VALIDATOR_URL"
  );
  const SAFE_OWNER_ADDRESS = process.env.SAFE_OWNER_ADDRESS as `0x${string}` | undefined;

  const [deployer] = await viem.getWalletClients();
  console.log("Deployer:", deployer.account.address);

  // Verify token contracts
  const paymentToken = await viem.getContractAt(
    "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol:IERC20Metadata",
    env.USDC_TOKEN_ADDRESS as `0x${string}`
  );
  console.log("Payment token:", paymentToken.address);
  console.log("Name:", await paymentToken.read.name());
  console.log("Symbol:", await paymentToken.read.symbol());
  console.log("Decimals:", await paymentToken.read.decimals());

  console.log();

  const feeToken = await viem.getContractAt(
    "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol:IERC20Metadata",
    env.LUMERIN_TOKEN_ADDRESS as `0x${string}`
  );
  console.log("Fee token:", feeToken.address);
  console.log("Name:", await feeToken.read.name());
  console.log("Symbol:", await feeToken.read.symbol());
  console.log("Decimals:", await feeToken.read.decimals());

  console.log();

  const hashrateOracle = await viem.getContractAt(
    "HashrateOracle",
    env.HASHRATE_ORACLE_ADDRESS as `0x${string}`
  );
  console.log("Hashrate oracle:", hashrateOracle.address);
  console.log("Num hashes to find to earn 1 satoshi:", await hashrateOracle.read.getHashesForBTC());

  console.log();

  // Deploy Futures implementation
  console.log("Deploying Futures implementation...");
  const futuresImpl = await viem.deployContract("contracts/marketplace/Futures.sol:Futures", []);
  console.log("Deployed at:", futuresImpl.address);
  await verifyContract(futuresImpl.address, []);

  console.log();

  const nearestMonday = new Date();
  nearestMonday.setUTCDate(nearestMonday.getUTCDate() + 8 - nearestMonday.getUTCDay());
  nearestMonday.setUTCHours(12, 0, 0, 0);

  // Deploy Futures proxy
  console.log("Deploying Futures proxy...");
  const encodedInitFn = encodeFunctionData({
    abi: futuresImpl.abi,
    functionName: "initialize",
    args: [
      env.USDC_TOKEN_ADDRESS as `0x${string}`, // payment token
      env.HASHRATE_ORACLE_ADDRESS as `0x${string}`, // hashrate oracle
      env.VALIDATOR_ADDRESS as `0x${string}`, // validator address
      Number(env.LIQUIDATION_MARGIN_PERCENT), // seller liquidation margin percent
      BigInt(env.SPEED_HPS), // speed HPS
      BigInt(env.MINIMUM_PRICE_INCREMENT), // minimum price increment
      Number(env.DELIVERY_DURATION_DAYS), // delivery duration days
      Number(env.DELIVERY_INTERVAL_DAYS), // delivery interval days
      Number(env.FUTURE_DELIVERY_DATES_COUNT), // future delivery dates count
      BigInt(BigInt(nearestMonday.getTime() / 1000)), // first future delivery date
    ],
  });

  const futuresProxy = await viem.deployContract(
    "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy",
    [futuresImpl.address, encodedInitFn]
  );
  console.log("Deployed at:", futuresProxy.address);

  const futures = await viem.getContractAt("Futures", futuresProxy.address);

  console.log();
  await futures.write.setValidatorURL([env.VALIDATOR_URL]);
  console.log("Validator URL set:", await futures.read.validatorURL());

  if (SAFE_OWNER_ADDRESS) {
    console.log("Transferring ownership of Futures to owner:", SAFE_OWNER_ADDRESS);

    const res = await futures.simulate.transferOwnership([SAFE_OWNER_ADDRESS]);
    const receipt = await writeAndWait(deployer, res);
    console.log("Txhash:", receipt.transactionHash);
  }

  console.log("---");
  console.log("SUCCESS");

  console.log("FUTURES address:", futuresProxy.address);
  fs.writeFileSync("futures-addr.tmp", futuresProxy.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
