import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits, zeroAddress } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { scaleHashprice } from "./utils.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

const WAD = 10n ** 18n; // PointsHook.WEIGHT_SCALE — weight 1 WAD == 1 point per notional unit.
const KEEPER_POINTS = parseUnits("10", 6); // flat keeper reward (POINTS has 6 decimals).

/**
 * Deploy the real `Points` ledger + `PointsHook` from collateral-margin and wire the roles:
 *   - the hook gets `MINTER_ROLE` on `Points`,
 *   - the futures venue gets `HOOK_CALLER_ROLE` on the hook (unless `grantCaller` is false,
 *     which exercises the "venue not authorized → fill/liquidation reverts" path).
 * Maker and taker weights are 1 WAD so minted points equal the trade notional.
 */
async function deployPointsStack(
  futuresAddress: `0x${string}`,
  owner: { account: { address: `0x${string}` } },
  grantCaller = true,
) {
  const admin = owner.account.address;
  const points = await viem.deployContract("Points", [admin]);
  const hook = await viem.deployContract("PointsHook", [
    points.address,
    admin,
    WAD,
    WAD,
    KEEPER_POINTS,
  ]);

  const minterRole = await points.read.MINTER_ROLE();
  await points.write.grantRole([minterRole, hook.address], { account: owner.account.address });

  if (grantCaller) {
    const callerRole = await hook.read.HOOK_CALLER_ROLE();
    await hook.write.grantRole([callerRole, futuresAddress], { account: owner.account.address });
  }

  return { points, hook };
}

