import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, zeroAddress } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

const FEES = 3_150_000n;
const DIFFICULTY = 150_000_000_000_000n;
const BTC_USD = 10_000_000_000_000n;
const WAD = 10n ** 18n;
const HALVING = 1_050_000n;

/**
 * Futures on the real oracle chain with the halving estimated at `etaOf(first, second)`, marking
 * off `HashpriceGlideUSD` and settling on its `HashpriceUSD`.
 */
async function marksFixture(etaOf: (first: bigint, second: bigint) => bigint) {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { futures, portfolioMarginEngine: pme } = data.contracts;
  const { owner } = data.accounts;
  const [first, second] = data.config.deliveryDates;
  await futures.write.setMakerFeeBps([0], { account: owner.account });
  await futures.write.setTakerFeeBps([0], { account: owner.account });

  const btc = await viem.deployContract("HashpriceBTCMock", []);
  const btcUsd = await viem.deployContract("PriceFeedMock", [8, "BTC/USD"]);
  await btcUsd.write.setPrice([BTC_USD]);
  const now = BigInt(await networkHelpers.time.latest());
  const eta = etaOf(first, second);
  await btc.write.setBlock([Number(HALVING - (eta - now) / 600n), FEES, DIFFICULTY]);
  const hashpriceUSD = await viem.deployContract("HashpriceUSD", [btc.address, btcUsd.address]);
  const glideUSD = await viem.deployContract("HashpriceGlideUSD", [hashpriceUSD.address]);
  await pme.write.setOracle([hashpriceUSD.address], { account: owner.account });
  await futures.write.setOracle([glideUSD.address], { account: owner.account });
  await pme.write.setShocks([(15n * WAD) / 100n, (10n * WAD) / 100n, 0n, 0n], {
    account: owner.account,
  });

  const index = await futures.read.getMarketPrice();
  /** The glide feed's range for a date, in venue units (8 → 6 decimals, rounded to the tick). */
  async function venueRange(date: bigint) {
    const [low, high] = await glideUSD.read.markRangeAt([date]);
    const tick = await futures.read.minimumPriceIncrement();
    const toVenue = (raw: bigint) => ((raw / 100n + tick / 2n) / tick) * tick;
    return [toVenue(low), toVenue(high)] as const;
  }
  return { ...data, btc, btcUsd, hashpriceUSD, glideUSD, first, second, eta, index, venueRange };
}

