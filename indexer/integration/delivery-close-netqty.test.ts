/**
 * Integration test: `closeDelivery` emits BOTH `PositionClosed` AND
 * `PositionDeliveryClosed` for the same position (see Futures.sol
 * `_closeAndCashSettleDeliveryAndPenalize` → `_closeAndCashSettleDelivery`
 * → `_removePosition`).
 *
 * Both handlers currently decrement `UserDeliverySessionPointer.netQuantity`,
 * so the running net qty is decremented twice per closure. Expected: 0 for
 * both sides after settlement. Actual today: ±2.
 *
 * This is the on-chain reproduction of the indexer-vs-chain drift observed
 * for user 0x1441…775D4 on base-sepolia: indexer reports a phantom short
 * (-5) while `getPositionIds(user)` returns [].
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits, concatHex, type Hex } from "viem";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "futures-contracts/test-api";
import { quantizePrice, refreshHashprice } from "../../contracts/tests/utils.ts";

type AnyContract = Parameters<typeof refreshHashprice>[0];

/**
 * Schema id: 20-byte address ++ 4-byte little-endian i32(deliveryAt).
 *
 * Mirrors `userDeliveryPointerId` in `src/ids.ts`, which uses graph-ts
 * `Bytes.concatI32` — that helper writes the i32 in **little-endian** byte
 * order, not big-endian. Build the same 4-byte tail here so the entity id
 * lines up.
 */
function pointerId(user: Hex, deliveryAt: bigint): Hex {
  const value = Number(deliveryAt) | 0; // wrap to i32, same as `BigInt.toI32()` in AS
  const buf = new Uint8Array(4);
  buf[0] = value & 0xff;
  buf[1] = (value >>> 8) & 0xff;
  buf[2] = (value >>> 16) & 0xff;
  buf[3] = (value >>> 24) & 0xff;
  const tail = `0x${Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
  return concatHex([user, tail]).toLowerCase() as Hex;
}

const conn = await network.getOrCreate();

describe("Futures closeDelivery: netQuantity bookkeeping", () => {
  after(() => conn.matchstick.reset());

  it("indexer netQuantity returns to 0 for both sides after closeDelivery", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault, hashrateOracle } = contracts;
    const { seller, buyer, validator, pc, tc } = accounts;

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.anchor();

    // Fund both sides + place matched orders → emits PositionCreated.
    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const marginAmount = parseUnits("1000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([marginAmount], { account: seller.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: buyer.account,
    });

    // Pull positionId from the PositionCreated event for the later read.
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const [created] = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });
    assert.ok(created, "fixture must produce a PositionCreated event");

    // Fast-forward into the delivery window, refresh the hashprice oracle so
    // the close path's `getMarketPrice()` doesn't trip `MAX_ORACLE_STALENESS`.
    await tc.setNextBlockTimestamp({
      timestamp: deliveryDate + BigInt(config.deliveryDurationSeconds) / 2n,
    });
    await refreshHashprice(hashrateOracle as unknown as AnyContract);

    // closeDelivery emits BOTH PositionDeliveryClosed AND (via _removePosition)
    // PositionClosed for the same positionId.
    const closeTx = await futures.write.closeDelivery([created.args.positionId, true], {
      account: validator.account,
    });

    // Sanity: the close tx must have emitted both events. If the contract is
    // ever refactored to drop one of them, the bug shape changes and this
    // test should re-fail with a clear "expected both" message.
    const closeReceipt = await pc.waitForTransactionReceipt({ hash: closeTx });
    const closedLogs = parseEventLogs({
      logs: closeReceipt.logs,
      abi: futures.abi,
      eventName: "PositionClosed",
    });
    const deliveryClosedLogs = parseEventLogs({
      logs: closeReceipt.logs,
      abi: futures.abi,
      eventName: "PositionDeliveryClosed",
    });
    assert.equal(closedLogs.length, 1, "PositionClosed must fire once");
    assert.equal(deliveryClosedLogs.length, 1, "PositionDeliveryClosed must fire once");

    const sellerPtr = pointerId(seller.account.address, deliveryDate);
    const buyerPtr = pointerId(buyer.account.address, deliveryDate);
    const positionId = created.args.positionId.toLowerCase();

    const [sellerPointer, buyerPointer, position] = await conn.matchstick.index([
      read("UserDeliverySessionPointer", sellerPtr),
      read("UserDeliverySessionPointer", buyerPtr),
      read("Position", positionId),
    ]);

    // Position canonical entity should be marked closed.
    assert.ok(position, "Position entity must exist");
    assert.equal(position.isClosed, true, "Position.isClosed must be true after PositionClosed");
    assert.equal(
      position.isDeliveryClosed,
      true,
      "Position.isDeliveryClosed must be true after PositionDeliveryClosed",
    );

    // The bug: both PositionClosed and PositionDeliveryClosed call
    // `applyPositionClosure`, so each side gets decremented twice. Expected
    // (single decrement): 0 / 0. Actual today (double decrement): -2 / +2.
    assert.ok(sellerPointer, "seller UserDeliverySessionPointer must exist");
    assert.ok(buyerPointer, "buyer UserDeliverySessionPointer must exist");
    assert.equal(
      String(sellerPointer.netQuantity),
      "0",
      `seller netQuantity must be 0 after closeDelivery, got ${sellerPointer.netQuantity} (double-decrement?)`,
    );
    assert.equal(
      String(buyerPointer.netQuantity),
      "0",
      `buyer netQuantity must be 0 after closeDelivery, got ${buyerPointer.netQuantity} (double-decrement?)`,
    );
  });
});
