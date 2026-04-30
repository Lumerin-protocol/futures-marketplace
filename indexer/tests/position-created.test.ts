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
  fillAggKeyDefaultTx,
  paramAddr,
  paramBytes,
  paramString,
  paramUint,
  pointerKey,
  setupDataSourceMock,
  setupFutures,
  tradeAggKeyDefaultTx,
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
  price: BigInt,
  deliveryAt: BigInt,
  destURL: string,
  orderId: Bytes,
): PositionCreated {
  return newTypedMockEventWithParams<PositionCreated>([
    paramBytes("positionId", positionId),
    paramAddr("seller", seller),
    paramAddr("buyer", buyer),
    paramUint("sellPricePerDay", price),
    paramUint("buyPricePerDay", price),
    paramUint("deliveryAt", deliveryAt),
    paramString("destURL", destURL),
    paramBytes("orderId", orderId),
    paramBytes("takerOrderId", bytes32Id(0)),
  ]);
}

describe("handlePositionCreated", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures(/* deliveryDurationDays */ 30);
  });

  test("opens an OPEN PositionSession + Trade + Fill for both sides", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    handlePositionCreated(
      createPositionCreatedEvent(bytes32Id(1), seller, buyer, PRICE, DELIVERY, "u1", bytes32Id(11)),
    );

    assert.entityCount("Position", 1);
    assert.entityCount("Fill", 2);
    assert.entityCount("Trade", 2);
    assert.entityCount("PositionSession", 2);
    assert.entityCount("User", 2);

    // Seller side: net qty −1, entry == trade price.
    assert.fieldEquals("PositionSession", SELLER_SESSION, "user", seller.toHexString());
    assert.fieldEquals("PositionSession", SELLER_SESSION, "deliveryAt", DELIVERY.toString());
    assert.fieldEquals("PositionSession", SELLER_SESSION, "status", "OPEN");
    assert.fieldEquals("PositionSession", SELLER_SESSION, "entryPrice", PRICE.toString());
    assert.fieldEquals("PositionSession", SELLER_SESSION, "maxQuantity", "1");
    assert.fieldEquals("PositionSession", SELLER_SESSION, "closedQuantity", "0");

    // Buyer side: net qty +1.
    assert.fieldEquals("PositionSession", BUYER_SESSION, "user", buyer.toHexString());
    assert.fieldEquals("PositionSession", BUYER_SESSION, "status", "OPEN");

    // Per-(user, deliveryAt) pointer reflects net qty.
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(seller, DELIVERY), "netQuantity", "-1");
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(seller, DELIVERY), "currentSessionId", SELLER_SESSION);
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, DELIVERY), "netQuantity", "1");
    assert.fieldEquals("UserDeliverySessionPointer", pointerKey(buyer, DELIVERY), "currentSessionId", BUYER_SESSION);

    // Fills: each side has one fill of qty ±1 at PRICE.
    const sellerFillId = fillAggKeyDefaultTx(seller, buyer);
    const buyerFillId = fillAggKeyDefaultTx(buyer, seller);
    assert.fieldEquals("Fill", sellerFillId, "fillQuantity", "-1");
    assert.fieldEquals("Fill", sellerFillId, "fillPrice", PRICE.toString());
    assert.fieldEquals("Fill", sellerFillId, "netQuantityAfter", "-1");
    assert.fieldEquals("Fill", sellerFillId, "user", seller.toHexString());
    assert.fieldEquals("Fill", sellerFillId, "counterparty", buyer.toHexString());
    assert.fieldEquals("Fill", buyerFillId, "fillQuantity", "1");
    assert.fieldEquals("Fill", buyerFillId, "netQuantityAfter", "1");

    // Trade aggregate (per user) has fillCount=1.
    assert.fieldEquals("Trade", tradeAggKeyDefaultTx(seller), "fillCount", "1");
    assert.fieldEquals("Trade", tradeAggKeyDefaultTx(seller), "tradeQuantity", "-1");
    assert.fieldEquals("Trade", tradeAggKeyDefaultTx(buyer), "fillCount", "1");

    // Position canonical record links both fills.
    assert.fieldEquals("Position", bytes32Id(1).toHexString(), "buyer", buyer.toHexString());
    assert.fieldEquals("Position", bytes32Id(1).toHexString(), "seller", seller.toHexString());
    assert.fieldEquals("Position", bytes32Id(1).toHexString(), "buyerFill", buyerFillId);
    assert.fieldEquals("Position", bytes32Id(1).toHexString(), "sellerFill", sellerFillId);
    assert.fieldEquals("Position", bytes32Id(1).toHexString(), "isPaid", "false");
    assert.fieldEquals("Position", bytes32Id(1).toHexString(), "isExited", "false");
    assert.fieldEquals("Position", bytes32Id(1).toHexString(), "isClosed", "false");

    // Volume = price * deliveryDurationDays.
    const expectedVolume = PRICE.times(BigInt.fromI32(30));
    assert.fieldEquals("Futures", "0", "totalVolume", expectedVolume.toString());
    assert.fieldEquals("Futures", "0", "totalFills", "2");
    assert.fieldEquals("Futures", "0", "totalTrades", "2");
  });

  test("two PositionCreated events with the same counterparty in one tx aggregate into one Fill (qty=2)", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    handlePositionCreated(
      createPositionCreatedEvent(bytes32Id(1), seller, buyer, PRICE, DELIVERY, "u1", bytes32Id(11)),
    );
    handlePositionCreated(
      createPositionCreatedEvent(bytes32Id(2), seller, buyer, PRICE, DELIVERY, "u2", bytes32Id(12)),
    );

    assert.entityCount("Position", 2);
    assert.entityCount("Fill", 2);
    assert.entityCount("Trade", 2);
    // Same session continues — qty doubles, status still OPEN.
    assert.fieldEquals("PositionSession", SELLER_SESSION, "maxQuantity", "2");
    assert.fieldEquals("PositionSession", BUYER_SESSION, "maxQuantity", "2");

    const sellerFillId = fillAggKeyDefaultTx(seller, buyer);
    const buyerFillId = fillAggKeyDefaultTx(buyer, seller);
    assert.fieldEquals("Fill", sellerFillId, "fillQuantity", "-2");
    assert.fieldEquals("Fill", sellerFillId, "netQuantityAfter", "-2");
    assert.fieldEquals("Fill", buyerFillId, "fillQuantity", "2");
    assert.fieldEquals("Fill", buyerFillId, "netQuantityAfter", "2");

    assert.fieldEquals("Trade", tradeAggKeyDefaultTx(seller), "fillCount", "1");
    assert.fieldEquals("Trade", tradeAggKeyDefaultTx(seller), "tradeQuantity", "-2");
    assert.fieldEquals("Futures", "0", "totalFills", "2");
    assert.fieldEquals("Futures", "0", "totalTrades", "2");
  });

  test("buyer matches against two different sellers in one tx → one Trade, two Fills", () => {
    const seller1 = userAddress(1);
    const seller2 = userAddress(2);
    const buyer = userAddress(3);

    handlePositionCreated(
      createPositionCreatedEvent(bytes32Id(1), seller1, buyer, PRICE, DELIVERY, "u1", bytes32Id(11)),
    );
    handlePositionCreated(
      createPositionCreatedEvent(bytes32Id(2), seller2, buyer, PRICE, DELIVERY, "u2", bytes32Id(12)),
    );

    // Buyer participated in 2 fills (one per seller) but it's 1 Trade.
    assert.fieldEquals("Trade", tradeAggKeyDefaultTx(buyer), "fillCount", "2");
    assert.fieldEquals("Trade", tradeAggKeyDefaultTx(buyer), "tradeQuantity", "2");
    assert.fieldEquals("Trade", tradeAggKeyDefaultTx(buyer), "netQuantityAfter", "2");
    // One Fill per (buyer, sellerN) bucket.
    assert.fieldEquals("Fill", fillAggKeyDefaultTx(buyer, seller1), "fillQuantity", "1");
    assert.fieldEquals("Fill", fillAggKeyDefaultTx(buyer, seller2), "fillQuantity", "1");
    // Each seller gets their own Trade as well.
    assert.fieldEquals("Trade", tradeAggKeyDefaultTx(seller1), "fillCount", "1");
    assert.fieldEquals("Trade", tradeAggKeyDefaultTx(seller2), "fillCount", "1");
  });

  test("PositionCreated for a stranger orderId (no pre-existing OrderEntry) is a safe no-op for promotion", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    handlePositionCreated(
      createPositionCreatedEvent(bytes32Id(1), seller, buyer, PRICE, DELIVERY, "u", bytes32Id(99)),
    );
    assert.entityCount("Position", 1);
    assert.entityCount("OrderEntry", 0);
  });
});
