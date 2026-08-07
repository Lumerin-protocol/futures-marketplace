import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress, type Hex, type PublicClient } from "viem";
import {
  aggregateOrdersByExpiration,
  discoverFromEvents,
  discoverFromIndexer,
  type FuturesOrder,
  type OrderAggregate,
  verifyOrderAggregateCache,
} from "../scripts/lib/order-aggregate-cache.ts";

const alice = getAddress("0x1000000000000000000000000000000000000001");
const bob = getAddress("0x2000000000000000000000000000000000000002");
const carol = getAddress("0x3000000000000000000000000000000000000003");
const orderA = `0x${"01".repeat(32)}` as Hex;
const orderB = `0x${"02".repeat(32)}` as Hex;
const orderC = `0x${"03".repeat(32)}` as Hex;

describe("order aggregate cache tooling", () => {
  it("aggregates both sides per expiration without dropping expired physical orders", () => {
    const orders: FuturesOrder[] = [
      { participant: alice, price: 5n, quantity: 3n, expirationAt: 1n },
      { participant: alice, price: 7n, quantity: -2n, expirationAt: 1n },
      { participant: alice, price: 11n, quantity: 4n, expirationAt: 2n },
    ];

    assert.deepEqual(aggregateOrdersByExpiration(orders), new Map([
      [1n, { buyQty: 3n, sellQty: 2n, buyValue: 15n, sellValue: 14n }],
      [2n, { buyQty: 4n, sellQty: 0n, buyValue: 44n, sellValue: 0n }],
    ]));
  });

  it("paginates a pinned indexer snapshot and deterministically deduplicates users", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      { data: { _meta: { block: { number: 995 }, hasIndexingErrors: false } } },
      {
        data: {
          _meta: { block: { number: 995 }, hasIndexingErrors: false },
          users: [
            { id: alice.toLowerCase(), address: alice },
            { id: bob.toLowerCase(), address: bob },
          ],
        },
      },
      {
        data: {
          _meta: { block: { number: 995 }, hasIndexingErrors: false },
          users: [
            { id: carol.toLowerCase(), address: carol },
            { id: `${carol.toLowerCase()}ff`, address: alice },
          ],
        },
      },
      {
        data: {
          _meta: { block: { number: 995 }, hasIndexingErrors: false },
          users: [],
        },
      },
    ];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await discoverFromIndexer("https://indexer.invalid", 1_000n, {
      maxLagBlocks: 5n,
      pageSize: 2,
      fetchImpl,
    });

    assert.equal(result.indexedBlock, 995n);
    assert.deepEqual(result.addresses, [alice, bob, carol]);
    assert.equal(requests.length, 4);
    assert.deepEqual(
      requests.slice(1).map((request) => (request.variables as { block: number }).block),
      [995, 995, 995],
    );
  });

  it("rejects stale or unhealthy indexers", async () => {
    const response = (hasIndexingErrors: boolean) =>
      (async () =>
        new Response(
          JSON.stringify({
            data: { _meta: { block: { number: 900 }, hasIndexingErrors } },
          }),
          { status: 200 },
        )) as typeof fetch;

    await assert.rejects(
      discoverFromIndexer("https://indexer.invalid", 1_000n, {
        maxLagBlocks: 50n,
        fetchImpl: response(false),
      }),
      /100 blocks behind/,
    );
    await assert.rejects(
      discoverFromIndexer("https://indexer.invalid", 900n, {
        maxLagBlocks: 50n,
        fetchImpl: response(true),
      }),
      /indexing errors/,
    );
  });

  it("halves rejected event ranges, grows again, and returns sorted unique participants", async () => {
    const ranges: Array<[bigint, bigint]> = [];
    const pc = {
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([fromBlock, toBlock]);
        if (fromBlock === 1n && toBlock === 8n) throw new Error("range too large");
        const participant = fromBlock < 5n ? bob : alice;
        return [{ args: { participant } }, { args: { participant } }];
      },
    } as unknown as PublicClient;

    const users = await discoverFromEvents(
      pc,
      getAddress("0x4000000000000000000000000000000000000004"),
      { startBlock: 1n, endBlock: 10n, initialChunkSize: 8n },
    );

    assert.deepEqual(ranges, [[1n, 8n], [1n, 4n], [5n, 10n]]);
    assert.deepEqual(users, [alice, bob]);
  });

  it("independently scans physical orders and verifies every expiration aggregate", async () => {
    const orders = new Map<Hex, FuturesOrder>([
      [orderA, { participant: alice, price: 5n, quantity: 3n, expirationAt: 1n }],
      [orderB, { participant: alice, price: 7n, quantity: -2n, expirationAt: 1n }],
      [orderC, { participant: alice, price: 11n, quantity: 4n, expirationAt: 2n }],
    ]);
    const aggregates = new Map<bigint, OrderAggregate>([
      [1n, { buyQty: 3n, sellQty: 2n, buyValue: 15n, sellValue: 14n }],
      [2n, { buyQty: 4n, sellQty: 0n, buyValue: 44n, sellValue: 0n }],
    ]);
    const result = await verifyOrderAggregateCache(
      [alice],
      {
        getUserOrders: async () => [orderA, orderB, orderC],
        getOrder: async (id) => orders.get(id)!,
        getOrderAggregate: async (_user, expiration) => aggregates.get(expiration)!,
      },
      2,
    );
    assert.deepEqual(result, { users: 1, orders: 3, expirations: 2 });

    aggregates.set(2n, { buyQty: 99n, sellQty: 0n, buyValue: 44n, sellValue: 0n });
    await assert.rejects(
      verifyOrderAggregateCache(
        [alice],
        {
          getUserOrders: async () => [orderA, orderB, orderC],
          getOrder: async (id) => orders.get(id)!,
          getOrderAggregate: async (_user, expiration) => aggregates.get(expiration)!,
        },
        2,
      ),
      /buyQty=99, expected 4/,
    );
  });
});
