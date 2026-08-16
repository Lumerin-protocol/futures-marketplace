import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { OrderCreated, OrderUpdated } from "../generated/HashPowerFutures/HashPowerFutures";
import { handleOrderCreated, handleOrderUpdated } from "../src/handlers/orders";
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
  price: BigInt,
  quantity: BigInt,
  expirationAt: BigInt,
): OrderCreated {
  return newTypedMockEventWithParams<OrderCreated>([
    paramBytes("orderId", orderId),
    paramAddr("participant", participant),
    paramUint("price", price),
    paramInt("quantity", quantity),
    paramUint("expirationAt", expirationAt),
  ]);
}

function createOrderUpdatedEvent(
  orderId: Bytes,
  participant: Address,
  newQuantity: BigInt,
): OrderUpdated {
  return newTypedMockEventWithParams<OrderUpdated>([
    paramBytes("orderId", orderId),
    paramAddr("participant", participant),
    paramInt("newQuantity", newQuantity),
  ]);
}

describe("handleOrderUpdated", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("reduce-only amend credits cancelledQuantity and stays ACTIVE", () => {
    const user = userAddress(1);
    const oid = bytes32Id(1);
    handleOrderCreated(createOrderCreatedEvent(oid, user, PRICE, BigInt.fromI32(8), DELIVERY));
    handleOrderUpdated(createOrderUpdatedEvent(oid, user, BigInt.fromI32(3)));

    const id = oid.toHexString();
    assert.fieldEquals("Order", id, "quantity", "3");
    assert.fieldEquals("Order", id, "filledQuantity", "0");
    assert.fieldEquals("Order", id, "cancelledQuantity", "5");
    assert.fieldEquals("Order", id, "status", "ACTIVE");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "totalQuantity", "3");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "orderCount", "1");
    assert.fieldEquals("Futures", "0", "activeOrders", "1");
  });

  test("amend to zero with no fills closes the order as CANCELLED", () => {
    const user = userAddress(1);
    const oid = bytes32Id(1);
    handleOrderCreated(createOrderCreatedEvent(oid, user, PRICE, BigInt.fromI32(4), DELIVERY));
    const update = createOrderUpdatedEvent(oid, user, BigInt.zero());
    handleOrderUpdated(update);

    const id = oid.toHexString();
    assert.fieldEquals("Order", id, "quantity", "0");
    assert.fieldEquals("Order", id, "filledQuantity", "0");
    assert.fieldEquals("Order", id, "cancelledQuantity", "4");
    assert.fieldEquals("Order", id, "status", "CANCELLED");
    assert.fieldEquals("Order", id, "closedAt", update.block.timestamp.toString());
    assert.fieldEquals("Order", id, "closedByTx", update.transaction.from.toHexString());
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "totalQuantity", "0");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "orderCount", "0");
    assert.fieldEquals("Futures", "0", "activeOrders", "0");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "0");
  });

  test("a second OrderUpdated on a terminal order is a no-op", () => {
    const user = userAddress(1);
    const oid = bytes32Id(1);
    handleOrderCreated(createOrderCreatedEvent(oid, user, PRICE, BigInt.fromI32(4), DELIVERY));
    handleOrderUpdated(createOrderUpdatedEvent(oid, user, BigInt.zero()));
    handleOrderUpdated(createOrderUpdatedEvent(oid, user, BigInt.zero()));

    // Counters must not double-decrement.
    assert.fieldEquals("Futures", "0", "activeOrders", "0");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "0");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "orderCount", "0");
  });

  test("OrderUpdated for unknown id is a no-op", () => {
    handleOrderUpdated(createOrderUpdatedEvent(bytes32Id(42), userAddress(1), BigInt.zero()));
    assert.entityCount("Order", 0);
  });
});
