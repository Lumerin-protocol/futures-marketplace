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
  PositionCreated,
  PositionDeliveryClosed,
  PositionClosed,
} from "../generated/Futures/Futures";
import { handlePositionCreated, handlePositionDeliveryClosed, handlePositionClosed } from "../src/handlers/positions";
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
const DELIVERY = BigInt.fromI64(1_700_000_000);
// Matchstick mock event has block.number=1, logIndex=1.
const SELLER_SESSION = "00000000000100000100";
const BUYER_SESSION = "00000000000100000101";

function createPositionCreatedEvent(
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
    paramString("destURL", "u1"),
    paramBytes("orderId", orderId),
    paramBytes("takerOrderId", takerOrderId),
  ]);
}

function createPositionDeliveryClosedEvent(
  positionId: Bytes,
  closedBy: Address,
): PositionDeliveryClosed {
  return newTypedMockEventWithParams<PositionDeliveryClosed>([
    paramBytes("positionId", positionId),
    paramAddr("closedBy", closedBy),
  ]);
}

function createPositionClosedEvent(positionId: Bytes): PositionClosed {
  return newTypedMockEventWithParams<PositionClosed>([
    paramBytes("positionId", positionId),
  ]);
}

describe("PositionClosed/PositionDeliveryClosed netQuantity bookkeeping", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures(/* deliveryDurationDays */ 30);
  });

  test("PositionDeliveryClosed decrements UserDeliverySessionPointer.netQuantity for both sides", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    const positionId = bytes32Id(1);
    const orderId = bytes32Id(11);
    const takerOrderId = bytes32Id(21);

    // 1. Open a position: seller -1, buyer +1
    handlePositionCreated(
      createPositionCreatedEvent(positionId, seller, buyer, orderId, takerOrderId),
    );

    // Verify initial state
    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(seller, DELIVERY),
      "netQuantity",
      "-1",
    );
    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(buyer, DELIVERY),
      "netQuantity",
      "1",
    );
    assert.fieldEquals("PositionSession", SELLER_SESSION, "netQuantity", "-1");
    assert.fieldEquals("PositionSession", BUYER_SESSION, "netQuantity", "1");

    // 2. Close via delivery (this is the bug - netQuantity should go back to 0)
    handlePositionDeliveryClosed(createPositionDeliveryClosedEvent(positionId, buyer));

    // After delivery close, net quantities should be 0 for both sides
    // THIS IS THE BUG: currently the indexer does NOT update these values
    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(seller, DELIVERY),
      "netQuantity",
      "0",
    );
    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(buyer, DELIVERY),
      "netQuantity",
      "0",
    );
    assert.fieldEquals("PositionSession", SELLER_SESSION, "netQuantity", "0");
    assert.fieldEquals("PositionSession", BUYER_SESSION, "netQuantity", "0");
    assert.fieldEquals("PositionSession", SELLER_SESSION, "status", "CLOSE");
    assert.fieldEquals("PositionSession", BUYER_SESSION, "status", "CLOSE");
  });

  test("PositionClosed decrements UserDeliverySessionPointer.netQuantity for both sides", () => {
    const seller = userAddress(3);
    const buyer = userAddress(4);
    const positionId = bytes32Id(2);
    const orderId = bytes32Id(12);
    const takerOrderId = bytes32Id(22);

    // 1. Open a position
    handlePositionCreated(
      createPositionCreatedEvent(positionId, seller, buyer, orderId, takerOrderId),
    );

    // 2. Close via PositionClosed
    handlePositionClosed(createPositionClosedEvent(positionId));

    // After close, net quantities should be 0
    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(seller, DELIVERY),
      "netQuantity",
      "0",
    );
    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(buyer, DELIVERY),
      "netQuantity",
      "0",
    );
  });

  test("multiple positions: closing one decrements netQuantity correctly", () => {
    const seller = userAddress(5);
    const buyer1 = userAddress(6);
    const buyer2 = userAddress(7);

    // Create two positions: seller sells 2 units total
    handlePositionCreated(
      createPositionCreatedEvent(bytes32Id(1), seller, buyer1, bytes32Id(11), bytes32Id(21)),
    );
    handlePositionCreated(
      createPositionCreatedEvent(bytes32Id(2), seller, buyer2, bytes32Id(12), bytes32Id(22)),
    );

    // Seller should have netQuantity = -2
    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(seller, DELIVERY),
      "netQuantity",
      "-2",
    );

    // Close first position
    handlePositionDeliveryClosed(createPositionDeliveryClosedEvent(bytes32Id(1), buyer1));

    // Seller should now have netQuantity = -1 (only second position remains)
    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(seller, DELIVERY),
      "netQuantity",
      "-1",
    );

    // Close second position
    handlePositionDeliveryClosed(createPositionDeliveryClosedEvent(bytes32Id(2), buyer2));

    // Seller should now have netQuantity = 0
    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(seller, DELIVERY),
      "netQuantity",
      "0",
    );
  });
});
