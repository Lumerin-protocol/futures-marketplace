import {
  assert,
  beforeEach,
  clearStore,
  createMockedFunction,
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
  contractAddress,
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

  test("handleOracleUpdated writes priceOracle", () => {
    const ev = newTypedMockEventWithParams<OracleUpdated>([
      paramAddress("newOracle", userAddress(12)),
    ]);
    handleOracleUpdated(ev);

    assert.fieldEquals("Futures", "0", "priceOracle", userAddress(12).toHexString());
  });

  test("handlePortfolioMarginUpdated writes portfolioMargin", () => {
    const ev = newTypedMockEventWithParams<PortfolioMarginUpdated>([
      paramAddress("newPortfolioMargin", userAddress(13)),
    ]);
    handlePortfolioMarginUpdated(ev);

    assert.fieldEquals("Futures", "0", "portfolioMargin", userAddress(13).toHexString());
  });
});

describe("Futures.collateralVault from the contract", () => {
  beforeEach(() => clearStore());

  test("getOrCreateFutures reads collateralVault off the vault() getter", () => {
    const vault = userAddress(21);
    setupDataSourceMock();
    mockFuturesContractCallsAsReverted();
    createMockedFunction(contractAddress(), "vault", "vault():(address)").returns([
      ethereum.Value.fromAddress(vault),
    ]);
    // No setupFutures() — the first handler invocation creates the singleton and
    // pulls the address snapshot off the chain.
    const ev = newTypedMockEventWithParams<MakerFeeBpsUpdated>([
      paramI32("newMakerFeeBps", 0),
    ]);
    handleMakerFeeBpsUpdated(ev);

    assert.fieldEquals("Futures", "0", "collateralVault", vault.toHexString());
  });

  // Deliberately not the on-chain 0: the default is also 0, so only a different
  // value proves the field came off the getter rather than the initializer.
  test("getOrCreateFutures reads quantityDecimals off the QUANTITY_DECIMALS() getter", () => {
    setupDataSourceMock();
    mockFuturesContractCallsAsReverted();
    createMockedFunction(
      contractAddress(),
      "QUANTITY_DECIMALS",
      "QUANTITY_DECIMALS():(uint8)",
    ).returns([ethereum.Value.fromI32(3)]);
    const ev = newTypedMockEventWithParams<MakerFeeBpsUpdated>([
      paramI32("newMakerFeeBps", 0),
    ]);
    handleMakerFeeBpsUpdated(ev);

    assert.fieldEquals("Futures", "0", "quantityDecimals", "3");
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
