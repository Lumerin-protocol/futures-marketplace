/**
 * Integration test: `FuturesExpiration` settlement-price metadata.
 *
 * Drives the real contract through maturity and asserts the indexer pins the
 * cash-settlement price onto the per-expiration `FuturesExpiration` entity —
 * both via the explicit `recordSettlementPrice` path and via the lazy auto-pin
 * inside `settlePosition`.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice, refreshHashprice } from "../../contracts/tests/utils.ts";
import { futuresExpirationId } from "./helpers.ts";

const conn = await network.getOrCreate();

// Opens a matched position (seller short / buyer long) at ~$100 on the first delivery date.
async function openMatchedPosition() {
  const data = await conn.networkHelpers.loadFixture(deployFuturesFixture);
  const { contracts, accounts, config } = data;
  const { futures, collateralVault } = contracts;
  const { seller, buyer, pc } = accounts;

  const margin = parseUnits("10000", 6);
  const deliveryDate = config.deliveryDates[0];
  const entry = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

  await collateralVault.write.deposit([margin], { account: seller.account });
  await collateralVault.write.deposit([margin], { account: buyer.account });

  conn.matchstick.bind("Futures", futures.address, futures.abi);
  await conn.matchstick.captureViewMocks();
  await conn.matchstick.anchor();

  await futures.write.createOrder([entry, deliveryDate, -1n], { account: seller.account });
  const tx = await futures.write.createOrder([entry, deliveryDate, 1n], {
    account: buyer.account,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash: tx });
  const [matched] = parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "OrderMatched" });
  assert.ok(matched);

  return { ...data, deliveryDate, seller, buyer };
}

describe("FuturesExpiration: settlement price", () => {
  after(() => conn.matchstick.reset());

  it("records the settlement price via recordSettlementPrice", async () => {
    const { contracts, accounts, deliveryDate } = await openMatchedPosition();
    const { futures, hashrateOracle } = contracts;
    const { buyer2, tc, pc } = accounts;

    await refreshHashprice(hashrateOracle, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
    const tx = await futures.write.recordSettlementPrice([deliveryDate], { account: buyer2.account });
    await pc.waitForTransactionReceipt({ hash: tx });

    const pinned = await futures.read.settlementPrice([deliveryDate]);
    const id = futuresExpirationId(deliveryDate);
    const snap = await conn.matchstick.indexSnapshot([read("FuturesExpiration", id)]);
    const exp = snap.entity("FuturesExpiration", id);

    assert.ok(exp, "FuturesExpiration entity must exist");
    assert.equal(String(exp.deliveryAt), deliveryDate.toString());
    assert.equal(String(exp.settlementPrice), pinned.toString());
    assert.ok(String(exp.settledAt) !== "" && exp.settledAt != null, "settledAt must be set");
    assert.equal(
      String(exp.recordedBy).toLowerCase(),
      buyer2.account.address.toLowerCase(),
      "recordedBy is the caller",
    );
    assert.ok(
      String(exp.recordTransactionHash).startsWith("0x"),
      "recordTransactionHash must be a hex hash",
    );
    assert.ok(exp.recordBlockNumber != null, "recordBlockNumber must be set");
  });

  it("lazily pins the settlement price the first time settlePosition runs", async () => {
    const { contracts, accounts, deliveryDate, buyer } = await openMatchedPosition();
    const { futures, hashrateOracle } = contracts;
    const { buyer2, tc, pc } = accounts;

    await refreshHashprice(hashrateOracle, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
    const tx = await futures.write.settlePosition([buyer.account.address, deliveryDate], {
      account: buyer2.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });

    const settled = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionSettled",
    });
    assert.equal(settled.length, 1, "settlePosition must emit PositionSettled");

    const pinned = await futures.read.settlementPrice([deliveryDate]);
    const id = futuresExpirationId(deliveryDate);
    const snap = await conn.matchstick.indexSnapshot([read("FuturesExpiration", id)]);
    const exp = snap.entity("FuturesExpiration", id);

    assert.ok(exp, "FuturesExpiration entity must exist");
    assert.notEqual(pinned, 0n, "settlePosition must have pinned a non-zero price on-chain");
    assert.equal(String(exp.settlementPrice), pinned.toString());
    assert.equal(
      String(exp.recordedBy).toLowerCase(),
      buyer2.account.address.toLowerCase(),
      "recordedBy is the settler",
    );
  });
});
