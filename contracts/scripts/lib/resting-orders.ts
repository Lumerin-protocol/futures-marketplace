import type { Address, Hex, PublicClient } from "viem";
import { readContract } from "viem/actions";
import { HashPowerFuturesAbi } from "../../abi/HashPowerFutures.ts";
import { mapConcurrently, type OrderSlot } from "./order-aggregate-cache.ts";

const MAX_PRICE_LEVELS_PER_SIDE = 200n;

/** Ids still resting in the given (participant, expiry) slots at `blockNumber`. */
export async function liveOrdersInSlots(
  pc: PublicClient,
  futures: Address,
  slots: readonly OrderSlot[],
  readConcurrency: number,
  blockNumber: bigint,
): Promise<Hex[]> {
  const perSlot = await mapConcurrently(slots, readConcurrency, ({ participant, expirationAt }) =>
    readContract(pc, {
      address: futures,
      abi: HashPowerFuturesAbi,
      functionName: "getUserOrdersAtExpiration",
      args: [participant, expirationAt],
      blockNumber,
    }),
  );
  return perSlot.flat();
}

/**
 * Throws unless every tradable expiry's book is empty, every listed user has no orders and a
 * zero aggregate there, and no order rests in the expired `slots`.
 */
export async function assertNoRestingOrders(
  pc: PublicClient,
  futures: Address,
  users: readonly Address[],
  expiredSlots: readonly OrderSlot[],
  readConcurrency: number,
  blockNumber: bigint,
): Promise<void> {
  const expirationAts = await readContract(pc, {
    address: futures,
    abi: HashPowerFuturesAbi,
    functionName: "getExpirationDates",
    blockNumber,
  });
  await mapConcurrently(expirationAts, readConcurrency, async (expirationAt) => {
    const [bids, asks] = await readContract(pc, {
      address: futures,
      abi: HashPowerFuturesAbi,
      functionName: "getOrderBookPrices",
      args: [expirationAt, MAX_PRICE_LEVELS_PER_SIDE],
      blockNumber,
    });
    if (bids.length + asks.length > 0) {
      throw new Error(
        `Expiry ${expirationAt} still has ${bids.length} bid and ${asks.length} ask levels`,
      );
    }
  });
  const slots = users.flatMap((participant) =>
    expirationAts.map((expirationAt) => ({ participant, expirationAt })),
  );
  await mapConcurrently(slots, readConcurrency, async ({ participant, expirationAt }) => {
    const aggregate = await readContract(pc, {
      address: futures,
      abi: HashPowerFuturesAbi,
      functionName: "getOrderAggregateAtExpiration",
      args: [participant, expirationAt],
      blockNumber,
    });
    if (Object.values(aggregate).some((value) => value !== 0n)) {
      throw new Error(`${participant} has a nonzero aggregate at expiry ${expirationAt}`);
    }
  });
  const leftovers = await liveOrdersInSlots(
    pc,
    futures,
    [...slots, ...expiredSlots],
    readConcurrency,
    blockNumber,
  );
  if (leftovers.length > 0) {
    throw new Error(`${leftovers.length} order(s) still resting, e.g. ${leftovers[0]}`);
  }
}
