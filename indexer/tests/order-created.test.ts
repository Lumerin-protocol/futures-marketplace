import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { OrderCreated } from "../generated/HashPowerFutures/HashPowerFutures";
import { handleOrderCreated } from "../src/handlers/orders";
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

describe("handleOrderCreated", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("creates User, Order keyed by orderId, PriceLevel and bumps Futures stats", () => {
    const user = userAddress(1);
    const oid = bytes32Id(1);
    const event = createOrderCreatedEvent(oid, user, PRICE, BigInt.fromI32(1), DELIVERY);
    handleOrderCreated(event);

    const id = oid.toHexString();

    assert.entityCount("User", 1);
    assert.entityCount("Order", 1);
    assert.entityCount("PriceLevel", 1);

    assert.fieldEquals("Order", id, "user", user.toHexString());
    assert.fieldEquals("Order", id, "isBuy", "true");
    assert.fieldEquals("Order", id, "price", PRICE.toString());
    assert.fieldEquals("Order", id, "expirationAt", DELIVERY.toString());
    assert.fieldEquals("Order", id, "quantity", "1");
    assert.fieldEquals("Order", id, "originalQuantity", "1");
    assert.fieldEquals("Order", id, "filledQuantity", "0");
    assert.fieldEquals("Order", id, "cancelledQuantity", "0");
    assert.fieldEquals("Order", id, "averageFillPrice", "0");
    assert.fieldEquals("Order", id, "status", "ACTIVE");
    assert.fieldEquals("Order", id, "createdAt", event.block.timestamp.toString());
    assert.fieldEquals("Order", id, "transactionHash", event.transaction.hash.toHexString());

    // The taker side of OrderMatched is attributed via this breadcrumb.
    assert.fieldEquals("User", user.toHexString(), "lastCreatedOrderId", id);

    const plKey = priceLevelKey(DELIVERY, PRICE, true);
    assert.fieldEquals("PriceLevel", plKey, "totalQuantity", "1");
    assert.fieldEquals("PriceLevel", plKey, "orderCount", "1");
    assert.fieldEquals("PriceLevel", plKey, "isBid", "true");
    assert.fieldEquals("PriceLevel", plKey, "price", PRICE.toString());

    assert.fieldEquals("Futures", "0", "totalUsers", "1");
    assert.fieldEquals("Futures", "0", "totalOrders", "1");
    assert.fieldEquals("Futures", "0", "activeOrders", "1");
    assert.fieldEquals("User", user.toHexString(), "orderCount", "1");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "1");
  });

  test("qty=3 in one event books a single Order with quantity=3", () => {
    const user = userAddress(1);
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(1), user, PRICE, BigInt.fromI32(3), DELIVERY));

    const id = bytes32Id(1).toHexString();
    assert.entityCount("Order", 1);
    assert.fieldEquals("Order", id, "quantity", "3");
    assert.fieldEquals("Order", id, "originalQuantity", "3");

    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "totalQuantity", "3");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "orderCount", "1");

    assert.fieldEquals("Futures", "0", "totalOrders", "1");
    assert.fieldEquals("Futures", "0", "activeOrders", "1");
    assert.fieldEquals("User", user.toHexString(), "orderCount", "1");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "1");
  });

  test("negative quantity books a sell-side Order with the absolute quantity", () => {
    const user = userAddress(1);
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(1), user, PRICE, BigInt.fromI32(-2), DELIVERY));

    const id = bytes32Id(1).toHexString();
    assert.fieldEquals("Order", id, "isBuy", "false");
    assert.fieldEquals("Order", id, "quantity", "2");
    assert.fieldEquals("Order", id, "originalQuantity", "2");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, false), "totalQuantity", "2");
  });

  test("orders in one tx stay separate rows, one per orderId", () => {
    const user = userAddress(1);
    // Same (price, side, expirationAt) tuple twice: the old aggregate keying
    // would have collapsed these two into a single Order row.
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(1), user, PRICE, BigInt.fromI32(1), DELIVERY));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(2), user, PRICE, BigInt.fromI32(1), DELIVERY));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(3), user, PRICE, BigInt.fromI32(-1), DELIVERY));
    handleOrderCreated(createOrderCreatedEvent(bytes32Id(4), user, PRICE, BigInt.fromI32(1), DELIVERY.plus(BigInt.fromI32(86400))));

    assert.entityCount("Order", 4);
    // (PRICE, bid, DELIVERY) is shared by orders 1 and 2.
    assert.entityCount("PriceLevel", 3);
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "totalQuantity", "2");
    assert.fieldEquals("PriceLevel", priceLevelKey(DELIVERY, PRICE, true), "orderCount", "2");
    assert.fieldEquals("Futures", "0", "totalOrders", "4");
    assert.fieldEquals("Futures", "0", "activeOrders", "4");
    assert.fieldEquals("User", user.toHexString(), "orderCount", "4");
    assert.fieldEquals("User", user.toHexString(), "activeOrderCount", "4");
  });
});
