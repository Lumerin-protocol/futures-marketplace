import { viem } from "hardhat";
import { requireEnvsSet } from "../lib/env";

async function main() {
  const env = requireEnvsSet("FUTURES_ADDRESS", "FUTURES_DEPLOY_BLOCK");
  const deployBlock = BigInt(env.FUTURES_DEPLOY_BLOCK);
  const futures = await viem.getContractAt("Futures", env.FUTURES_ADDRESS as `0x${string}`);
  const orderFee = await futures.read.orderFee();
  const pc = await viem.getPublicClient();
  const currentBlock = await pc.getBlockNumber();
  const queryLimit = 1000000n;
  console.log("Order fee:", orderFee);
  console.log("Current block:", currentBlock);
  let totalFees = 0n;
  for (let i = currentBlock - queryLimit; i > deployBlock - queryLimit; i -= queryLimit) {
    const events = await pc.getLogs({
      address: futures.address,
      event: {
        type: "event",
        anonymous: false,
        inputs: [
          { name: "from", internalType: "address", type: "address", indexed: true },
          { name: "to", internalType: "address", type: "address", indexed: true },
          {
            name: "value",
            internalType: "uint256",
            type: "uint256",
            indexed: false,
          },
        ],
        name: "Transfer",
      },
      fromBlock: i,
      toBlock: i + queryLimit,
      args: {
        to: futures.address,
      },
    });
    for (const event of events) {
      if ((event.args.value = orderFee)) {
        totalFees += event.args.value;
        console.log("Tx:", event.transactionHash);
      }
    }
    console.log("Block:", i, "Total fees:", totalFees);
  }
}

main();
