import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { ConfigUpdated } from "../generated/Futures/Futures";
import { handleConfigUpdated } from "../src/handlers/admin";
import {
  mockFuturesContractCallsAsReverted,
  setupDataSourceMock,
  setupFutures,
  userAddress,
} from "./helpers";

function buildConfigParam(
  makerFee: BigInt,
  takerFee: BigInt,
  liquidationFee: BigInt,
  minimumPriceIncrement: BigInt,
  liquidationMarginPercent: i32,
  futureDeliveryDatesCount: i32,
  hashrateOracle: Address,
  marginEngine: Address,
): ethereum.EventParam {
  // Tuple field order MUST mirror the Solidity `Config` struct definition in
  // Futures.sol; matchstick decodes by position, not by name. Contract size is a
  // compile-time constant (CONTRACT_SIZE_HPS_DAY) and is not part of the config snapshot.
  const tuple = changetype<ethereum.Tuple>([
    ethereum.Value.fromUnsignedBigInt(makerFee),
    ethereum.Value.fromUnsignedBigInt(takerFee),
    ethereum.Value.fromUnsignedBigInt(liquidationFee),
    ethereum.Value.fromUnsignedBigInt(minimumPriceIncrement),
    ethereum.Value.fromI32(liquidationMarginPercent),
    ethereum.Value.fromI32(futureDeliveryDatesCount),
    ethereum.Value.fromAddress(hashrateOracle),
    ethereum.Value.fromAddress(marginEngine),
  ]);
  return new ethereum.EventParam("config", ethereum.Value.fromTuple(tuple));
}

describe("handleConfigUpdated", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("overwrites every config field with the event snapshot", () => {
    const ev = newTypedMockEventWithParams<ConfigUpdated>([
      buildConfigParam(
        BigInt.fromI64(42),
        BigInt.fromI64(7),
        BigInt.fromI64(99),
        BigInt.fromI64(100),
        80,
        4,
        userAddress(12),
        userAddress(13),
      ),
    ]);

    handleConfigUpdated(ev);

    assert.fieldEquals("Futures", "0", "makerFee", "42");
    assert.fieldEquals("Futures", "0", "takerFee", "7");
    assert.fieldEquals("Futures", "0", "liquidationFee", "99");
    assert.fieldEquals("Futures", "0", "minimumPriceIncrement", "100");
    assert.fieldEquals("Futures", "0", "liquidationMarginPercent", "80");
    assert.fieldEquals("Futures", "0", "futureDeliveryDatesCount", "4");
    assert.fieldEquals("Futures", "0", "hashrateOracleAddress", userAddress(12).toHexString());
    assert.fieldEquals("Futures", "0", "marginEngineAddress", userAddress(13).toHexString());
  });
});

describe("Futures.startBlock from data source context", () => {
  beforeEach(() => clearStore());

  test("getOrCreateFutures populates startBlock from the dataSource context", () => {
    const startBlock = BigInt.fromI64(222_848_905);
    setupDataSourceMock(startBlock);
    mockFuturesContractCallsAsReverted();
    // No setupFutures() — first handler invocation creates the singleton and
    // must read startBlock from the mocked data source context.
    const ev = newTypedMockEventWithParams<ConfigUpdated>([
      buildConfigParam(
        BigInt.zero(),
        BigInt.zero(),
        BigInt.zero(),
        BigInt.zero(),
        0,
        1,
        Address.zero(),
        Address.zero(),
      ),
    ]);
    handleConfigUpdated(ev);
    assert.fieldEquals("Futures", "0", "startBlock", startBlock.toString());
  });
});
