import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData } from "viem";
import { deployContract, deployFuturesFixture } from "./fixtures.ts";
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
const DAY = 86_400n;
const INTERVAL = 30n * DAY;

/**
 * N28: a futures date that falls near the estimated halving sits inside the halving window and
 * is priced at both ends of the range, and when the estimate drifts past a window edge its marks
 * step by the whole halving in one oracle round. The venue must keep its delivery dates away from
 * the estimate: a grid date near it is listed at a shifted date instead, and the grid date is not
 * tradable.
 *
 * A fresh venue with three dates (prd's count) on the real oracle chain, the halving estimated one
 * day after the second grid date.
 */
async function venueAroundHalving(etaOffsetFromSecondGridDate: bigint) {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { collateralVault: vault, portfolioMarginEngine: pme } = data.contracts;
  const { owner, buyer: alice, seller: bob, pc } = data.accounts;

  const btc = await viem.deployContract("HashpriceBTCMock", []);
  const btcUsd = await viem.deployContract("PriceFeedMock", [8, "BTC/USD"]);
  await btcUsd.write.setPrice([BTC_USD]);
  const hashpriceUSD = await viem.deployContract("HashpriceUSD", [btc.address, btcUsd.address]);
  const glideUSD = await viem.deployContract("HashpriceGlideUSD", [hashpriceUSD.address]);

  // Grid: the first date 30 days out at 12:00 UTC, then every 30 days.
  const now = BigInt(await networkHelpers.time.latest());
  const first = now + INTERVAL - ((now + INTERVAL) % DAY) + 12n * 3600n;
  const secondGridDate = first + INTERVAL;
  const eta = secondGridDate + etaOffsetFromSecondGridDate;
  await btc.write.setBlock([Number(HALVING - (eta - now) / 600n), FEES, DIFFICULTY]);

  const impl = await viem.deployContract("HashPowerFutures", [vault.address], {
    libraries: { FuturesBookLib: data.contracts.bookLib.address },
  });
  const proxy = await deployContract<"ERC1967Proxy">(
    owner,
    pc,
    "../artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json",
    [
      impl.address,
      encodeFunctionData({
        abi: impl.abi,
        functionName: "initialize",
        args: [glideUSD.address, 20, 3, first],
      }),
    ],
  );
  const futures = await viem.getContractAt("HashPowerFutures", proxy.address);
  await vault.write.setAuthorizedCaller([futures.address, true], { account: owner.account });
  await pme.write.setOracle([hashpriceUSD.address], { account: owner.account });
  await pme.write.addLinearMarket([futures.address], { account: owner.account });
  await pme.write.setShocks([(15n * WAD) / 100n, (10n * WAD) / 100n, 0n, 0n], { account: owner.account });
  await futures.write.setPortfolioMargin([pme.address], { account: owner.account });

  const index = await futures.read.getMarketPrice();
  // The fixture already approved the vault for every trader.
  for (const who of [alice, bob]) {
    await vault.write.deposit([index * 50n], { account: who.account });
  }

  return { ...data, futures, glideUSD, hashpriceUSD, first, secondGridDate, eta, index, alice, bob };
}

describe("N28 — delivery dates keep clear of the estimated halving", () => {
  it("lists no date priced on both sides of the halving, and the grid date near the estimate is not tradable", async () => {
    const s = await venueAroundHalving(DAY);
    const { futures } = s;

    const dates = await futures.read.getExpirationDates();
    assert.equal(dates.length, 3);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(dates[i] > dates[i - 1], "dates are strictly increasing");
      assert.ok(dates[i] - dates[i - 1] >= 15n * DAY, `dates ${i - 1} and ${i} are closer than 15 days`);
    }
    for (const date of dates) {
      const [low, high] = await futures.read.getMarkRange([date]);
      const toEta = date > s.eta ? date - s.eta : s.eta - date;
      console.log(`    date ${date} is ${toEta / DAY} days from the halving estimate, marks ${low}/${high}`);
      assert.equal(low, high, `date ${date} is inside the halving window`);
    }

    // The grid date one day before the estimate is not a delivery date any more.
    assert.ok(!dates.includes(s.secondGridDate), "the grid date near the estimate is still listed");
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([s.index, s.secondGridDate, 1n, TimeInForce.GTC], { account: s.alice.account }),
      futures,
      "ExpirationDateNotAvailable",
    );

    // Every listed date trades.
    for (const date of dates) {
      await futures.write.createOrder([s.index, date, -1n, TimeInForce.GTC], { account: s.bob.account });
      await futures.write.createOrder([s.index, date, 1n, TimeInForce.GTC], { account: s.alice.account });
      assert.equal((await futures.read.getUserPosition([s.alice.account.address, date])).netQuantity, 1n);
    }
  });

  it("the same with the estimate one day before the grid date", async () => {
    const s = await venueAroundHalving(-DAY);
    const dates = await s.futures.read.getExpirationDates();
    for (const date of dates) {
      const [low, high] = await s.futures.read.getMarkRange([date]);
      assert.equal(low, high, `date ${date} is inside the halving window`);
    }
    assert.ok(!dates.includes(s.secondGridDate), "the grid date near the estimate is still listed");
  });
});
