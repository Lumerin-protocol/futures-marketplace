import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { maxUint256, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";
import { scaleHashprice } from "./utils.ts";

const { networkHelpers } = await network.getOrCreate();

/**
 * CF-007 (High, futures twin AH-FMC-004): the resting-order fill-loss reserve is
 * `max(0, Σvalue − Σqty·mark)` per side, so a deep decoy bid nets away the loss of a bid
 * priced above the mark. Fills go best price first, so the hidden bid fills alone and its
 * maker is left with a loss far above its margin.
 *
 * End-to-end exploits on the real vault + PME + venue. Attack steps may revert on a fixed
 * venue; the tests assert the safe invariant: the colluding accounts end with no more than
 * they deposited, the insurance fund is not drained, and nothing halts.
 */
describe("CF-007 — decoy orders cannot hide a resting order's fill loss", () => {
  async function setup() {
    const fixture = await networkHelpers.loadFixture(deployFuturesFixture);
    const { seller: alice, buyer: bob, buyer2: carol, validator: keeper } = fixture.accounts;
    return { ...fixture, alice, bob, carol, keeper, expiry: fixture.config.deliveryDates[0] };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  async function deposit(f: Setup, amounts: { alice: bigint; bob: bigint; carol: bigint }) {
    const vault = f.contracts.collateralVault;
    await vault.write.deposit([amounts.alice], { account: f.alice.account });
    await vault.write.deposit([amounts.bob], { account: f.bob.account });
    await vault.write.deposit([amounts.carol], { account: f.carol.account });
    return amounts.alice + amounts.bob + amounts.carol;
  }

  async function liquidateAlice(f: Setup) {
    const { futures } = f.contracts;
    const alice = f.alice.account.address;
    const ids = await futures.read.getUserOrdersAtExpiration([alice, f.expiry]);
    if (ids.length > 0) await futures.write.liquidateOrders([alice, ids], { account: f.keeper.account });
    await futures.write.liquidatePosition([alice, f.expiry, maxUint256], { account: f.keeper.account });
  }

  async function assertSafe(f: Setup, deposited: bigint, ifBefore: bigint) {
    const vault = f.contracts.collateralVault;
    const held =
      (await vault.read.balanceOf([f.alice.account.address])) +
      (await vault.read.balanceOf([f.bob.account.address])) +
      (await vault.read.balanceOf([f.carol.account.address]));
    assert.ok(held <= deposited, "colluding accounts must not end with more than they deposited");
    assert.ok((await vault.read.insuranceFundBalance()) >= ifBefore, "insurance fund must not pay a hidden loss");
    assert.equal(await vault.read.halted(), false, "attack must not latch the vault halt");
  }

  it("static: a decoy cannot hide a bid resting far above the mark", async () => {
    const f = await setup();
    const { futures, collateralVault: vault } = f.contracts;
    const Q = 100n;
    const mark = await futures.read.getMarketPrice();
    const high = mark * 2n;
    const deep = f.config.priceLadderStep;

    const deposited = await deposit(f, { alice: parseUnits("1500", 6), bob: parseUnits("1000", 6), carol: parseUnits("1000", 6) });
    await futures.write.createOrder([deep, f.expiry, Q, TimeInForce.GTC], { account: f.alice.account });
    const ifBefore = await vault.read.insuranceFundBalance();

    try {
      await futures.write.createOrder([high, f.expiry, Q, TimeInForce.GTC], { account: f.alice.account });
      await futures.write.createOrder([high, f.expiry, -Q, TimeInForce.IOC], { account: f.bob.account });
      await liquidateAlice(f);
      await futures.write.createOrder([mark, f.expiry, -Q, TimeInForce.GTC], { account: f.carol.account });
      await futures.write.createOrder([mark, f.expiry, Q, TimeInForce.IOC], { account: f.bob.account });
    } catch {
      // attack step rejected — no value moved
    }

    await assertSafe(f, deposited, ifBefore);
  });

  it("patient: decoys cannot hide a resting bid's growing loss from keepers during a slide", async () => {
    const f = await setup();
    const { futures, collateralVault: vault, portfolioMarginEngine: pme, hashpriceUsd } = f.contracts;
    const Q = 100n;
    const mark0 = await futures.read.getMarketPrice();
    const deep = f.config.priceLadderStep;

    const deposited = await deposit(f, { alice: parseUnits("2000", 6), bob: parseUnits("1000", 6), carol: parseUnits("1000", 6) });
    const ifBefore = await vault.read.insuranceFundBalance();

    try {
      await futures.write.createOrder([mark0, f.expiry, Q, TimeInForce.GTC], { account: f.alice.account });
      await futures.write.createOrder([deep, f.expiry, (Q * 3n) / 2n, TimeInForce.GTC], { account: f.alice.account });
    } catch {
      // placement rejected — no value moved
    }

    // The mark slides 5% per step. A keeper cancels Alice's orders as soon as the engine
    // reports her liquidatable.
    for (let step = 0; step < 20; step++) {
      await scaleHashprice(hashpriceUsd, 95n, 100n);
      if (await pme.read.isLiquidatable([f.alice.account.address])) {
        const ids = await futures.read.getUserOrdersAtExpiration([f.alice.account.address, f.expiry]);
        if (ids.length > 0) {
          await futures.write.liquidateOrders([f.alice.account.address, ids], { account: f.keeper.account });
        }
      }
    }

    try {
      const mark = await futures.read.getMarketPrice();
      await futures.write.createOrder([mark0, f.expiry, -Q, TimeInForce.IOC], { account: f.bob.account });
      await liquidateAlice(f);
      await futures.write.createOrder([mark, f.expiry, -Q, TimeInForce.GTC], { account: f.carol.account });
      await futures.write.createOrder([mark, f.expiry, Q, TimeInForce.IOC], { account: f.bob.account });
    } catch {
      // stale bid already cancelled by the keeper — no value moved
    }

    await assertSafe(f, deposited, ifBefore);
  });
});
