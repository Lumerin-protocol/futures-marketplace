/**
 * Integration test: OrderFeeUpdated flow.
 *
 * Deploy futures → bind Matchstick to the proxy → anchor → call
 * `setOrderFee(...)` → `index(read("Futures", "0"))` → assert.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "futures-contracts/test-api";

const conn = await network.getOrCreate();

describe("Futures OrderFeeUpdated Integration", () => {
  after(() => conn.matchstick.reset());

  it("indexes orderFee updates", async () => {
    const { contracts, accounts } = await conn.networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.anchor();

    const newFee = 12345n;
    await futures.write.setOrderFee([newFee], { account: owner.account });

    const [futuresEntity] = await conn.matchstick.index([read("Futures", "0")]);

    assert.ok(futuresEntity, "Futures#0 should exist after OrderFeeUpdated");
    assert.equal(futuresEntity.orderFee, newFee.toString());
    assert.equal(futuresEntity.totalUsers, 0, "setOrderFee does not create users");
    assert.equal(conn.matchstick.eventCount, 1);
  });
});
