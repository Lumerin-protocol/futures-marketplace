/**
 * Integration tests: liquidation + bad-debt events under the permissionless
 * keeper flow.
 *
 * Verifies that `LotLiquidated` + `LotClosed(LIQUIDATION)` populate the Lot
 * entity (liquidator / liquidationFee / liquidatedParticipant), that
 * `BadDebtEvent` is created when losses exceed coverage, and that
 * `Futures.totalLiquidations` is incremented once per tx via the
 * `LiquidationTx` dedup sentinel (regardless of how many legs the tx
 * contained).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData, parseEventLogs, parseUnits } from "viem";
import { EntityFields, read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice, scaleHashprice } from "../../contracts/tests/utils.ts";

const conn = await network.create({ override: { loggingEnabled: true } });
const { matchstick } = conn;

// ---------------------------------------------------------------------------
// Test 1: permissionless liquidatePosition — Lot closed, seller netQty=0
// ---------------------------------------------------------------------------
describe("liquidatePosition: Lot closed with LIQUIDATION, seller netQty=0", () => {
  after(() => matchstick.reset());

  it("populates Lot liquidator/fee + bumps Futures.totalLiquidations once per tx", async () => {
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

    // Crash hashprice 40x so seller is deeply underwater (PME-MM breached)
    await scaleHashprice(hashrateOracle, 40n, 1n);

    const liqTx = await futures.write.liquidatePosition([seller.account.address, lotId], {
      account: validator.account,
    });
    const liqReceipt = await pc.waitForTransactionReceipt({ hash: liqTx });

    const lotLiquidatedEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "LotLiquidated",
    });
    assert.equal(lotLiquidatedEvents.length, 1, "must emit exactly 1 LotLiquidated");
    const lotLiquidated = lotLiquidatedEvents[0];
    assert.equal(lotLiquidated.args.lotId.toLowerCase(), lotId);

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const validatorAddr = validator.account.address.toLowerCase() as `0x${string}`;

    const snap = await matchstick.indexSnapshot([]);

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
    assert.ok(buyerPtr);
    assert.equal(
      String(buyerPtr.netQuantity),
      "0",
      "buyer netQty must be 0 (cash-settled both sides)",
    );

    const futuresEntity = snap.entity("Futures", "0");
    assert.ok(futuresEntity);
    assert.equal(
      String(futuresEntity.totalLiquidations),
      "1",
      "Futures.totalLiquidations must be 1 after one liquidation tx",
    );

    // Dedup sentinel created exactly once per tx
    const liquidationTxs = snap.saved("LiquidationTx");
    assert.equal(liquidationTxs.length, 1, "exactly 1 LiquidationTx sentinel per liquidation tx");
    assert.equal(
      String(liquidationTxs[0].id).toLowerCase(),
      liqTx.toLowerCase(),
      "LiquidationTx.id mirrors the liquidatePosition tx hash",
    );

    const sellerUser = snap.entity("User", sellerAddr);
    assert.ok(sellerUser);
    assert.ok(
      BigInt(String(sellerUser.realizedPnl)) < 0n,
      `seller User.realizedPnl must be negative after liquidation: got ${sellerUser.realizedPnl}`,
    );

    // The forced close is modeled as a flagged Trade (single source of truth):
    // the closing Trade for the liquidated seller in the liquidation tx must
    // carry isLiquidation + liquidator + liquidationFee, mirroring the on-chain
    // LotLiquidated event.
    let sellerTrade: EntityFields | undefined;
    for (const t of snap.saved("Trade")) {
      if (
        t.user === sellerAddr &&
        String(t.transactionHash).toLowerCase() === liqTx.toLowerCase()
      ) {
        sellerTrade = t;
      }
    }
    assert.ok(
      sellerTrade,
      "a closing Trade must exist for the liquidated seller in the liquidation tx",
    );
    assert.equal(
      sellerTrade.isLiquidation,
      true,
      "closing Trade.isLiquidation must be true on a LIQUIDATION close",
    );
    assert.equal(
      String(sellerTrade.liquidator).toLowerCase(),
      validatorAddr,
      "Trade.liquidator must be the keeper/validator from LotLiquidated",
    );
    assert.equal(
      String(sellerTrade.liquidationFee),
      String(lotLiquidated.args.fee),
      "Trade.liquidationFee must mirror the on-chain LotLiquidated.fee",
    );

    // Denormalized liquidation qty on the closing PositionSession (what the
    // Positions / Position History views read; no nested trade fetch needed).
    const sellerSession = snap.entity(
      "PositionSession",
      String(sellerTrade.positionSession),
    );
    assert.ok(sellerSession, "the closing PositionSession must exist");
    assert.equal(
      String(sellerSession.liquidatedQuantity),
      "1",
      "PositionSession.liquidatedQuantity must equal abs(closed qty) = 1",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2: BadDebt — BadDebtEvent entity when losses exceed coverage
// ---------------------------------------------------------------------------
describe("BadDebt: BadDebtEvent when losses exceed participant balance + insurance fund", () => {
  after(() => matchstick.reset());

  it("BadDebtEvent is created and Futures.totalBadDebt is non-zero", async () => {
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
    await matchstick.anchor();

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

    // Spike price 500x — loss (~12 015 USDC) exceeds seller (1 000) + insurance fund (10 000)
    await scaleHashprice(hashrateOracle, 500n, 1n);

    const liqTx = await futures.write.liquidatePosition([seller.account.address, lotId], {
      account: validator.account,
    });
    const liqReceipt = await pc.waitForTransactionReceipt({ hash: liqTx });

    const badDebtEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "BadDebt",
    });
    assert.equal(badDebtEvents.length, 1, "must emit exactly 1 BadDebt event");
    const onChainAmount = badDebtEvents[0].args.amount;

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;

    const snap = await matchstick.indexSnapshot([]);

    const badDebtEntities = snap.saved("BadDebtEvent");
    assert.equal(badDebtEntities.length, 1, "exactly 1 BadDebtEvent entity");
    const badDebt = badDebtEntities[0];
    assert.equal(badDebt.user, sellerAddr, "BadDebtEvent.user must be the seller");
    assert.equal(
      badDebt.amount,
      onChainAmount.toString(),
      "BadDebtEvent.amount must match on-chain event",
    );

    // Field-coverage: BadDebtEvent metadata.
    assert.ok(
      typeof badDebt.id === "string" && (badDebt.id as string).startsWith("0x"),
      "BadDebtEvent.id is `tx hash ++ logIndex` (hex Bytes), set by createEventId",
    );
    assert.equal(
      String(badDebt.transactionHash).toLowerCase(),
      liqTx.toLowerCase(),
      "BadDebtEvent.transactionHash mirrors the liquidatePosition tx hash",
    );
    assert.ok(
      BigInt(String(badDebt.timestamp)) > 0n,
      "BadDebtEvent.timestamp is set from event.block.timestamp",
    );
    assert.ok(
      BigInt(String(badDebt.blockNumber)) > 0n,
      "BadDebtEvent.blockNumber is set from event.block.number",
    );

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
    assert.equal(
      String(futuresEntity.totalLiquidations),
      "1",
      "totalLiquidations still bumps once for the same tx",
    );

    const lotLiquidatedEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "LotLiquidated",
    });
    assert.equal(lotLiquidatedEvents.length, 1, "must emit exactly 1 LotLiquidated");
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
// Test 3: multi-position liquidation across two txs — Futures.totalLiquidations counts txs
// ---------------------------------------------------------------------------
//
// Each `liquidatePosition` call is its own tx, so two underwater positions
// liquidate in two txs. The `LiquidationTx` dedup sentinel keeps the counter
// in lockstep with tx count (not leg count).
describe("multi-position permissionless liquidation: per-tx dedup", () => {
  after(() => matchstick.reset());

  it("two liquidatePosition txs → 2 LotLiquidated, totalLiquidations=2", async () => {
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

    await scaleHashprice(hashrateOracle, 40n, 1n);

    const liqTx1 = await futures.write.liquidatePosition([seller.account.address, lot1Id], {
      account: validator.account,
    });
    await pc.waitForTransactionReceipt({ hash: liqTx1 });

    const liqTx2 = await futures.write.liquidatePosition([seller.account.address, lot2Id], {
      account: validator.account,
    });
    await pc.waitForTransactionReceipt({ hash: liqTx2 });

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const snap = await matchstick.indexSnapshot([read("Lot", lot1Id), read("Lot", lot2Id)]);

    for (const id of [lot1Id, lot2Id]) {
      const lot = snap.entity("Lot", id);
      assert.ok(lot, `Lot ${id} must exist`);
      assert.equal(lot.status, "CLOSED");
      assert.equal(lot.closeReason, "LIQUIDATION");
      assert.equal(String(lot.liquidatedParticipant).toLowerCase(), sellerAddr);
    }

    const liquidationTxs = snap.saved("LiquidationTx");
    assert.equal(
      liquidationTxs.length,
      2,
      "one LiquidationTx sentinel per liquidatePosition tx (two txs in this test)",
    );

    const futuresEntity = snap.entity("Futures", "0");
    assert.ok(futuresEntity);
    assert.equal(
      String(futuresEntity.totalLiquidations),
      "2",
      "Futures.totalLiquidations bumps once per liquidation tx (two txs here)",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 4: multi-leg liquidation in ONE tx — liquidatedQuantity counts units
// ---------------------------------------------------------------------------
//
// A keeper can batch several `liquidatePosition` calls into a single tx via the
// embedded multicall. When two same-session positions are liquidated in one tx,
// the two `LotClosed(LIQUIDATION)` legs aggregate into ONE Trade whose
// `tradeQuantity` grows to 2, and two `LotLiquidated` legs fire. The
// denormalized `PositionSession.liquidatedQuantity` must count the liquidated
// UNITS (2), not accumulate the running aggregate trade qty per leg (which would
// give 1 + 2 = 3).
describe("multi-leg liquidation in one tx: liquidatedQuantity counts units", () => {
  after(() => matchstick.reset());

  it("two liquidatePosition legs in one multicall tx → liquidatedQuantity == 2", async () => {
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

    // Seller shorts two lots at distinct prices on the SAME deliveryDate → one
    // PositionSession with netQuantity -2 (both lots scale into one session).
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

    await scaleHashprice(hashrateOracle, 40n, 1n);

    // Liquidate BOTH positions in a SINGLE tx via the embedded multicall so the
    // tx carries two LotLiquidated legs for the same (participant, session).
    const calldata = [
      encodeFunctionData({
        abi: futures.abi,
        functionName: "liquidatePosition",
        args: [seller.account.address, lot1Id],
      }),
      encodeFunctionData({
        abi: futures.abi,
        functionName: "liquidatePosition",
        args: [seller.account.address, lot2Id],
      }),
    ];
    const liqTx = await futures.write.multicall([calldata], { account: validator.account });
    const liqReceipt = await pc.waitForTransactionReceipt({ hash: liqTx });

    const lotLiquidatedEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "LotLiquidated",
    });
    assert.equal(
      lotLiquidatedEvents.length,
      2,
      "a single multicall tx must carry two LotLiquidated legs",
    );

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;

    const snap = await matchstick.indexSnapshot([]);

    // Both close legs aggregate into one Trade for the seller in this tx.
    let sellerTrade: EntityFields | undefined;
    for (const t of snap.saved("Trade")) {
      if (
        t.user === sellerAddr &&
        String(t.transactionHash).toLowerCase() === liqTx.toLowerCase()
      ) {
        sellerTrade = t;
      }
    }
    assert.ok(sellerTrade, "a closing Trade must exist for the liquidated seller");
    assert.equal(
      sellerTrade.isLiquidation,
      true,
      "the seller's closing Trade must be flagged isLiquidation",
    );

    const sellerSession = snap.entity("PositionSession", String(sellerTrade.positionSession));
    assert.ok(sellerSession, "the closing PositionSession must exist");
    assert.equal(
      String(sellerSession.liquidatedQuantity),
      "2",
      "liquidatedQuantity must equal the number of liquidated units (2), not the summed running aggregate trade qty (1 + 2 = 3)",
    );
  });
});
