import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { OrderCreated, OrderMatched } from "../generated/HashPowerFutures/HashPowerFutures";
import { handleOrderCreated, handleOrderMatched } from "../src/handlers/orders";
import {
  bytes32Id,
  fillKey,
  nudgeTx,
  paramAddr,
  paramBytes,
  paramInt,
  paramUint,
  pointerKey,
  sessionKey,
  setupDataSourceMock,
  setupFutures,
  tradeAggKey,
  userAddress,
} from "./helpers";

const PRICE = BigInt.fromI64(1_000_000);
const DELIVERY = BigInt.fromI64(1_700_000_000);

function createOrderCreatedEvent(
  orderId: Bytes,
  participant: Address,
  quantity: BigInt,
): OrderCreated {
  return newTypedMockEventWithParams<OrderCreated>([
    paramBytes("orderId", orderId),
    paramAddr("participant", participant),
    paramUint("price", PRICE),
    paramInt("quantity", quantity),
    paramUint("expirationAt", DELIVERY),
  ]);
}

function createOrderMatchedEvent(
  makerOrderId: Bytes,
  maker: Address,
  taker: Address,
  tradePrice: BigInt,
  takerQuantity: BigInt,
  makerFee: BigInt,
  takerFee: BigInt,
  makerNetQtyAfter: BigInt,
  takerNetQtyAfter: BigInt,
  makerEntryPriceAfter: BigInt,
  takerEntryPriceAfter: BigInt,
): OrderMatched {
  return newTypedMockEventWithParams<OrderMatched>([
    paramBytes("makerOrderId", makerOrderId),
    paramAddr("maker", maker),
    paramAddr("taker", taker),
    paramUint("expirationAt", DELIVERY),
    paramUint("tradePrice", tradePrice),
    paramInt("takerQuantity", takerQuantity),
    paramInt("makerFee", makerFee),
    paramInt("takerFee", takerFee),
    paramInt("makerNetQtyAfter", makerNetQtyAfter),
    paramInt("takerNetQtyAfter", takerNetQtyAfter),
    paramUint("makerEntryPriceAfter", makerEntryPriceAfter),
    paramUint("takerEntryPriceAfter", takerEntryPriceAfter),
  ]);
}

const ONE = BigInt.fromI32(1);
const TWO = BigInt.fromI32(2);