describe("Futures per-expiry marks (CF-321)", () => {
  it("marks a date before the window at the index and one after it post-halving", async () => {
    const s = await marksFixture((first, second) => (first + second) / 2n);
    const { futures } = s.contracts;
    assert.deepEqual(await futures.read.getMarkRange([s.first]), [s.index, s.index]);
    const [low, high] = await futures.read.getMarkRange([s.second]);
    assert.deepEqual([low, high], [...(await s.venueRange(s.second))]);
    assert.equal(low, high);
    assert.ok(low * 100n < s.index * 55n, "post-halving at about half the index");
  });

  it("marks a date inside the window at both: longs post-halving, shorts at the index", async () => {
    const s = await marksFixture((_first, second) => second);
    const [low, high] = await s.contracts.futures.read.getMarkRange([s.second]);
    assert.equal(high, s.index);
    assert.ok(low * 100n < s.index * 55n);

    const { futures, collateralVault: vault } = s.contracts;
    const { seller: bob, buyer: alice } = s.accounts;
    await vault.write.deposit([s.index * 100n], { account: alice.account });
    await vault.write.deposit([s.index * 100n], { account: bob.account });
    await futures.write.createOrder([s.index, s.second, -10n, TimeInForce.GTC], {
      account: bob.account,
    });
    await futures.write.createOrder([s.index, s.second, 10n, TimeInForce.GTC], {
      account: alice.account,
    });
    assert.equal(
      (await futures.read.getExposureView([alice.account.address])).netPositionExposure,
      10n * low,
    );
    assert.equal(
      (await futures.read.getExposureView([bob.account.address])).netPositionExposure,
      -10n * high,
    );
    assert.equal(
      await futures.read.getUnrealizedPnl([alice.account.address]),
      10n * (low - s.index),
    );
    assert.equal(await futures.read.getUnrealizedPnl([bob.account.address]), 0n);
  });

  it("a short sold at a fair post-halving price needs no halving gap", async () => {
    const s = await marksFixture((first, second) => (first + second) / 2n);
    const { futures, collateralVault: vault } = s.contracts;
    const { seller: miner, buyer } = s.accounts;
    const [post] = await futures.read.getMarkRange([s.second]);
    // 20% of the position at the post-halving price, the same share a long holds at the index.
    await vault.write.deposit([(post * 100n * 20n) / 100n], { account: miner.account });
    await vault.write.deposit([post * 100n], { account: buyer.account });
    await futures.write.createOrder([post, s.second, 100n, TimeInForce.GTC], {
      account: buyer.account,
    });
    await futures.write.createOrder([post, s.second, -100n, TimeInForce.GTC], {
      account: miner.account,
    });
    assert.equal(
      (await futures.read.getUserPosition([miner.account.address, s.second])).netQuantity,
      -100n,
    );
  });

  it("liquidation hands a long over at its low mark, and settlement pins the raw index", async () => {
    const s = await marksFixture((first, second) => (first + second) / 2n);
    const { futures, collateralVault: vault } = s.contracts;
    const { seller: bob, buyer: alice, buyer2: keeper } = s.accounts;
    const [post] = await futures.read.getMarkRange([s.second]);
    await vault.write.deposit([(post * 10n * 20n) / 100n], { account: alice.account });
    await vault.write.deposit([post * 100n], { account: bob.account });
    await futures.write.createOrder([post, s.second, -10n, TimeInForce.GTC], {
      account: bob.account,
    });
    await futures.write.createOrder([post, s.second, 10n, TimeInForce.GTC], {
      account: alice.account,
    });

    // BTC falls 30%: Alice's long is underwater and is handed to the backstop at the new low mark.
    await s.btcUsd.write.setPrice([(BTC_USD * 70n) / 100n]);
    const [low] = await futures.read.getMarkRange([s.second]);
    const hash = await futures.write.liquidatePosition([alice.account.address, s.second, 10n], {
      account: keeper.account,
    });
    const receipt = await s.accounts.pc.waitForTransactionReceipt({ hash });
    const [assigned] = parseEventLogs({
      abi: futures.abi,
      logs: receipt.logs,
      eventName: "BackstopAssigned",
    });
    assert.equal(assigned.args.price, low);

    await networkHelpers.time.increaseTo(s.second + 1n);
    await s.btc.write.setBlock([Number(HALVING + 1n), FEES, DIFFICULTY]);
    await s.btcUsd.write.setPrice([BTC_USD]);
    await futures.write.recordSettlementPrice([s.second]);
    assert.equal(
      await futures.read.settlementPrice([s.second]),
      await futures.read.getMarketPrice(),
    );
  });

  it("setOracle adopts the mark oracle with its index, and refuses one without an index", async () => {
    const s = await marksFixture((first, second) => (first + second) / 2n);
    const { futures } = s.contracts;
    const { owner } = s.accounts;
    assert.equal(await futures.read.markOracle(), getAddress(s.glideUSD.address));
    assert.equal(await futures.read.priceOracle(), getAddress(s.hashpriceUSD.address));

    await viem.assertions.revertWithCustomError(
      futures.write.setOracle([s.hashpriceUSD.address], { account: owner.account }),
      futures,
      "InvalidDependency",
    );
    await viem.assertions.revertWithCustomError(
      futures.write.setOracle([zeroAddress], { account: owner.account }),
      futures,
      "InvalidOracle",
    );
  });
});
