import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";

const { networkHelpers } = await network.getOrCreate();

describe("Futures - Initialization", () => {
  it("should initialize with correct parameters", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    assert.equal(getAddress(await futures.read.token()), getAddress(contracts.usdcMock.address));
    assert.equal(
      getAddress(await futures.read.hashrateOracle()),
      getAddress(contracts.hashrateOracle.address),
    );
    assert.equal(
      getAddress(await futures.read.validatorAddress()),
      getAddress(accounts.validator.account.address),
    );
    assert.equal(await futures.read.liquidationMarginPercent(), config.liquidationMarginPercent);
    assert.equal(await futures.read.speedHps(), config.speedHps);
    assert.equal(await futures.read.deliveryDurationDays(), config.deliveryDurationDays);
    assert.equal(await futures.read.breachPenaltyRatePerDay(), 0n);
  });

  it("should have correct decimals", async () => {
    const { contracts } = await networkHelpers.loadFixture(deployFuturesFixture);
    assert.equal(await contracts.futures.read.decimals(), 6);
  });
});
