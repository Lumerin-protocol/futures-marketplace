import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { BigInt } from "@graphprotocol/graph-ts";
import { BadDebt } from "../generated/HashPowerFutures/HashPowerFutures";
import { handleBadDebt } from "../src/handlers/liquidation";
import {
  eventIdHex,
  paramAddr,
  paramUint,
  setupDataSourceMock,
  setupFutures,
  userAddress,
} from "./helpers";

describe("handleBadDebt", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("creates a BadDebtEvent entity and accumulates Futures.totalBadDebt", () => {
    const user = userAddress(3);
    const amount = BigInt.fromI64(123_456);

    handleBadDebt(
      newTypedMockEventWithParams<BadDebt>([
        paramAddr("account", user),
        paramUint("amount", amount),
      ]),
    );

    const id = eventIdHex();
    assert.entityCount("BadDebtEvent", 1);
    assert.fieldEquals("BadDebtEvent", id, "user", user.toHexString());
    assert.fieldEquals("BadDebtEvent", id, "amount", amount.toString());
    assert.fieldEquals("Futures", "0", "totalBadDebt", amount.toString());

    // Second event with a different logIndex accumulates totals.
    const ev2 = newTypedMockEventWithParams<BadDebt>([
      paramAddr("account", user),
      paramUint("amount", amount),
    ]);
    ev2.logIndex = BigInt.fromI32(2);
    handleBadDebt(ev2);
    const expected = amount.times(BigInt.fromI32(2));
    assert.fieldEquals("Futures", "0", "totalBadDebt", expected.toString());
    assert.entityCount("BadDebtEvent", 2);
  });
});
