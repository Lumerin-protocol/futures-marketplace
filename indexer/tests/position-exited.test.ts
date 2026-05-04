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
    // Historical entryPrice must survive the close (must NOT be reset to 0).
    assert.fieldEquals("PositionSession", buyerSession, "entryPrice", ENTRY_PRICE.toString());

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

    // Historical entryPrice must survive the close (must NOT be reset to 0).
    const sellerSession = "00000000000100000100";
    assert.fieldEquals("PositionSession", sellerSession, "status", "CLOSE");
    assert.fieldEquals("PositionSession", sellerSession, "entryPrice", ENTRY_PRICE.toString());
  });

  test("scale-in then full exit: closed session preserves the weighted-avg entryPrice", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);

    // Two opens at different prices → buyer's session has weighted-avg entry.
    const open1 = positionCreated(bytes32Id(1), seller, buyer, BigInt.fromI64(3_000_000));
    handlePositionCreated(open1);

    const open2 = positionCreated(bytes32Id(2), seller, buyer, BigInt.fromI64(4_000_000));
    nudgeTx(open2, 2);
    handlePositionCreated(open2);

    // Buyer session id is bound to block=1 / logIndex=1 / side=1 (the first open).
    const buyerSession = "00000000000100000101";
    const expectedEntry = BigInt.fromI64(3_500_000); // (3M + 4M) / 2
    assert.fieldEquals("PositionSession", buyerSession, "entryPrice", expectedEntry.toString());
    assert.fieldEquals("PositionSession", buyerSession, "netQuantity", "2");

    // Exit both units → session goes flat (closedQuantity == maxQuantity).
    const exit1 = positionExited(bytes32Id(1), buyer, BigInt.fromI64(1_000_000 * DURATION_DAYS));
    nudgeTx(exit1, 3);
    handlePositionExited(exit1);

    const exit2 = positionExited(bytes32Id(2), buyer, BigInt.fromI64(1_000_000 * DURATION_DAYS));
    nudgeTx(exit2, 4);
    handlePositionExited(exit2);

    assert.fieldEquals("PositionSession", buyerSession, "status", "CLOSE");
    assert.fieldEquals("PositionSession", buyerSession, "netQuantity", "0");
    assert.fieldEquals("PositionSession", buyerSession, "closedQuantity", "2");
    assert.fieldEquals("PositionSession", buyerSession, "maxQuantity", "2");
    // Regression: entryPrice must NOT be reset to 0 when the session closes.
    assert.fieldEquals("PositionSession", buyerSession, "entryPrice", expectedEntry.toString());
  });

  test("asymmetric scale-in: entryPrice is correctly qty-weighted (catches swapped-weight bugs)", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);

    // 3 opens at 2M followed by 1 open at 10M.
    // Correct weighted-avg:   (3*2M + 1*10M) / 4 = 4M
    // Swapped-weight bug:     (1*2M + 3*10M) / 4 = 8M (would be caught by this test)
    const priceLow = BigInt.fromI64(2_000_000);
    const priceHigh = BigInt.fromI64(10_000_000);

    const a = positionCreated(bytes32Id(1), seller, buyer, priceLow);
    handlePositionCreated(a);

    const b = positionCreated(bytes32Id(2), seller, buyer, priceLow);
    nudgeTx(b, 2);
    handlePositionCreated(b);

    const c = positionCreated(bytes32Id(3), seller, buyer, priceLow);
    nudgeTx(c, 3);
    handlePositionCreated(c);

    const d = positionCreated(bytes32Id(4), seller, buyer, priceHigh);
    nudgeTx(d, 4);
    handlePositionCreated(d);

    const buyerSession = "00000000000100000101";
    assert.fieldEquals("PositionSession", buyerSession, "netQuantity", "4");
    assert.fieldEquals("PositionSession", buyerSession, "entryPrice", "4000000");
  });

  test("partial close preserves entryPrice on the still-open session", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);

    handlePositionCreated(positionCreated(bytes32Id(1), seller, buyer, ENTRY_PRICE));
    const open2 = positionCreated(bytes32Id(2), seller, buyer, ENTRY_PRICE);
    nudgeTx(open2, 2);
    handlePositionCreated(open2);

    // Exit only one of the two units → session stays OPEN at netQuantity=1,
    // entryPrice must remain unchanged (reduce-same-direction branch).
    const exit1 = positionExited(bytes32Id(1), buyer, BigInt.fromI64(2_000_000 * DURATION_DAYS));
    nudgeTx(exit1, 3);
    handlePositionExited(exit1);

    const buyerSession = "00000000000100000101";
    assert.fieldEquals("PositionSession", buyerSession, "status", "OPEN");
    assert.fieldEquals("PositionSession", buyerSession, "netQuantity", "1");
    assert.fieldEquals("PositionSession", buyerSession, "closedQuantity", "1");
    assert.fieldEquals("PositionSession", buyerSession, "entryPrice", ENTRY_PRICE.toString());
  });

  test("break-even close (pnl=0) still bumps closedQuantity and updates closePrice", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);

    handlePositionCreated(positionCreated(bytes32Id(1), seller, buyer, ENTRY_PRICE));
    const open2 = positionCreated(bytes32Id(2), seller, buyer, ENTRY_PRICE);
    nudgeTx(open2, 2);
    handlePositionCreated(open2);

    // Exit at break-even (pnl=0 → derivePriceFromExit returns entryPrice → priceDiff=0).
    // closedQuantity, closePrice, and the realizedPnl-running-sum must still update.
    const exit1 = positionExited(bytes32Id(1), buyer, BigInt.fromI64(0));
    nudgeTx(exit1, 3);
    handlePositionExited(exit1);

    const buyerSession = "00000000000100000101";
    assert.fieldEquals("PositionSession", buyerSession, "status", "OPEN");
    assert.fieldEquals("PositionSession", buyerSession, "netQuantity", "1");
    assert.fieldEquals("PositionSession", buyerSession, "closedQuantity", "1");
    assert.fieldEquals("PositionSession", buyerSession, "closePrice", ENTRY_PRICE.toString());
    assert.fieldEquals("PositionSession", buyerSession, "realizedPnl", "0");
    assert.fieldEquals("PositionSession", buyerSession, "entryPrice", ENTRY_PRICE.toString());
  });

  test("close-then-reopen at a different price: new session entryPrice tracks new trade price", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);

    handlePositionCreated(positionCreated(bytes32Id(1), seller, buyer, ENTRY_PRICE));
    const exitEvent = positionExited(bytes32Id(1), buyer, BigInt.fromI64(0));
    nudgeTx(exitEvent, 2);
    handlePositionExited(exitEvent);

    // Reopen at a different price → new session must start at the new trade price,
    // not be polluted by the old (preserved) entry.
    const reopenPrice = BigInt.fromI64(7_000_000);
    const reopen = positionCreated(bytes32Id(2), seller, buyer, reopenPrice);
    nudgeTx(reopen, 3);
    handlePositionCreated(reopen);

    const oldSession = "00000000000100000101"; // first open, side=1 buyer
    const newSession = "00000000000300000301"; // second open after close
    assert.fieldEquals("PositionSession", oldSession, "status", "CLOSE");
    assert.fieldEquals("PositionSession", oldSession, "entryPrice", ENTRY_PRICE.toString());
    assert.fieldEquals("PositionSession", newSession, "status", "OPEN");
    assert.fieldEquals("PositionSession", newSession, "entryPrice", reopenPrice.toString());
  });

  test("PositionExited for unknown positionId is a safe no-op", () => {
    handlePositionExited(positionExited(bytes32Id(99), userAddress(1), BigInt.fromI32(0)));
    assert.entityCount("Position", 0);
    assert.entityCount("Fill", 0);
  });
});
