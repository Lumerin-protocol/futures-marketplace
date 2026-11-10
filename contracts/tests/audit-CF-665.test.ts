import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { refreshHashprice, scaleHashprice } from "./utils.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

const unit = (n: string) => parseUnits(n, 6);
/** 1,000 contracts: $34.4k of notional at the fixture mark. */
const Q = 1_000n;
/** Covers the colluder's resting calendar until the attacker lifts it (20% IM shock). */
const COLLUDER_DEPOSIT = unit("10000");
const HONEST_DEPOSIT = unit("10000");

/**
 * CF-665 / CF-666 / CF-669 (Critical): the margin engine nets an account's offsetting legs, so a
 * calendar (short one expiry, long another) needs no collateral, but the venue realizes each leg
 * on its own against the vault. Realizing the losing leg first writes its loss off to the
 * insurance fund at a zero balance; the winning leg is then paid in full. Expiry settlement and
 * reducing fills are permissionless, so the attacker picks the order.
 *
 * End-to-end exploit on the real vault. Setup runs normally; the extraction steps may revert on
 * a fixed stack. The test asserts the safe invariant: the attacking accounts end with no more
 * than they put in, the fund is not drained, nothing is borrowed and nothing halts.
 */
describe("CF-665 — offsetting legs realized loser-first cannot drain the insurance fund", () => {
  async function setup() {
    const ctx = await networkHelpers.loadFixture(deployFuturesFixture);
    const wallets = await viem.getWalletClients();
    // A fresh account that never deposits: everything it ends up with came from the fund.
    const attacker = wallets[8];
    const [e1, e2] = ctx.config.deliveryDates;
    const p0 = await ctx.contracts.futures.read.getMarketPrice();
    return { ...ctx, attacker, e1, e2, p0 };
  }

  type Ctx = Awaited<ReturnType<typeof setup>>;
  type Wallet = Ctx["attacker"];

  async function wealth(ctx: Ctx, accounts: Wallet[]) {
    let total = 0n;
    for (const a of accounts) {
      total += await ctx.contracts.usdcMock.read.balanceOf([a.account.address]);
      total += await ctx.contracts.collateralVault.read.balanceOf([a.account.address]);
    }
    return total;
  }

  async function withdrawAll(ctx: Ctx, a: Wallet) {
    const { collateralVault: vault } = ctx.contracts;
    const bal = await vault.read.balanceOf([a.account.address]);
    if (bal > 0n) await vault.write.withdraw([bal], { account: a.account });
  }

  /** `maker` rests the calendar, the zero-balance `taker` lifts both legs in one batch. */
  async function openCalendar(ctx: Ctx, maker: Wallet, taker: Wallet) {
    const { futures, collateralVault: vault } = ctx.contracts;
    const { e1, e2, p0 } = ctx;
    await vault.write.deposit([COLLUDER_DEPOSIT], { account: maker.account });
    await futures.write.createOrders(
      [
        [
          { price: p0, expirationAt: e1, quantity: Q, timeInForce: TimeInForce.GTC },
          { price: p0, expirationAt: e2, quantity: -Q, timeInForce: TimeInForce.GTC },
        ],
      ],
      { account: maker.account },
    );
    await futures.write.createOrders(
      [
        [
          { price: p0, expirationAt: e1, quantity: -Q, timeInForce: TimeInForce.IOC },
          { price: p0, expirationAt: e2, quantity: Q, timeInForce: TimeInForce.IOC },
        ],
      ],
      { account: taker.account },
    );
    await withdrawAll(ctx, maker);
  }

  /** Move the mark by `num / den` and make the next transaction land at `expiry`. */
  async function matureWithMovedMark(ctx: Ctx, expiry: bigint, num: bigint, den: bigint) {
    await scaleHashprice(ctx.contracts.hashpriceUsd, num, den);
    await refreshHashprice(ctx.contracts.hashpriceUsd, expiry);
    await ctx.accounts.tc.setNextBlockTimestamp({ timestamp: expiry });
  }

  async function assertFundWhole(ctx: Ctx, fundBefore: bigint) {
    const { collateralVault: vault } = ctx.contracts;
    assert.ok((await vault.read.insuranceFundBalance()) >= fundBefore, "insurance fund must not be drained");
    assert.equal(await vault.read.insuranceDebt(), 0n, "nothing may be borrowed against the fund");
    assert.equal(await vault.read.halted(), false, "the attack must not latch the vault halt");
  }

  /**
   * CF-665: a colluding pair, both at zero balance once the calendar is open. At e1 the e1 loser
   * is settled first, then the e2 loser closes as the maker against the e2 winner, then the e1
   * winner settles. Each loss is written off and each gain is paid by the fund.
   */
  async function calendarPairLoserFirst(num: bigint, den: bigint) {
    const ctx = await setup();
    const { futures } = ctx.contracts;
    const { attacker: x, e1, e2 } = ctx;
    const { seller: y, validator: keeper } = ctx.accounts;
    const before = await wealth(ctx, [x, y]);

    await openCalendar(ctx, y, x);
    const fundBefore = await ctx.contracts.collateralVault.read.insuranceFundBalance();
    await matureWithMovedMark(ctx, e1, num, den);
    const up = num > den;
    // x is short e1 and long e2; y holds the mirror image.
    const e1Loser = up ? x : y;
    const e1Winner = up ? y : x;

    try {
      await futures.write.settlePosition([e1Loser.account.address, e1], { account: keeper.account });
      const p1 = await futures.read.getMarketPrice();
      // The e1 winner holds the losing e2 leg: it rests the reducing order, so its loss is
      // realized as a maker; the e1 loser takes it and collects its e2 gain.
      const e2LoserQty = (await futures.read.getUserPosition([e1Winner.account.address, e2])).netQuantity;
      await futures.write.createOrder([p1, e2, -e2LoserQty, TimeInForce.GTC], { account: e1Winner.account });
      await futures.write.createOrder([p1, e2, e2LoserQty, TimeInForce.IOC], { account: e1Loser.account });
      await futures.write.settlePosition([e1Winner.account.address, e1], { account: keeper.account });
      await withdrawAll(ctx, x);
      await withdrawAll(ctx, y);
    } catch {
      // extraction refused — no value moved
    }

    assert.ok((await wealth(ctx, [x, y])) <= before, "colluding pair must not end with more than it put in");
    await assertFundWhole(ctx, fundBefore);
  }

  it("CF-665: a zero-capital calendar pair settled loser-first extracts nothing (mark up)", async () => {
    await calendarPairLoserFirst(110n, 100n);
  });

  it("CF-665: a zero-capital calendar pair settled loser-first extracts nothing (mark down)", async () => {
    await calendarPairLoserFirst(90n, 100n);
  });

  it("CF-666: settling a zero-capital account's losing expiry first does not let it keep its other gain", async () => {
    const ctx = await setup();
    const { futures, collateralVault: vault } = ctx.contracts;
    const { attacker: x, e1, e2, p0 } = ctx;
    const { buyer: carol, buyer2: dave, validator: keeper } = ctx.accounts;

    // Honest, fully collateralized makers on both expiries; x lifts both at zero balance.
    await vault.write.deposit([HONEST_DEPOSIT], { account: carol.account });
    await vault.write.deposit([HONEST_DEPOSIT], { account: dave.account });
    await futures.write.createOrder([p0, e1, Q, TimeInForce.GTC], { account: carol.account });
    await futures.write.createOrder([p0, e2, -Q, TimeInForce.GTC], { account: dave.account });
    await futures.write.createOrders(
      [
        [
          { price: p0, expirationAt: e1, quantity: -Q, timeInForce: TimeInForce.IOC },
          { price: p0, expirationAt: e2, quantity: Q, timeInForce: TimeInForce.IOC },
        ],
      ],
      { account: x.account },
    );
    const fundBefore = await vault.read.insuranceFundBalance();
    await matureWithMovedMark(ctx, e1, 110n, 100n);

    try {
      // The keeper settles every matured leg; x's losing e1 short goes first.
      await futures.write.settlePosition([x.account.address, e1], { account: keeper.account });
      await futures.write.settlePosition([carol.account.address, e1], { account: keeper.account });
      const p1 = await futures.read.getMarketPrice();
      // Dave buys back his short e2 and pays his loss; x sells its long e2 into it.
      await futures.write.createOrder([p1, e2, Q, TimeInForce.GTC], { account: dave.account });
      await futures.write.createOrder([p1, e2, -Q, TimeInForce.IOC], { account: x.account });
      await withdrawAll(ctx, x);
    } catch {
      // extraction refused — no value moved
    }

    assert.equal(await wealth(ctx, [x]), 0n, "a zero-capital account must not take value from the fund");
    await assertFundWhole(ctx, fundBefore);
  });

  it("CF-669: closing the losing legs first before expiry does not let the pair keep the gains", async () => {
    const ctx = await setup();
    const { futures, collateralVault: vault } = ctx.contracts;
    const { attacker: x, e1, e2 } = ctx;
    const { seller: y, buyer: carol, buyer2: dave } = ctx.accounts;
    const before = await wealth(ctx, [x, y]);

    await openCalendar(ctx, y, x);
    await vault.write.deposit([HONEST_DEPOSIT], { account: carol.account });
    await vault.write.deposit([HONEST_DEPOSIT], { account: dave.account });
    const fundBefore = await vault.read.insuranceFundBalance();
    // A move past the 20% shock: once the losing leg is gone, the winning leg's own gain covers
    // its margin, so each close is allowed as locally reducing.
    await scaleHashprice(ctx.contracts.hashpriceUsd, 130n, 100n);
    const p1 = await futures.read.getMarketPrice();

    try {
      // x is short e1 (losing): it rests the reducing bid and Carol sells into it.
      await futures.write.createOrder([p1, e1, Q, TimeInForce.GTC], { account: x.account });
      await futures.write.createOrder([p1, e1, -Q, TimeInForce.IOC], { account: carol.account });
      // y is short e2 (losing): same, against Dave.
      await futures.write.createOrder([p1, e2, Q, TimeInForce.GTC], { account: y.account });
      await futures.write.createOrder([p1, e2, -Q, TimeInForce.IOC], { account: dave.account });
      // Both now close their winning legs as takers against the honest accounts.
      await futures.write.createOrder([p1, e2, Q, TimeInForce.GTC], { account: carol.account });
      await futures.write.createOrder([p1, e2, -Q, TimeInForce.IOC], { account: x.account });
      await futures.write.createOrder([p1, e1, -Q, TimeInForce.GTC], { account: dave.account });
      await futures.write.createOrder([p1, e1, Q, TimeInForce.IOC], { account: y.account });
      await withdrawAll(ctx, x);
      await withdrawAll(ctx, y);
    } catch {
      // extraction refused — no value moved
    }

    assert.ok((await wealth(ctx, [x, y])) <= before, "colluding pair must not end with more than it put in");
    await assertFundWhole(ctx, fundBefore);
  });
});
