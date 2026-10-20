import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { networkHelpers } = await network.getOrCreate();

/**
 * CF-002 (Critical, futures twin AH-FMC-005): fills execute at the maker's price with no band
 * against the oracle mark. 6.8.0 makes a losing *taker* pay in full, but a losing *maker*
 * still takes the bad-debt path, so the maker-loss direction stays open: a short maker rests
 * a far-above-mark reducing bid (cheap, because a deep bid nets its fill-loss reserve away), a
 * colluder sells into it, the maker's loss is written off, and the fund pays the colluder.
 *
 * End-to-end exploit. Setup runs normally; the off-market fill and the extraction are allowed
 * to revert on a fixed venue. The test asserts the safe invariant: the colluding accounts end
 * with no more than they deposited, the fund is not drained, and nothing halts.
 */
describe("CF-002 — an off-market maker fill cannot shift its loss onto the insurance fund", () => {
  it("does not let a colluding pair extract an off-market maker loss from the fund", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault: vault } = contracts;
    const { seller: alice, buyer: bob, buyer2: carol } = accounts;
    const expiry = config.deliveryDates[0];
    const unit = (n: string) => parseUnits(n, 6);
    const Q = 100n;

    const mark = await futures.read.getMarketPrice();
    const offMarket = parseUnits("140", 6); // ~4x mark, far outside any band
    const deep = config.priceLadderStep; // one-tick bid that only nets the fill-loss reserve

    // The futures fixture stresses IM at 20%, so the colluders need more than on perps: Alice to
    // rest both bids, Bob to open the short that lifts the off-market bid.
    const deposits = { alice: unit("2500"), bob: unit("1000"), carol: unit("1000") };
    await vault.write.deposit([deposits.alice], { account: alice.account });
    await vault.write.deposit([deposits.bob], { account: bob.account });
    await vault.write.deposit([deposits.carol], { account: carol.account });
    const deposited = deposits.alice + deposits.bob + deposits.carol;

    // Alice opens a short at the mark against Carol.
    await futures.write.createOrder([mark, expiry, Q, TimeInForce.GTC], { account: carol.account });
    await futures.write.createOrder([mark, expiry, -Q, TimeInForce.IOC], { account: alice.account });
    // Deep bid nets the per-side fill-loss reserve, so the off-market reducing bid rests cheaply.
    // The off-market bid itself is placed inside the attack block: a venue that reserves its
    // full fill loss rejects it, which is a safe outcome.
    await futures.write.createOrder([deep, expiry, 3n * Q, TimeInForce.GTC], { account: alice.account });

    const ifBefore = await vault.read.insuranceFundBalance();

    try {
      await futures.write.createOrder([offMarket, expiry, Q, TimeInForce.GTC], { account: alice.account });
      // Bob sells into Alice's off-market bid: Alice (maker) realises the loss on the bad-debt path.
      await futures.write.createOrder([offMarket, expiry, -Q, TimeInForce.IOC], { account: bob.account });
      // Bob closes at the mark against Carol; the fund pays Bob's off-market gain.
      await futures.write.createOrder([mark, expiry, -Q, TimeInForce.GTC], { account: carol.account });
      await futures.write.createOrder([mark, expiry, Q, TimeInForce.IOC], { account: bob.account });
    } catch {
      // off-market fill refused — no value moved
    }

    const held =
      (await vault.read.balanceOf([alice.account.address])) +
      (await vault.read.balanceOf([bob.account.address])) +
      (await vault.read.balanceOf([carol.account.address]));
    assert.ok(held <= deposited, "colluding accounts must not end with more than they deposited");
    assert.ok(
      (await vault.read.insuranceFundBalance()) >= ifBefore,
      "insurance fund must not pay out an off-market maker loss",
    );
    assert.equal(await vault.read.halted(), false, "attack must not latch the vault halt");
  });
});
