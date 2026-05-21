/**
 * Integration tests: liquidation and bad-debt events.
 *
 * Verifies that Liquidation and BadDebtEvent entities are created correctly,
 * that the lot is marked closed, and that the liquidated user's
 * UserDeliverySessionPointer.netQuantity reaches 0.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { EntityFields, read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice, scaleHashprice } from "../../contracts/tests/utils.ts";
import { assertHexHash } from "./helpers.ts";

const conn = await network.create({ override: { loggingEnabled: true } });
const { matchstick } = conn;

// ---------------------------------------------------------------------------
// Test 1: marginCall — Liquidation entity created, position closed, netQty=0
// ---------------------------------------------------------------------------
describe("marginCall: Liquidation entity, position closed, seller netQty=0", () => {
  after(() => matchstick.reset());

  it("after marginCall the Liquidation entity exists and seller pointer is reset to 0", async () => {
    const { contracts, accounts, config } =
      await conn.networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault, hashrateOracle } = contracts;
    const { seller, buyer, validator, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    matchstick.bind("Futures", futures.address, futures.abi);
    await matchstick.captureViewMocks();
    // await matchstick.anchor();

    // Open one position: seller is short
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const [lotCreated] = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const lotId = lotCreated.args.lotId.toLowerCase() as `0x${string}`;

    // Crash the market price 40x → seller's unrealized loss (~938 USDC) exceeds
    // their margin (~61 USDC free) by far; PME 20% IM threshold is breached.
    // scaleHashprice updates the oracle price and updatedAt in one call.
    await scaleHashprice(hashrateOracle, 40n, 1n);

    console.log("seller, short, loss ", seller.account.address);
    const liqTx = await futures.write.marginCall([seller.account.address], {
      account: validator.account,
    });
    const liqReceipt = await pc.waitForTransactionReceipt({ hash: liqTx });

    // The on-chain tx must contain a Liquidation event
    const liqEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "Liquidation",
    });
    assert.equal(liqEvents.length, 1, "marginCall must emit exactly 1 Liquidation event");

    const lotLiquidatedEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "LotLiquidated",
    });
    assert.equal(lotLiquidatedEvents.length, 1, "marginCall must emit exactly 1 LotLiquidated");
    const lotLiquidated = lotLiquidatedEvents[0];
    assert.equal(lotLiquidated.args.lotId.toLowerCase(), lotId);

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const validatorAddr = validator.account.address.toLowerCase() as `0x${string}`;

    const snap = await matchstick.indexSnapshot([]);

    // --- Liquidation entity ---
    const liquidations = snap.saved("Liquidation");
    assert.equal(liquidations.length, 1, "exactly 1 Liquidation entity");

    const [liq] = liquidations;
    assert.equal(liq.user, sellerAddr, "Liquidation.user must be the liquidated seller");
    assert.equal(liq.liquidator, validatorAddr, "Liquidation.liquidator must be the validator");

    // The seller was short and price spiked → significant realized loss
    assert.ok(
      BigInt(String(liq.realizedPnl)) < 0n,
      `Liquidation.realizedPnl must be negative (seller loss): got ${liq.realizedPnl}`,
    );

    // realizedPnl must mirror the on-chain Liquidation event payload.
    assert.equal(
      String(liq.realizedPnl),
      String(liqEvents[0].args.realizedPnl),
      "Liquidation.realizedPnl must match the on-chain event",
    );
    assert.equal(
      String(liq.reclaimedMargin),
      String(liqEvents[0].args.reclaimedMargin),
      "Liquidation.reclaimedMargin must match the on-chain event",
    );
    assert.ok(
      BigInt(String(liq.blockNumber)) > 0n,
      "Liquidation.blockNumber must be set from the receipt",
    );
    assertHexHash(liq.transactionHash, "Liquidation.transactionHash");

    // --- Lot closed ---
    const lot = snap.entity("Lot", lotId);
    assert.ok(lot);
    assert.equal(lot.status, "CLOSED", "Lot must be closed after liquidation");
    assert.equal(lot.closeReason, "LIQUIDATION");
    assert.equal(lot.isClosed, true);
    assert.equal(
      String(lot.liquidatedParticipant).toLowerCase(),
      sellerAddr,
      "Lot.liquidatedParticipant must match the LotLiquidated event participant",
    );
    assert.equal(
      String(lot.liquidator).toLowerCase(),
      validatorAddr,
      "Lot.liquidator must match the LotLiquidated event liquidator (msg.sender)",
    );
    assert.equal(
      String(lot.liquidationFee),
      String(lotLiquidated.args.fee),
      "Lot.liquidationFee must mirror the on-chain LotLiquidated.fee",
    );

    // --- Pointer: seller must be flat ---
    let sellerPtr: EntityFields | undefined;
    let buyerPtr: EntityFields | undefined;

    for (const ptr of snap.saved("UserDeliverySessionPointer")) {
      if (ptr.user === sellerAddr) {
        sellerPtr = ptr;
      } else {
        buyerPtr = ptr;
      }
    }
    assert.ok(sellerPtr);
    assert.equal(String(sellerPtr.netQuantity), "0", "seller netQty must be 0 after liquidation");

    // Buyer's position is also closed (marginCall closes both sides)
    assert.ok(buyerPtr);
    assert.equal(
      String(buyerPtr.netQuantity),
      "0",
      "buyer netQty must be 0 (position closed for both sides)",
    );

    // --- Futures counter ---
    const futuresEntity = snap.entity("Futures", "0");
    assert.ok(futuresEntity);
    assert.equal(
      String(futuresEntity.totalLiquidations),
      "1",
      "Futures.totalLiquidations must be 1",
    );

    // --- User realizedPnl updated ---
    const sellerUser = snap.entity("User", sellerAddr);
    assert.ok(sellerUser);
    console.log(sellerUser);
    assert.ok(
      BigInt(String(sellerUser.realizedPnl)) < 0n,
      `seller User.realizedPnl must be negative after liquidation: got ${sellerUser.realizedPnl}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2: BadDebt — BadDebtEvent entity when losses exceed coverage
// ---------------------------------------------------------------------------
describe("BadDebt: BadDebtEvent entity when losses exceed participant balance + insurance fund", () => {
  after(() => matchstick.reset());

  it("BadDebtEvent is created and Futures.totalBadDebt is non-zero", async () => {
    const { contracts, accounts, config } =
      await conn.networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault, hashrateOracle } = contracts;
    const { seller, buyer, validator, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    // Deposit minimum margin (1000 USDC) — insurance fund has 10 000 USDC.
    // At 500x price the loss is ~12 000 USDC which exceeds 1 000 + 10 000 → BadDebt.
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    matchstick.bind("Futures", futures.address, futures.abi);
    await matchstick.captureViewMocks();
    await matchstick.anchor();

    // Open one short position for the seller
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const [lotCreated] = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const lotId = lotCreated.args.lotId.toLowerCase() as `0x${string}`;

    // Spike price by 500x — loss (~12 015 USDC) exceeds seller (1 000) + insurance fund (10 000)
    await scaleHashprice(hashrateOracle, 500n, 1n);

    const liqTx = await futures.write.marginCall([seller.account.address], {
      account: validator.account,
    });
    const liqReceipt = await pc.waitForTransactionReceipt({ hash: liqTx });

    // The on-chain tx must contain a BadDebt event
    const badDebtEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "BadDebt",
    });
    console.log(badDebtEvents);
    assert.equal(badDebtEvents.length, 1, "must emit exactly 1 BadDebt event");
    const onChainAmount = badDebtEvents[0].args.amount;

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;

    const snap = await matchstick.indexSnapshot([]);

    // --- BadDebtEvent entity ---
    const badDebtEntities = snap.saved("BadDebtEvent");
    assert.equal(badDebtEntities.length, 1, "exactly 1 BadDebtEvent entity");
    const badDebt = badDebtEntities[0];
    assert.equal(badDebt.user, sellerAddr, "BadDebtEvent.user must be the seller");
    assert.equal(
      badDebt.amount,
      onChainAmount.toString(),
      "BadDebtEvent.amount must match on-chain event",
    );

    // --- Futures.totalBadDebt updated ---
    const futuresEntity = snap.entity("Futures", "0");
    assert.ok(futuresEntity);
    assert.equal(
      futuresEntity.totalBadDebt,
      onChainAmount.toString(),
      "Futures.totalBadDebt must equal the bad-debt amount",
    );
    assert.ok(
      BigInt(String(futuresEntity.totalBadDebt)) > 0n,
      "Futures.totalBadDebt must be positive",
    );

    // --- Liquidation entity also exists ---
    const liquidations = snap.saved("Liquidation");
    assert.equal(liquidations.length, 1, "1 Liquidation entity alongside the BadDebt");

    // --- Lot closed with LIQUIDATION metadata ---
    const lotLiquidatedEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "LotLiquidated",
    });
    assert.equal(lotLiquidatedEvents.length, 1, "marginCall must emit exactly 1 LotLiquidated");
    const lotLiquidated = lotLiquidatedEvents[0];
    const validatorAddr = validator.account.address.toLowerCase() as `0x${string}`;

    const lot = snap.entity("Lot", lotId);
    assert.ok(lot);
    assert.equal(lot.status, "CLOSED");
    assert.equal(
      lot.closeReason,
      "LIQUIDATION",
      "bad-debt path must still surface closeReason=LIQUIDATION",
    );
    assert.equal(lot.isClosed, true);
    assert.equal(String(lot.liquidatedParticipant).toLowerCase(), sellerAddr);
    assert.equal(String(lot.liquidator).toLowerCase(), validatorAddr);
    assert.equal(String(lot.liquidationFee), String(lotLiquidated.args.fee));
  });
});

// ---------------------------------------------------------------------------
// Test 3: multi-position liquidation in one tx — N LotLiquidated, 1 Liquidation
// ---------------------------------------------------------------------------
//
// `marginCall` force-closes all of a participant's positions FIFO in a single
// tx, emitting one `LotLiquidated` per position but a single `Liquidation`
// summary at the end. After matchstick-ts v0.3.0 each `LotLiquidated` carries
// its own `logIndex`, so the resulting per-Lot mutations don't collide on a
// shared mock log index — exercising that distinct path is the point of this
// test. The single `Liquidation` row stays unique because its id is
// `tx hash + logIndex` and each tx writes only one of them.
describe("marginCall with multiple positions: N LotLiquidated, 1 Liquidation summary", () => {
  after(() => matchstick.reset());

  it("closes both positions, marks both Lots LIQUIDATION, emits one Liquidation", async () => {
    const { contracts, accounts, config } =
      await conn.networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault, hashrateOracle } = contracts;
    const { seller, buyer, validator, pc } = accounts;

    const price1 = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const price2 = price1 + config.priceLadderStep;
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    matchstick.bind("Futures", futures.address, futures.abi);
    await matchstick.captureViewMocks();

    // Two short positions for the seller, at slightly different prices so the
    // book retains them as distinct lots.
    await futures.write.createOrder([price1, deliveryDate, "", -1], { account: seller.account });
    const buy1 = await futures.write.createOrder([price1, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    const r1 = await pc.waitForTransactionReceipt({ hash: buy1 });
    const [created1] = parseEventLogs({ logs: r1.logs, abi: futures.abi, eventName: "LotCreated" });

    await futures.write.createOrder([price2, deliveryDate, "", -1], { account: seller.account });
    const buy2 = await futures.write.createOrder([price2, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    const r2 = await pc.waitForTransactionReceipt({ hash: buy2 });
    const [created2] = parseEventLogs({ logs: r2.logs, abi: futures.abi, eventName: "LotCreated" });

    const lot1Id = created1.args.lotId.toLowerCase() as `0x${string}`;
    const lot2Id = created2.args.lotId.toLowerCase() as `0x${string}`;
    assert.notEqual(lot1Id, lot2Id, "two open lots must have distinct ids");

    // Crash the market so both positions are underwater for the seller.
    await scaleHashprice(hashrateOracle, 40n, 1n);

    const liqTx = await futures.write.marginCall([seller.account.address], {
      account: validator.account,
    });
    const liqReceipt = await pc.waitForTransactionReceipt({ hash: liqTx });

    const lotLiquidatedEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "LotLiquidated",
    });
    assert.equal(
      lotLiquidatedEvents.length,
      2,
      "marginCall must emit one LotLiquidated per position",
    );
    const liqEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "Liquidation",
    });
    assert.equal(
      liqEvents.length,
      1,
      "marginCall must emit exactly one Liquidation summary regardless of position count",
    );

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const snap = await matchstick.indexSnapshot([read("Lot", lot1Id), read("Lot", lot2Id)]);

    // --- Both lots closed via LIQUIDATION ---
    for (const id of [lot1Id, lot2Id]) {
      const lot = snap.entity("Lot", id);
      assert.ok(lot, `Lot ${id} must exist`);
      assert.equal(lot.status, "CLOSED");
      assert.equal(lot.closeReason, "LIQUIDATION");
      assert.equal(String(lot.liquidatedParticipant).toLowerCase(), sellerAddr);
    }

    // --- Exactly one Liquidation entity, with a distinct (tx, log) id ---
    const liquidations = snap.saved("Liquidation");
    assert.equal(
      liquidations.length,
      1,
      "one summary Liquidation per marginCall, even with multiple lots",
    );
    assertHexHash(liquidations[0].transactionHash, "Liquidation.transactionHash");

    // --- Futures.totalLiquidations counts the single summary, not the lots ---
    const futuresEntity = snap.entity("Futures", "0");
    assert.ok(futuresEntity);
    assert.equal(
      String(futuresEntity.totalLiquidations),
      "1",
      "Futures.totalLiquidations counts Liquidation events, not LotLiquidated events",
    );
  });
});
