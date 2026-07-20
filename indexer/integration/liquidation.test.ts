/**
 * Integration tests: liquidation + bad-debt events under the permissionless
 * keeper flow.
 *
 * Verifies that `PositionLiquidated` + `OrderLiquidated` populate the
 * PositionSession / OrderEntry entities, that `BadDebtEvent` is created when
 * losses exceed coverage, and that `Futures.totalLiquidations` is incremented
 * once per tx via the `LiquidationTx` dedup sentinel (regardless of how many
 * legs the tx contained).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData, parseEventLogs, parseUnits } from "viem";
import { EntityFields, read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice, scaleHashprice } from "../../contracts/tests/utils.ts";
import { pointerId } from "./helpers.ts";

const conn = await network.create({ override: { loggingEnabled: true } });
const { matchstick } = conn;

// ---------------------------------------------------------------------------
// Test 1: permissionless liquidatePosition — seller closed, seller netQty=0
// ---------------------------------------------------------------------------
describe("liquidatePosition: PositionLiquidated, seller netQty=0", () => {
  after(() => matchstick.reset());

  it("populates Trade liquidation fields + bumps Futures.totalLiquidations once per tx", async () => {
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

    await futures.write.createOrder([price, deliveryDate, -1n], { account: seller.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, 1n], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: buyTx });

    // Crash hashprice 40x so seller is deeply underwater (PME-MM breached)
    await scaleHashprice(hashrateOracle, 40n, 1n);

    const liqTx = await futures.write.liquidatePosition(
      [seller.account.address, deliveryDate, 1n],
      { account: validator.account },
    );
    const liqReceipt = await pc.waitForTransactionReceipt({ hash: liqTx });

    const positionLiquidatedEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "PositionLiquidated",
    });
    assert.equal(positionLiquidatedEvents.length, 1, "must emit exactly 1 PositionLiquidated");
    const positionLiquidated = positionLiquidatedEvents[0];
    assert.equal(positionLiquidated.args.deliveryAt, deliveryDate);

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const buyerAddr = buyer.account.address.toLowerCase() as `0x${string}`;
    const validatorAddr = validator.account.address.toLowerCase() as `0x${string}`;

    const snap = await matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", pointerId(seller.account.address, deliveryDate)),
      read("UserDeliverySessionPointer", pointerId(buyer.account.address, deliveryDate)),
    ]);

    const sellerPtr = snap.entity(
      "UserDeliverySessionPointer",
      pointerId(seller.account.address, deliveryDate),
    );
    const buyerPtr = snap.entity(
      "UserDeliverySessionPointer",
      pointerId(buyer.account.address, deliveryDate),
    );
    assert.ok(sellerPtr);
    assert.equal(String(sellerPtr.netQuantity), "0", "seller netQty must be 0 after liquidation");
    assert.ok(buyerPtr);
    assert.equal(
      String(buyerPtr.netQuantity),
      "1",
      "buyer netQty stays open (unilateral liquidation)",
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
      "Trade.liquidator must be the keeper/validator from PositionLiquidated",
    );
    assert.equal(
      String(sellerTrade.liquidationFee),
      String(positionLiquidated.args.liquidatorFee),
      "Trade.liquidationFee must mirror the on-chain PositionLiquidated.liquidatorFee",
    );

    const sellerSession = snap.entity(
      "PositionSession",
      String(sellerTrade.positionSession),
    );
    assert.ok(sellerSession, "the closing PositionSession must exist");
    assert.equal(sellerSession.status, "CLOSE");
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

    await futures.write.createOrder([price, deliveryDate, -1n], { account: seller.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, 1n], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: buyTx });

    // Spike price 500x — loss exceeds seller (1 000) + insurance fund (10 000)
    await scaleHashprice(hashrateOracle, 500n, 1n);

    const liqTx = await futures.write.liquidatePosition(
      [seller.account.address, deliveryDate, 1n],
      { account: validator.account },
    );
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

    const positionLiquidatedEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "PositionLiquidated",
    });
    assert.equal(positionLiquidatedEvents.length, 1, "must emit exactly 1 PositionLiquidated");
    const positionLiquidated = positionLiquidatedEvents[0];
    const validatorAddr = validator.account.address.toLowerCase() as `0x${string}`;

    const sellerPtr = snap.entity(
      "UserDeliverySessionPointer",
      pointerId(seller.account.address, deliveryDate),
    );
    assert.ok(sellerPtr);
    assert.equal(String(sellerPtr.netQuantity), "0");
    assert.equal(
      String(positionLiquidated.args.liquidator).toLowerCase(),
      validatorAddr,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 3: multi-position liquidation across two txs — Futures.totalLiquidations counts txs
// ---------------------------------------------------------------------------
describe("multi-position permissionless liquidation: per-tx dedup", () => {
  after(() => matchstick.reset());

  it("two liquidatePosition txs → 2 PositionLiquidated, totalLiquidations=2", async () => {
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

    await futures.write.createOrder([price1, deliveryDate, -1n], { account: seller.account });
    const buy1 = await futures.write.createOrder([price1, deliveryDate, 1n], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: buy1 });

    await futures.write.createOrder([price2, deliveryDate, -1n], { account: seller.account });
    const buy2 = await futures.write.createOrder([price2, deliveryDate, 1n], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: buy2 });

    await scaleHashprice(hashrateOracle, 40n, 1n);

    const liqTx1 = await futures.write.liquidatePosition(
      [seller.account.address, deliveryDate, 1n],
      { account: validator.account },
    );
    await pc.waitForTransactionReceipt({ hash: liqTx1 });

    const liqTx2 = await futures.write.liquidatePosition(
      [seller.account.address, deliveryDate, 1n],
      { account: validator.account },
    );
    await pc.waitForTransactionReceipt({ hash: liqTx2 });

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const snap = await matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", pointerId(seller.account.address, deliveryDate)),
    ]);

    const sellerPtr = snap.entity(
      "UserDeliverySessionPointer",
      pointerId(seller.account.address, deliveryDate),
    );
    assert.ok(sellerPtr);
    assert.equal(String(sellerPtr.netQuantity), "0", "seller fully liquidated after two partial txs");

    const sellerSessions = snap
      .saved("PositionSession")
      .filter((s) => String(s.user).toLowerCase() === sellerAddr);
    assert.equal(sellerSessions.length, 1);
    assert.equal(sellerSessions[0].status, "CLOSE");
    assert.equal(String(sellerSessions[0].liquidatedQuantity), "2");

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

    // Seller shorts two units at distinct prices on the SAME deliveryDate → one
    // PositionSession with netQuantity -2 (both fills scale into one session).
    await futures.write.createOrder([price1, deliveryDate, -1n], { account: seller.account });
    const buy1 = await futures.write.createOrder([price1, deliveryDate, 1n], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: buy1 });

    await futures.write.createOrder([price2, deliveryDate, -1n], { account: seller.account });
    const buy2 = await futures.write.createOrder([price2, deliveryDate, 1n], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: buy2 });

    await scaleHashprice(hashrateOracle, 40n, 1n);

    // Liquidate BOTH units in a SINGLE tx via the embedded multicall so the
    // tx carries two PositionLiquidated legs for the same (participant, session).
    const calldata = [
      encodeFunctionData({
        abi: futures.abi,
        functionName: "liquidatePosition",
        args: [seller.account.address, deliveryDate, 1n],
      }),
      encodeFunctionData({
        abi: futures.abi,
        functionName: "liquidatePosition",
        args: [seller.account.address, deliveryDate, 1n],
      }),
    ];
    const liqTx = await futures.write.multicall([calldata], { account: validator.account });
    const liqReceipt = await pc.waitForTransactionReceipt({ hash: liqTx });

    const positionLiquidatedEvents = parseEventLogs({
      logs: liqReceipt.logs,
      abi: futures.abi,
      eventName: "PositionLiquidated",
    });
    assert.equal(
      positionLiquidatedEvents.length,
      2,
      "a single multicall tx must carry two PositionLiquidated legs",
    );

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;

    const snap = await matchstick.indexSnapshot([]);

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
      "liquidatedQuantity must equal the number of liquidated units (2)",
    );
  });
});
