import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice, refreshHashprice } from "../../contracts/tests/utils.ts";
import { assertHexHash, assertLotTimestampInvariants, pointerId } from "./helpers.ts";

type AnyContract = Parameters<typeof refreshHashprice>[0];

const conn = await network.getOrCreate();

describe("closeDelivery netQty bookkeeping", () => {
  after(() => conn.matchstick.reset());

  it("closes an unpaid lot (BREACH) and returns both pointers to zero", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault, hashrateOracle } = contracts;
    const { seller, buyer, validator, pc, tc } = accounts;

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const marginAmount = parseUnits("1000", 6);

    await collateralVault.write.deposit([marginAmount], { account: seller.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const [created] = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    assert.ok(created, "fixture must emit LotCreated");

    // No depositDeliveryPaymentV2 call -> unpaid path must still close.
    await tc.setNextBlockTimestamp({
      timestamp: deliveryDate + BigInt(config.deliveryDurationSeconds) / 2n,
    });
    await refreshHashprice(hashrateOracle as unknown as AnyContract);

    const closeTx = await futures.write.closeDelivery([created.args.lotId, true], {
      account: validator.account,
    });
    const closeReceipt = await pc.waitForTransactionReceipt({ hash: closeTx });
    const [lotClosed] = parseEventLogs({
      logs: closeReceipt.logs,
      abi: futures.abi,
      eventName: "LotClosed",
    });
    assert.ok(lotClosed, "closeDelivery must emit LotClosed");
    assert.equal(lotClosed.args.reason, 2, "closeDelivery must emit BREACH reason");

    const sellerPtr = pointerId(seller.account.address, deliveryDate);
    const buyerPtr = pointerId(buyer.account.address, deliveryDate);
    const [sellerPointer, buyerPointer, lot] = await conn.matchstick.index([
      read("UserDeliverySessionPointer", sellerPtr),
      read("UserDeliverySessionPointer", buyerPtr),
      read("Lot", created.args.lotId.toLowerCase() as `0x${string}`),
    ]);

    assert.ok(lot, "Lot entity must exist");
    assert.equal(lot.status, "CLOSED");
    assert.equal(lot.closeReason, "BREACH");
    assert.equal(lot.isClosed, true);
    assert.ok(sellerPointer, "seller pointer must exist");
    assert.ok(buyerPointer, "buyer pointer must exist");
    assert.equal(String(sellerPointer.netQuantity), "0");
    assert.equal(String(buyerPointer.netQuantity), "0");

    // closedBy is the validator (the caller of closeDelivery) — distinguishes
    // BREACH from MUTUAL_EXIT (closedBy=zero) and from LIQUIDATION (also zero).
    assert.equal(
      String(lot.closedBy).toLowerCase(),
      validator.account.address.toLowerCase(),
      "Lot.closedBy must record the validator who called closeDelivery on BREACH",
    );

    // sellerPnl + buyerPnl mirror the on-chain LotClosed.{sellerPnl,buyerPnl}.
    assert.equal(
      String(lot.sellerPnl),
      String(lotClosed.args.sellerPnl),
      "Lot.sellerPnl must match the on-chain BREACH close payload",
    );
    assert.equal(
      String(lot.buyerPnl),
      String(lotClosed.args.buyerPnl),
      "Lot.buyerPnl must match the on-chain BREACH close payload",
    );
    // BREACH penalizes the at-fault side, so the two pnls are opposite in sign
    // (zero-sum at the price-difference layer, before the breach penalty).
    assert.equal(
      BigInt(String(lot.sellerPnl)) + BigInt(String(lot.buyerPnl)),
      0n,
      "BREACH close pnls must sum to zero on the cash-settle leg",
    );

    // Lifecycle metadata
    assertHexHash(lot.transactionHash, "Lot.transactionHash (creation)");
    assertHexHash(lot.closeTransactionHash, "Lot.closeTransactionHash (BREACH)");
    assert.notEqual(
      String(lot.transactionHash),
      String(lot.closeTransactionHash),
      "creation and close txs must have distinct hashes",
    );
    assertLotTimestampInvariants(lot);
  });
});
