import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice, refreshHashprice } from "../../contracts/tests/utils.ts";
import { pointerId } from "./helpers.ts";

type AnyContract = Parameters<typeof refreshHashprice>[0];

const conn = await network.getOrCreate();

describe("multi-lot closeDelivery bookkeeping", () => {
  after(() => conn.matchstick.reset());

  it("decrements netQty exactly once per closeDelivery call", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault, hashrateOracle } = contracts;
    const { seller, buyer, validator, pc, tc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin * 3n], { account: seller.account });
    await collateralVault.write.deposit([margin * 3n], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    const lotIds: `0x${string}`[] = [];
    for (let i = 0; i < 3; i++) {
      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const buyTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
        account: buyer.account,
      });
      const receipt = await pc.waitForTransactionReceipt({ hash: buyTx });
      const [created] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });
      lotIds.push(created.args.lotId.toLowerCase() as `0x${string}`);
    }

    const sellerPtrId = pointerId(seller.account.address, deliveryDate);
    const buyerPtrId = pointerId(buyer.account.address, deliveryDate);

    await tc.setNextBlockTimestamp({
      timestamp: deliveryDate + BigInt(config.deliveryDurationSeconds) / 2n,
    });

    // close #1: ±3 -> ±2
    await refreshHashprice(hashrateOracle as unknown as AnyContract);
    await futures.write.closeDelivery([lotIds[0], true], { account: validator.account });
    let snap = await conn.matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", sellerPtrId),
      read("UserDeliverySessionPointer", buyerPtrId),
    ]);
    assert.equal(String(snap.entity("UserDeliverySessionPointer", sellerPtrId)?.netQuantity), "-2");
    assert.equal(String(snap.entity("UserDeliverySessionPointer", buyerPtrId)?.netQuantity), "2");

    // close #2: ±2 -> ±1
    await refreshHashprice(hashrateOracle as unknown as AnyContract);
    await futures.write.closeDelivery([lotIds[1], true], { account: validator.account });
    snap = await conn.matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", sellerPtrId),
      read("UserDeliverySessionPointer", buyerPtrId),
    ]);
    assert.equal(String(snap.entity("UserDeliverySessionPointer", sellerPtrId)?.netQuantity), "-1");
    assert.equal(String(snap.entity("UserDeliverySessionPointer", buyerPtrId)?.netQuantity), "1");

    // close #3: ±1 -> 0
    await refreshHashprice(hashrateOracle as unknown as AnyContract);
    await futures.write.closeDelivery([lotIds[2], true], { account: validator.account });
    snap = await conn.matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", sellerPtrId),
      read("UserDeliverySessionPointer", buyerPtrId),
      ...lotIds.map((id) => read("Lot", id)),
    ]);
    assert.equal(String(snap.entity("UserDeliverySessionPointer", sellerPtrId)?.netQuantity), "0");
    assert.equal(String(snap.entity("UserDeliverySessionPointer", buyerPtrId)?.netQuantity), "0");
    for (const id of lotIds) {
      assert.equal(snap.entity("Lot", id)?.status, "CLOSED", `${id} must be closed`);
      assert.equal(snap.entity("Lot", id)?.closeReason, "BREACH", `${id} must be BREACH`);
    }
  });
});
