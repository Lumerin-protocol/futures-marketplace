import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { networkHelpers } = await network.getOrCreate();

/**
 * CF-022 (futures canonical AH-FMC-003): a match realizes the maker before the taker, each
 * against the insurance fund. A colluding pair closes at an off-market price so the maker's gain
 * exceeds the fund plus cap headroom: the fund borrows, the vault halts, and the taker's equal
 * loss repays the debt a moment later while withdrawals and orders stay frozen.
 */
describe("CF-022 — a zero-sum futures match cannot leave the vault halted", () => {
  it("does not halt when a maker's gain is repaid by the taker in the same match", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault: vault } = contracts;
    const { seller: alice, buyer: bob, owner } = accounts;
    const expiry = config.deliveryDates[0];
    const unit = (n: string) => parseUnits(n, 6);
    const Q = 100n;

    // Mainnet fund balance and prd cap.
    const fund = await vault.read.insuranceFundBalance();
    await vault.write.withdrawInsuranceFund([owner.account.address, fund - 143_273n], { account: owner.account });
    await vault.write.setInsuranceDebtCap([unit("2000")], { account: owner.account });
    await vault.write.deposit([unit("1000")], { account: alice.account });
    await vault.write.deposit([unit("3000")], { account: bob.account });

    const mark = await futures.read.getMarketPrice();
    const close = mark + unit("25");

    await futures.write.createOrder([mark, expiry, Q, TimeInForce.GTC], { account: alice.account });
    await futures.write.createOrder([mark, expiry, -Q, TimeInForce.IOC], { account: bob.account });

    const fundBefore = await vault.read.insuranceFundBalance();
    const gain = (close - mark) * Q;
    assert.ok(gain > fundBefore + unit("2000"), "the maker's gain must exceed the fund plus cap headroom");

    await futures.write.createOrder([close, expiry, -Q, TimeInForce.GTC], { account: alice.account });
    await futures.write.createOrder([close, expiry, Q, TimeInForce.IOC], { account: bob.account });

    assert.equal(await futures.read.getUserPosition([alice.account.address, expiry]).then((p) => p.netQuantity), 0n);
    assert.equal(await vault.read.insuranceDebt(), 0n);
    assert.equal(await vault.read.insuranceFundBalance(), fundBefore);
    assert.equal(await vault.read.halted(), false, "a zero-sum match must not halt the vault");
  });
});
