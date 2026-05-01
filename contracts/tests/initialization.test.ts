import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, zeroAddress } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";

const { networkHelpers, viem } = await network.getOrCreate();

describe("Futures - Initialization", () => {
  it("should initialize with correct parameters", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    // Check hashrate oracle address (now serves the hashprice in USD; getter name kept for back-compat)
    assert.equal(
      getAddress(await futures.read.hashrateOracle()),
      getAddress(contracts.hashrateOracle.address),
    );
    // Check validator address
    assert.equal(
      getAddress(await futures.read.validatorAddress()),
      getAddress(accounts.validator.account.address),
    );
    // Check margin percentages
    assert.equal(await futures.read.liquidationMarginPercent(), config.liquidationMarginPercent);
    // Check speed
    assert.equal(await futures.read.speedHps(), config.speedHps);
    // Check delivery duration
    assert.equal(await futures.read.deliveryDurationDays(), config.deliveryDurationDays);
    // Check breach penalty rate
    assert.equal(await futures.read.breachPenaltyRatePerDay(), 0n);
  });

  it("should expose the configured oracle staleness window", async function () {
    const { contracts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    assert.equal(await futures.read.MAX_ORACLE_STALENESS(), 3600n);
  });
});

describe("Futures - Oracle staleness", function () {
  it("rejects setOracle with the zero address", async function () {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.setOracle([zeroAddress], { account: owner.account }),
      futures,
      "InvalidOracle",
    );
  });

  it("reverts getMarketPrice with OracleStale once the answer ages past MAX_ORACLE_STALENESS", async function () {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, hashrateOracle } = contracts;
    const { tc, pc } = accounts;

    // Sanity check: a fresh feed serves market price normally.
    await futures.read.getMarketPrice();

    const maxStaleness = await futures.read.MAX_ORACLE_STALENESS();
    const { timestamp: now } = await pc.getBlock({ blockTag: "latest" });
    await tc.setNextBlockTimestamp({ timestamp: now + maxStaleness + 2n });
    await tc.mine({ blocks: 1 });

    await viem.assertions.revertWithCustomError(
      futures.read.getMarketPrice(),
      futures,
      "OracleStale",
    );

    // Pushing a fresh answer brings the feed back online without redeploying.
    const [, answer] = await hashrateOracle.read.latestRoundData();
    await hashrateOracle.write.setPrice([answer]);
    await futures.read.getMarketPrice();
  });

  it("reverts getMarketPrice with InvalidOracle when the feed answers with a non-positive value", async function () {
    const { contracts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, hashrateOracle } = contracts;

    await hashrateOracle.write.setPrice([0n]);
    await viem.assertions.revertWithCustomError(
      futures.read.getMarketPrice(),
      futures,
      "InvalidOracle",
    );

    await hashrateOracle.write.setPrice([-1n]);
    await viem.assertions.revertWithCustomError(
      futures.read.getMarketPrice(),
      futures,
      "InvalidOracle",
    );
  });
});
