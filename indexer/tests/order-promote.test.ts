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
  orderAggKeyDefaultTx,
  paramAddr,
  paramBool,
  paramBytes,
  paramString,
  paramUint,
  priceLevelKey,
  setupDataSourceMock,
  setupFutures,
  userAddress,
} from "./helpers";

const PRICE = BigInt.fromI64(1_000_000);
const DELIVERY = BigInt.fromI64(1_700_000_000);

function orderCreated(orderId: Bytes, user: Address, isBuy: boolean): OrderCreated {
  return newTypedMockEventWithParams<OrderCreated>([
    paramBytes("orderId", orderId),
    paramAddr("participant", user),
    paramString("destURL", "u"),
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
  orderId: Bytes,
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
    paramBytes("orderId", orderId),
    paramBytes("takerOrderId", takerOrderId),
  ]);
}

describe("resting-order promotion (OrderClosed → PositionCreated in same tx)", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("OrderEntry first cancelled then promoted to MATCHED when matching position fires", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    const oid = bytes32Id(10);

    handleOrderCreated(orderCreated(oid, seller, false));
    // OrderClosed fires for the resting order at the moment of match (we can't tell yet).
    handleOrderClosed(orderClosed(oid, seller));

    const aggId = orderAggKeyDefaultTx(seller, PRICE, DELIVERY, false);
    assert.fieldEquals("OrderEntry", oid.toHexString(), "status", "CANCELLED");
    assert.fieldEquals("Order", aggId, "status", "CANCELLED");
    assert.fieldEquals("Order", aggId, "cancelledQuantity", "1");
    assert.fieldEquals("Order", aggId, "filledQuantity", "0");

    // Subsequent PositionCreated in the same tx referencing this orderId promotes it.
    handlePositionCreated(positionCreated(bytes32Id(1), seller, buyer, oid, bytes32Id(0)));

    assert.fieldEquals("OrderEntry", oid.toHexString(), "status", "MATCHED");
    assert.fieldEquals("Order", aggId, "cancelledQuantity", "0");
    assert.fieldEquals("Order", aggId, "filledQuantity", "1");
    assert.fieldEquals("Order", aggId, "status", "FILLED");
  });

  test("partial promotion: 2 entries, 1 cancelled then matched, 1 still cancelled → PARTIAL", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    const o1 = bytes32Id(10);
    const o2 = bytes32Id(11);

    handleOrderCreated(orderCreated(o1, seller, false));
    handleOrderCreated(orderCreated(o2, seller, false));
    handleOrderClosed(orderClosed(o1, seller));
    handleOrderClosed(orderClosed(o2, seller));
    handlePositionCreated(positionCreated(bytes32Id(1), seller, buyer, o1, bytes32Id(0)));

    const aggId = orderAggKeyDefaultTx(seller, PRICE, DELIVERY, false);
    assert.fieldEquals("OrderEntry", o1.toHexString(), "status", "MATCHED");
    assert.fieldEquals("OrderEntry", o2.toHexString(), "status", "CANCELLED");
    assert.fieldEquals("Order", aggId, "cancelledQuantity", "1");
    assert.fieldEquals("Order", aggId, "filledQuantity", "1");
    assert.fieldEquals("Order", aggId, "originalQuantity", "2");
    // quantity=0 with mixed filled+cancelled → recomputeOrderStatus picks FILLED.
    assert.fieldEquals("Order", aggId, "status", "FILLED");
    // PriceLevel: PositionCreated does NOT bump totalQuantity back up.
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, false), "totalQuantity", "0");
  });
});
