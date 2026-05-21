/**
 * Integration tests: lot payment lifecycle.
 *
 * Covers `LotPaid` (buyer prepays delivery via depositDeliveryPaymentV2) and
 * `LotPaymentWithdrawn` (seller withdraws after window) including the
 * accompanying `LotClosed(SETTLED)` co-emission. These paths are not exercised
 * by the BREACH-focused delivery-close tests, so they get a dedicated file.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { assertHexHash, assertLotTimestampInvariants } from "./helpers.ts";

const conn = await network.getOrCreate();

describe("LotPaid: buyer prepays delivery", () => {
  after(() => conn.matchstick.reset());

  it("flips Lot.isPaid + paidAt + paymentTransactionHash on depositDeliveryPaymentV2", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, "https://dst.com", 1], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const [created] = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const lotId = created.args.lotId.toLowerCase() as `0x${string}`;

    const depositTx = await futures.write.depositDeliveryPaymentV2([created.args.lotId], {
      account: buyer.account,
    });
    const depositReceipt = await pc.waitForTransactionReceipt({ hash: depositTx });
    const [paid] = parseEventLogs({
      logs: depositReceipt.logs,
      abi: futures.abi,
      eventName: "LotPaid",
    });
    assert.ok(paid, "depositDeliveryPaymentV2 must emit LotPaid");
    assert.equal(paid.args.lotId.toLowerCase(), lotId);

    const snap = await conn.matchstick.indexSnapshot([read("Lot", lotId)]);
    const lot = snap.entity("Lot", lotId);
    assert.ok(lot);
    assert.equal(lot.isPaid, true);
    assert.equal(lot.isWithdrawn, false, "no withdraw yet");
    assert.equal(lot.isClosed, false, "LotPaid alone must not close the lot");
    assert.equal(lot.status, "OPEN");
    assert.ok(BigInt(String(lot.paidAt)) > 0n, "Lot.paidAt must be a positive timestamp");
    assertHexHash(lot.paymentTransactionHash, "Lot.paymentTransactionHash");
    assertHexHash(lot.transactionHash, "Lot.transactionHash");
    assert.notEqual(
      String(lot.transactionHash),
      String(lot.paymentTransactionHash),
      "creation and payment txs must have distinct hashes",
    );
    assertLotTimestampInvariants(lot);
  });
});

describe("LotPaymentWithdrawn + LotClosed(SETTLED): seller withdraws after window", () => {
  after(() => conn.matchstick.reset());

  it("marks lot withdrawn, closed, and closeReason=SETTLED", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc, tc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, "https://dst.com", 1], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const [created] = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const lotId = created.args.lotId.toLowerCase() as `0x${string}`;

    await futures.write.depositDeliveryPaymentV2([created.args.lotId], { account: buyer.account });

    const deliveryEnd = deliveryDate + BigInt(config.deliveryDurationSeconds);
    await tc.setNextBlockTimestamp({ timestamp: deliveryEnd + 1n });

    const withdrawTx = await futures.write.withdrawDeliveryPayment([deliveryDate], {
      account: seller.account,
    });
    const withdrawReceipt = await pc.waitForTransactionReceipt({ hash: withdrawTx });
    const [withdrawn] = parseEventLogs({
      logs: withdrawReceipt.logs,
      abi: futures.abi,
      eventName: "LotPaymentWithdrawn",
    });
    const [closed] = parseEventLogs({
      logs: withdrawReceipt.logs,
      abi: futures.abi,
      eventName: "LotClosed",
    });
    assert.ok(withdrawn, "withdrawDeliveryPayment must emit LotPaymentWithdrawn");
    assert.ok(closed, "withdrawDeliveryPayment must co-emit LotClosed");
    assert.equal(withdrawn.args.lotId.toLowerCase(), lotId);
    assert.equal(closed.args.lotId.toLowerCase(), lotId);
    assert.equal(closed.args.reason, 3, "reason=3 => SETTLED");

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const buyerAddr = buyer.account.address.toLowerCase() as `0x${string}`;

    const snap = await conn.matchstick.indexSnapshot([
      read("Lot", lotId),
      read("User", sellerAddr),
      read("User", buyerAddr),
    ]);

    const lot = snap.entity("Lot", lotId);
    assert.ok(lot);
    assert.equal(lot.isPaid, true);
    assert.equal(lot.isWithdrawn, true);
    assert.equal(lot.isClosed, true);
    assert.equal(lot.status, "CLOSED");
    assert.equal(lot.closeReason, "SETTLED");
    assert.ok(BigInt(String(lot.paidAt)) > 0n);
    assert.ok(BigInt(String(lot.withdrawnAt)) > 0n);
    assert.ok(BigInt(String(lot.closedAt)) > 0n);
    assertHexHash(lot.withdrawalTransactionHash, "Lot.withdrawalTransactionHash");
    assertHexHash(lot.closeTransactionHash, "Lot.closeTransactionHash");
    assertHexHash(lot.paymentTransactionHash, "Lot.paymentTransactionHash");
    assertHexHash(lot.transactionHash, "Lot.transactionHash");

    // The SETTLED close is co-emitted with `LotPaymentWithdrawn` in the same
    // `withdrawDeliveryPayment` call, so close & withdrawal share a tx hash.
    // Creation and payment must each differ from those.
    assert.equal(
      String(lot.withdrawalTransactionHash),
      String(lot.closeTransactionHash),
      "withdrawalTransactionHash and closeTransactionHash share the same tx (co-emit)",
    );
    assert.notEqual(
      String(lot.transactionHash),
      String(lot.paymentTransactionHash),
      "creation and payment must be distinct txs",
    );
    assert.notEqual(
      String(lot.transactionHash),
      String(lot.withdrawalTransactionHash),
      "creation and withdrawal must be distinct txs",
    );
    assert.notEqual(
      String(lot.paymentTransactionHash),
      String(lot.withdrawalTransactionHash),
      "payment and withdrawal must be distinct txs",
    );
    assertLotTimestampInvariants(lot);

    // SETTLED closes books with sellerPnl=buyerPnl=0 by contract design.
    assert.equal(String(lot.sellerPnl), "0");
    assert.equal(String(lot.buyerPnl), "0");

    // closing fills are recorded for both sides (each in their own per-user Trade).
    const fills = snap.saved("Fill");
    const trades = snap.saved("Trade");
    assert.ok(
      fills.some((f) => String(f.user).toLowerCase() === sellerAddr),
      "seller must have a fill row",
    );
    assert.ok(
      fills.some((f) => String(f.user).toLowerCase() === buyerAddr),
      "buyer must have a fill row",
    );
    assert.ok(
      trades.some((t) => String(t.user).toLowerCase() === sellerAddr),
      "seller must have a trade row",
    );
    assert.ok(
      trades.some((t) => String(t.user).toLowerCase() === buyerAddr),
      "buyer must have a trade row",
    );
  });
});
