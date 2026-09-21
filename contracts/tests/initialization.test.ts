import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, zeroAddress } from "viem";
import { HashPowerFuturesAbi } from "../abi/HashPowerFutures.ts";
import { deployFuturesFixture } from "./fixtures.ts";

const { networkHelpers, viem } = await network.getOrCreate();

describe("Futures - Initialization", () => {
  it("should initialize with correct parameters", async () => {
    const { contracts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    // Check hashrate oracle address (now serves the hashprice in USD; getter name kept for back-compat)
    assert.equal(
      getAddress(await futures.read.priceOracle()),
      getAddress(contracts.hashpriceUsd.address),
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

  it("exposes version metadata in the runtime and generated ABI", async function () {
    const { contracts } = await networkHelpers.loadFixture(deployFuturesFixture);

    assert.equal(await contracts.futures.read.QUANTITY_DECIMALS(), 0);
    assert.ok(
      HashPowerFuturesAbi.some((item) => item.type === "function" && item.name === "VERSION"),
    );
    assert.ok(
      HashPowerFuturesAbi.some(
        (item) => item.type === "function" && item.name === "QUANTITY_DECIMALS",
      ),
    );
  });

  it("keeps the converged public ABI vocabulary", function () {
    const functionOutputs = (name: string) => {
      const item = HashPowerFuturesAbi.find(
        (candidate) => candidate.type === "function" && candidate.name === name,
      );
      assert.ok(item && "outputs" in item, `missing function ${name}`);
      return item.outputs.map((output) => output.name);
    };

    assert.deepEqual(functionOutputs("getOrderBookPrices"), ["bids", "asks"]);
    assert.deepEqual(functionOutputs("getUserOrdersAtExpiration"), ["orderIds"]);
    assert.deepEqual(functionOutputs("getOrderAggregateAtExpiration"), [""]);
    assert.deepEqual(functionOutputs("getQuantityAtPrice"), [""]);
    assert.deepEqual(functionOutputs("getRiskView"), ["view_"]);
    assert.deepEqual(functionOutputs("getUnrealizedPnl"), [""]);

    for (const name of ["InvalidQty", "InsufficientMarginBalance", "ValueOutOfRange"]) {
      assert.ok(
        HashPowerFuturesAbi.some((item) => item.type === "error" && item.name === name),
        `missing error ${name}`,
      );
    }

    const liquidation = HashPowerFuturesAbi.find(
      (item) => item.type === "event" && item.name === "PositionLiquidated",
    );
    assert.ok(liquidation && "inputs" in liquidation);
    assert.deepEqual(
      liquidation.inputs.map(({ name, indexed }) => ({ name, indexed })),
      [
        { name: "user", indexed: true },
        { name: "liquidator", indexed: true },
        { name: "expirationAt", indexed: false },
        { name: "closedQuantity", indexed: false },
        { name: "pnl", indexed: false },
        { name: "liquidatorFee", indexed: false },
      ],
    );
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
    const { futures, hashpriceUsd } = contracts;
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
    const [, answer] = await hashpriceUsd.read.latestRoundData();
    await hashpriceUsd.write.setPrice([answer], { account: owner.account, chain: owner.chain });
    await futures.read.getMarketPrice();
  });

  it("reverts getMarketPrice with InvalidOracle when the feed answers with a non-positive value", async function () {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, hashpriceUsd } = contracts;
    const { owner } = accounts;

    await hashpriceUsd.write.setPrice([0n], { account: owner.account, chain: owner.chain });
    await viem.assertions.revertWithCustomError(
      futures.read.getMarketPrice(),
      futures,
      "InvalidOracle",
    );

    await hashpriceUsd.write.setPrice([-1n], { account: owner.account, chain: owner.chain });
    await viem.assertions.revertWithCustomError(
      futures.read.getMarketPrice(),
      futures,
      "InvalidOracle",
    );
  });
});

describe("Futures - contract size (mark price)", function () {
  it("getMarketPrice scales the oracle answer to token decimals (no unit rebase)", async function () {
    const { contracts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, hashpriceUsd } = contracts;

    const [, answer] = await hashpriceUsd.read.latestRoundData();
    const contractSize = await futures.read.CONTRACT_SIZE_HPS_DAY();
    const step = await futures.read.minimumPriceIncrement();

    assert.equal(contractSize, 10n ** 15n, "one contract settles 1 PH/s/day");

    // Oracle has 8 decimals, token has 6 → scale down by 10^2 = 100.
    const divisor = 100n;
    const scaled = answer / divisor;
    const rounded = ((scaled + step / 2n) / step) * step;

    assert.equal(await futures.read.getMarketPrice(), rounded);
  });
});
