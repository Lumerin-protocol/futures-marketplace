import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { getAddress, zeroAddress } from "viem";
import { deployFuturesFixture } from "./fixtures";
import { catchError } from "../lib/lib";
describe("Futures - Initialization", function () {
  it("should initialize with correct parameters", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    // Check token address
    const tokenAddress = await futures.read.token();
    expect(getAddress(tokenAddress)).to.equal(getAddress(contracts.usdcMock.address));

    // Check hashrate oracle address (now serves the hashprice in USD; getter name kept for back-compat)
    const oracleAddress = await futures.read.hashrateOracle();
    expect(getAddress(oracleAddress)).to.equal(getAddress(contracts.hashrateOracle.address));

    // Check validator address
    const validatorAddress = await futures.read.validatorAddress();
    expect(getAddress(validatorAddress)).to.equal(getAddress(accounts.validator.account.address));

    // Check margin percentages
    const liquidationMarginPercent = await futures.read.liquidationMarginPercent();
    expect(liquidationMarginPercent).to.equal(config.liquidationMarginPercent);

    // Check speed
    const speed = await futures.read.speedHps();
    expect(speed).to.equal(config.speedHps);

    // Check delivery duration
    const deliveryDuration = await futures.read.deliveryDurationDays();
    expect(deliveryDuration).to.equal(config.deliveryDurationDays); // 7 days

    // Check breach penalty rate
    const breachPenaltyRate = await futures.read.breachPenaltyRatePerDay();
    expect(breachPenaltyRate).to.equal(0n);
  });

  it("should have correct ERC20 token details", async function () {
    const { contracts } = await loadFixture(deployFuturesFixture);
    const { futures, usdcMock } = contracts;

    const usdcSymbol = await usdcMock.read.symbol();

    const name = await futures.read.name();
    const symbol = await futures.read.symbol();
    const decimals = await futures.read.decimals();

    expect(name).to.equal(`Lumerin Futures ${usdcSymbol}`);
    expect(symbol).to.equal(`w${usdcSymbol}`);
    expect(decimals).to.equal(6);
  });

  it("should expose the configured oracle staleness window", async function () {
    const { contracts } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    expect(await futures.read.MAX_ORACLE_STALENESS()).to.equal(3600n);
  });
});

describe("Futures - Oracle staleness", function () {
  it("rejects setOracle with the zero address", async function () {
    const { contracts, accounts } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    await catchError(futures.abi, "InvalidOracle", async () => {
      await futures.write.setOracle([zeroAddress], { account: owner.account });
    });
  });

  it("reverts getMarketPrice with OracleStale once the answer ages past MAX_ORACLE_STALENESS", async function () {
    const { contracts, accounts } = await loadFixture(deployFuturesFixture);
    const { futures, hashrateOracle } = contracts;
    const { tc, pc } = accounts;

    // Sanity check: a fresh feed serves market price normally.
    await futures.read.getMarketPrice();

    const maxStaleness = await futures.read.MAX_ORACLE_STALENESS();
    const { timestamp: now } = await pc.getBlock({ blockTag: "latest" });
    await tc.setNextBlockTimestamp({ timestamp: now + maxStaleness + 2n });
    await tc.mine({ blocks: 1 });

    await catchError(futures.abi, "OracleStale", async () => {
      await futures.read.getMarketPrice();
    });

    // Pushing a fresh answer brings the feed back online without redeploying.
    const [, answer] = await hashrateOracle.read.latestRoundData();
    await hashrateOracle.write.setPrice([answer]);
    await futures.read.getMarketPrice();
  });

  it("reverts getMarketPrice with InvalidOracle when the feed answers with a non-positive value", async function () {
    const { contracts } = await loadFixture(deployFuturesFixture);
    const { futures, hashrateOracle } = contracts;

    await hashrateOracle.write.setPrice([0n]);
    await catchError(futures.abi, "InvalidOracle", async () => {
      await futures.read.getMarketPrice();
    });

    await hashrateOracle.write.setPrice([-1n]);
    await catchError(futures.abi, "InvalidOracle", async () => {
      await futures.read.getMarketPrice();
    });
  });
});
