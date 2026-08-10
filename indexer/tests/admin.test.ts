import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { newTypedMockEventWithParams } from "matchstick-as/assembly/defaults";
import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  FutureExpirationDatesCountUpdated,
  LiquidationFeeBpsUpdated,
  LiquidatorShareBpsUpdated,
  MakerFeeBpsUpdated,
  OracleUpdated,
  PortfolioMarginUpdated,
  TakerFeeBpsUpdated,
} from "../generated/HashPowerFutures/HashPowerFutures";
import {
  handleFutureExpirationDatesCountUpdated,
  handleLiquidationFeeBpsUpdated,
  handleLiquidatorShareBpsUpdated,
  handleMakerFeeBpsUpdated,
  handleOracleUpdated,
  handlePortfolioMarginUpdated,
  handleTakerFeeBpsUpdated,
} from "../src/handlers/admin";
import {
  mockFuturesContractCallsAsReverted,
  setupDataSourceMock,
  setupFutures,
  userAddress,
} from "./helpers";

function paramI32(name: string, value: i32): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromI32(value));
}

function paramAddress(name: string, value: Address): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromAddress(value));
}

describe("per-field admin config handlers", () => {
  beforeEach(() => {
    clearStore();
    setupDataSourceMock();
    setupFutures();
  });

  test("handleMakerFeeBpsUpdated writes makerFeeBps", () => {
    const ev = newTypedMockEventWithParams<MakerFeeBpsUpdated>([
      paramI32("newMakerFeeBps", -5),
    ]);
    handleMakerFeeBpsUpdated(ev);

    assert.fieldEquals("Futures", "0", "makerFeeBps", "-5");
    assert.fieldEquals("Futures", "0", "lastUpdatedAt", ev.block.timestamp.toString());
  });

  test("handleTakerFeeBpsUpdated writes takerFeeBps", () => {
    const ev = newTypedMockEventWithParams<TakerFeeBpsUpdated>([
      paramI32("newTakerFeeBps", 25),
    ]);
    handleTakerFeeBpsUpdated(ev);

    assert.fieldEquals("Futures", "0", "takerFeeBps", "25");
  });

  test("handleLiquidationFeeBpsUpdated writes liquidationFeeBps", () => {
    const ev = newTypedMockEventWithParams<LiquidationFeeBpsUpdated>([
      paramI32("newLiquidationFeeBps", 50),
    ]);
    handleLiquidationFeeBpsUpdated(ev);

    assert.fieldEquals("Futures", "0", "liquidationFeeBps", "50");
  });

  test("handleLiquidatorShareBpsUpdated writes liquidatorShareBps", () => {
    const ev = newTypedMockEventWithParams<LiquidatorShareBpsUpdated>([
      paramI32("newLiquidatorShareBps", 2500),
    ]);
    handleLiquidatorShareBpsUpdated(ev);

    assert.fieldEquals("Futures", "0", "liquidatorShareBps", "2500");
  });

  test("handleFutureExpirationDatesCountUpdated writes futureExpirationDatesCount", () => {
    const ev = newTypedMockEventWithParams<FutureExpirationDatesCountUpdated>([
      paramI32("newFutureExpirationDatesCount", 4),
    ]);
    handleFutureExpirationDatesCountUpdated(ev);

    assert.fieldEquals("Futures", "0", "futureExpirationDatesCount", "4");
  });

  test("handleOracleUpdated writes hashrateOracleAddress", () => {
    const ev = newTypedMockEventWithParams<OracleUpdated>([
      paramAddress("newOracle", userAddress(12)),
    ]);
    handleOracleUpdated(ev);

    assert.fieldEquals("Futures", "0", "hashrateOracleAddress", userAddress(12).toHexString());
  });

  test("handlePortfolioMarginUpdated writes portfolioMarginAddress", () => {
    const ev = newTypedMockEventWithParams<PortfolioMarginUpdated>([
      paramAddress("newPortfolioMargin", userAddress(13)),
    ]);
    handlePortfolioMarginUpdated(ev);

    assert.fieldEquals("Futures", "0", "portfolioMarginAddress", userAddress(13).toHexString());
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
    const ev = newTypedMockEventWithParams<MakerFeeBpsUpdated>([
      paramI32("newMakerFeeBps", 0),
    ]);
    handleMakerFeeBpsUpdated(ev);

    assert.fieldEquals("Futures", "0", "startBlock", startBlock.toString());
  });
});
