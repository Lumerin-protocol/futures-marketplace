import hre from "hardhat";
import { getAddress, type Address } from "viem";
import { requireAddress, requireEnvsSet } from "../lib/env.ts";
import { addrUrl, txUrl } from "../lib/explorer.ts";
import { logInfo, logStep, logSuccess, logTitle } from "../lib/log.ts";

async function main() {
  logTitle("Futures Settle Position (3.0)");

  const { viem } = await hre.network.getOrCreate();

  const futuresAddress = requireAddress("FUTURES_ADDRESS");
  const env = requireEnvsSet("USER_ADDRESS", "DELIVERY_AT");
  const user = getAddress(env.USER_ADDRESS) as Address;
  const deliveryAt = BigInt(env.DELIVERY_AT);

  // Cash settlement is permissionless — any funded signer can call settlePosition.
  const [keeper] = await viem.getWalletClients();
  const pc = await viem.getPublicClient();

  logInfo("inputs", {
    Futures: addrUrl(pc, futuresAddress),
    User: user,
    DeliveryAt: new Date(Number(deliveryAt) * 1000).toISOString(),
    Caller: keeper.account.address,
  });

  const futures = await viem.getContractAt("Futures", futuresAddress);

  const position = await futures.read.getUserPosition([user, deliveryAt]);
  logInfo("position", {
    NetQuantity: position.netQuantity.toString(),
    NetEntryValue: position.netEntryValue.toString(),
  });

  if (position.netQuantity === 0n) {
    throw new Error(`User ${user} has no position at deliveryAt ${deliveryAt}`);
  }

  const tx = await futures.write.settlePosition([user, deliveryAt], {
    account: keeper.account,
  });

  const receipt = await pc.waitForTransactionReceipt({ hash: tx });
  logStep("Settled", txUrl(pc, receipt.transactionHash));
  logStep("Gas used", receipt.gasUsed.toString());
  logSuccess(`Settled ${user} @ ${deliveryAt}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
