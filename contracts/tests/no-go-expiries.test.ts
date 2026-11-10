import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData, parseEventLogs } from "viem";
import { deployContract, deployFuturesFixture } from "./fixtures.ts";
import { refreshHashprice } from "./utils.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

const DAY = 86_400n;
const INTERVAL = 30n * DAY;
const FEES = 3_150_000n;
const DIFFICULTY = 150_000_000_000_000n;
const BTC_USD = 10_000_000_000_000n;
const HALVING = 1_050_000n;

/** The standard stack: the mock mark oracle has a settable halving estimate (0 = none). */
async function scheduleFixture() {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { futures, markOracle } = data.contracts;
  const zone = await futures.read.NO_GO_HALF_WIDTH();
  const first = await futures.read.firstFutureExpirationDate();
  const dates = await futures.read.getExpirationDates();
  const last = dates[dates.length - 1];
  /** Roll the window one slot (and keep the feed fresh). */
  async function roll() {
    const window = await futures.read.getExpirationDates();
    await networkHelpers.time.increaseTo(window[0] + 1n);
    await refreshHashprice(data.contracts.hashpriceUsd);
  }
  async function pin(account = data.accounts.buyer.account) {
    const hash = await futures.write.pinExpiry({ account });
    const receipt = await data.accounts.pc.waitForTransactionReceipt({ hash });
    const [pinned] = parseEventLogs({ abi: futures.abi, logs: receipt.logs, eventName: "ExpiryPinned" });
    return pinned.args;
  }
  return { ...data, futures, markOracle, zone, first, dates, last, roll, pin };
}

