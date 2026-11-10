import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/** Fee average at the 2026 level: a halving step of about 49.5%. */
const FEES = 3_150_000n;
/** About 150 T. */
const DIFFICULTY = 150_000_000_000_000n;
/** BTC/USD $100,000 (8 decimals): with the values above the index is about $42 per PH/s/day. */
const BTC_USD = 10_000_000_000_000n;
const WAD = 10n ** 18n;
const HALVING = 1_050_000n;

/**
 * CF-321 on futures: a colluding pair trades a date that settles after the halving at the full
 * index. The engine and the venue read `HashpriceUSD` over a mock Bitcoin height; the halving's
 * estimated date sits between the first two listed dates, so the second settles post-halving.
 */
async function halvingFixture() {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { futures, collateralVault: vault, portfolioMarginEngine: pme } = data.contracts;
  const { owner } = data.accounts;
  const [first, second] = data.config.deliveryDates;

  await futures.write.setMakerFeeBps([0], { account: owner.account });
  await futures.write.setTakerFeeBps([0], { account: owner.account });

  const btc = await viem.deployContract("HashpriceBTCMock", []);
  const btcUsd = await viem.deployContract("PriceFeedMock", [8, "BTC/USD"]);
  await btcUsd.write.setPrice([BTC_USD]);
  const now = BigInt(await networkHelpers.time.latest());
  // Halving estimated half way between the two dates.
  const eta = (first + second) / 2n;
  const relay = (height: bigint) => btc.write.setBlock([Number(height), FEES, DIFFICULTY]);
  await relay(HALVING - (eta - now) / 600n);
  const hashpriceUSD = await viem.deployContract("HashpriceUSD", [btc.address, btcUsd.address]);
  const glideUSD = await viem.deployContract("HashpriceGlideUSD", [hashpriceUSD.address]);

  await pme.write.setOracle([hashpriceUSD.address], { account: owner.account });
  await pme.write.setShocks([(15n * WAD) / 100n, (10n * WAD) / 100n, 0n, 0n], { account: owner.account });

  /** Refresh both inputs at the current time, the halving relayed if `height` is past it. */
  async function relayAt(height: bigint) {
    await relay(height);
    await btcUsd.write.setPrice([BTC_USD]);
  }

  return { ...data, vault, btcUsd, hashpriceUSD, glideUSD, first, second, eta, relayAt };
}

describe("CF-321 — a colluding pair on a futures date that settles after the halving", () => {
  it("the protocol pays nothing: a long bought at the full index posts the halving gap or is refused", async () => {
    const s = await halvingFixture();
    const { futures } = s.contracts;
    const { vault } = s;
    const { owner, seller: bob, buyer: alice } = s.accounts;

    // The venue values each expiry at the schedule's marks, on their index (the fix).
    try {
      await futures.write.setOracle([s.glideUSD.address], { account: owner.account });
    } catch {
      // No per-expiry marks.
    }

    const qty = 100n;
    const price = await futures.read.getMarketPrice();
    // Alice holds 20% of the position at the index: enough for IM 15% when it is valued there.
    const aliceDeposit = (price * qty * 20n) / 100n;
    await vault.write.deposit([aliceDeposit], { account: alice.account });
    await vault.write.deposit([price * qty], { account: bob.account });
    const pairBefore =
      (await vault.read.balanceOf([alice.account.address])) + (await vault.read.balanceOf([bob.account.address]));

    await futures.write.createOrder([price, s.second, -qty, TimeInForce.GTC], { account: bob.account });
    try {
      await futures.write.createOrder([price, s.second, qty, TimeInForce.GTC], { account: alice.account });
    } catch {
      // A venue valuing the date post-halving rejects a long this thin.
    }

    // The halving arrives near its estimate; the date then settles at the post-halving index.
    await networkHelpers.time.increaseTo(s.eta);
    await s.relayAt(HALVING);
    await networkHelpers.time.increaseTo(s.second + 1n);
    await s.relayAt(HALVING + (s.second - s.eta) / 600n);
    await futures.write.recordSettlementPrice([s.second]);
    for (const who of [alice, bob]) {
      if ((await futures.read.getUserPosition([who.account.address, s.second])).netQuantity !== 0n) {
        await futures.write.settlePosition([who.account.address, s.second]);
      }
    }

    const pairAfter =
      (await vault.read.balanceOf([alice.account.address])) + (await vault.read.balanceOf([bob.account.address]));
    const loss = pairAfter - pairBefore;
    console.log(`    protocol loss ${loss} (token units), position value at entry ${price * qty}`);
    assert.equal(loss, 0n, "the protocol pays for the halving");
  });
});
