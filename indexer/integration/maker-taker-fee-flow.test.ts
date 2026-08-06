/**
 * Integration test: the per-field admin config events (MakerFeeBpsUpdated /
 * TakerFeeBpsUpdated and friends) that replaced the monolithic ConfigUpdated.
 *
 * Deploy futures → bind Matchstick to the proxy → anchor → call
 * `setMakerFeeBps(...)` / `setTakerFeeBps(...)` → `index(read("Futures", "0"))`
 * → assert.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseUnits } from "viem";
import { read, type EntityFields } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { TimeInForce } from "../../contracts/tests/timeInForce.ts";

const conn = await network.getOrCreate();

const BPS = 10_000n;

describe("Futures fee config events", () => {
  after(() => conn.matchstick.reset());

  it("indexes makerFeeBps and takerFeeBps updates", async () => {
    const { contracts, accounts } = await conn.networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    const newMakerFeeBps = -5;
    const newTakerFeeBps = 25;
    // Taker first: `_validateFees` rejects a maker rebate that the current
    // taker fee cannot cover (makerFeeBps + takerFeeBps must stay >= 0).
    await futures.write.setTakerFeeBps([newTakerFeeBps], { account: owner.account });
    await futures.write.setMakerFeeBps([newMakerFeeBps], { account: owner.account });

    const [futuresEntity] = await conn.matchstick.index([read("Futures", "0")]);

    assert.ok(futuresEntity, "Futures#0 should exist after fee updates");
    assert.equal(futuresEntity.makerFeeBps, newMakerFeeBps);
    assert.equal(futuresEntity.takerFeeBps, newTakerFeeBps);
    assert.equal(futuresEntity.totalUsers, 0, "fee setters do not create users");
    assert.equal(conn.matchstick.eventCount, 2);
  });
});

describe("Futures: full config + address surface populated by loadFuturesFromContract", () => {
  after(() => conn.matchstick.reset());

  it("locks in every config field on the Futures singleton", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, hashpriceUsd, portfolioMarginEngine } = contracts;
    const { owner } = accounts;

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Any admin event will do: the per-field handler writes its own field, but
    // creating the singleton pulls the rest of the snapshot from the chain via
    // `try_*` getters (see `getOrCreateFutures`).
    await futures.write.setMakerFeeBps([config.makerFeeBps], { account: owner.account });

    const [entity] = await conn.matchstick.index([read("Futures", "0")]);
    assert.ok(entity, "Futures#0 should exist after a config event");

    // === id + addresses ===
    assert.equal(String(entity.id), "0", "Futures is a singleton at id=0");
    assert.equal(
      String(entity.contractAddress).toLowerCase(),
      futures.address.toLowerCase(),
      "contractAddress mirrors the proxy address Matchstick is bound to",
    );
    assert.equal(
      String(entity.hashrateOracleAddress).toLowerCase(),
      hashpriceUsd.address.toLowerCase(),
    );
    assert.equal(
      String(entity.portfolioMarginAddress).toLowerCase(),
      portfolioMarginEngine.address.toLowerCase(),
    );

    // === scalar config ===
    assert.equal(String(entity.minimumPriceIncrement), config.priceLadderStep.toString());
    assert.equal(String(entity.makerFeeBps), config.makerFeeBps.toString());
    assert.equal(String(entity.takerFeeBps), config.takerFeeBps.toString());
    assert.equal(String(entity.liquidationFeeBps), "0", "fixture leaves liquidationFeeBps at 0");
    // Contract size is a compile-time constant (CONTRACT_SIZE_HPS_DAY = 1e15), read from the
    // on-chain getter at bootstrap rather than emitted via a config event.
    assert.equal(String(entity.contractSizeHpsDay), "1000000000000000");
    assert.equal(String(entity.expirationIntervalDays), config.expirationIntervalDays.toString());
    assert.equal(
      String(entity.futureExpirationDatesCount),
      config.futureExpirationDatesCount.toString(),
    );
    assert.equal(
      String(entity.firstFutureExpirationDate),
      config.firstFutureExpirationDate.toString(),
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
      "lastUpdatedAt is bumped on every config save (event.block.timestamp)",
    );
  });
});

// ============================================================================
// Trade.tradingFee + PositionSession.tradingFees: maker/taker fees are basis
// points of the matched notional (`_executeMatch` computes
// `notional * feeBps / BPS`, where notional = price * fill).
// ============================================================================
describe("Trade.tradingFee and PositionSession.tradingFees reflect makerFeeBps/takerFeeBps", () => {
  after(() => conn.matchstick.reset());

  const makerFeeBps = 50;
  const takerFeeBps = 100;

  /** Deploy, set non-zero fees on both sides, and match a single contract. */
  async function matchOneContract() {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, owner, pc } = accounts;

    // Override the fixture default (0 bps) so BOTH sides accrue a fee.
    await futures.write.setMakerFeeBps([makerFeeBps], { account: owner.account });
    await futures.write.setTakerFeeBps([takerFeeBps], { account: owner.account });

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    const buyTx = await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: buyTx });

    // One contract filled, so the notional is just the trade price.
    return {
      sellerAddr: seller.account.address.toLowerCase() as `0x${string}`,
      buyerAddr: buyer.account.address.toLowerCase() as `0x${string}`,
      expectedMakerFee: (price * BigInt(makerFeeBps)) / BPS,
      expectedTakerFee: (price * BigInt(takerFeeBps)) / BPS,
    };
  }

  it("Trade.tradingFee > 0 for both maker and taker after a real match", async () => {
    const { sellerAddr, buyerAddr, expectedMakerFee, expectedTakerFee } =
      await matchOneContract();

    const snap = await conn.matchstick.indexSnapshot([]);
    const trades = snap.saved("Trade");

    const sellerTrade = trades.find(
      (t: EntityFields) => String(t.user).toLowerCase() === sellerAddr,
    );
    const buyerTrade = trades.find((t: EntityFields) => String(t.user).toLowerCase() === buyerAddr);
    assert.ok(sellerTrade, "seller (maker) has a Trade row");
    assert.ok(buyerTrade, "buyer (taker) has a Trade row");

    assert.equal(
      String(sellerTrade.tradingFee),
      expectedMakerFee.toString(),
      "maker (resting seller) Trade.tradingFee = notional * makerFeeBps / BPS",
    );
    assert.equal(
      String(buyerTrade.tradingFee),
      expectedTakerFee.toString(),
      "taker (incoming buyer) Trade.tradingFee = notional * takerFeeBps / BPS",
    );
  });

  it("PositionSession.tradingFees > 0 after a real match", async () => {
    const { sellerAddr, buyerAddr, expectedMakerFee, expectedTakerFee } =
      await matchOneContract();

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
      expectedMakerFee.toString(),
      "maker PositionSession.tradingFees accumulates the maker fee on open",
    );
    assert.equal(
      String(buyerSession.tradingFees),
      expectedTakerFee.toString(),
      "taker PositionSession.tradingFees accumulates the taker fee on open",
    );
  });
});
