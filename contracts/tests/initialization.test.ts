import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, zeroAddress } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";

const { networkHelpers, viem } = await network.getOrCreate();

describe("Futures - Initialization", () => {
  it("should initialize with correct parameters", async () => {
    const { contracts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    // Check hashrate oracle address (now serves the hashprice in USD; getter name kept for back-compat)
    assert.equal(
      getAddress(await futures.read.hashrateOracle()),
      getAddress(contracts.hashrateOracle.address),
    );
    // Check margin percentages
    assert.equal(await futures.read.liquidationMarginPercent(), config.liquidationMarginPercent);
    // Check contract size (compile-time constant, hashes/s·day driving the mark)
    assert.equal(await futures.read.CONTRACT_SIZE_HPS_DAY(), config.contractSizeHpsDay);
    // Check the delivery-date spacing
    assert.equal(await futures.read.expirationIntervalDays(), config.expirationIntervalDays);
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
    const { tc, pc, owner } = accounts;

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
    await hashrateOracle.write.setPrice([answer], { account: owner.account, chain: owner.chain });
    await futures.read.getMarketPrice();
  });

  it("reverts getMarketPrice with InvalidOracle when the feed answers with a non-positive value", async function () {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, hashrateOracle } = contracts;
    const { owner } = accounts;

    await hashrateOracle.write.setPrice([0n], { account: owner.account, chain: owner.chain });
    await viem.assertions.revertWithCustomError(
      futures.read.getMarketPrice(),
      futures,
      "InvalidOracle",
    );

    await hashrateOracle.write.setPrice([-1n], { account: owner.account, chain: owner.chain });
    await viem.assertions.revertWithCustomError(
      futures.read.getMarketPrice(),
      futures,
      "InvalidOracle",
    );
  });
});

describe("Futures - contract size (mark price)", function () {
  it("getMarketPrice rebases the oracle answer by contractSizeHpsDay / ORACLE_UNIT_HPS_DAY", async function () {
    const { contracts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, hashrateOracle } = contracts;

    const [, answer] = await hashrateOracle.read.latestRoundData();
    const contractSize = await futures.read.CONTRACT_SIZE_HPS_DAY();
    const oracleUnit = await futures.read.ORACLE_UNIT_HPS_DAY();
    const divisor = await futures.read.hashpriceScalingDivisor();
    const step = await futures.read.minimumPriceIncrement();

    const rebased = (answer * contractSize) / (divisor * oracleUnit);
    const rounded = ((rebased + step / 2n) / step) * step;

    assert.equal(await futures.read.getMarketPrice(), rounded);

    // CONTRACT_SIZE_HPS_DAY = 1 PH/s·day, so the mark is 10× the oracle's
    // per-100TH answer (rebased to token decimals).
    const perOracleUnit = answer / divisor;
    assert.equal(await futures.read.getMarketPrice(), perOracleUnit * 10n);
  });
});
