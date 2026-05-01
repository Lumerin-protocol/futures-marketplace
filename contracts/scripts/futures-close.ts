import hre from "hardhat";
import { requireAddress, requireEnvsSet } from "../lib/env.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logStep, logSuccess, logTitle } from "../lib/log.ts";

async function main() {
  logTitle("Futures Close Delivery");

  const { viem } = await hre.network.getOrCreate();

  const futuresAddress = requireAddress("FUTURES_ADDRESS");
  const env = requireEnvsSet("POSITION_ID");
  const positionId = env.POSITION_ID as `0x${string}`;
  const blameSeller = process.env.BLAME_SELLER !== "false";

  const [, , , validator] = await viem.getWalletClients();
  const pc = await viem.getPublicClient();
  const tc = await viem.getTestClient();

  logInfo("inputs", {
    Futures: addrUrl(pc, futuresAddress),
    PositionId: positionId,
    BlameSeller: blameSeller,
    Validator: validator.account.address,
  });

  const futures = await viem.getContractAt("Futures", futuresAddress);

  const position = await futures.read.getPositionById([positionId]);
  logInfo("position", {
    Seller: position.seller,
    Buyer: position.buyer,
    DeliveryAt: new Date(Number(position.deliveryAt) * 1000).toISOString(),
    SellPricePerDay: position.sellPricePerDay.toString(),
    BuyPricePerDay: position.buyPricePerDay.toString(),
    Paid: position.paid,
  });

  await tc.setNextBlockTimestamp({ timestamp: BigInt(Math.floor(Date.now() / 1000)) });
  const tx = await futures.write.closeDelivery([positionId, blameSeller], {
    account: validator.account,
  });

  const receipt = await pc.waitForTransactionReceipt({ hash: tx });
  logStep("Closed", txUrl(pc, receipt.transactionHash));
  logStep("Gas used", receipt.gasUsed.toString());
  logSuccess(`Position ${positionId} closed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
