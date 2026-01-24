import { viem } from "hardhat";
import { requireEnvsSet } from "../lib/env";
import { getAddress, zeroAddress } from "viem";

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
  let charges = 0n;
  let burns = 0n;
  let totalFees = 0n;
  for (let i = currentBlock - queryLimit; i > deployBlock - queryLimit; i -= queryLimit) {
    const events1 = await pc.getLogs({
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

    const events2 = await pc.getLogs({
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
        from: futures.address,
        to: zeroAddress,
      },
    });
    for (const event of [...events1, ...events2]) {
      if (
        event.args.value === orderFee &&
        getAddress(event.args.to!) === getAddress(futures.address)
      ) {
        totalFees += event.args.value;
        charges++;
      }
      if (
        getAddress(event.args.from!) === getAddress(futures.address) &&
        getAddress(event.args.to!) === zeroAddress
      ) {
        totalFees -= event.args.value!;
        burns++;
        console.log("Charges:", charges, "Burns:", burns);
        console.log("Burn:", event.args.value, "Tx:", event.transactionHash);
      }
    }

    console.log("Block:", i, "Total fees:", totalFees);
  }
}

main();
