/**
 * Integration tests: the protocol backstop.
 *
 * `PositionLiquidated` closes the user; the paired `BackstopAssigned` gives the
 * backstop ledger (`0xbB…bB`) the same signed quantity at the liquidation mark,
 * so per-expiry nets keep summing to zero across User pointers. A later
 * `unwindBackstop` is an ordinary `OrderMatched` with the backstop as taker plus
 * a `BackstopUnwound` record for the caller fee.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits, type Hex } from "viem";
import { read, type EntityFields } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice, scaleHashprice } from "../../contracts/tests/utils.ts";
import { pointerId } from "./helpers.ts";
import { TimeInForce } from "../../contracts/tests/timeInForce.ts";

const conn = await network.create({ override: { loggingEnabled: true } });
const { matchstick } = conn;

describe("backstop: BackstopAssigned + BackstopUnwound", () => {
  after(() => matchstick.reset());

  it("moves the liquidated quantity onto the backstop pointer and records the unwind", async () => {
    const { contracts, accounts, config } =
      await conn.networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault, hashpriceUsd } = contracts;
    const { seller, buyer, buyer2, owner, validator, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);
    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await collateralVault.write.deposit([margin * 10n], { account: buyer2.account });
    await futures.write.setMakerFeeBps([0], { account: owner.account });
    await futures.write.setTakerFeeBps([0], { account: owner.account });

    matchstick.bind("HashPowerFutures", futures.address, futures.abi);
    await matchstick.captureViewMocks();

    await futures.write.createOrder([price, deliveryDate, -2n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, 2n, TimeInForce.GTC], { account: buyer.account });

    // Crash hashprice so the seller (short) is deeply underwater, then liquidate.
    await scaleHashprice(hashpriceUsd, 40n, 1n);
    const liqTx = await futures.write.liquidatePosition([seller.account.address, deliveryDate, 2n], {
      account: validator.account,
    });
    const liqReceipt = await pc.waitForTransactionReceipt({ hash: liqTx });
    const [assigned] = parseEventLogs({ logs: liqReceipt.logs, abi: futures.abi, eventName: "BackstopAssigned" });
    assert.equal(assigned.args.quantity, -2n, "backstop inherits the seller's short");
    const backstop = (await futures.read.BACKSTOP()).toLowerCase() as Hex;

    // Unwind: buyer2 rests an ask at the mark; anyone calls unwindBackstop and the
    // backstop buys 1 to cover.
    await collateralVault.write.setBackstopParams([100, 10], { account: owner.account });
    await collateralVault.write.depositFor([futures.address, parseUnits("10", 6)], { account: owner.account });
    const mark = await futures.read.getMarketPrice();
    await futures.write.createOrder([mark, deliveryDate, -1n, TimeInForce.GTC], { account: buyer2.account });
    const unwindTx = await futures.write.unwindBackstop([deliveryDate, 1n], { account: validator.account });
    const unwindReceipt = await pc.waitForTransactionReceipt({ hash: unwindTx });
    const [unwound] = parseEventLogs({ logs: unwindReceipt.logs, abi: futures.abi, eventName: "BackstopUnwound" });

    const snap = await matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", pointerId(seller.account.address, deliveryDate)),
      read("UserDeliverySessionPointer", pointerId(buyer.account.address, deliveryDate)),
      read("UserDeliverySessionPointer", pointerId(buyer2.account.address, deliveryDate)),
      read("UserDeliverySessionPointer", pointerId(backstop, deliveryDate)),
    ]);

    const net = (who: Hex) =>
      BigInt(String(snap.entity("UserDeliverySessionPointer", pointerId(who, deliveryDate))?.netQuantity ?? "0"));
    assert.equal(net(seller.account.address), 0n, "seller closed");
    assert.equal(net(buyer.account.address), 2n, "counterparty untouched");
    assert.equal(net(buyer2.account.address), -1n, "buyer2 sold 1 to the backstop");
    assert.equal(net(backstop), -1n, "backstop: inherited -2, covered +1");
    assert.equal(
      net(seller.account.address) + net(buyer.account.address) + net(buyer2.account.address) + net(backstop),
      0n,
      "per-expiry conservation across users + backstop",
    );

    const backstopPtr = snap.entity("UserDeliverySessionPointer", pointerId(backstop, deliveryDate));
    assert.ok(backstopPtr);
    assert.equal(String(backstopPtr.aggregatedEntryPrice), String(assigned.args.price), "entry = liquidation mark");

    // The assignment is a flagged Trade on the backstop with no Fill rows.
    let assignment: EntityFields | undefined;
    for (const t of snap.saved("Trade")) {
      if (t.user === backstop && String(t.transactionHash).toLowerCase() === liqTx.toLowerCase()) assignment = t;
    }
    assert.ok(assignment, "backstop Trade in the liquidation tx");
    assert.equal(assignment.isBackstopAssignment, true);
    assert.equal(assignment.isLiquidation, false);
    assert.equal(String(assignment.backstopFromUser).toLowerCase(), seller.account.address.toLowerCase());
    assert.equal(String(assignment.tradeQuantity), "-2");
    assert.equal(String(assignment.realizedPnl), "0", "inheriting opens; nothing realized");
    const assignmentFills = snap.saved("Fill").filter((f) => f.trade === assignment?.id);
    assert.equal(assignmentFills.length, 0, "no counterparty order, so no Fill");

    // The unwind fill is a normal Fill for the backstop as taker...
    const backstopFills = snap.saved("Fill").filter(
      (f) => f.user === backstop && String(f.transactionHash).toLowerCase() === unwindTx.toLowerCase(),
    );
    assert.equal(backstopFills.length, 1);
    assert.equal(String(backstopFills[0].fillQuantity), "1");
    assert.equal(backstopFills[0].side, "TAKER");
    // ...plus a BackstopUnwind row for the caller.
    const unwinds = snap.saved("BackstopUnwind");
    assert.equal(unwinds.length, 1);
    assert.equal(String(unwinds[0].caller).toLowerCase(), validator.account.address.toLowerCase());
    assert.equal(String(unwinds[0].filledQuantity), "1");
    assert.equal(String(unwinds[0].fee), String(unwound.args.fee));
    assert.ok(unwound.args.fee > 0n, "fee paid from the pot");
    assert.equal(String(unwinds[0].expirationAt), String(deliveryDate));

    // The backstop User row exists and is not counted as liquidated.
    const backstopUser = snap.entity("User", backstop);
    assert.ok(backstopUser);
    let backstopLiquidated = false;
    for (const t of snap.saved("Trade")) if (t.user === backstop && t.isLiquidation === true) backstopLiquidated = true;
    assert.equal(backstopLiquidated, false);
  });
});