describe("handleOrderMatched", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("credits both maker and taker orders and opens a session per side", () => {
    const maker = userAddress(1);
    const taker = userAddress(2);
    const makerOid = bytes32Id(1);
    const takerOid = bytes32Id(2);

    // Maker rests a sell, then the taker's buy crosses it.
    handleOrderCreated(createOrderCreatedEvent(makerOid, maker, ONE.neg()));
    handleOrderCreated(createOrderCreatedEvent(takerOid, taker, ONE));

    const match = createOrderMatchedEvent(
      makerOid, maker, taker, PRICE, ONE,
      BigInt.zero(), BigInt.zero(),
      ONE.neg(), ONE, PRICE, PRICE,
    );
    handleOrderMatched(match);

    // Both sides of the match are credited, not just the maker's.
    assert.fieldEquals("Order", takerOid.toHexString(), "filledQuantity", "1");
    assert.fieldEquals("Order", takerOid.toHexString(), "averageFillPrice", PRICE.toString());
    assert.fieldEquals("Order", makerOid.toHexString(), "filledQuantity", "1");
    assert.fieldEquals("Order", makerOid.toHexString(), "averageFillPrice", PRICE.toString());

    assert.entityCount("Fill", 2);
    assert.entityCount("Trade", 2);
    assert.entityCount("PositionSession", 2);
    assert.fieldEquals("Futures", "0", "totalFills", "2");
    assert.fieldEquals("Futures", "0", "totalTrades", "2");
    assert.fieldEquals("Futures", "0", "totalVolume", PRICE.toString());

    const takerFill = fillKey(match.transaction.hash, match.logIndex, 0);
    const makerFill = fillKey(match.transaction.hash, match.logIndex, 1);
    assert.fieldEquals("Fill", takerFill, "side", "TAKER");
    assert.fieldEquals("Fill", takerFill, "user", taker.toHexString());
    assert.fieldEquals("Fill", takerFill, "counterparty", maker.toHexString());
    assert.fieldEquals("Fill", takerFill, "order", takerOid.toHexString());
    assert.fieldEquals("Fill", takerFill, "counterpartyOrder", makerOid.toHexString());
    assert.fieldEquals("Fill", takerFill, "fillQuantity", "1");
    assert.fieldEquals("Fill", takerFill, "netQuantityAfter", "1");
    assert.fieldEquals("Fill", takerFill, "aggregatedEntryPriceAfter", PRICE.toString());

    assert.fieldEquals("Fill", makerFill, "side", "MAKER");
    assert.fieldEquals("Fill", makerFill, "order", makerOid.toHexString());
    assert.fieldEquals("Fill", makerFill, "counterpartyOrder", takerOid.toHexString());
    assert.fieldEquals("Fill", makerFill, "fillQuantity", "-1");
    assert.fieldEquals("Fill", makerFill, "netQuantityAfter", "-1");

    const takerSession = sessionKey(match.block.number, match.logIndex, 0);
    const makerSession = sessionKey(match.block.number, match.logIndex, 1);
    assert.fieldEquals("PositionSession", takerSession, "status", "OPEN");
    assert.fieldEquals("PositionSession", takerSession, "netQuantity", "1");
    assert.fieldEquals("PositionSession", takerSession, "entryPrice", PRICE.toString());
    assert.fieldEquals("PositionSession", makerSession, "netQuantity", "-1");

    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(taker, DELIVERY),
      "currentSessionId",
      takerSession,
    );
  });

  test("stores the event's post-state entry price on a scale-in", () => {
    const maker1 = userAddress(1);
    const maker2 = userAddress(2);
    const taker = userAddress(3);
    const secondPrice = PRICE.plus(BigInt.fromI64(200_000));
    // Average of 1_000_000 and 1_200_000 across two contracts.
    const avgPrice = BigInt.fromI64(1_100_000);

    handleOrderCreated(createOrderCreatedEvent(bytes32Id(1), maker1, ONE.neg()));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(10), taker, ONE));
    const match1 = createOrderMatchedEvent(
      bytes32Id(1), maker1, taker, PRICE, ONE,
      BigInt.zero(), BigInt.zero(),
      ONE.neg(), ONE, PRICE, PRICE,
    );
    handleOrderMatched(match1);

    handleOrderCreated(createOrderCreatedEvent(bytes32Id(2), maker2, ONE.neg()));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(20), taker, ONE));
    const match2 = createOrderMatchedEvent(
      bytes32Id(2), maker2, taker, secondPrice, ONE,
      BigInt.zero(), BigInt.zero(),
      ONE.neg(), TWO, secondPrice, avgPrice,
    );
    match2.logIndex = BigInt.fromI32(2);
    handleOrderMatched(match2);

    // The contract's own averaged entry price is stored verbatim.
    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(taker, DELIVERY),
      "aggregatedEntryPrice",
      avgPrice.toString(),
    );
    const session = sessionKey(match1.block.number, match1.logIndex, 0);
    assert.fieldEquals("PositionSession", session, "entryPrice", avgPrice.toString());
    assert.fieldEquals("PositionSession", session, "netQuantity", "2");
    assert.fieldEquals("PositionSession", session, "maxQuantity", "2");
  });

  test("a sign flip closes the old session and opens a new one", () => {
    const maker1 = userAddress(1);
    const maker2 = userAddress(2);
    const trader = userAddress(3);
    const flipPrice = PRICE.plus(BigInt.fromI64(100_000));

    // Open +1 at PRICE.
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(1), maker1, ONE.neg()));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(10), trader, ONE));
    const open = createOrderMatchedEvent(
      bytes32Id(1), maker1, trader, PRICE, ONE,
      BigInt.zero(), BigInt.zero(),
      ONE.neg(), ONE, PRICE, PRICE,
    );
    handleOrderMatched(open);
    const oldSession = sessionKey(open.block.number, open.logIndex, 0);

    // Sell 2 at flipPrice: +1 → -1.
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(2), maker2, TWO));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(20), trader, TWO.neg()));
    const flip = createOrderMatchedEvent(
      bytes32Id(2), maker2, trader, flipPrice, TWO.neg(),
      BigInt.zero(), BigInt.zero(),
      TWO, ONE.neg(), flipPrice, flipPrice,
    );
    // A fresh tx so the reversal's legs don't fold into the opening Trade row.
    nudgeTx(flip, 0x1234);
    handleOrderMatched(flip);

    // PnL on the 1 contract closed: (1_100_000 - 1_000_000) * 1 = 100_000.
    assert.fieldEquals("PositionSession", oldSession, "status", "CLOSE");
    assert.fieldEquals("PositionSession", oldSession, "netQuantity", "0");
    assert.fieldEquals("PositionSession", oldSession, "closedQuantity", "1");
    assert.fieldEquals("PositionSession", oldSession, "closePrice", flipPrice.toString());
    assert.fieldEquals("PositionSession", oldSession, "realizedPnl", "100000");

    // The residual lives in a brand-new session, not smeared onto the old one.
    const newSession = sessionKey(flip.block.number, flip.logIndex, 2);
    assert.fieldEquals("PositionSession", newSession, "status", "OPEN");
    assert.fieldEquals("PositionSession", newSession, "netQuantity", "-1");
    assert.fieldEquals("PositionSession", newSession, "entryPrice", flipPrice.toString());
    assert.fieldEquals("PositionSession", newSession, "realizedPnl", "0");
    assert.fieldEquals("User", trader.toHexString(), "realizedPnl", "100000");
    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(trader, DELIVERY),
      "currentSessionId",
      newSession,
    );

    // One Trade row per session, and the closing leg keeps the realized PnL.
    const closeTrade = tradeAggKey(flip.transaction.hash, trader, oldSession);
    const openTrade = tradeAggKey(flip.transaction.hash, trader, newSession);
    assert.fieldEquals("Trade", closeTrade, "realizedPnl", "100000");
    assert.fieldEquals("Trade", closeTrade, "tradeQuantity", "-1");
    assert.fieldEquals("Trade", closeTrade, "fillCount", "1");
    assert.fieldEquals("Trade", openTrade, "realizedPnl", "0");
    assert.fieldEquals("Trade", openTrade, "tradeQuantity", "-1");
    assert.fieldEquals("Trade", openTrade, "fillCount", "1");

    // The flipping side writes two legs; the other side writes one.
    assert.fieldEquals("Fill", fillKey(flip.transaction.hash, flip.logIndex, 0), "realizedPnl", "100000");
    assert.fieldEquals("Fill", fillKey(flip.transaction.hash, flip.logIndex, 2), "realizedPnl", "0");
    assert.fieldEquals("Fill", fillKey(flip.transaction.hash, flip.logIndex, 1), "side", "MAKER");
    assert.fieldEquals("User", trader.toHexString(), "fillCount", "3");
  });

  test("a full close closes the session and keeps its historical entry price", () => {
    const maker1 = userAddress(1);
    const maker2 = userAddress(2);
    const trader = userAddress(3);
    const exitPrice = PRICE.minus(BigInt.fromI64(50_000));

    handleOrderCreated(createOrderCreatedEvent(bytes32Id(1), maker1, ONE.neg()));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(10), trader, ONE));
    const open = createOrderMatchedEvent(
      bytes32Id(1), maker1, trader, PRICE, ONE,
      BigInt.zero(), BigInt.zero(),
      ONE.neg(), ONE, PRICE, PRICE,
    );
    handleOrderMatched(open);
    const session = sessionKey(open.block.number, open.logIndex, 0);

    handleOrderCreated(createOrderCreatedEvent(bytes32Id(2), maker2, ONE));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(20), trader, ONE.neg()));
    const close = createOrderMatchedEvent(
      bytes32Id(2), maker2, trader, exitPrice, ONE.neg(),
      BigInt.zero(), BigInt.zero(),
      // The contract reports a zeroed entry price once flat.
      ONE, BigInt.zero(), exitPrice, BigInt.zero(),
    );
    close.logIndex = BigInt.fromI32(2);
    handleOrderMatched(close);

    assert.fieldEquals("PositionSession", session, "status", "CLOSE");
    assert.fieldEquals("PositionSession", session, "entryPrice", PRICE.toString());
    assert.fieldEquals("PositionSession", session, "closePrice", exitPrice.toString());
    assert.fieldEquals("PositionSession", session, "closedQuantity", "1");
    assert.fieldEquals("PositionSession", session, "realizedPnl", "-50000");
    assert.fieldEquals("User", trader.toHexString(), "realizedPnl", "-50000");

    const pointer = pointerKey(trader, DELIVERY);
    assert.fieldEquals("UserDeliverySessionPointer", pointer, "netQuantity", "0");
    assert.fieldEquals("UserDeliverySessionPointer", pointer, "currentSessionId", "");
    assert.fieldEquals("UserDeliverySessionPointer", pointer, "lastClosedSessionId", session);
  });

  test("a break-even close still records the settled quantity and close price", () => {
    const maker1 = userAddress(1);
    const maker2 = userAddress(2);
    const trader = userAddress(3);

    handleOrderCreated(createOrderCreatedEvent(bytes32Id(1), maker1, ONE.neg()));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(10), trader, ONE));
    const open = createOrderMatchedEvent(
      bytes32Id(1), maker1, trader, PRICE, ONE,
      BigInt.zero(), BigInt.zero(),
      ONE.neg(), ONE, PRICE, PRICE,
    );
    handleOrderMatched(open);
    const session = sessionKey(open.block.number, open.logIndex, 0);

    handleOrderCreated(createOrderCreatedEvent(bytes32Id(2), maker2, ONE));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(20), trader, ONE.neg()));
    const close = createOrderMatchedEvent(
      bytes32Id(2), maker2, trader, PRICE, ONE.neg(),
      BigInt.zero(), BigInt.zero(),
      ONE, BigInt.zero(), PRICE, BigInt.zero(),
    );
    close.logIndex = BigInt.fromI32(2);
    handleOrderMatched(close);

    assert.fieldEquals("PositionSession", session, "realizedPnl", "0");
    assert.fieldEquals("PositionSession", session, "closedQuantity", "1");
    assert.fieldEquals("PositionSession", session, "closePrice", PRICE.toString());
  });

  test("fees land on the Fill, the Trade and the PositionSession", () => {
    const maker = userAddress(1);
    const taker = userAddress(2);
    const makerOid = bytes32Id(1);
    const takerOid = bytes32Id(2);
    const takerFee = BigInt.fromI32(500);
    const makerFee = BigInt.fromI32(-200);

    handleOrderCreated(createOrderCreatedEvent(makerOid, maker, ONE.neg()));
    handleOrderCreated(createOrderCreatedEvent(takerOid, taker, ONE));
    const match = createOrderMatchedEvent(
      makerOid, maker, taker, PRICE, ONE,
      makerFee, takerFee,
      ONE.neg(), ONE, PRICE, PRICE,
    );
    handleOrderMatched(match);

    const takerSession = sessionKey(match.block.number, match.logIndex, 0);
    const makerSession = sessionKey(match.block.number, match.logIndex, 1);
    assert.fieldEquals(
      "Fill",
      fillKey(match.transaction.hash, match.logIndex, 0),
      "tradingFee",
      takerFee.toString(),
    );
    assert.fieldEquals(
      "Trade",
      tradeAggKey(match.transaction.hash, taker, takerSession),
      "tradingFee",
      takerFee.toString(),
    );
    assert.fieldEquals("PositionSession", takerSession, "tradingFees", takerFee.toString());
    assert.fieldEquals("PositionSession", makerSession, "tradingFees", makerFee.toString());
  });

  test("self-match keeps the two legs in distinct Fills and sessions", () => {
    const user = userAddress(1);
    const restingOid = bytes32Id(1);
    const takingOid = bytes32Id(2);

    handleOrderCreated(createOrderCreatedEvent(restingOid, user, ONE.neg()));
    handleOrderCreated(createOrderCreatedEvent(takingOid, user, ONE));
    const match = createOrderMatchedEvent(
      restingOid, user, user, PRICE, ONE,
      BigInt.zero(), BigInt.zero(),
      BigInt.zero(), BigInt.zero(), BigInt.zero(), BigInt.zero(),
    );
    handleOrderMatched(match);

    // `side`, `order` and `counterpartyOrder` are the only distinguishing
    // fields when a user matches themselves.
    const takerFill = fillKey(match.transaction.hash, match.logIndex, 0);
    const makerFill = fillKey(match.transaction.hash, match.logIndex, 1);
    assert.entityCount("Fill", 2);
    assert.fieldEquals("Fill", takerFill, "order", takingOid.toHexString());
    assert.fieldEquals("Fill", takerFill, "counterpartyOrder", restingOid.toHexString());
    assert.fieldEquals("Fill", makerFill, "order", restingOid.toHexString());
    assert.fieldEquals("Fill", makerFill, "counterpartyOrder", takingOid.toHexString());

    // Two sessions opened and closed within the one log, so two Trade rows.
    assert.entityCount("Trade", 2);
    assert.entityCount("PositionSession", 2);
    assert.fieldEquals(
      "PositionSession",
      sessionKey(match.block.number, match.logIndex, 0),
      "status",
      "CLOSE",
    );
    assert.fieldEquals(
      "PositionSession",
      sessionKey(match.block.number, match.logIndex, 1),
      "status",
      "CLOSE",
    );
    assert.fieldEquals("User", user.toHexString(), "fillCount", "2");
    assert.fieldEquals("User", user.toHexString(), "tradeCount", "2");
  });
});
