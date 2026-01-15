import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { parseUnits, getAddress } from "viem";
import { deployFuturesFixture } from "./fixtures";
describe("Futures - Initialization", function () {
  it("should initialize with correct parameters", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    // Check token address
    const tokenAddress = await futures.read.token();
    expect(getAddress(tokenAddress)).to.equal(getAddress(contracts.usdcMock.address));

    // Check hashrate oracle address
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
});
