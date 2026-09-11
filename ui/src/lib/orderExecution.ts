/**
 * What a place-order transaction actually did, read back from its receipt.
 *
 * The review step can only bound the outcome — the book moves before the
 * transaction lands — so once it has, the venue's own events are the record:
 *
 *   OrderCreated(orderId, user, price, quantity)         the order as submitted
 *   OrderMatched(..., taker = user, takerQuantity, fee)  one per fill, user as taker
 *   OrderUpdated(orderId, user, remaining)               what is left resting
 *                                                         (0 for an IOC remainder)
 *
 * Both venues emit the same sequence from `_createOrder`; only the `OrderMatched`
 * signature differs (futures carries `expirationAt`), which is why each venue
 * has its own event ABI here. Quantities are in the venue's native units and
 * signed the way the venue signs them: positive long, negative short.
 */

import { type Abi, getAddress, type Log, parseEventLogs } from "viem";

export type ExecutionVenue = "futures" | "perps";

export interface ExecutionFill {
  price: bigint;
  /** Signed, native units. */
  quantity: bigint;
  /** Charged to the user on this fill; negative is a rebate. */
  fee: bigint;
}

export interface OrderExecution {
  /** Signed native quantity submitted across the user's `OrderCreated` events. */
  placed: bigint;
  /** Signed native quantity matched in this transaction. */
  filled: bigint;
  /** Signed native quantity left on the book. */
  resting: bigint;
  /** Signed native quantity neither filled nor resting — the IOC remainder. */
  cancelled: bigint;
  fills: ExecutionFill[];
  /** Fill-weighted average price; `undefined` without fills. */
  averagePrice: bigint | undefined;
  /** Sum of the user's fees over the fills; negative is a net rebate. */
  feePaid: bigint;
  /** Net position after the last fill, per the venue; `undefined` without fills. */
  positionAfter: bigint | undefined;
  /** Resting orders of the user's that this transaction cancelled or shrank (offsets). */
  ownOrdersRetired: number;
}

/** Decoded shape shared by both venues, so one summariser serves both. */
export type ExecutionEvent =
  | { name: "OrderCreated"; orderId: `0x${string}`; participant: `0x${string}`; price: bigint; quantity: bigint }
  | { name: "OrderUpdated"; orderId: `0x${string}`; participant: `0x${string}`; newQuantity: bigint }
  | { name: "OrderCancelled"; orderId: `0x${string}`; participant: `0x${string}` }
  | {
      name: "OrderMatched";
      makerOrderId: `0x${string}`;
      maker: `0x${string}`;
      taker: `0x${string}`;
      tradePrice: bigint;
      takerQuantity: bigint;
      makerFee: bigint;
      takerFee: bigint;
      makerNetQtyAfter: bigint;
      takerNetQtyAfter: bigint;
    };

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Fold decoded events into the outcome for `user`. Log order is the venue's
 * emission order, which the resting/cancelled arithmetic relies on: the last
 * `OrderUpdated` for a created id is its final resting size.
 */
export function summarizeExecutionEvents(events: ExecutionEvent[], user: `0x${string}`): OrderExecution {
  const created = new Map<`0x${string}`, bigint>();
  const finalSize = new Map<`0x${string}`, bigint>();
  const fills: ExecutionFill[] = [];
  let positionAfter: bigint | undefined;
  let ownOrdersRetired = 0;

  for (const event of events) {
    switch (event.name) {
      case "OrderCreated":
        if (same(event.participant, user)) created.set(event.orderId, event.quantity);
        break;
      case "OrderUpdated":
        if (!same(event.participant, user)) break;
        if (created.has(event.orderId)) finalSize.set(event.orderId, event.newQuantity);
        else ownOrdersRetired++;
        break;
      case "OrderCancelled":
        if (!same(event.participant, user)) break;
        if (created.has(event.orderId)) finalSize.set(event.orderId, 0n);
        else ownOrdersRetired++;
        break;
      case "OrderMatched": {
        const asTaker = same(event.taker, user);
        const asMaker = same(event.maker, user);
        if (!asTaker && !asMaker) break;
        // The user's own resting order being hit by the user's own new order is
        // blocked by the venues, so at most one side is theirs per event.
        if (asTaker) {
          fills.push({ price: event.tradePrice, quantity: event.takerQuantity, fee: event.takerFee });
          positionAfter = event.takerNetQtyAfter;
        } else {
          fills.push({ price: event.tradePrice, quantity: -event.takerQuantity, fee: event.makerFee });
          positionAfter = event.makerNetQtyAfter;
        }
        break;
      }
    }
  }

  let placed = 0n;
  let resting = 0n;
  for (const [orderId, quantity] of created) {
    placed += quantity;
    resting += finalSize.get(orderId) ?? quantity;
  }

  let filled = 0n;
  let notional = 0n;
  let feePaid = 0n;
  for (const fill of fills) {
    filled += fill.quantity;
    notional += fill.price * abs(fill.quantity);
    feePaid += fill.fee;
  }

  // A GTC that filled in part has its remainder in `OrderUpdated`, so
  // `placed − filled − resting` is zero; an IOC closes at 0, leaving the rest here.
  const cancelled = placed - filled - resting;

  return {
    placed,
    filled,
    resting,
    cancelled,
    fills,
    averagePrice: filled === 0n ? undefined : notional / abs(filled),
    feePaid,
    positionAfter,
    ownOrdersRetired,
  };
}

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

