import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { OrderCancelled, OrderCreated } from "../generated/HashPowerFutures/HashPowerFutures";
import { handleOrderCancelled, handleOrderCreated } from "../src/handlers/orders";
import {
  bytes32Id,
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
    paramUint("expirationAt", DELIVERY),
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

  test("cancelling marks the Order CANCELLED and clears active counters", () => {
    const user = userAddress(1);
    const oid = bytes32Id(1);
    handleOrderCreated(createOrderCreatedEvent(oid, user, BigInt.fromI32(1)));
    const cancel = createOrderCancelledEvent(oid, user);
    handleOrderCancelled(cancel);

    const id = oid.toHexString();
    assert.fieldEquals("Order", id, "quantity", "0");
    assert.fieldEquals("Order", id, "cancelledQuantity", "1");
    assert.fieldEquals("Order", id, "filledQuantity", "0");
    assert.fieldEquals("Order", id, "status", "CANCELLED");
    assert.fieldEquals("Order", id, "closedAt", cancel.block.timestamp.toString());
    assert.fieldEquals("Order", id, "closedByTx", cancel.transaction.from.toHexString());

    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "totalQuantity", "0");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "orderCount", "0");
    assert.fieldEquals("Futures", "0", "activeOrders", "0");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "0");
  });

  test("cancelling a qty=2 order clears the full remaining quantity", () => {
    const user = userAddress(1);
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(1), user, BigInt.fromI32(2)));
    handleOrderCancelled(createOrderCancelledEvent(bytes32Id(1), user));

    const id = bytes32Id(1).toHexString();
    assert.fieldEquals("Order", id, "quantity", "0");
    assert.fieldEquals("Order", id, "cancelledQuantity", "2");
    assert.fieldEquals("Order", id, "originalQuantity", "2");
    assert.fieldEquals("Order", id, "status", "CANCELLED");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "totalQuantity", "0");
    assert.fieldEquals("Futures", "0", "activeOrders", "0");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "0");
  });

  test("OrderCancelled for unknown id is a no-op", () => {
    handleOrderCancelled(createOrderCancelledEvent(bytes32Id(42), userAddress(1)));
    assert.entityCount("Order", 0);
  });

  test("OrderCancelled after expirationAt marks the Order EXPIRED", () => {
    const user = userAddress(1);
    const oid = bytes32Id(1);
    handleOrderCreated(createOrderCreatedEvent(oid, user, BigInt.fromI32(1)));

    const cancelled = createOrderCancelledEvent(oid, user);
    cancelled.block.timestamp = DELIVERY.plus(BigInt.fromI32(1));
    handleOrderCancelled(cancelled);

    assert.fieldEquals("Order", oid.toHexString(), "status", "EXPIRED");
    assert.fieldEquals("Order", oid.toHexString(), "quantity", "0");
    assert.fieldEquals("Futures", "0", "activeOrders", "0");
  });

  test("a cancel after the order already went terminal is a no-op", () => {
    const user = userAddress(1);
    const oid = bytes32Id(1);
    handleOrderCreated(createOrderCreatedEvent(oid, user, BigInt.fromI32(1)));
    handleOrderCancelled(createOrderCancelledEvent(oid, user));
    handleOrderCancelled(createOrderCancelledEvent(oid, user));

    assert.fieldEquals("Futures", "0", "activeOrders", "0");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "0");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "orderCount", "0");
  });
});
