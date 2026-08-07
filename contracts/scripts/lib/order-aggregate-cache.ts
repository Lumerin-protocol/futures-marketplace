import { type Address, getAbiItem, getAddress, type Hex, type PublicClient } from "viem";
import { readContract } from "viem/actions";
import { FuturesAbi } from "../../abi/Futures.ts";

export const ORDER_CACHE_ABI = [
  {
    type: "function",
    name: "getUserOrders",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "orderIds", type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "getOrder",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "participant", type: "address" },
          { name: "price", type: "uint256" },
          { name: "quantity", type: "int256" },
          { name: "expirationAt", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getOrderAggregateAtExpiration",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "expirationAt", type: "uint256" },
    ],
    outputs: [
      {
        name: "aggregate",
        type: "tuple",
        components: [
          { name: "buyQty", type: "uint256" },
          { name: "sellQty", type: "uint256" },
          { name: "buyValue", type: "uint256" },
          { name: "sellValue", type: "uint256" },
        ],
      },
    ],
  },
] as const;

const ORDER_CREATED_EVENT = getAbiItem({
  abi: FuturesAbi,
  name: "OrderCreated",
});

export type DiscoverySource = "auto" | "indexer" | "events";
export type UsedDiscoverySource = "supplied" | "indexer" | "events";

export type DiscoveryResult = {
  addresses: Address[];
  source: "indexer" | "events";
  indexedBlock?: bigint;
  startBlock?: bigint;
  endBlock: bigint;
};

export type FuturesOrder = {
  participant: Address;
  price: bigint;
  quantity: bigint;
  expirationAt: bigint;
};

export type OrderAggregate = {
  buyQty: bigint;
  sellQty: bigint;
  buyValue: bigint;
  sellValue: bigint;
};

export type AggregateVerificationReader = {
  getUserOrders(user: Address): Promise<readonly Hex[]>;
  getOrder(orderId: Hex): Promise<FuturesOrder>;
  getOrderAggregate(user: Address, expirationAt: bigint): Promise<OrderAggregate>;
};

type GraphMeta = {
  block: { number: number };
  hasIndexingErrors: boolean;
};

type GraphResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_PAGE_SIZE = 1_000;
const MIN_EVENT_CHUNK = 1n;

export function readDiscoverySource(
  value = process.env.ORDER_CACHE_DISCOVERY_SOURCE ?? "auto",
  envName = "ORDER_CACHE_DISCOVERY_SOURCE",
): DiscoverySource {
  if (value !== "auto" && value !== "indexer" && value !== "events") {
    throw new Error(`${envName} must be auto, indexer, or events`);
  }
  return value;
}

