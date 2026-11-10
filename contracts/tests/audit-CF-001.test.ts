import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { maxUint256, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { networkHelpers } = await network.getOrCreate();

/**
 * CF-001 (Critical, futures twin AH-FMC-001): order price has no upper bound and
 * `int256(price)` is an unchecked cast. A resting ask at P ≥ 2^255 (tick-aligned) is
 * accepted for almost no margin; when it is lifted the buyer's entry value wraps to an
 * attacker-chosen negative number and closing the position mints phantom PnL out of the
 * insurance fund.
 *
 * End-to-end exploit. The attack is run in full; the test asserts the safe invariant
 * (insurance fund not drained, attacker not enriched, no halt). On the unfixed venue the
 * attack succeeds and these assertions fail; once oversized prices are rejected at
 * placement the attack cannot start and the invariant holds.
 */
describe("CF-001 — wrapped order price cannot mint phantom PnL from the insurance fund", () => {
  // Futures entry value is qty * int256(P) with no 1e6 divisor. 2^256 mod 1e4 == 9936,
  // so P = 2^256 - (gain + 9936) is tick-aligned (tick = 0.01e6).
  const GAIN_USDC = 5_000n * 1_000_000n; // phantom gain (6dp), kept below the IF balance
  const X = GAIN_USDC + 9936n;
  const POISON_PRICE = maxUint256 - X + 1n;

  it("does not let an off-market ask socialise a loss onto the fund", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault: vault } = contracts;
    const { seller, buyer, buyer2 } = accounts;
    const expiry = config.deliveryDates[0];

    assert.equal(POISON_PRICE % config.priceLadderStep, 0n, "poison price is tick-aligned");

    const mark = await futures.read.getMarketPrice();

    // Honest resting bid at the mark gives the attacker an exit to realise against.
    await vault.write.deposit([parseUnits("1000", 6)], { account: buyer2.account });
    await futures.write.createOrder([mark, expiry, 1n, TimeInForce.GTC], { account: buyer2.account });

    // Attacker maker rests the poison ask; attacker taker will lift it.
    await vault.write.deposit([parseUnits("50", 6)], { account: seller.account });
    await vault.write.deposit([parseUnits("50", 6)], { account: buyer.account });

    const ifBefore = await vault.read.insuranceFundBalance();
    const takerBefore = await vault.read.balanceOf([buyer.account.address]);

    // Full attack: rest the poison ask, lift it, then close into the honest bid. Any step may
    // revert on a fixed venue; that is a valid (safe) outcome, so swallow reverts and judge by
    // the economic invariant below.
    try {
      await futures.write.createOrder([POISON_PRICE, expiry, -1n, TimeInForce.GTC], { account: seller.account });
      await futures.write.createOrder([POISON_PRICE, expiry, 1n, TimeInForce.IOC], { account: buyer.account });
      await futures.write.createOrder([mark, expiry, -1n, TimeInForce.IOC], { account: buyer.account });
    } catch {
      // placement/fill rejected — the attack never moved value
    }

    assert.ok(
      (await vault.read.insuranceFundBalance()) >= ifBefore,
      "insurance fund must not pay out a wrapped-price phantom gain",
    );
    assert.ok(
      (await vault.read.balanceOf([buyer.account.address])) <= takerBefore,
      "attacker must not realise a phantom gain",
    );
    assert.equal(await vault.read.halted(), false, "attack must not latch the vault halt");
  });
});
