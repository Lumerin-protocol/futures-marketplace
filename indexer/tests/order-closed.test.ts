import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { OrderCancelled, OrderCreated } from "../generated/Futures/Futures";
import { handleOrderCancelled, handleOrderCreated } from "../src/handlers/orders";
import {
  bytes32Id,
  orderAggKeyDefaultTx,
  paramAddr,
  paramBytes,
  paramInt,
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
  quantity: BigInt,
): OrderCreated {
  return newTypedMockEventWithParams<OrderCreated>([
    paramBytes("orderId", orderId),
    paramAddr("participant", participant),
    paramUint("price", PRICE),
    paramInt("quantity", quantity),
    paramUint("deliveryAt", DELIVERY),
  ]);
}

function createOrderCancelledEvent(
  orderId: Bytes,
  participant: Address,
): OrderCancelled {
  return newTypedMockEventWithParams<OrderCancelled>([
    paramBytes("orderId", orderId),
    paramAddr("participant", participant),
  ]);
}

describe("handleOrderCancelled", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("cancelling the only entry marks the Order CANCELLED and clears active counters", () => {
    const user = userAddress(1);
    const oid = bytes32Id(1);
    handleOrderCreated(createOrderCreatedEvent(oid, user, BigInt.fromI32(1)));
    handleOrderCancelled(createOrderCancelledEvent(oid, user));

    const aggId = orderAggKeyDefaultTx(user, PRICE, DELIVERY, true);
    assert.fieldEquals("Order", aggId, "quantity", "0");
    assert.fieldEquals("Order", aggId, "cancelledQuantity", "1");
    assert.fieldEquals("Order", aggId, "filledQuantity", "0");
    assert.fieldEquals("Order", aggId, "status", "CANCELLED");

    assert.fieldEquals("OrderEntry", oid.toHexString(), "status", "CANCELLED");
    assert.fieldEquals("OrderEntry", oid.toHexString(), "remainingQuantity", "0");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "totalQuantity", "0");
    assert.fieldEquals("Futures", "0", "activeOrders", "0");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "0");
  });

  test("cancelling a qty=2 order clears the full remaining quantity", () => {
    const user = userAddress(1);
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(1), user, BigInt.fromI32(2)));
    handleOrderCancelled(createOrderCancelledEvent(bytes32Id(1), user));

    const aggId = orderAggKeyDefaultTx(user, PRICE, DELIVERY, true);
    assert.fieldEquals("Order", aggId, "quantity", "0");
    assert.fieldEquals("Order", aggId, "cancelledQuantity", "2");
    assert.fieldEquals("Order", aggId, "originalQuantity", "2");
    assert.fieldEquals("Order", aggId, "status", "CANCELLED");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "totalQuantity", "0");
    assert.fieldEquals("Futures", "0", "activeOrders", "0");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "0");
  });

  test("OrderCancelled for unknown id is a no-op", () => {
    handleOrderCancelled(createOrderCancelledEvent(bytes32Id(42), userAddress(1)));
    assert.entityCount("OrderEntry", 0);
    assert.entityCount("Order", 0);
  });

  test("OrderCancelled after deliveryAt marks OrderEntry EXPIRED", () => {
    const user = userAddress(1);
    const oid = bytes32Id(1);
    handleOrderCreated(createOrderCreatedEvent(oid, user, BigInt.fromI32(1)));

    const cancelled = createOrderCancelledEvent(oid, user);
    cancelled.block.timestamp = DELIVERY.plus(BigInt.fromI32(1));
    handleOrderCancelled(cancelled);

    assert.fieldEquals("OrderEntry", oid.toHexString(), "status", "EXPIRED");
    assert.fieldEquals("Order", orderAggKeyDefaultTx(user, PRICE, DELIVERY, true), "status", "CANCELLED");
  });
});