/** Only the four events the summary reads, per venue — the topic hashes must match the deployed signatures. */
const COMMON_EVENTS = [
  {
    type: "event",
    name: "OrderUpdated",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "participant", type: "address", indexed: true },
      { name: "newQuantity", type: "int256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OrderCancelled",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "participant", type: "address", indexed: true },
    ],
  },
] as const satisfies Abi;

const MATCH_TAIL = [
  { name: "tradePrice", type: "uint256", indexed: false },
  { name: "takerQuantity", type: "int256", indexed: false },
  { name: "makerFee", type: "int256", indexed: false },
  { name: "takerFee", type: "int256", indexed: false },
  { name: "makerNetQtyAfter", type: "int256", indexed: false },
  { name: "takerNetQtyAfter", type: "int256", indexed: false },
  { name: "makerEntryPriceAfter", type: "uint256", indexed: false },
  { name: "takerEntryPriceAfter", type: "uint256", indexed: false },
] as const;

const MATCH_HEAD = [
  { name: "makerOrderId", type: "bytes32", indexed: true },
  { name: "maker", type: "address", indexed: true },
  { name: "taker", type: "address", indexed: true },
] as const;

export const FUTURES_EXECUTION_EVENTS = [
  ...COMMON_EVENTS,
  {
    type: "event",
    name: "OrderCreated",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "participant", type: "address", indexed: true },
      { name: "price", type: "uint256", indexed: false },
      { name: "quantity", type: "int256", indexed: false },
      { name: "expirationAt", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OrderMatched",
    inputs: [...MATCH_HEAD, { name: "expirationAt", type: "uint256", indexed: false }, ...MATCH_TAIL],
  },
] as const satisfies Abi;

export const PERPS_EXECUTION_EVENTS = [
  ...COMMON_EVENTS,
  {
    type: "event",
    name: "OrderCreated",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "participant", type: "address", indexed: true },
      { name: "price", type: "uint256", indexed: false },
      { name: "quantity", type: "int256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OrderMatched",
    inputs: [...MATCH_HEAD, ...MATCH_TAIL],
  },
] as const satisfies Abi;

/**
 * Decode a receipt's logs for `venue` and summarise them for `user`. Logs from
 * other contracts in the same transaction are ignored when `contractAddress` is
 * given; without it, anything that decodes as one of the four events counts.
 */
export function summarizeOrderExecution(args: {
  logs: Log[];
  venue: ExecutionVenue;
  user: `0x${string}`;
  contractAddress?: `0x${string}`;
}): OrderExecution {
  const abi = args.venue === "futures" ? FUTURES_EXECUTION_EVENTS : PERPS_EXECUTION_EVENTS;
  const logs = args.contractAddress
    ? args.logs.filter((log) => same(log.address, getAddress(args.contractAddress as `0x${string}`)))
    : args.logs;
  const decoded = parseEventLogs({ abi, logs, strict: true });

  const events: ExecutionEvent[] = decoded.map((log) => {
    switch (log.eventName) {
      case "OrderCreated":
        return { name: "OrderCreated", ...log.args };
      case "OrderUpdated":
        return { name: "OrderUpdated", ...log.args };
      case "OrderCancelled":
        return { name: "OrderCancelled", ...log.args };
      case "OrderMatched":
        return { name: "OrderMatched", ...log.args };
    }
  });
  return summarizeExecutionEvents(events, args.user);
}
