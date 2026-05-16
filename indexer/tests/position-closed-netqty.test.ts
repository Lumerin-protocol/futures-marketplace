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
import {
  handlePositionCreated,
  handlePositionDeliveryClosed,
  handlePositionClosed,
} from "../src/handlers/positions";
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

/// `PositionDeliveryClosed` is metadata-only at the indexer level — the
/// on-chain `closeDelivery` path emits `PositionExited` for BOTH sides BEFORE
/// `PositionClosed` (which co-fires with `PositionDeliveryClosed`), so the
/// netQuantity decrement is owned by `handlePositionExited`. See the
/// `applyPositionClosure` doc comment in `src/handlers/positions.ts` for the
/// full call-site map.
///
/// `handlePositionClosed` falls back to decrementing only when no
/// `PositionExited` ran for that side (the `resetState` admin path).
describe("PositionClosed/PositionDeliveryClosed netQuantity bookkeeping", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures(/* deliveryDurationDays */ 30);
  });

  test("PositionDeliveryClosed alone only stamps metadata (closeDelivery decrement happens via PositionExited)", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    const positionId = bytes32Id(1);
    const orderId = bytes32Id(11);
    const takerOrderId = bytes32Id(21);

    handlePositionCreated(
      createPositionCreatedEvent(positionId, seller, buyer, orderId, takerOrderId),
    );

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

    handlePositionDeliveryClosed(createPositionDeliveryClosedEvent(positionId, buyer));

    // netQuantity is unchanged — `PositionExited` (not modeled in this isolated
    // unit test) is what would zero it out on the real chain.
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
    // Metadata IS stamped: position is flagged as delivery-closed.
    assert.fieldEquals("Position", positionId.toHexString(), "isDeliveryClosed", "true");
    assert.fieldEquals("Position", positionId.toHexString(), "closedBy", buyer.toHexString());
  });

  test("PositionClosed without a prior PositionExited decrements both sides (resetState path)", () => {
    const seller = userAddress(3);
    const buyer = userAddress(4);
    const positionId = bytes32Id(2);
    const orderId = bytes32Id(12);
    const takerOrderId = bytes32Id(22);

    handlePositionCreated(
      createPositionCreatedEvent(positionId, seller, buyer, orderId, takerOrderId),
    );

    handlePositionClosed(createPositionClosedEvent(positionId));

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
    assert.fieldEquals("PositionSession", SELLER_SESSION, "status", "CLOSE");
    assert.fieldEquals("PositionSession", BUYER_SESSION, "status", "CLOSE");
  });

  test("multiple positions: PositionDeliveryClosed alone does not move netQuantity", () => {
    const seller = userAddress(5);
    const buyer1 = userAddress(6);
    const buyer2 = userAddress(7);

    handlePositionCreated(
      createPositionCreatedEvent(bytes32Id(1), seller, buyer1, bytes32Id(11), bytes32Id(21)),
    );
    handlePositionCreated(
      createPositionCreatedEvent(bytes32Id(2), seller, buyer2, bytes32Id(12), bytes32Id(22)),
    );

    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(seller, DELIVERY),
      "netQuantity",
      "-2",
    );

    // Delivery-closing without the co-emitted PositionExited leaves netQuantity
    // exactly where PositionExited would have left it on the real chain (here:
    // unchanged, because we don't simulate the exit step).
    handlePositionDeliveryClosed(createPositionDeliveryClosedEvent(bytes32Id(1), buyer1));
    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(seller, DELIVERY),
      "netQuantity",
      "-2",
    );

    handlePositionDeliveryClosed(createPositionDeliveryClosedEvent(bytes32Id(2), buyer2));
    assert.fieldEquals(
      "UserDeliverySessionPointer",
      pointerKey(seller, DELIVERY),
      "netQuantity",
      "-2",
    );
  });
});
