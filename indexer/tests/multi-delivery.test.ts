import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { PositionCreated } from "../generated/Futures/Futures";
import { handlePositionCreated } from "../src/handlers/positions";
import {
  bytes32Id,
  paramAddr,
  paramBytes,
  paramString,
  paramUint,
  pointerKey,
  setupDataSourceMock,
  setupFutures,
  userAddress,
} from "./helpers";

const PRICE = BigInt.fromI64(1_000_000);

function positionCreated(
  positionId: Bytes,
  seller: Address,
  buyer: Address,
  deliveryAt: BigInt,
): PositionCreated {
  return newTypedMockEventWithParams<PositionCreated>([
    paramBytes("positionId", positionId),
    paramAddr("seller", seller),
    paramAddr("buyer", buyer),
    paramUint("sellPricePerDay", PRICE),
    paramUint("buyPricePerDay", PRICE),
    paramUint("deliveryAt", deliveryAt),
    paramString("destURL", "u"),
    paramBytes("orderId", bytes32Id(99)),
    paramBytes("takerOrderId", bytes32Id(98)),
  ]);
}

describe("multi-delivery sessions", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("same user with two delivery dates gets two distinct PositionSessions and two pointers", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    const d1 = BigInt.fromI64(1_700_000_000);
    const d2 = BigInt.fromI64(1_700_000_000 + 86_400 * 7);

    const e1 = positionCreated(bytes32Id(1), seller, buyer, d1);
    handlePositionCreated(e1);

    // Bump block + logIndex so the new sessions get distinct ids.
    const e2 = positionCreated(bytes32Id(2), seller, buyer, d2);
    e2.block.number = BigInt.fromI32(2);
    e2.logIndex = BigInt.fromI32(2);
    handlePositionCreated(e2);

    // Two pointers per user (one per deliveryAt).
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, d1), "netQuantity", "1");
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, d2), "netQuantity", "1");
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(seller, d1), "netQuantity", "-1");
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(seller, d2), "netQuantity", "-1");

    // Distinct sessions per (user, delivery).
    assert.entityCount("PositionSession", 4);
  });
});