export function readNonNegativeBigInt(name: string, fallback?: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Environment variable ${name} is required`);
  }
  const value = BigInt(raw);
  if (value < 0n) throw new Error(`${name} must not be negative`);
  return value;
}

export function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function parseAddressList(raw: string | undefined): Address[] | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => getAddress(value));
  return sortAddresses(values);
}

export function sortAddresses(addresses: Iterable<Address>): Address[] {
  const unique = new Map<string, Address>();
  for (const address of addresses) {
    const checksummed = getAddress(address);
    unique.set(checksummed.toLowerCase(), checksummed);
  }
  return [...unique.values()].sort(compareStrings);
}

export function emptyAggregate(): OrderAggregate {
  return { buyQty: 0n, sellQty: 0n, buyValue: 0n, sellValue: 0n };
}

export function aggregateOrdersByExpiration(
  orders: readonly FuturesOrder[],
): Map<bigint, OrderAggregate> {
  const aggregates = new Map<bigint, OrderAggregate>();
  for (const order of orders) {
    if (order.quantity === 0n) continue;
    const aggregate = aggregates.get(order.expirationAt) ?? emptyAggregate();
    if (order.quantity > 0n) {
      aggregate.buyQty += order.quantity;
      aggregate.buyValue += order.price * order.quantity;
    } else {
      const quantity = -order.quantity;
      aggregate.sellQty += quantity;
      aggregate.sellValue += order.price * quantity;
    }
    aggregates.set(order.expirationAt, aggregate);
  }
  return aggregates;
}

export function assertAggregateEqual(
  user: Address,
  expirationAt: bigint,
  expected: OrderAggregate,
  actual: OrderAggregate,
): void {
  for (const field of ["buyQty", "sellQty", "buyValue", "sellValue"] as const) {
    if (actual[field] !== expected[field]) {
      throw new Error(
        `Order aggregate mismatch for ${user} expiration ${expirationAt}: ` +
          `${field}=${actual[field]}, expected ${expected[field]}`,
      );
    }
  }
}

/**
 * Verifies the cache from canonical storage only. Timestamps are deliberately
 * ignored: an expired order remains physical until it is explicitly removed.
 */
export async function verifyOrderAggregateCache(
  users: readonly Address[],
  reader: AggregateVerificationReader,
  readConcurrency: number,
): Promise<{ users: number; orders: number; expirations: number }> {
  let orderCount = 0;
  let expirationCount = 0;

  for (const user of sortAddresses(users)) {
    const orderIds = await reader.getUserOrders(user);
    const orders = await mapConcurrently(orderIds, readConcurrency, (orderId) =>
      reader.getOrder(orderId),
    );
    for (const order of orders) {
      if (getAddress(order.participant) !== user) {
        throw new Error(`getUserOrders(${user}) returned an order owned by ${order.participant}`);
      }
    }

    const expected = aggregateOrdersByExpiration(orders);
    const expirations = [...expected.keys()].sort(compareBigInts);
    const actual = await mapConcurrently(expirations, readConcurrency, (expirationAt) =>
      reader.getOrderAggregate(user, expirationAt),
    );
    for (let i = 0; i < expirations.length; i++) {
      assertAggregateEqual(user, expirations[i], expected.get(expirations[i])!, actual[i]);
    }

    orderCount += orderIds.length;
    expirationCount += expirations.length;
  }

  return { users: users.length, orders: orderCount, expirations: expirationCount };
}

export function createOnChainVerificationReader(
  pc: PublicClient,
  futuresAddress: Address,
  blockNumber?: bigint,
): AggregateVerificationReader {
  const block = blockNumber === undefined ? {} : { blockNumber };
  return {
    getUserOrders: (user) =>
      readContract(pc, {
        address: futuresAddress,
        abi: ORDER_CACHE_ABI,
        functionName: "getUserOrders",
        args: [user],
        ...block,
      }),
    getOrder: (orderId) =>
      readContract(pc, {
        address: futuresAddress,
        abi: ORDER_CACHE_ABI,
        functionName: "getOrder",
        args: [orderId],
        ...block,
      }),
    getOrderAggregate: (user, expirationAt) =>
      readContract(pc, {
        address: futuresAddress,
        abi: ORDER_CACHE_ABI,
        functionName: "getOrderAggregateAtExpiration",
        args: [user, expirationAt],
        ...block,
      }),
  };
}

export async function filterUsersWithPhysicalOrders(
  pc: PublicClient,
  futuresAddress: Address,
  candidates: readonly Address[],
  readConcurrency: number,
): Promise<Address[]> {
  const sorted = sortAddresses(candidates);
  const orders = await mapConcurrently(sorted, readConcurrency, (user) =>
    readContract(pc, {
      address: futuresAddress,
      abi: ORDER_CACHE_ABI,
      functionName: "getUserOrders",
      args: [user],
    }),
  );
  return sorted.filter((_, index) => orders[index].length > 0);
}

export async function discoverFromIndexer(
  url: string,
  latestBlock: bigint,
  options: {
    maxLagBlocks: bigint;
    pageSize?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<{ addresses: Address[]; indexedBlock: bigint }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new Error("Indexer page size must be a positive integer");
  }

  const metaPayload = await postGraphQL<{ _meta: GraphMeta }>(
    fetchImpl,
    url,
    `query OrderCacheDiscoveryMeta {
      _meta {
        block { number }
        hasIndexingErrors
      }
    }`,
    {},
  );
  validateIndexerMeta(metaPayload._meta);
  const indexedBlock = BigInt(metaPayload._meta.block.number);
  const lag = latestBlock > indexedBlock ? latestBlock - indexedBlock : 0n;
  if (lag > options.maxLagBlocks) {
    throw new Error(
      `Indexer is ${lag} blocks behind; maximum allowed lag is ${options.maxLagBlocks}`,
    );
  }

  const addresses: Address[] = [];
  let lastId = ZERO_ADDRESS;
  for (;;) {
    const payload = await postGraphQL<{
      _meta: GraphMeta;
      users: Array<{ id: string; address: string }>;
    }>(
      fetchImpl,
      url,
      `query OrderCacheUsers($lastId: Bytes!, $first: Int!, $block: Int!) {
        _meta(block: { number: $block }) {
          block { number }
          hasIndexingErrors
        }
        users(
          first: $first
          orderBy: id
          orderDirection: asc
          block: { number: $block }
          where: { id_gt: $lastId }
        ) {
          id
          address
        }
      }`,
      { lastId, first: pageSize, block: Number(indexedBlock) },
    );
    validateIndexerMeta(payload._meta);
    if (BigInt(payload._meta.block.number) !== indexedBlock) {
      throw new Error(
        `Indexer snapshot changed from block ${indexedBlock} to ${payload._meta.block.number}`,
      );
    }

    for (const user of payload.users) addresses.push(getAddress(user.address));
    if (payload.users.length < pageSize) break;

    const nextId = payload.users[payload.users.length - 1]?.id;
    if (!nextId || nextId.toLowerCase() <= lastId.toLowerCase()) {
      throw new Error("Indexer pagination cursor did not advance");
    }
    lastId = nextId;
  }

  return { addresses: sortAddresses(addresses), indexedBlock };
}

export async function discoverFromEvents(
  pc: PublicClient,
  futuresAddress: Address,
  options: {
    startBlock: bigint;
    endBlock: bigint;
    initialChunkSize: bigint;
    onProgress?: (from: bigint, to: bigint, participants: number) => void;
    onRetry?: (from: bigint, to: bigint, nextChunk: bigint, error: unknown) => void;
  },
): Promise<Address[]> {
  if (options.initialChunkSize <= 0n) {
    throw new Error("EVENT_SCAN_CHUNK_SIZE must be greater than zero");
  }
  if (options.startBlock > options.endBlock) return [];

  const addresses = new Set<Address>();
  let chunkSize = options.initialChunkSize;
  let toBlock = options.endBlock;
  while (toBlock >= options.startBlock) {
    const desiredFrom = toBlock >= chunkSize - 1n ? toBlock - chunkSize + 1n : 0n;
    const fromBlock = desiredFrom > options.startBlock ? desiredFrom : options.startBlock;
    try {
      const logs = await pc.getLogs({
        address: futuresAddress,
        event: ORDER_CREATED_EVENT,
        fromBlock,
        toBlock,
      });
      for (const log of logs) {
        if (log.args.participant) addresses.add(getAddress(log.args.participant));
      }
      options.onProgress?.(fromBlock, toBlock, addresses.size);
      if (fromBlock === options.startBlock) break;
      toBlock = fromBlock - 1n;
      if (chunkSize < options.initialChunkSize) {
        const doubled = chunkSize * 2n;
        chunkSize = doubled > options.initialChunkSize ? options.initialChunkSize : doubled;
      }
    } catch (error) {
      if (chunkSize <= MIN_EVENT_CHUNK) {
        throw new Error(
          `eth_getLogs failed at block ${fromBlock} with a one-block chunk: ${
            (error as Error).message
          }`,
        );
      }
      const halved = chunkSize / 2n;
      chunkSize = halved < MIN_EVENT_CHUNK ? MIN_EVENT_CHUNK : halved;
      options.onRetry?.(fromBlock, toBlock, chunkSize, error);
    }
  }
  return sortAddresses(addresses);
}

export async function discoverOrderCacheCandidates(
  pc: PublicClient,
  futuresAddress: Address,
  options: {
    source: DiscoverySource;
    indexerUrl?: string;
    latestBlock: bigint;
    startBlock?: bigint;
    endBlock?: bigint;
    eventChunkSize: bigint;
    maxIndexerLagBlocks: bigint;
    etherscanApiKey?: string;
    onIndexerFallback?: (error: unknown) => void;
    onEventProgress?: (from: bigint, to: bigint, participants: number) => void;
    onEventRetry?: (from: bigint, to: bigint, nextChunk: bigint, error: unknown) => void;
  },
): Promise<DiscoveryResult> {
  const endBlock = options.endBlock ?? options.latestBlock;
  if (endBlock > options.latestBlock) {
    throw new Error(`END_BLOCK ${endBlock} is above latest block ${options.latestBlock}`);
  }

  if (options.source !== "events" && options.indexerUrl) {
    try {
      const result = await discoverFromIndexer(options.indexerUrl, options.latestBlock, {
        maxLagBlocks: options.maxIndexerLagBlocks,
      });
      let addresses = result.addresses;
      // A tolerated indexer lag must not create a migration blind spot. Scan the
      // short tail for users first seen after the pinned indexer snapshot.
      if (result.indexedBlock < endBlock) {
        const tail = await discoverFromEvents(pc, futuresAddress, {
          startBlock: result.indexedBlock + 1n,
          endBlock,
          initialChunkSize: options.eventChunkSize,
          onProgress: options.onEventProgress,
          onRetry: options.onEventRetry,
        });
        addresses = sortAddresses([...addresses, ...tail]);
      }
      return {
        addresses,
        source: "indexer",
        indexedBlock: result.indexedBlock,
        endBlock,
      };
    } catch (error) {
      if (options.source === "indexer") throw error;
      options.onIndexerFallback?.(error);
    }
  } else if (options.source === "indexer") {
    throw new Error("FUTURES_INDEXER_URL or SUBGRAPH_URL is required for indexer discovery");
  }

  let startBlock = options.startBlock;
  if (startBlock === undefined) {
    if (!options.etherscanApiKey) {
      throw new Error(
        "ETHERSCAN_API_KEY is required to discover the deployment block; set FUTURES_START_BLOCK to bypass",
      );
    }
    startBlock = await fetchDeploymentBlockFromEtherscan(
      pc,
      futuresAddress,
      options.etherscanApiKey,
    );
  }
  const addresses = await discoverFromEvents(pc, futuresAddress, {
    startBlock,
    endBlock,
    initialChunkSize: options.eventChunkSize,
    onProgress: options.onEventProgress,
    onRetry: options.onEventRetry,
  });
  return { addresses, source: "events", startBlock, endBlock };
}

export async function fetchDeploymentBlockFromEtherscan(
  pc: PublicClient,
  address: Address,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<bigint> {
  const chainId = pc.chain?.id;
  if (!chainId) throw new Error("Public client has no chain id; cannot query Etherscan");

  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getcontractcreation");
  url.searchParams.set("contractaddresses", address);
  url.searchParams.set("apikey", apiKey);

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Etherscan request failed: HTTP ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as {
    status: string;
    message: string;
    result: Array<{ blockNumber?: string }> | string;
  };
  if (body.status !== "1" || !Array.isArray(body.result) || body.result.length === 0) {
    const detail = typeof body.result === "string" ? body.result : body.message;
    throw new Error(`Etherscan returned no creation record for ${address}: ${detail}`);
  }
  const blockNumber = body.result[0]?.blockNumber;
  if (!blockNumber)
    throw new Error(`Etherscan response omitted the deployment block for ${address}`);
  return BigInt(blockNumber);
}

export async function mapConcurrently<T, R>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error("concurrency must be a positive integer");
  }
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await fn(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

export function chunk<T>(values: readonly T[], size: number): T[][] {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("chunk size must be positive");
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

async function postGraphQL<T>(
  fetchImpl: typeof fetch,
  url: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Indexer returned HTTP ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as GraphResponse<T>;
  if (payload.errors?.length) {
    throw new Error(
      `Indexer GraphQL error: ${payload.errors.map((error) => error.message).join("; ")}`,
    );
  }
  if (!payload.data) throw new Error("Indexer response did not contain data");
  return payload.data;
}

function validateIndexerMeta(meta: GraphMeta | undefined): void {
  if (!meta || !Number.isSafeInteger(meta.block?.number) || meta.block.number < 0) {
    throw new Error("Indexer response contained invalid _meta.block.number");
  }
  if (meta.hasIndexingErrors) throw new Error("Indexer reports indexing errors");
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareBigInts(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