describe("Delivery dates keep clear of the halving (N28)", () => {
  it("initialize pins the whole window on the plain grid; pinExpiry pins one slot past it, then nothing", async () => {
    const s = await scheduleFixture();
    const count = BigInt(await s.futures.read.futureExpirationDatesCount());
    const [currentSlot, pinnedCount, previousExpiry] = await s.futures.read.deliverySchedule();
    assert.equal(currentSlot, 0n);
    assert.equal(pinnedCount, count);
    assert.equal(previousExpiry, 0n);
    for (let i = 0; i < s.dates.length; i++) {
      assert.equal(s.dates[i], s.first + BigInt(i) * INTERVAL);
    }

    // Permissionless: a trader pins the slot past the window, on the chain.
    const pinned = await s.pin(s.accounts.buyer.account);
    assert.equal(pinned.slot, count);
    assert.equal(pinned.expiry, s.last + INTERVAL);
    assert.equal(pinned.shifted, false);
    await viem.assertions.revertWithCustomError(
      s.futures.write.pinExpiry({ account: s.accounts.buyer.account }),
      s.futures,
      "NothingToPin",
    );

    // After a roll the next slot is pinnable; the matured date is reported for settlement.
    await s.roll();
    const next = await s.pin();
    assert.equal(next.slot, count + 1n);
    const [current2, pinned2, previous2] = await s.futures.read.deliverySchedule();
    assert.equal(current2, 1n);
    assert.equal(pinned2, count + 2n);
    assert.equal(previous2, s.dates[0]);
  });

  it("a chain date exactly on either edge of the zone is not moved", async () => {
    for (const side of [-1n, 1n]) {
      const s = await scheduleFixture();
      const chain = s.last + INTERVAL;
      await s.markOracle.write.setHalvingEta([chain + side * s.zone], { account: s.accounts.owner.account, chain: s.accounts.owner.chain });
      const pinned = await s.pin();
      assert.equal(pinned.expiry, chain, `edge ${side}`);
      assert.equal(pinned.shifted, false);
    }
  });

  it("a chain date after the estimate moves to the later edge, on the lattice; the chain continues from it", async () => {
    const s = await scheduleFixture();
    const chain = s.last + INTERVAL;
    const eta = chain - 2n * DAY - 3_600n; // the date is 2 h over 2 days past the estimate
    await s.markOracle.write.setHalvingEta([eta], { account: s.accounts.owner.account, chain: s.accounts.owner.chain });
    const pinned = await s.pin();
    assert.equal(pinned.shifted, true);
    assert.equal(pinned.halvingEta, eta);
    assert.ok(pinned.expiry >= eta + s.zone, "inside the zone");
    assert.ok(pinned.expiry < eta + s.zone + DAY, "rounded by more than a day");
    assert.equal((pinned.expiry - s.first) % DAY, 0n, "off the daily lattice");

    // The estimate moving afterwards changes nothing for the pinned date, and the next slot
    // continues 30 days from the shifted date.
    await s.markOracle.write.setHalvingEta([0n], { account: s.accounts.owner.account, chain: s.accounts.owner.chain });
    await s.roll();
    const window = await s.futures.read.getExpirationDates();
    assert.equal(window[window.length - 1], pinned.expiry);
    const next = await s.pin();
    assert.equal(next.expiry, pinned.expiry + INTERVAL);
    assert.equal(next.shifted, false);
    for (let i = 1; i < window.length; i++) {
      assert.ok(window[i] - window[i - 1] >= 15n * DAY);
    }
  });

  it("a chain date at or before the estimate moves to the earlier edge, never closer than 15 days to the date before it", async () => {
    const s = await scheduleFixture();
    const chain = s.last + INTERVAL;
    await s.markOracle.write.setHalvingEta([chain], { account: s.accounts.owner.account, chain: s.accounts.owner.chain }); // exactly on the estimate: ties move earlier
    const pinned = await s.pin();
    assert.equal(pinned.shifted, true);
    assert.ok(pinned.expiry <= chain - s.zone);
    assert.ok(pinned.expiry > chain - s.zone - DAY);
    assert.ok(pinned.expiry - s.last >= 15n * DAY);
    assert.equal((pinned.expiry - s.first) % DAY, 0n);
  });

  it("no estimate, or one far away, leaves the chain alone", async () => {
    const s = await scheduleFixture();
    await s.markOracle.write.setHalvingEta([0n], { account: s.accounts.owner.account, chain: s.accounts.owner.chain });
    assert.equal((await s.pin()).shifted, false);
    await s.roll();
    await s.markOracle.write.setHalvingEta([BigInt(await networkHelpers.time.latest()) + 4n * 365n * DAY], { account: s.accounts.owner.account, chain: s.accounts.owner.chain });
    assert.equal((await s.pin()).shifted, false);
  });

  it("the first order after a roll pins the due slot itself", async () => {
    const s = await scheduleFixture();
    const { collateralVault } = s.contracts;
    const { seller } = s.accounts;
    const count = BigInt(await s.futures.read.futureExpirationDatesCount());
    await collateralVault.write.deposit([10_000_000_000n], { account: seller.account });
    await s.roll();
    const [, before] = await s.futures.read.deliverySchedule();
    assert.equal(before, count, "already pinned");

    const price = await s.futures.read.getMarketPrice();
    const hash = await s.futures.write.createOrder([price, s.dates[1], -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    const receipt = await s.accounts.pc.waitForTransactionReceipt({ hash });
    const [pinned] = parseEventLogs({ abi: s.futures.abi, logs: receipt.logs, eventName: "ExpiryPinned" });
    assert.equal(pinned.args.slot, count);
    assert.equal(pinned.args.expiry, s.last + INTERVAL);
    const [, after] = await s.futures.read.deliverySchedule();
    assert.equal(after, count + 1n);
  });

  it("a shifted date trades, margins, hands over to the backstop and settles; its grid date does not exist", async () => {
    const s = await scheduleFixture();
    const { futures, collateralVault, portfolioMarginEngine: pme } = s.contracts;
    const { seller: bob, buyer: alice, buyer2: keeper } = s.accounts;
    const chain = s.last + INTERVAL;
    await s.markOracle.write.setHalvingEta([chain - DAY], { account: s.accounts.owner.account, chain: s.accounts.owner.chain });
    const { expiry } = await s.pin();
    assert.notEqual(expiry, chain);

    // Roll until the shifted date is tradable (it is the last of the window after one roll).
    await s.roll();
    const window = await futures.read.getExpirationDates();
    assert.equal(window[window.length - 1], expiry);

    const price = await futures.read.getMarketPrice();
    await collateralVault.write.deposit([price * 100n], { account: alice.account });
    await collateralVault.write.deposit([price * 100n], { account: bob.account });
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, chain, 1n, TimeInForce.GTC], { account: alice.account }),
      futures,
      "ExpirationDateNotAvailable",
    );
    await futures.write.createOrder([price, expiry, -10n, TimeInForce.GTC], { account: bob.account });
    await futures.write.createOrder([price, expiry, 10n, TimeInForce.GTC], { account: alice.account });
    assert.equal((await futures.read.getUserPosition([alice.account.address, expiry])).netQuantity, 10n);
    assert.deepEqual(await futures.read.getActiveExpirationDates([alice.account.address]), [expiry]);
    assert.equal((await futures.read.getExposureView([alice.account.address])).netPositionExposure, 10n * price);

    // A resting order on the shifted date is reserved (the per-slot bitmap resolves it).
    await futures.write.createOrder([price - 10_000n, expiry, 1n, TimeInForce.GTC], { account: alice.account });
    assert.equal(await futures.read.hasRestingOrderDelta([alice.account.address]), true);
    const [orderId] = await futures.read.getUserOrdersAtExpiration([alice.account.address, expiry]);
    await futures.write.cancelOrder([orderId], { account: alice.account });
    assert.equal(await futures.read.hasRestingOrderDelta([alice.account.address]), false);

    // Alice at IM, the index falls 25%: liquidated at the mark, the backstop inherits the leg.
    const im = await pme.read.computePortfolioIM([alice.account.address]);
    const balance = await collateralVault.read.balanceOf([alice.account.address]);
    await collateralVault.write.withdraw([balance - im], { account: alice.account });
    const [, answer] = await s.contracts.hashpriceUsd.read.latestRoundData();
    await s.contracts.hashpriceUsd.write.setPrice([(answer * 75n) / 100n], { account: s.accounts.owner.account, chain: s.accounts.owner.chain });
    await futures.write.liquidatePosition([alice.account.address, expiry, 10n], { account: keeper.account });
    const backstop = await futures.read.BACKSTOP();
    assert.equal((await futures.read.getUserPosition([backstop, expiry])).netQuantity, 10n);

    // Settlement at the shifted timestamp; the schedule then reports it as the matured date.
    await networkHelpers.time.increaseTo(expiry + 1n);
    await refreshHashprice(s.contracts.hashpriceUsd);
    await futures.write.recordSettlementPrice([expiry]);
    await futures.write.settlePosition([bob.account.address, expiry]);
    assert.equal((await futures.read.getUserPosition([bob.account.address, expiry])).netQuantity, 0n);
    const [, , previousExpiry] = await futures.read.deliverySchedule();
    assert.equal(previousExpiry, expiry);
  });

  it("the book views served by the linked library match the book", async () => {
    const s = await scheduleFixture();
    const { futures, collateralVault } = s.contracts;
    const { seller, buyer } = s.accounts;
    const price = await futures.read.getMarketPrice();
    await collateralVault.write.deposit([price * 100n], { account: seller.account });
    await collateralVault.write.deposit([price * 100n], { account: buyer.account });
    await futures.write.createOrder([price, s.dates[0], -3n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([price + 10_000n, s.dates[0], -2n, TimeInForce.GTC], { account: seller.account });
    assert.equal(await futures.read.getQuantityAtPrice([s.dates[0], price, false]), 3n);
    assert.equal(await futures.read.getQuantityAtPrice([s.dates[0], price + 10_000n, false]), 2n);
    const [filled, vwap, remaining] = await futures.read.simulateOrder([s.dates[0], price + 10_000n, 4n], {
      account: buyer.account,
    });
    assert.equal(filled, 4n);
    assert.equal(remaining, 0n);
    assert.equal(vwap, (3n * price + 1n * (price + 10_000n)) / 4n);
    // Own resting size nets out instead of filling.
    const [own, , ownRemaining] = await futures.read.simulateOrder([s.dates[0], price + 10_000n, 4n], {
      account: seller.account,
    });
    assert.equal(own, 4n);
    assert.equal(ownRemaining, 0n);
  });
});

/**
 * On the real oracle chain: a date pinned 15 days past the estimate becomes two-sided only if
 * blocks run slow enough, for long enough, that the estimate catches up with it faster than the
 * window around the estimate shrinks (10% of the time left, 4 days at least). Sustained 10% slow
 * blocks never do; 30% do. Fast blocks move the estimate away from such a date.
 */
describe("N28 — the accepted drift threshold (control)", () => {
  async function pinnedDateAfterEstimate() {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { collateralVault: vault, portfolioMarginEngine: pme } = data.contracts;
    const { owner, pc } = data.accounts;
    const btc = await viem.deployContract("HashpriceBTCMock", []);
    const btcUsd = await viem.deployContract("PriceFeedMock", [8, "BTC/USD"]);
    await btcUsd.write.setPrice([BTC_USD]);
    const hashpriceUSD = await viem.deployContract("HashpriceUSD", [btc.address, btcUsd.address]);
    const glideUSD = await viem.deployContract("HashpriceGlideUSD", [hashpriceUSD.address]);
    const now = BigInt(await networkHelpers.time.latest());
    const first = now + INTERVAL - ((now + INTERVAL) % DAY) + 12n * 3600n;
    const eta = first + INTERVAL - 12n * 3600n; // half a day before the second grid date, which moves later
    let height = HALVING - (eta - now) / 600n;
    await btc.write.setBlock([Number(height), FEES, DIFFICULTY]);
    const impl = await viem.deployContract("HashPowerFutures", [vault.address], {
      libraries: { FuturesBookLib: data.contracts.bookLib.address },
    });
    const proxy = await deployContract<"ERC1967Proxy">(
      owner,
      pc,
      "../artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json",
      [impl.address, encodeFunctionData({ abi: impl.abi, functionName: "initialize", args: [glideUSD.address, 20, 3, first] })],
    );
    const futures = await viem.getContractAt("HashPowerFutures", proxy.address);
    await pme.write.setOracle([hashpriceUSD.address], { account: owner.account });
    const dates = await futures.read.getExpirationDates();
    const pinned = dates[1];
    assert.ok(pinned >= eta + 15n * DAY && pinned < eta + 16n * DAY, `pinned ${pinned} vs eta ${eta}`);

    /** Blocks at 600 × (1 + slow) seconds, relayed daily until the halving block or the date. */
    async function daysTwoSided(slowPct: bigint) {
      let twoSided = 0;
      const perDay = (144n * 100n) / (100n + slowPct);
      while (height < HALVING && BigInt(await networkHelpers.time.latest()) + DAY < pinned) {
        await networkHelpers.time.increase(Number(DAY));
        height += perDay;
        if (height > HALVING) height = HALVING;
        await btc.write.setBlock([Number(height), FEES, DIFFICULTY]);
        await btcUsd.write.setPrice([BTC_USD]);
        const [low, high] = await futures.read.getMarkRange([pinned]);
        if (low !== high) twoSided++;
      }
      return twoSided;
    }
    return { daysTwoSided };
  }

  it("10% slow blocks for two months never price the pinned date on both sides", async () => {
    const s = await pinnedDateAfterEstimate();
    assert.equal(await s.daysTwoSided(10n), 0);
  });

  it("30% slow blocks do, on some days: the step the zone accepts as out of range", async () => {
    const s = await pinnedDateAfterEstimate();
    const days = await s.daysTwoSided(30n);
    console.log(`    two-sided on ${days} days`);
    assert.ok(days > 0);
  });
});
