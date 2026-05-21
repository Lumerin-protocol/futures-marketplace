import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read, type EntityFields } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { pointerId } from "./helpers.ts";

const conn = await network.getOrCreate();

describe("rewiring exit: B exits, seller A rewired to C", () => {
  after(() => conn.matchstick.reset());

  it("keeps A netQty unchanged while B exits and C enters", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller: partA, buyer: partB, buyer2: partC, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const price2 = price - config.priceLadderStep;
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: partA.account });
    await collateralVault.write.deposit([margin], { account: partB.account });
    await collateralVault.write.deposit([margin], { account: partC.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Open lot_1: A sells, B buys.
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: partA.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: partB.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const [lotCreated] = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const oldLotId = lotCreated.args.lotId.toLowerCase() as `0x${string}`;

    // Rewiring: C rests buy with a destURL so the taker-first / maker-fallback path
    // on the new lot is exercised (B's taker order carries no destURL).
    await futures.write.createOrder([price2, deliveryDate, "rewire-dst", 1], {
      account: partC.account,
    });
    const exitTx = await futures.write.createOrder([price2, deliveryDate, "", -1], {
      account: partB.account,
    });
    const exitReceipt = await pc.waitForTransactionReceipt({ hash: exitTx });
    const [transferred] = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "LotTransferred",
    });
    assert.ok(transferred, "LotTransferred must be emitted on rewiring");
    assert.equal(transferred.args.oldLotId.toLowerCase(), oldLotId);
    assert.equal(
      transferred.args.exitingParticipant.toLowerCase(),
      partB.account.address.toLowerCase(),
    );
    assert.equal(transferred.args.newParticipant.toLowerCase(), partC.account.address.toLowerCase());
    const newLotId = transferred.args.newLotId.toLowerCase() as `0x${string}`;
    const newMakerOrderId = transferred.args.makerOrderId.toLowerCase() as `0x${string}`;
    const newTakerOrderId = transferred.args.takerOrderId.toLowerCase() as `0x${string}`;
    const expectedExitPnl = transferred.args.exitPnl;

    const partAAddr = partA.account.address.toLowerCase() as `0x${string}`;
    const partBAddr = partB.account.address.toLowerCase() as `0x${string}`;
    const partCAddr = partC.account.address.toLowerCase() as `0x${string}`;

    const snap = await conn.matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", pointerId(partA.account.address, deliveryDate)),
      read("UserDeliverySessionPointer", pointerId(partB.account.address, deliveryDate)),
      read("UserDeliverySessionPointer", pointerId(partC.account.address, deliveryDate)),
      read("Lot", oldLotId),
      read("Lot", newLotId),
      read("User", partAAddr),
      read("User", partBAddr),
      read("User", partCAddr),
    ]);

    // Core invariant: remaining party A does not flicker and stays at -1.
    assert.equal(
      String(
        snap.entity("UserDeliverySessionPointer", pointerId(partA.account.address, deliveryDate))
          ?.netQuantity,
      ),
      "-1",
    );
    assert.equal(
      String(
        snap.entity("UserDeliverySessionPointer", pointerId(partB.account.address, deliveryDate))
          ?.netQuantity,
      ),
      "0",
    );
    assert.equal(
      String(
        snap.entity("UserDeliverySessionPointer", pointerId(partC.account.address, deliveryDate))
          ?.netQuantity,
      ),
      "1",
    );

    const oldLot = snap.entity("Lot", oldLotId);
    assert.ok(oldLot);
    assert.equal(oldLot.status, "REPLACED");
    assert.equal(oldLot.isClosed, true, "old lot must be marked closed when replaced");
    assert.ok(BigInt(String(oldLot.closedAt)) > 0n, "old lot must have a closedAt timestamp");
    assert.ok(
      typeof oldLot.closeTransactionHash === "string" &&
        (oldLot.closeTransactionHash as string).startsWith("0x"),
      "old lot's closeTransactionHash must be a hex string (matchstick uses a mock tx hash)",
    );

    const newLot = snap.entity("Lot", newLotId);
    assert.ok(newLot);
    assert.equal(newLot.status, "OPEN");
    assert.equal(newLot.isClosed, false);
    assert.equal(newLot.isPaid, false);
    assert.equal(newLot.isWithdrawn, false);
    assert.equal(newLot.sellPricePerDay, price2.toString());
    assert.equal(newLot.buyPricePerDay, price2.toString());
    assert.equal(newLot.makerOrderId, newMakerOrderId);
    assert.equal(newLot.takerOrderId, newTakerOrderId);
    assert.equal(
      newLot.destURL,
      "rewire-dst",
      "B's taker order has no destURL, so newLot.destURL falls back to C's maker entry",
    );

    // Exit / open leg accounting: A is untouched, B exits with realized PnL,
    // C opens a fresh fill for the new lot.
    const userA = snap.entity("User", partAAddr);
    const userB = snap.entity("User", partBAddr);
    const userC = snap.entity("User", partCAddr);
    assert.ok(userA);
    assert.ok(userB);
    assert.ok(userC);

    assert.deepEqual(
      userA.lots,
      [oldLotId, newLotId],
      "remaining party (A) keeps the original lot and gets appended on rewire",
    );
    assert.deepEqual(userB.lots, [oldLotId], "exiting party (B) is not re-added to the new lot");
    assert.deepEqual(userC.lots, [newLotId], "entrant (C) only sees the new lot");

    assert.equal(String(userA.fillCount), "1", "A was not touched by the rewire fill leg");
    assert.equal(
      String(userB.fillCount),
      "2",
      "B has an open Fill (lot_1) plus an exit Fill (rewire)",
    );
    assert.equal(String(userC.fillCount), "1", "C only has the open fill into the new lot");

    assert.equal(
      String(userB.realizedPnl),
      String(expectedExitPnl),
      "B's realizedPnl must equal the on-chain exitPnl",
    );
    assert.equal(String(userA.realizedPnl), "0", "A's PnL does not change on a rewire");
    assert.equal(String(userC.realizedPnl), "0", "C's PnL does not change on a fresh open");

    const bFills = snap
      .saved("Fill")
      .filter((f: EntityFields) => String(f.user).toLowerCase() === partBAddr);
    assert.equal(bFills.length, 2, "B has one open Fill and one exit Fill");

    const bOpenFill = bFills.find((f: EntityFields) => String(f.fillQuantity) === "1");
    const bExitFill = bFills.find((f: EntityFields) => String(f.fillQuantity) === "-1");
    assert.ok(bOpenFill, "B has an open Fill with quantity +1");
    assert.ok(bExitFill, "B has an exit Fill with quantity -1");
    assert.equal(
      String(bOpenFill.realizedPnl),
      "0",
      "B's open Fill carries no realized PnL (PnL realizes on exit)",
    );
    assert.equal(
      String(bExitFill.realizedPnl),
      String(expectedExitPnl),
      "B's exit Fill carries the realized exitPnl",
    );
    assert.equal(
      String(bExitFill.netQuantityAfter),
      "0",
      "B's net qty after the exit leg is 0",
    );

    const cOpenFills = snap
      .saved("Fill")
      .filter((f: EntityFields) => String(f.user).toLowerCase() === partCAddr);
    assert.equal(cOpenFills.length, 1, "C has exactly one open fill from the rewire tx");
    assert.equal(String(cOpenFills[0].fillQuantity), "1");
    assert.equal(String(cOpenFills[0].netQuantityAfter), "1");
    assert.equal(String(cOpenFills[0].realizedPnl), "0", "C's open fill has no realized PnL");
  });
});

