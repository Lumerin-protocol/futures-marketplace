import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  OrderClosed,
  OrderCreated,
  PositionCreated,
} from "../generated/Futures/Futures";
import { handleOrderClosed, handleOrderCreated } from "../src/handlers/orders";
import { handlePositionCreated } from "../src/handlers/positions";
import {
  bytes32Id,
  fillAggKeyDefaultTx,
  orderAggKeyDefaultTx,
  paramAddr,
  paramBool,
  paramBytes,
  paramString,
  paramUint,
  setupDataSourceMock,
  setupFutures,
  userAddress,
} from "./helpers";

const PRICE = BigInt.fromI64(1_000_000);
const DELIVERY = BigInt.fromI64(1_700_000_000);

function orderCreated(orderId: Bytes, user: Address, isBuy: boolean, dest: string): OrderCreated {
  return newTypedMockEventWithParams<OrderCreated>([
    paramBytes("orderId", orderId),
    paramAddr("participant", user),
    paramString("destURL", dest),
    paramUint("pricePerDay", PRICE),
    paramUint("deliveryAt", DELIVERY),
    paramBool("isBuy", isBuy),
  ]);
}

function orderClosed(orderId: Bytes, user: Address): OrderClosed {
  return newTypedMockEventWithParams<OrderClosed>([
    paramBytes("orderId", orderId),
    paramAddr("participant", user),
  ]);
}

function positionCreated(
  positionId: Bytes,
  seller: Address,
  buyer: Address,
  makerOrderId: Bytes,
  takerOrderId: Bytes,
): PositionCreated {
  return newTypedMockEventWithParams<PositionCreated>([
    paramBytes("positionId", positionId),
    paramAddr("seller", seller),
    paramAddr("buyer", buyer),
    paramUint("sellPricePerDay", PRICE),
    paramUint("buyPricePerDay", PRICE),
    paramUint("deliveryAt", DELIVERY),
    paramString("destURL", "u"),
    paramBytes("orderId", makerOrderId),
    paramBytes("takerOrderId", takerOrderId),
  ]);
}

describe("taker flow: order placed and immediately filled", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("both maker and taker orders end up in the indexer as FILLED Orders with MATCHED entries", () => {
    const maker = userAddress(1); // resting seller
    const taker = userAddress(2); // aggressor buyer
    const makerOid = bytes32Id(10);
    const takerOid = bytes32Id(20);

    // 1. Maker rests a sell order in a prior tx.
    handleOrderCreated(orderCreated(makerOid, maker, false, "u-maker"));

    // 2. Taker tx: synthetic OrderCreated + OrderClosed for the taker, OrderClosed
    //    for the maker, PositionCreated wiring both ids.
    handleOrderCreated(orderCreated(takerOid, taker, true, "u-taker"));
    handleOrderClosed(orderClosed(takerOid, taker));
    handleOrderClosed(orderClosed(makerOid, maker));
    handlePositionCreated(positionCreated(bytes32Id(1), maker, taker, makerOid, takerOid));

    // Both entries flipped CANCELLED → MATCHED.
    assert.fieldEquals("OrderEntry", makerOid.toHexString(), "status", "MATCHED");
    assert.fieldEquals("OrderEntry", takerOid.toHexString(), "status", "MATCHED");

    // Both Order aggregates are FILLED with all units accounted for.
    const makerAggId = orderAggKeyDefaultTx(maker, PRICE, DELIVERY, false);
    const takerAggId = orderAggKeyDefaultTx(taker, PRICE, DELIVERY, true);
    assert.fieldEquals("Order", makerAggId, "status", "FILLED");
    assert.fieldEquals("Order", makerAggId, "filledQuantity", "1");
    assert.fieldEquals("Order", makerAggId, "cancelledQuantity", "0");
    assert.fieldEquals("Order", makerAggId, "quantity", "0");
    assert.fieldEquals("Order", takerAggId, "status", "FILLED");
    assert.fieldEquals("Order", takerAggId, "filledQuantity", "1");
    assert.fieldEquals("Order", takerAggId, "cancelledQuantity", "0");
    assert.fieldEquals("Order", takerAggId, "quantity", "0");

    // Both users + a Position exist; both have an active fill against each other.
    assert.entityCount("User", 2);
    assert.entityCount("Position", 1);
    assert.entityCount("Fill", 2);
    assert.fieldEquals(
      "Fill",
      fillAggKeyDefaultTx(maker, taker),
      "fillQuantity",
      "-1",
    );
    assert.fieldEquals(
      "Fill",
      fillAggKeyDefaultTx(taker, maker),
      "fillQuantity",
      "1",
    );

    // No active orders left: both orderbook units consumed.
    assert.fieldEquals("Futures", "0", "totalOrders", "2");
    assert.fieldEquals("Futures", "0", "activeOrders", "0");
    assert.fieldEquals("User", maker.toHexString(), "activeOrderCount", "0");
    assert.fieldEquals("User", taker.toHexString(), "activeOrderCount", "0");
  });

  test("taker that matches against two different makers in one tx still produces one taker Order with two MATCHED entries", () => {
    const maker1 = userAddress(1);
    const maker2 = userAddress(2);
    const taker = userAddress(3);
    const m1 = bytes32Id(10);
    const m2 = bytes32Id(11);
    const t1 = bytes32Id(20);
    const t2 = bytes32Id(21);

    // Maker 1 rests in tx A.
    handleOrderCreated(orderCreated(m1, maker1, false, "u1"));

    // Maker 2 rests in tx B.
    const m2Created = orderCreated(m2, maker2, false, "u2");
    m2Created.transaction.hash = bytes32Id(7);
    m2Created.block.number = BigInt.fromI32(2);
    m2Created.logIndex = BigInt.fromI32(2);
    handleOrderCreated(m2Created);

    // Taker tx — fills both makers in one go.
    handleOrderCreated(orderCreated(t1, taker, true, "u-t"));
    handleOrderClosed(orderClosed(t1, taker));
    handleOrderClosed(orderClosed(m1, maker1));
    handlePositionCreated(positionCreated(bytes32Id(1), maker1, taker, m1, t1));

    handleOrderCreated(orderCreated(t2, taker, true, "u-t"));
    handleOrderClosed(orderClosed(t2, taker));
    handleOrderClosed(orderClosed(m2, maker2));
    handlePositionCreated(positionCreated(bytes32Id(2), maker2, taker, m2, t2));

    // Both maker entries MATCHED.
    assert.fieldEquals("OrderEntry", m1.toHexString(), "status", "MATCHED");
    assert.fieldEquals("OrderEntry", m2.toHexString(), "status", "MATCHED");
    // Both taker entries MATCHED.
    assert.fieldEquals("OrderEntry", t1.toHexString(), "status", "MATCHED");
    assert.fieldEquals("OrderEntry", t2.toHexString(), "status", "MATCHED");

    // Taker emitted both OrderCreated events with the same (price, deliveryAt, isBuy)
    // tuple in the same default tx → they aggregate into ONE Order with quantity=2.
    const takerAggId = orderAggKeyDefaultTx(taker, PRICE, DELIVERY, true);
    assert.fieldEquals("Order", takerAggId, "originalQuantity", "2");
    assert.fieldEquals("Order", takerAggId, "filledQuantity", "2");
    assert.fieldEquals("Order", takerAggId, "cancelledQuantity", "0");
    assert.fieldEquals("Order", takerAggId, "status", "FILLED");
  });
});
