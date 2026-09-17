import hre from "hardhat";
import { getAddress, zeroAddress } from "viem";
import { requireAddress, requireEnvsSet } from "../lib/env.ts";

async function main() {
  const { viem } = await hre.network.getOrCreate();

  const futuresAddress = requireAddress("FUTURES_ADDRESS");
  const env = requireEnvsSet("FUTURES_DEPLOY_BLOCK");
  const deployBlock = BigInt(env.FUTURES_DEPLOY_BLOCK);

  const futures = await viem.getContractAt("HashPowerFutures", futuresAddress);
  const makerFee = await futures.read.makerFeeBps();
  const takerFee = await futures.read.takerFeeBps();
  const pc = await viem.getPublicClient();
  const currentBlock = await pc.getBlockNumber();
  const queryLimit = 1_000_000n;

  console.log("Maker fee:", makerFee);
  console.log("Taker fee:", takerFee);
  console.log("Current block:", currentBlock);

  let charges = 0n;
  let burns = 0n;
  let totalFees = 0n;
  for (let i = currentBlock - queryLimit; i > deployBlock - queryLimit; i -= queryLimit) {
    const transferEvent = {
      type: "event",
      anonymous: false,
      inputs: [
        { name: "from", internalType: "address", type: "address", indexed: true },
        { name: "to", internalType: "address", type: "address", indexed: true },
        { name: "value", internalType: "uint256", type: "uint256", indexed: false },
      ],
      name: "Transfer",
    } as const;

    const events1 = await pc.getLogs({
      address: futures.address,
      event: transferEvent,
      fromBlock: i,
      toBlock: i + queryLimit,
      args: { to: futures.address },
    });

    const events2 = await pc.getLogs({
      address: futures.address,
      event: transferEvent,
      fromBlock: i,
      toBlock: i + queryLimit,
      args: { from: futures.address, to: zeroAddress },
    });

    for (const event of [...events1, ...events2]) {
      if (
        (event.args.value === (makerFee||0n) || event.args.value === (takerFee||0n)) &&
        event.args.to &&
        getAddress(event.args.to) === getAddress(futures.address)
      ) {
        totalFees += event.args.value || 0n;
        charges++;
      }
      if (
        event.args.from &&
        event.args.to &&
        event.args.value !== undefined &&
        getAddress(event.args.from) === getAddress(futures.address) &&
        getAddress(event.args.to) === zeroAddress
      ) {
        totalFees -= event.args.value;
        burns++;
        console.log("Charges:", charges, "Burns:", burns);
        console.log("Burn:", event.args.value, "Tx:", event.transactionHash);
      }
    }

    console.log("Block:", i, "Total fees:", totalFees);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
