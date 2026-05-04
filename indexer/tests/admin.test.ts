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
  OrderFeeUpdated,
  ValidatorURLUpdated,
} from "../generated/Futures/Futures";
import {
  handleOrderFeeUpdated,
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

  test("handleOrderFeeUpdated updates Futures.orderFee", () => {
    const fee = BigInt.fromI64(42);
    handleOrderFeeUpdated(
      newTypedMockEventWithParams<OrderFeeUpdated>([paramUint("orderFee", fee)]),
    );
    assert.fieldEquals("Futures", "0", "orderFee", fee.toString());
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
    handleOrderFeeUpdated(
      newTypedMockEventWithParams<OrderFeeUpdated>([paramUint("orderFee", BigInt.fromI32(1))]),
    );
    assert.fieldEquals("Futures", "0", "startBlock", startBlock.toString());
  });
});
