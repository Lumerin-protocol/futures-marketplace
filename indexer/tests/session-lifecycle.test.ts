import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { PositionCreated, PositionExited } from "../generated/Futures/Futures";
import {
  handlePositionCreated,
  handlePositionExited,
} from "../src/handlers/positions";
import {
  bytes32Id,
  paramAddr,
  paramBytes,
  paramInt,
  paramString,
  paramUint,
  pointerKey,
  setupDataSourceMock,
  setupFutures,
  userAddress,
} from "./helpers";

const DELIVERY = BigInt.fromI64(1_700_000_000);
const PRICE = BigInt.fromI64(1_000_000);

function positionCreated(positionId: Bytes, seller: Address, buyer: Address): PositionCreated {
  return newTypedMockEventWithParams<PositionCreated>([
    paramBytes("positionId", positionId),
    paramAddr("seller", seller),
    paramAddr("buyer", buyer),
    paramUint("sellPricePerDay", PRICE),
    paramUint("buyPricePerDay", PRICE),
    paramUint("deliveryAt", DELIVERY),
    paramString("destURL", "u"),
    paramBytes("orderId", bytes32Id(99)),
    paramBytes("takerOrderId", bytes32Id(98)),
  ]);
}

function positionExited(positionId: Bytes, participant: Address, pnl: BigInt): PositionExited {
  return newTypedMockEventWithParams<PositionExited>([
    paramBytes("positionId", positionId),
    paramAddr("participant", participant),
    paramInt("pnl", pnl),
  ]);
}

describe("session lifecycle: open → close → reopen", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures(30);
  });

  test("buyer goes long, exits flat, then opens a new long → two distinct PositionSessions", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);

    // 1st block.
    const open1 = positionCreated(bytes32Id(1), seller, buyer);
    handlePositionCreated(open1);

    // Bump block.number / logIndex so the new session-id is distinct.
    const exit = positionExited(bytes32Id(1), buyer, BigInt.fromI32(0));
    exit.block.number = BigInt.fromI32(2);
    exit.logIndex = BigInt.fromI32(2);
    handlePositionExited(exit);
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, DELIVERY), "netQuantity", "0");
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, DELIVERY), "currentSessionId", "");

    const open2 = positionCreated(bytes32Id(2), seller, buyer);
    open2.block.number = BigInt.fromI32(3);
    open2.logIndex = BigInt.fromI32(3);
    handlePositionCreated(open2);

    // Two distinct buyer sessions — first CLOSE, second OPEN.
    const buyerSession1 = "00000000000100000101"; // block=1 logIndex=1 side=1
    const buyerSession2 = "00000000000300000301"; // block=3 logIndex=3 side=1
    assert.fieldEquals("PositionSession", buyerSession1, "status", "CLOSE");
    assert.fieldEquals("PositionSession", buyerSession1, "netQuantity", "0");
    assert.fieldEquals("PositionSession", buyerSession2, "status", "OPEN");
    assert.fieldEquals("PositionSession", buyerSession2, "netQuantity", "1");
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, DELIVERY), "netQuantity", "1");
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, DELIVERY), "currentSessionId", buyerSession2);
  });
});
