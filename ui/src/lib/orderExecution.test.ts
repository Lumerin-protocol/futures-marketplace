import { describe, expect, it } from "vitest";
import { encodeEventTopics, encodeAbiParameters, type Log } from "viem";
import {
  type ExecutionEvent,
  FUTURES_EXECUTION_EVENTS,
  PERPS_EXECUTION_EVENTS,
  summarizeExecutionEvents,
  summarizeOrderExecution,
} from "./orderExecution";

const USER = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const ID = `0x${"ab".repeat(32)}` as const;
const MAKER_ID = `0x${"cd".repeat(32)}` as const;

const created = (quantity: bigint, price = 100n): ExecutionEvent => ({
  name: "OrderCreated",
  orderId: ID,
  participant: USER,
  price,
  quantity,
});
const matched = (takerQuantity: bigint, tradePrice: bigint, takerFee: bigint, takerNetQtyAfter: bigint): ExecutionEvent => ({
  name: "OrderMatched",
  makerOrderId: MAKER_ID,
  maker: OTHER,
  taker: USER,
  tradePrice,
  takerQuantity,
  makerFee: -1n,
  takerFee,
  makerNetQtyAfter: -takerNetQtyAfter,
  takerNetQtyAfter,
});
const updated = (newQuantity: bigint, orderId: `0x${string}` = ID): ExecutionEvent => ({
  name: "OrderUpdated",
  orderId,
  participant: USER,
  newQuantity,
});

describe("summarizeExecutionEvents", () => {
  it("GTC that rests untouched: everything placed is resting", () => {
    const s = summarizeExecutionEvents([created(3n)], USER);
    expect(s).toMatchObject({ placed: 3n, filled: 0n, resting: 3n, cancelled: 0n, feePaid: 0n });
    expect(s.averagePrice).toBeUndefined();
    expect(s.positionAfter).toBeUndefined();
  });

  it("GTC partially filled: fills, then the remainder from OrderUpdated", () => {
    const s = summarizeExecutionEvents(
      [created(5n, 100n), matched(2n, 99n, 4n, 2n), matched(1n, 100n, 2n, 3n), updated(2n)],
      USER,
    );
    expect(s).toMatchObject({ placed: 5n, filled: 3n, resting: 2n, cancelled: 0n, feePaid: 6n, positionAfter: 3n });
    // (2 × 99 + 1 × 100) / 3, floored.
    expect(s.averagePrice).toBe(99n);
    expect(s.fills).toHaveLength(2);
  });

  it("IOC: the unmatched part is cancelled, not resting", () => {
    const s = summarizeExecutionEvents([created(-5n), matched(-2n, 101n, 3n, -2n), updated(0n)], USER);
    expect(s).toMatchObject({ placed: -5n, filled: -2n, resting: 0n, cancelled: -3n, positionAfter: -2n });
  });

  it("full fill closes the id at 0 with nothing left over", () => {
    const s = summarizeExecutionEvents([created(2n), matched(2n, 100n, 1n, 2n), updated(0n)], USER);
    expect(s).toMatchObject({ placed: 2n, filled: 2n, resting: 0n, cancelled: 0n });
  });

  it("a rebate shows as a negative fee", () => {
    const s = summarizeExecutionEvents([created(1n), matched(1n, 100n, -2n, 1n), updated(0n)], USER);
    expect(s.feePaid).toBe(-2n);
  });

  it("counts the user's other orders being retired (offset) without treating them as placed", () => {
    const s = summarizeExecutionEvents(
      [
        { name: "OrderCancelled", orderId: MAKER_ID, participant: USER },
        updated(1n, `0x${"ef".repeat(32)}`),
        created(1n),
      ],
      USER,
    );
    expect(s).toMatchObject({ placed: 1n, resting: 1n, ownOrdersRetired: 2 });
  });

  it("ignores other participants' events entirely", () => {
    const s = summarizeExecutionEvents(
      [
        { name: "OrderCreated", orderId: MAKER_ID, participant: OTHER, price: 1n, quantity: 9n },
        { name: "OrderUpdated", orderId: MAKER_ID, participant: OTHER, newQuantity: 1n },
        {
          name: "OrderMatched",
          makerOrderId: MAKER_ID,
          maker: OTHER,
          taker: OTHER,
          tradePrice: 1n,
          takerQuantity: 1n,
          makerFee: 0n,
          takerFee: 0n,
          makerNetQtyAfter: 0n,
          takerNetQtyAfter: 0n,
        },
      ],
      USER,
    );
    expect(s).toMatchObject({ placed: 0n, filled: 0n, resting: 0n, cancelled: 0n, ownOrdersRetired: 0 });
  });

  it("matches addresses case-insensitively", () => {
    const s = summarizeExecutionEvents([created(1n)], USER.toUpperCase().replace("0X", "0x") as `0x${string}`);
    expect(s.placed).toBe(1n);
  });
});

