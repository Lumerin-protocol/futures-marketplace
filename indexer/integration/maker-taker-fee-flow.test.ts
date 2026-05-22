/**
 * Integration test: ConfigUpdated flow (replaces per-field MakerFeeUpdated /
 * TakerFeeUpdated events).
 *
 * Deploy futures → bind Matchstick to the proxy → anchor → call
 * `setMakerFee(...)` / `setTakerFee(...)` → `index(read("Futures", "0"))` → assert.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";

const conn = await network.getOrCreate();

describe("Futures ConfigUpdated Integration", () => {
  after(() => conn.matchstick.reset());

  it("indexes makerFee and takerFee updates", async () => {
    const { contracts, accounts } = await conn.networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    const newMakerFee = 4321n;
    const newTakerFee = 12345n;
    await futures.write.setMakerFee([newMakerFee], { account: owner.account });
    await futures.write.setTakerFee([newTakerFee], { account: owner.account });

    const [futuresEntity] = await conn.matchstick.index([read("Futures", "0")]);

    assert.ok(futuresEntity, "Futures#0 should exist after fee updates");
    assert.equal(futuresEntity.makerFee, newMakerFee.toString());
    assert.equal(futuresEntity.takerFee, newTakerFee.toString());
    assert.equal(futuresEntity.totalUsers, 0, "fee setters do not create users");
    assert.equal(conn.matchstick.eventCount, 2);
  });
});
