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
  fillAggKey,
  nudgeTx,
  nudgedTxHash,
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
const ENTRY_PRICE = BigInt.fromI64(1_000_000);
const DURATION_DAYS = 30;

function positionCreated(
  positionId: Bytes,
  seller: Address,
  buyer: Address,
  price: BigInt,
): PositionCreated {
  return newTypedMockEventWithParams<PositionCreated>([
    paramBytes("positionId", positionId),
    paramAddr("seller", seller),
    paramAddr("buyer", buyer),
    paramUint("sellPricePerDay", price),
    paramUint("buyPricePerDay", price),
    paramUint("deliveryAt", DELIVERY),
    paramString("destURL", "u"),
    paramBytes("orderId", bytes32Id(99)),
    paramBytes("takerOrderId", bytes32Id(98)),
  ]);
}

function positionExited(
  positionId: Bytes,
  participant: Address,
  pnl: BigInt,
): PositionExited {
  return newTypedMockEventWithParams<PositionExited>([
    paramBytes("positionId", positionId),
    paramAddr("participant", participant),
    paramInt("pnl", pnl),
  ]);
}

describe("handlePositionExited", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures(DURATION_DAYS);
  });

  test("buyer exits a long: realized pnl recorded, position marked exited, session closes", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    const pid = bytes32Id(1);

    handlePositionCreated(positionCreated(pid, seller, buyer, ENTRY_PRICE));
    // Exit happens in a *later* tx — bump tx hash + block so the new Fill is distinct.
    const exitEvent = positionExited(pid, buyer, BigInt.fromI64(5_000_000 * DURATION_DAYS));
    nudgeTx(exitEvent, 2);
    const pnl = BigInt.fromI64(5_000_000 * DURATION_DAYS);
    handlePositionExited(exitEvent);

    assert.fieldEquals("Position", pid.toHexString(), "isExited", "true");
    assert.fieldEquals("Position", pid.toHexString(), "buyerExitPnl", pnl.toString());

    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, DELIVERY), "netQuantity", "0");
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, DELIVERY), "currentSessionId", "");

    const exitFillId = fillAggKey(nudgedTxHash(2), buyer, seller);
    assert.fieldEquals("Fill", exitFillId, "realizedPnl", pnl.toString());
    assert.fieldEquals("Fill", exitFillId, "fillQuantity", "-1");
    assert.fieldEquals("Fill", exitFillId, "netQuantityAfter", "0");

    assert.fieldEquals("User", buyer.toHexString(), "realizedPnl", pnl.toString());

    // Buyer's PositionSession (block=1, logIndex=1, side=1) transitions to CLOSE.
    const buyerSession = "00000000000100000101";
    assert.fieldEquals("PositionSession", buyerSession, "status", "CLOSE");
    assert.fieldEquals("PositionSession", buyerSession, "netQuantity", "0");
    assert.fieldEquals("PositionSession", buyerSession, "closedQuantity", "1");
    assert.fieldEquals("PositionSession", buyerSession, "realizedPnl", pnl.toString());

    assert.fieldEquals("Position", pid.toHexString(), "buyerExitFill", exitFillId);
  });

  test("seller exits a short: pnl recorded, sellerExitFill linked, session closes", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    const pid = bytes32Id(1);

    handlePositionCreated(positionCreated(pid, seller, buyer, ENTRY_PRICE));
    const exitEvent = positionExited(pid, seller, BigInt.fromI64(2_000_000 * DURATION_DAYS));
    nudgeTx(exitEvent, 2);
    const pnl = BigInt.fromI64(2_000_000 * DURATION_DAYS);
    handlePositionExited(exitEvent);

    assert.fieldEquals("Position", pid.toHexString(), "isExited", "true");
    assert.fieldEquals("Position", pid.toHexString(), "sellerExitPnl", pnl.toString());

    const sellerExitFillId = fillAggKey(nudgedTxHash(2), seller, buyer);
    assert.fieldEquals("Position", pid.toHexString(), "sellerExitFill", sellerExitFillId);
    assert.fieldEquals("Fill", sellerExitFillId, "fillQuantity", "1");
    assert.fieldEquals("Fill", sellerExitFillId, "realizedPnl", pnl.toString());

    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(seller, DELIVERY), "netQuantity", "0");
    assert.fieldEquals("User", seller.toHexString(), "realizedPnl", pnl.toString());
  });

  test("PositionExited for unknown positionId is a safe no-op", () => {
    handlePositionExited(positionExited(bytes32Id(99), userAddress(1), BigInt.fromI32(0)));
    assert.entityCount("Position", 0);
    assert.entityCount("Fill", 0);
  });
});
