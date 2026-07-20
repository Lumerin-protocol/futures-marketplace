import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { OrderCreated } from "../generated/Futures/Futures";
import { handleOrderCreated } from "../src/handlers/orders";
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
  deliveryAt: BigInt,
): OrderCreated {
  return newTypedMockEventWithParams<OrderCreated>([
    paramBytes("orderId", orderId),
    paramAddr("participant", participant),
    paramUint("price", price),
    paramInt("quantity", quantity),
    paramUint("deliveryAt", deliveryAt),
  ]);
}

describe("handleOrderCreated", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("creates User, Order, OrderEntry, PriceLevel and bumps Futures stats", () => {
    const user = userAddress(1);
    const oid = bytes32Id(1);
    handleOrderCreated(createOrderCreatedEvent(oid, user, PRICE, BigInt.fromI32(1), DELIVERY));

    const aggId = orderAggKeyDefaultTx(user, PRICE, DELIVERY, true);

    assert.entityCount("User", 1);
    assert.entityCount("Order", 1);
    assert.entityCount("OrderEntry", 1);
    assert.entityCount("PriceLevel", 1);

    assert.fieldEquals("Order", aggId, "user", user.toHexString());
    assert.fieldEquals("Order", aggId, "isBuy", "true");
    assert.fieldEquals("Order", aggId, "price", PRICE.toString());
    assert.fieldEquals("Order", aggId, "deliveryAt", DELIVERY.toString());
    assert.fieldEquals("Order", aggId, "quantity", "1");
    assert.fieldEquals("Order", aggId, "originalQuantity", "1");
    assert.fieldEquals("Order", aggId, "filledQuantity", "0");
    assert.fieldEquals("Order", aggId, "cancelledQuantity", "0");
    assert.fieldEquals("Order", aggId, "status", "ACTIVE");

    assert.fieldEquals("OrderEntry", oid.toHexString(), "order", aggId);
    assert.fieldEquals("OrderEntry", oid.toHexString(), "remainingQuantity", "1");
    assert.fieldEquals("OrderEntry", oid.toHexString(), "status", "ACTIVE");

    const plKey = priceLevelKey(DELIVERY, PRICE, true);
    assert.fieldEquals("PriceLevel", plKey, "totalQuantity", "1");
    assert.fieldEquals("PriceLevel", plKey, "isBid", "true");
    assert.fieldEquals("PriceLevel", plKey, "price", PRICE.toString());

    assert.fieldEquals("Futures", "0", "totalUsers", "1");
    assert.fieldEquals("Futures", "0", "totalOrders", "1");
    assert.fieldEquals("Futures", "0", "activeOrders", "1");
    assert.fieldEquals("User", user.toHexString(), "orderCount", "1");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "1");
  });

  test("qty=3 in one event creates a single OrderEntry with remainingQuantity=3", () => {
    const user = userAddress(1);
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(1), user, PRICE, BigInt.fromI32(3), DELIVERY));

    const aggId = orderAggKeyDefaultTx(user, PRICE, DELIVERY, true);
    assert.entityCount("Order", 1);
    assert.entityCount("OrderEntry", 1);
    assert.fieldEquals("Order", aggId, "quantity", "3");
    assert.fieldEquals("Order", aggId, "originalQuantity", "3");
    assert.fieldEquals("OrderEntry", bytes32Id(1).toHexString(), "remainingQuantity", "3");

    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "totalQuantity", "3");

    assert.fieldEquals("Futures", "0", "totalOrders", "1");
    assert.fieldEquals("Futures", "0", "activeOrders", "1");
    assert.fieldEquals("User", user.toHexString(), "orderCount", "1");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "1");
  });

  test("negative quantity creates a sell-side Order aggregate", () => {
    const user = userAddress(1);
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(1), user, PRICE, BigInt.fromI32(-2), DELIVERY));

    const aggId = orderAggKeyDefaultTx(user, PRICE, DELIVERY, false);
    assert.fieldEquals("Order", aggId, "isBuy", "false");
    assert.fieldEquals("Order", aggId, "quantity", "2");
    assert.fieldEquals("OrderEntry", bytes32Id(1).toHexString(), "remainingQuantity", "2");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, false), "totalQuantity", "2");
  });

  test("different (price, side, deliveryAt) tuples create separate Order aggregates", () => {
    const user = userAddress(1);
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(1), user, PRICE, BigInt.fromI32(1), DELIVERY));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(2), user, PRICE.plus(BigInt.fromI32(1)), BigInt.fromI32(1), DELIVERY));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(3), user, PRICE, BigInt.fromI32(-1), DELIVERY));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(4), user, PRICE, BigInt.fromI32(1), DELIVERY.plus(BigInt.fromI32(86400))));

    assert.entityCount("Order", 4);
    assert.entityCount("OrderEntry", 4);
    assert.entityCount("PriceLevel", 4);
    assert.fieldEquals("Futures", "0", "totalOrders", "4");
    assert.fieldEquals("Futures", "0", "activeOrders", "4");
    assert.fieldEquals("User", user.toHexString(), "orderCount", "4");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "4");
  });
});
