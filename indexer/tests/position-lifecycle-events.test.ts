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
  PositionClosed,
  PositionCreated,
  PositionDeliveryClosed,
  PositionPaid,
  PositionPaymentReceived,
} from "../generated/Futures/Futures";
import {
  handlePositionClosed,
  handlePositionCreated,
  handlePositionDeliveryClosed,
  handlePositionPaid,
  handlePositionPaymentReceived,
} from "../src/handlers/positions";
import {
  bytes32Id,
  paramAddr,
  paramBytes,
  paramString,
  paramUint,
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

describe("Position lifecycle events (paid / received / delivery-closed / closed)", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("PositionPaid flips isPaid; PositionPaymentReceived flips it back", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    const pid = bytes32Id(1);
    handlePositionCreated(positionCreated(pid, seller, buyer));

    handlePositionPaid(
      newTypedMockEventWithParams<PositionPaid>([paramBytes("positionId", pid)]),
    );
    assert.fieldEquals("Position", pid.toHexString(), "isPaid", "true");

    handlePositionPaymentReceived(
      newTypedMockEventWithParams<PositionPaymentReceived>([paramBytes("positionId", pid)]),
    );
    assert.fieldEquals("Position", pid.toHexString(), "isPaid", "false");
  });

  test("PositionDeliveryClosed records closedBy and isDeliveryClosed", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    const pid = bytes32Id(1);
    const liquidator = userAddress(7);
    handlePositionCreated(positionCreated(pid, seller, buyer));

    handlePositionDeliveryClosed(
      newTypedMockEventWithParams<PositionDeliveryClosed>([
        paramBytes("positionId", pid),
        paramAddr("closedBy", liquidator),
      ]),
    );
    assert.fieldEquals("Position", pid.toHexString(), "isDeliveryClosed", "true");
    assert.fieldEquals("Position", pid.toHexString(), "closedBy", liquidator.toHexString());
  });

  test("PositionClosed sets isClosed and closedAt", () => {
    const seller = userAddress(1);
    const buyer = userAddress(2);
    const pid = bytes32Id(1);
    handlePositionCreated(positionCreated(pid, seller, buyer));

    const ev = newTypedMockEventWithParams<PositionClosed>([paramBytes("positionId", pid)]);
    handlePositionClosed(ev);
    assert.fieldEquals("Position", pid.toHexString(), "isClosed", "true");
    assert.fieldEquals("Position", pid.toHexString(), "closedAt", ev.block.timestamp.toString());
  });

  test("All four lifecycle events for unknown positionId are safe no-ops", () => {
    const stranger = bytes32Id(99);
    handlePositionPaid(
      newTypedMockEventWithParams<PositionPaid>([paramBytes("positionId", stranger)]),
    );
    handlePositionPaymentReceived(
      newTypedMockEventWithParams<PositionPaymentReceived>([paramBytes("positionId", stranger)]),
    );
    handlePositionDeliveryClosed(
      newTypedMockEventWithParams<PositionDeliveryClosed>([
        paramBytes("positionId", stranger),
        paramAddr("closedBy", userAddress(1)),
      ]),
    );
    handlePositionClosed(
      newTypedMockEventWithParams<PositionClosed>([paramBytes("positionId", stranger)]),
    );
    assert.entityCount("Position", 0);
  });
});
