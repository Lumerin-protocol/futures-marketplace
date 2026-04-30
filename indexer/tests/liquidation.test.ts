import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { BigInt } from "@graphprotocol/graph-ts";
import { BadDebt, Liquidation } from "../generated/Futures/Futures";
import { handleBadDebt, handleLiquidation } from "../src/handlers/liquidation";
import {
  eventIdHex,
  paramAddr,
  paramInt,
  paramUint,
  setupDataSourceMock,
  setupFutures,
  userAddress,
} from "./helpers";

describe("handleLiquidation", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("creates a Liquidation entity, bumps user pnl + Futures.totalLiquidations", () => {
    const user = userAddress(1);
    const liquidator = userAddress(2);
    const reclaim = BigInt.fromI64(500_000);
    const pnl = BigInt.fromI64(-250_000);

    handleLiquidation(
      newTypedMockEventWithParams<Liquidation>([
        paramAddr("participant", user),
        paramAddr("liquidator", liquidator),
        paramInt("reclaimedMargin", reclaim),
        paramInt("realizedPnl", pnl),
      ]),
    );

    const id = eventIdHex();
    assert.entityCount("Liquidation", 1);
    assert.fieldEquals("Liquidation", id, "user", user.toHexString());
    assert.fieldEquals("Liquidation", id, "liquidator", liquidator.toHexString());
    assert.fieldEquals("Liquidation", id, "reclaimedMargin", reclaim.toString());
    assert.fieldEquals("Liquidation", id, "realizedPnl", pnl.toString());

    assert.fieldEquals("User", user.toHexString(), "realizedPnl", pnl.toString());
    assert.fieldEquals("Futures", "0", "totalLiquidations", "1");
  });
});

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
