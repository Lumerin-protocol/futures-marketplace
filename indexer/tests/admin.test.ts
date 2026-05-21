import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { BigInt } from "@graphprotocol/graph-ts";
import {
  MakerFeeUpdated,
  TakerFeeUpdated,
  ValidatorURLUpdated,
} from "../generated/Futures/Futures";
import {
  handleMakerFeeUpdated,
  handleTakerFeeUpdated,
  handleValidatorURLUpdated,
} from "../src/handlers/admin";
import {
  mockFuturesContractCallsAsReverted,
  paramString,
  paramUint,
  setupDataSourceMock,
  setupFutures,
} from "./helpers";

describe("admin handlers", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("handleMakerFeeUpdated updates Futures.makerFee", () => {
    const fee = BigInt.fromI64(42);
    handleMakerFeeUpdated(
      newTypedMockEventWithParams<MakerFeeUpdated>([paramUint("makerFee", fee)]),
    );
    assert.fieldEquals("Futures", "0", "makerFee", fee.toString());
  });

  test("handleTakerFeeUpdated updates Futures.takerFee", () => {
    const fee = BigInt.fromI64(7);
    handleTakerFeeUpdated(
      newTypedMockEventWithParams<TakerFeeUpdated>([paramUint("takerFee", fee)]),
    );
    assert.fieldEquals("Futures", "0", "takerFee", fee.toString());
  });

  test("handleValidatorURLUpdated updates Futures.validatorURL", () => {
    handleValidatorURLUpdated(
      newTypedMockEventWithParams<ValidatorURLUpdated>([
        paramString("validatorURL", "https://newvalidator.example"),
      ]),
    );
    assert.fieldEquals("Futures", "0", "validatorURL", "https://newvalidator.example");
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
    handleTakerFeeUpdated(
      newTypedMockEventWithParams<TakerFeeUpdated>([paramUint("takerFee", BigInt.fromI32(1))]),
    );
    assert.fieldEquals("Futures", "0", "startBlock", startBlock.toString());
  });
});
