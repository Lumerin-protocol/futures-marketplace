import hre from "hardhat";
import { requireAddress, requireEnvsSet } from "../lib/env.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logStep, logSuccess, logTitle } from "../lib/log.ts";

async function main() {
  logTitle("Futures Settle Position");

  const { viem } = await hre.network.getOrCreate();

  const futuresAddress = requireAddress("FUTURES_ADDRESS");
  const env = requireEnvsSet("POSITION_ID");
  const positionId = env.POSITION_ID as `0x${string}`;

  // Cash settlement is permissionless — any funded signer can call settlePosition.
  const [keeper] = await viem.getWalletClients();
  const pc = await viem.getPublicClient();

  logInfo("inputs", {
    Futures: addrUrl(pc, futuresAddress),
    PositionId: positionId,
    Caller: keeper.account.address,
  });

  const futures = await viem.getContractAt("Futures", futuresAddress);

  const position = await futures.read.getPositionById([positionId]);
  logInfo("position", {
    Seller: position.seller,
    Buyer: position.buyer,
    DeliveryAt: new Date(Number(position.deliveryAt) * 1000).toISOString(),
    SellPricePerDay: position.sellPricePerDay.toString(),
    BuyPricePerDay: position.buyPricePerDay.toString(),
  });

  const tx = await futures.write.settlePosition([positionId], {
    account: keeper.account,
  });

  const receipt = await pc.waitForTransactionReceipt({ hash: tx });
  logStep("Settled", txUrl(pc, receipt.transactionHash));
  logStep("Gas used", receipt.gasUsed.toString());
  logSuccess(`Position ${positionId} settled`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
