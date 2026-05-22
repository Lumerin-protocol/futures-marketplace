/**
 * Integration test: ConfigUpdated flow (replaces per-field MakerFeeUpdated /
 * TakerFeeUpdated events).
 *
 * Deploy futures → bind Matchstick to the proxy → anchor → call
 * `setMakerFee(...)` / `setTakerFee(...)` → `index(read("Futures", "0"))` → assert.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseUnits } from "viem";
import { read, type EntityFields } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";

const conn = await network.getOrCreate();

describe("Futures ConfigUpdated Integration", () => {
  after(() => conn.matchstick.reset());

  it("indexes makerFee and takerFee updates", async () => {
    const { contracts, accounts } = await conn.networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    const newMakerFee = 4321n;
    const newTakerFee = 12345n;
    await futures.write.setMakerFee([newMakerFee], { account: owner.account });
    await futures.write.setTakerFee([newTakerFee], { account: owner.account });

    const [futuresEntity] = await conn.matchstick.index([read("Futures", "0")]);

    assert.ok(futuresEntity, "Futures#0 should exist after fee updates");
    assert.equal(futuresEntity.makerFee, newMakerFee.toString());
    assert.equal(futuresEntity.takerFee, newTakerFee.toString());
    assert.equal(futuresEntity.totalUsers, 0, "fee setters do not create users");
    assert.equal(conn.matchstick.eventCount, 2);
  });
});

describe("Futures: full config + address surface populated by loadFuturesFromContract", () => {
  after(() => conn.matchstick.reset());

  it("locks in every config field on the Futures singleton after a ConfigUpdated re-load", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault, hashrateOracle, portfolioMarginEngine } = contracts;
    const { owner, validator } = accounts;

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Trigger any ConfigUpdated-flavored setter; `handleConfigUpdated` reloads
    // the full snapshot from chain via `try_*` getters regardless of which
    // field changed.
    await futures.write.setMakerFee([config.makerFee], { account: owner.account });

    const [entity] = await conn.matchstick.index([read("Futures", "0")]);
    assert.ok(entity, "Futures#0 should exist after ConfigUpdated");

    // === id + addresses ===
    assert.equal(String(entity.id), "0", "Futures is a singleton at id=0");
    assert.equal(
      String(entity.contractAddress).toLowerCase(),
      futures.address.toLowerCase(),
      "contractAddress mirrors the proxy address Matchstick is bound to",
    );
    // `Futures.collateralToken` is sourced from `contract.collateralVault()`,
    // so it actually stores the vault proxy address (not the underlying USDC).
    // Schema field name is misleading; behavior locked in here.
    assert.equal(
      String(entity.collateralToken).toLowerCase(),
      collateralVault.address.toLowerCase(),
      "collateralToken is populated from collateralVault() getter (vault proxy address)",
    );
    assert.equal(
      String(entity.hashrateOracleAddress).toLowerCase(),
      hashrateOracle.address.toLowerCase(),
    );
    assert.equal(
      String(entity.marginEngineAddress).toLowerCase(),
      portfolioMarginEngine.address.toLowerCase(),
    );
    assert.equal(
      String(entity.validatorAddress).toLowerCase(),
      validator.account.address.toLowerCase(),
    );
    assert.equal(
      String(entity.validatorURL),
      "//shev8.validator:anything@stratum.braiins.com:3333",
    );

    // === scalar config ===
    assert.equal(String(entity.minimumPriceIncrement), config.priceLadderStep.toString());
    assert.equal(String(entity.makerFee), config.makerFee.toString());
    assert.equal(String(entity.takerFee), config.takerFee.toString());
    assert.equal(String(entity.liquidationFee), "0", "liquidationFee defaults to 0 in fixture");
    assert.equal(
      String(entity.liquidationMarginPercent),
      config.liquidationMarginPercent.toString(),
    );
    assert.equal(String(entity.speedHps), config.speedHps.toString());
    assert.equal(String(entity.deliveryDurationDays), config.deliveryDurationDays.toString());
    assert.equal(String(entity.deliveryIntervalDays), config.deliveryIntervalDays.toString());
    assert.equal(
      String(entity.futureDeliveryDatesCount),
      config.futureDeliveryDatesCount.toString(),
    );
    assert.equal(
      String(entity.firstFutureDeliveryDate),
      config.firstFutureDeliveryDate.toString(),
    );
    assert.equal(
      String(entity.breachPenaltyRatePerDay),
      "0",
      "breachPenaltyRatePerDay defaults to 0 in fixture",
    );
    assert.equal(
      String(entity.collectedFeesBalance),
      "0",
      "no matches yet → collectedFeesBalance is 0",
    );

    // `startBlock` is read from the data source context (set via env var
    // START_BLOCK_FUTURES). Matchstick never sets that context entry, so
    // `readStartBlockFromContext` falls back to BigInt.zero(); see store.ts.
    assert.equal(String(entity.startBlock), "0", "startBlock falls back to 0 in matchstick");

    // === metadata sentinels ===
    // `initializedAt` is set ONLY by `handleInitialized`, which fires on the
    // Initialized event the contract emits during deployment. Matchstick
    // anchors AFTER the fixture deploys, so that event is never replayed —
    // initializedAt stays at the BigInt.zero() default from store.ts.
    assert.equal(
      String(entity.initializedAt),
      "0",
      "initializedAt remains 0 in matchstick (anchor() happens after deploy)",
    );
    assert.ok(
      BigInt(String(entity.lastUpdatedAt)) > 0n,
      "lastUpdatedAt is bumped on every ConfigUpdated save (event.block.timestamp)",
    );
  });
});

// ============================================================================
// Trade.tradingFee + PositionSession.tradingFees: flat per-unit maker/taker fees
// (contract `_chargeMatchFees` transfers `makerFee` / `takerFee` once per
// matched unit — NOT price-scaled).
// ============================================================================
describe("Trade.tradingFee and PositionSession.tradingFees reflect makerFee/takerFee", () => {
  after(() => conn.matchstick.reset());

  it("Trade.tradingFee > 0 for both maker and taker after a real match", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, owner, pc } = accounts;

    // Override fixture default (makerFee=0) so BOTH sides should accrue a fee.
    const nonZeroMakerFee = parseUnits("0.5", 6);
    const nonZeroTakerFee = parseUnits("1", 6);
    await futures.write.setMakerFee([nonZeroMakerFee], { account: owner.account });
    await futures.write.setTakerFee([nonZeroTakerFee], { account: owner.account });

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: buyTx });

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const buyerAddr = buyer.account.address.toLowerCase() as `0x${string}`;

    const snap = await conn.matchstick.indexSnapshot([]);
    const trades = snap.saved("Trade");

    const sellerTrade = trades.find(
      (t: EntityFields) => String(t.user).toLowerCase() === sellerAddr,
    );
    const buyerTrade = trades.find(
      (t: EntityFields) => String(t.user).toLowerCase() === buyerAddr,
    );
    assert.ok(sellerTrade, "seller (maker) has a Trade row");
    assert.ok(buyerTrade, "buyer (taker) has a Trade row");

    assert.equal(
      String(sellerTrade.tradingFee),
      nonZeroMakerFee.toString(),
      "maker (resting seller) Trade.tradingFee = flat makerFee per unit",
    );
    assert.equal(
      String(buyerTrade.tradingFee),
      nonZeroTakerFee.toString(),
      "taker (incoming buyer) Trade.tradingFee = flat takerFee per unit",
    );
  });

  it("PositionSession.tradingFees > 0 after a real match", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, owner, pc } = accounts;

    const nonZeroMakerFee = parseUnits("0.5", 6);
    const nonZeroTakerFee = parseUnits("1", 6);
    await futures.write.setMakerFee([nonZeroMakerFee], { account: owner.account });
    await futures.write.setTakerFee([nonZeroTakerFee], { account: owner.account });

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: buyTx });

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const buyerAddr = buyer.account.address.toLowerCase() as `0x${string}`;

    const snap = await conn.matchstick.indexSnapshot([]);
    const sessions = snap.saved("PositionSession");

    const sellerSession = sessions.find(
      (s: EntityFields) => String(s.user).toLowerCase() === sellerAddr,
    );
    const buyerSession = sessions.find(
      (s: EntityFields) => String(s.user).toLowerCase() === buyerAddr,
    );
    assert.ok(sellerSession);
    assert.ok(buyerSession);

    assert.equal(
      String(sellerSession.tradingFees),
      nonZeroMakerFee.toString(),
      "maker PositionSession.tradingFees accumulates flat makerFee on open",
    );
    assert.equal(
      String(buyerSession.tradingFees),
      nonZeroTakerFee.toString(),
      "taker PositionSession.tradingFees accumulates flat takerFee on open",
    );
  });
});