describe("Futures - points hook wiring", function () {
  describe("setHook", function () {
    it("allows the owner to set the hook and emits HookUpdated", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { owner, pc } = accounts;

      const { hook } = await deployPointsStack(futures.address, owner);

      const tx = await futures.write.setHook([hook.address], { account: owner.account });
      const receipt = await pc.waitForTransactionReceipt({ hash: tx });
      const [{ args }] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "HookUpdated",
      });

      assert.equal(args.hook, getAddress(hook.address));
      assert.equal(await futures.read.hook(), getAddress(hook.address));
    });

    it("rejects an address holding no code", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { owner, buyer } = accounts;

      await viem.assertions.revertWithCustomError(
        futures.write.setHook([buyer.account.address], { account: owner.account }),
        futures,
        "InvalidDependency",
      );
    });

    it("reverts when a non-owner sets the hook", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { buyer } = accounts;

      await assert.rejects(
        futures.write.setHook([buyer.account.address], { account: buyer.account }),
      );
    });
  });

  describe("onFill", function () {
    it("mints points to the taker on a match (maker earns nothing when makerFee is 0)", async function () {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { owner, seller, buyer } = accounts;

      const { points, hook } = await deployPointsStack(futures.address, owner);
      await futures.write.setHook([hook.address], { account: owner.account });

      const price = await futures.read.getMarketPrice();
      const margin = price * 10n;
      const deliveryDate = config.deliveryDates[0];
      await collateralVault.write.deposit([margin], { account: seller.account });
      await collateralVault.write.deposit([margin], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], {
        account: seller.account,
      });
      await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
        account: buyer.account,
      });

      const notional = price;

      // wTaker == 1 WAD, so taker points == notional. makerFee is 0, so the maker earns nothing.
      assert.equal(
        await points.read.balanceOf([buyer.account.address]),
        notional,
        "taker earns notional",
      );
      assert.equal(
        await points.read.balanceOf([seller.account.address]),
        0n,
        "maker earns nothing",
      );
    });

    it("does not mint (or revert) when no hook is configured", async function () {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer } = accounts;

      const price = await futures.read.getMarketPrice();
      const margin = price * 10n;
      const deliveryDate = config.deliveryDates[0];
      await collateralVault.write.deposit([margin], { account: seller.account });
      await collateralVault.write.deposit([margin], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], {
        account: seller.account,
      });
      await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
        account: buyer.account,
      });
      assert.equal(await futures.read.hook(), zeroAddress);
    });

    it("reverts the fill when the venue lacks HOOK_CALLER_ROLE (no try/catch isolation)", async function () {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { owner, seller, buyer } = accounts;

      const { hook } = await deployPointsStack(futures.address, owner, false);
      await futures.write.setHook([hook.address], { account: owner.account });

      const price = await futures.read.getMarketPrice();
      const margin = price * 10n;
      const deliveryDate = config.deliveryDates[0];
      await collateralVault.write.deposit([margin], { account: seller.account });
      await collateralVault.write.deposit([margin], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], {
        account: seller.account,
      });
      await assert.rejects(
        futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
          account: buyer.account,
        }),
      );
    });
  });

  describe("maker price-improvement multiplier", function () {
    it("boosts maker points when the resting quote sits at the oracle price", async function () {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { owner, seller, buyer } = accounts;

      const { points, hook } = await deployPointsStack(futures.address, owner);
      await futures.write.setHook([hook.address], { account: owner.account });

      // Maker must pay a positive fee to earn; enable a 3x bonus tapering over a 1% spread.
      await futures.write.setMakerFeeBps([1], { account: owner.account });
      await hook.write.setPriceImprovement([3n * WAD, WAD / 100n], { account: owner.account });

      const price = await futures.read.getMarketPrice();
      const margin = price * 10n;
      const deliveryDate = config.deliveryDates[0];
      await collateralVault.write.deposit([margin], { account: seller.account });
      await collateralVault.write.deposit([margin], { account: buyer.account });

      // Seller rests at the oracle price (spread 0 → full 3x), buyer takes.
      await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], {
        account: seller.account,
      });
      await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
        account: buyer.account,
      });

      const notional = price;

      // wMaker == 1 WAD and the maker quoted at the reference price → 3x notional.
      assert.equal(
        await points.read.balanceOf([seller.account.address]),
        notional * 3n,
        "maker earns 3x at zero spread",
      );
      // The taker is unaffected by the maker multiplier.
      assert.equal(
        await points.read.balanceOf([buyer.account.address]),
        notional,
        "taker earns notional",
      );
    });
  });

  describe("onLiquidation", function () {
    async function underwaterPosition(grantCaller = true) {
      const data = await networkHelpers.loadFixture(deployFuturesFixture);
      const { contracts, accounts, config } = data;
      const { futures, collateralVault } = contracts;
      const { owner, seller, buyer, buyer2, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const deliveryDate = config.deliveryDates[0];
      // A long contract's loss is bounded by its entry price (the mark can't go
      // below zero), so the deposit must sit above entry IM but below the
      // maintenance margin after the crash to be liquidatable with one contract.
      const positionMargin = price / 2n;

      await collateralVault.write.deposit([positionMargin], { account: seller.account });
      await collateralVault.write.deposit([positionMargin], { account: buyer.account });
      await collateralVault.write.deposit([positionMargin], { account: buyer2.account });

      // Open the matched position BEFORE plugging in the hook, so the fill path is unaffected
      // and only the liquidation path exercises the hook.
      await futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.GTC], {
        account: seller.account,
      });
      await futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
        account: buyer.account,
      });

      const { points, hook } = await deployPointsStack(futures.address, owner, grantCaller);
      await futures.write.setHook([hook.address], { account: owner.account });

      return {
        ...data,
        points,
        hook,
        deliveryDate,
        async makeUnderwater() {
          await scaleHashprice(contracts.hashpriceUsd, 100n, 300n);
        },
      };
    }

    it("mints flat keeper points to the liquidator on a position liquidation", async function () {
      const data = await underwaterPosition();
      const { contracts, accounts, points, deliveryDate } = data;
      const { futures } = contracts;
      const { buyer, buyer2 } = accounts;

      await data.makeUnderwater();
      await futures.write.liquidatePosition([buyer.account.address, deliveryDate, 1n], {
        account: buyer2.account,
      });

      assert.equal(await points.read.balanceOf([buyer2.account.address]), KEEPER_POINTS);
    });

    it("reverts the liquidation when the venue lacks HOOK_CALLER_ROLE", async function () {
      const data = await underwaterPosition(false);
      const { contracts, accounts, deliveryDate } = data;
      const { futures } = contracts;
      const { buyer, buyer2 } = accounts;

      await data.makeUnderwater();
      await assert.rejects(
        futures.write.liquidatePosition([buyer.account.address, deliveryDate, 1n], {
          account: buyer2.account,
        }),
      );
    });
  });
});