describe("mutual exit: A and B both go flat", () => {
  after(() => conn.matchstick.reset());

  it("emits LotClosed(MUTUAL_EXIT) and zeroes both pointers", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller: partA, buyer: partB, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const price2 = price - config.priceLadderStep;
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: partA.account });
    await collateralVault.write.deposit([margin], { account: partB.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: partA.account });
    const openTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: partB.account,
    });
    const openReceipt = await pc.waitForTransactionReceipt({ hash: openTx });
    const [opened] = parseEventLogs({
      logs: openReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const lotId = opened.args.lotId.toLowerCase() as `0x${string}`;

    // Mutual exit path: B sells resting, A buys taker.
    await futures.write.createOrder([price2, deliveryDate, "", -1], { account: partB.account });
    const exitTx = await futures.write.createOrder([price2, deliveryDate, "", 1], {
      account: partA.account,
    });
    const exitReceipt = await pc.waitForTransactionReceipt({ hash: exitTx });
    const [closed] = parseEventLogs({
      logs: exitReceipt.logs,
      abi: futures.abi,
      eventName: "LotClosed",
    });
    assert.ok(closed, "LotClosed must be emitted on mutual exit");
    assert.equal(closed.args.lotId.toLowerCase(), lotId);
    assert.equal(closed.args.reason, 0, "reason=0 => MUTUAL_EXIT");
    const expectedSellerPnl = closed.args.sellerPnl;
    const expectedBuyerPnl = closed.args.buyerPnl;
    const expectedClosedBy = closed.args.closedBy.toLowerCase() as `0x${string}`;

    const partAAddr = partA.account.address.toLowerCase() as `0x${string}`;
    const partBAddr = partB.account.address.toLowerCase() as `0x${string}`;

    const snap = await conn.matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", pointerId(partA.account.address, deliveryDate)),
      read("UserDeliverySessionPointer", pointerId(partB.account.address, deliveryDate)),
      read("Lot", lotId),
      read("User", partAAddr),
      read("User", partBAddr),
    ]);
    assert.equal(
      String(
        snap.entity("UserDeliverySessionPointer", pointerId(partA.account.address, deliveryDate))
          ?.netQuantity,
      ),
      "0",
    );
    assert.equal(
      String(
        snap.entity("UserDeliverySessionPointer", pointerId(partB.account.address, deliveryDate))
          ?.netQuantity,
      ),
      "0",
    );

    const lot = snap.entity("Lot", lotId);
    assert.ok(lot);
    assert.equal(lot.status, "CLOSED");
    assert.equal(lot.closeReason, "MUTUAL_EXIT");
    assert.equal(lot.isClosed, true);
    assert.equal(String(lot.sellerPnl), String(expectedSellerPnl));
    assert.equal(String(lot.buyerPnl), String(expectedBuyerPnl));
    assert.equal(String(lot.closedBy).toLowerCase(), expectedClosedBy);
    assert.ok(BigInt(String(lot.closedAt)) > 0n, "Lot.closedAt must be set on mutual exit");
    assert.ok(
      typeof lot.closeTransactionHash === "string" &&
        (lot.closeTransactionHash as string).startsWith("0x"),
      "Lot.closeTransactionHash must be a hex string (matchstick uses a mock tx hash)",
    );

    // Append-only User.lots: closed lots remain in each participant's history.
    const userA = snap.entity("User", partAAddr);
    const userB = snap.entity("User", partBAddr);
    assert.ok(userA);
    assert.ok(userB);
    assert.deepEqual(
      userA.lots,
      [lotId],
      "seller's User.lots still references the closed lot (append-only history)",
    );
    assert.deepEqual(
      userB.lots,
      [lotId],
      "buyer's User.lots still references the closed lot (append-only history)",
    );
    assert.equal(
      String(userA.realizedPnl),
      String(expectedSellerPnl),
      "seller User.realizedPnl must equal the on-chain sellerPnl",
    );
    assert.equal(
      String(userB.realizedPnl),
      String(expectedBuyerPnl),
      "buyer User.realizedPnl must equal the on-chain buyerPnl",
    );
  });
});