/** Build a raw log the way a node would, so the decode path is exercised end to end. */
function rawLog(
  abi: typeof FUTURES_EXECUTION_EVENTS | typeof PERPS_EXECUTION_EVENTS,
  eventName: string,
  indexed: Record<string, unknown>,
  data: { type: string; value: unknown }[],
  address: `0x${string}` = "0x3333333333333333333333333333333333333333",
): Log {
  const topics = encodeEventTopics({ abi, eventName, args: indexed } as never);
  return {
    address,
    topics,
    data: encodeAbiParameters(
      data.map((d) => ({ type: d.type })),
      data.map((d) => d.value),
    ),
    blockNumber: 1n,
    blockHash: `0x${"00".repeat(32)}`,
    transactionHash: `0x${"00".repeat(32)}`,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  } as Log;
}

describe("summarizeOrderExecution", () => {
  it("decodes a futures receipt: created, matched once, remainder resting", () => {
    const abi = FUTURES_EXECUTION_EVENTS;
    const logs = [
      rawLog(abi, "OrderCreated", { orderId: ID, participant: USER }, [
        { type: "uint256", value: 100n },
        { type: "int256", value: 4n },
        { type: "uint256", value: 1_700_000_000n },
      ]),
      rawLog(abi, "OrderMatched", { makerOrderId: MAKER_ID, maker: OTHER, taker: USER }, [
        { type: "uint256", value: 1_700_000_000n },
        { type: "uint256", value: 99n },
        { type: "int256", value: 3n },
        { type: "int256", value: -1n },
        { type: "int256", value: 5n },
        { type: "int256", value: -3n },
        { type: "int256", value: 3n },
        { type: "uint256", value: 99n },
        { type: "uint256", value: 99n },
      ]),
      rawLog(abi, "OrderUpdated", { orderId: ID, participant: USER }, [{ type: "int256", value: 1n }]),
    ];
    const s = summarizeOrderExecution({ logs, venue: "futures", user: USER });
    expect(s).toMatchObject({ placed: 4n, filled: 3n, resting: 1n, cancelled: 0n, feePaid: 5n, positionAfter: 3n });
    expect(s.averagePrice).toBe(99n);
  });

  it("decodes a perps receipt (no expirationAt) and filters by contract address", () => {
    const abi = PERPS_EXECUTION_EVENTS;
    const perps = "0x4444444444444444444444444444444444444444" as const;
    const logs = [
      rawLog(
        abi,
        "OrderCreated",
        { orderId: ID, participant: USER },
        [
          { type: "uint256", value: 50n },
          { type: "int256", value: -2_000_000n },
        ],
        perps,
      ),
      rawLog(
        abi,
        "OrderMatched",
        { makerOrderId: MAKER_ID, maker: OTHER, taker: USER },
        [
          { type: "uint256", value: 50n },
          { type: "int256", value: -2_000_000n },
          { type: "int256", value: 0n },
          { type: "int256", value: 7n },
          { type: "int256", value: 2_000_000n },
          { type: "int256", value: -2_000_000n },
          { type: "uint256", value: 50n },
          { type: "uint256", value: 50n },
        ],
        perps,
      ),
      rawLog(abi, "OrderUpdated", { orderId: ID, participant: USER }, [{ type: "int256", value: 0n }], perps),
      // Same shape emitted by an unrelated contract in the same tx — must be ignored.
      rawLog(abi, "OrderCreated", { orderId: MAKER_ID, participant: USER }, [
        { type: "uint256", value: 1n },
        { type: "int256", value: 1n },
      ]),
    ];
    const s = summarizeOrderExecution({ logs, venue: "perps", user: USER, contractAddress: perps });
    expect(s).toMatchObject({ placed: -2_000_000n, filled: -2_000_000n, resting: 0n, cancelled: 0n, feePaid: 7n });
    expect(s.positionAfter).toBe(-2_000_000n);
  });
});
