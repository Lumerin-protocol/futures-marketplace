import { requireEnvsSet } from "../lib/env";
import { viem } from "hardhat";

async function main() {
  console.log("Futures contract close delivery script");
  console.log();

  const env = <
    {
      FUTURES_ADDRESS: `0x${string}`;
      POSITION_ID: `0x${string}`;
    }
  >requireEnvsSet("FUTURES_ADDRESS", "POSITION_ID");

  // BLAME_SELLER is optional, defaults to true
  const blameSeller = process.env.BLAME_SELLER !== "false";

  const [owner, seller, buyer, validator] = await viem.getWalletClients();
  const pc = await viem.getPublicClient();
  const tc = await viem.getTestClient();

  console.log("Futures address:", env.FUTURES_ADDRESS);
  console.log("Position ID:", env.POSITION_ID);
  console.log("Blame seller:", blameSeller);
  console.log("Validator account:", validator.account.address);
  console.log();

  const futures = await viem.getContractAt("Futures", env.FUTURES_ADDRESS);

  // Get position info before closing
  const position = await futures.read.getPositionById([env.POSITION_ID]);

  console.log("Position details:");
  console.log("  Seller:", position.seller);
  console.log("  Buyer:", position.buyer);
  console.log("  Delivery at:", new Date(Number(position.deliveryAt) * 1000).toISOString());
  console.log("  Sell price per day:", position.sellPricePerDay.toString());
  console.log("  Buy price per day:", position.buyPricePerDay.toString());
  console.log("  Paid:", position.paid);
  console.log();

  console.log("Closing delivery...");
  await tc.setNextBlockTimestamp({ timestamp: BigInt(Math.floor(Date.now() / 1000)) });
  const tx = await futures.write.closeDelivery([env.POSITION_ID, blameSeller], {
    account: validator.account,
  });

  const receipt = await pc.waitForTransactionReceipt({ hash: tx });
  console.log("Transaction hash:", tx);
  console.log("Gas used:", receipt.gasUsed.toString());
  console.log();
  console.log("---");
  console.log("SUCCESS: Position closed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
