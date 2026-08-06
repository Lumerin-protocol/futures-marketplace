import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData, getAddress, parseUnits, zeroAddress } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";

const { viem, networkHelpers } = await network.getOrCreate();

const FEED_DECIMALS = 8;

async function deployVault(collateralToken: `0x${string}`) {
  const impl = await viem.deployContract("CollateralVault", []);
  const proxy = await viem.deployContract("ERC1967Proxy", [
    impl.address,
    encodeFunctionData({ abi: impl.abi, functionName: "initialize", args: [collateralToken] }),
  ]);
  return await viem.getContractAt("CollateralVault", proxy.address);
}

/** A second engine, aggregating whichever vault it is pointed at. */
async function deployEngine(vaultAddress: `0x${string}`) {
  const impl = await viem.deployContract("PortfolioMarginEngine", []);
  const proxy = await viem.deployContract("ERC1967Proxy", [
    impl.address,
    encodeFunctionData({ abi: impl.abi, functionName: "initialize", args: [] }),
  ]);

  const pme = await viem.getContractAt("PortfolioMarginEngine", proxy.address);
  await pme.write.setVault([vaultAddress]);
  return pme;
}

describe("Futures - dependency validation", function () {
  describe("setPortfolioMargin", function () {
    it("rejects the zero address", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { owner } = accounts;

      await viem.assertions.revertWithCustomError(
        futures.write.setPortfolioMargin([zeroAddress], { account: owner.account }),
        futures,
        "ZeroAddress",
      );
    });

    it("rejects an address holding no code", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { owner, buyer } = accounts;

      await viem.assertions.revertWithCustomError(
        futures.write.setPortfolioMargin([buyer.account.address], { account: owner.account }),
        futures,
        "InvalidDependency",
      );
    });

    it("rejects a contract lacking the margin-engine surface", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, usdcMock } = contracts;
      const { owner } = accounts;

      await viem.assertions.revertWithCustomError(
        futures.write.setPortfolioMargin([usdcMock.address], { account: owner.account }),
        futures,
        "InvalidDependency",
      );
    });

    it("rejects an engine aggregating a different vault", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, usdcMock } = contracts;
      const { owner } = accounts;
      const strayEngine = await deployEngine((await deployVault(usdcMock.address)).address);

      await viem.assertions.revertWithCustomError(
        futures.write.setPortfolioMargin([strayEngine.address], { account: owner.account }),
        futures,
        "VaultMismatch",
      );
    });

    it("accepts an engine aggregating the venue's own vault", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { owner } = accounts;
      const engine = await deployEngine(collateralVault.address);

      await futures.write.setPortfolioMargin([engine.address], { account: owner.account });
      assert.equal(await futures.read.portfolioMargin(), getAddress(engine.address));
    });
  });

  describe("setOracle", function () {
    it("rejects the zero address", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { owner } = accounts;

      await viem.assertions.revertWithCustomError(
        futures.write.setOracle([zeroAddress], { account: owner.account }),
        futures,
        "InvalidOracle",
      );
    });

    it("rejects an address holding no code", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { owner, buyer } = accounts;

      await viem.assertions.revertWithCustomError(
        futures.write.setOracle([buyer.account.address], { account: owner.account }),
        futures,
        "InvalidDependency",
      );
    });

    it("rejects a contract that does not answer latestRoundData", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, usdcMock } = contracts;
      const { owner } = accounts;

      await viem.assertions.revertWithCustomError(
        futures.write.setOracle([usdcMock.address], { account: owner.account }),
        futures,
        "InvalidDependency",
      );
    });

    it("rejects a feed that has never answered", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { owner } = accounts;
      // Never had setPrice called, so it reads as price 0 on an uninitialized round —
      // adopting it would settle and mark every position at zero.
      const silentFeed = await viem.deployContract("PriceFeedMock", [FEED_DECIMALS, "silent"]);

      await viem.assertions.revertWithCustomError(
        futures.write.setOracle([silentFeed.address], { account: owner.account }),
        futures,
        "InvalidOracle",
      );
    });

    it("accepts a live feed", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { owner } = accounts;
      const feed = await viem.deployContract("PriceFeedMock", [FEED_DECIMALS, "live"]);
      await feed.write.setPrice([parseUnits("34.4", FEED_DECIMALS)]);

      await futures.write.setOracle([feed.address], { account: owner.account });
      assert.equal(await futures.read.priceOracle(), getAddress(feed.address));
    });
  });
});
