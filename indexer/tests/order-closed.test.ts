import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { OrderClosed, OrderCreated } from "../generated/Futures/Futures";
import { handleOrderClosed, handleOrderCreated } from "../src/handlers/orders";
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

function createOrderCreatedEvent(
  orderId: Bytes,
  participant: Address,
  isBuy: boolean,
): OrderCreated {
  return newTypedMockEventWithParams<OrderCreated>([
    paramBytes("orderId", orderId),
    paramAddr("participant", participant),
    paramString("destURL", "url"),
    paramUint("pricePerDay", PRICE),
    paramUint("deliveryAt", DELIVERY),
    paramBool("isBuy", isBuy),
  ]);
}

function createOrderClosedEvent(orderId: Bytes, participant: Address): OrderClosed {
  return newTypedMockEventWithParams<OrderClosed>([
    paramBytes("orderId", orderId),
    paramAddr("participant", participant),
  ]);
}

describe("handleOrderClosed", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("cancelling the only entry marks the Order CANCELLED and clears active counters", () => {
    const user = userAddress(1);
    const oid = bytes32Id(1);
    handleOrderCreated(createOrderCreatedEvent(oid, user, true));
    handleOrderClosed(createOrderClosedEvent(oid, user));

    const aggId = orderAggKeyDefaultTx(user, PRICE, DELIVERY, true);
    assert.fieldEquals("Order", aggId, "quantity", "0");
    assert.fieldEquals("Order", aggId, "cancelledQuantity", "1");
    assert.fieldEquals("Order", aggId, "filledQuantity", "0");
    assert.fieldEquals("Order", aggId, "status", "CANCELLED");

    assert.fieldEquals("OrderEntry", oid.toHexString(), "status", "CANCELLED");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "totalQuantity", "0");
    assert.fieldEquals("Futures", "0", "activeOrders", "0");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "0");
  });

  test("cancelling one of two entries leaves the Order PARTIAL", () => {
    const user = userAddress(1);
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(1), user, true));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(2), user, true));

    handleOrderClosed(createOrderClosedEvent(bytes32Id(1), user));

    const aggId = orderAggKeyDefaultTx(user, PRICE, DELIVERY, true);
    assert.fieldEquals("Order", aggId, "quantity", "1");
    assert.fieldEquals("Order", aggId, "cancelledQuantity", "1");
    assert.fieldEquals("Order", aggId, "originalQuantity", "2");
    assert.fieldEquals("Order", aggId, "status", "PARTIAL");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "totalQuantity", "1");
    assert.fieldEquals("Futures", "0", "activeOrders", "1");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "1");
  });

  test("OrderClosed for unknown id is a no-op", () => {
    handleOrderClosed(createOrderClosedEvent(bytes32Id(42), userAddress(1)));
    assert.entityCount("OrderEntry", 0);
    assert.entityCount("Order", 0);
  });
});
