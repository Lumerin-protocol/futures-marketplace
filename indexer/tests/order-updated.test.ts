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

    const aggId = orderAggKeyDefaultTx(user, PRICE, DELIVERY, true);
    assert.fieldEquals("Order", aggId, "quantity", "3");
    assert.fieldEquals("Order", aggId, "filledQuantity", "0");
    assert.fieldEquals("Order", aggId, "cancelledQuantity", "5");
    assert.fieldEquals("Order", aggId, "status", "ACTIVE");
    assert.fieldEquals("OrderEntry", oid.toHexString(), "remainingQuantity", "3");
    assert.fieldEquals("OrderEntry", oid.toHexString(), "status", "ACTIVE");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "totalQuantity", "3");
    assert.fieldEquals("Futures", "0", "activeOrders", "1");
  });
});
