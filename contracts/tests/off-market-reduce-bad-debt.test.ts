import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import type { NetworkConnection } from "hardhat/types/network";
import type { TransactionReceipt } from "viem";
import { formatUnits, getAddress, parseEventLogs, parseUnits, zeroAddress } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";
import { scaleHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

const USDC_DECIMALS = 6;

/**
 * Voluntary orders have no price band against the mark, so a trader can close into a
 * colluding bid at one tick. Before 6.8.0 the vault booked whatever the trader could not pay
 * as `BadDebt` while the fund paid the colluder's matching gain in full, either at the fill
 * or at the liquidation of the remainder. The taker must now pay its realized loss in full,
 * and a reducing order below IM must not grow the account's MM deficit.
 *
 * IM 20% / MM 10%, zero fees. Trader long 10 at the mark with 2x IM, colluder short 10.
 */
async function collusionFixture(_conn: NetworkConnection) {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { futures, portfolioMarginEngine: pme, collateralVault: vault } = data.contracts;
  const { owner, buyer: trader, seller: colluder, pc } = data.accounts;

  await pme.write.setShocks([parseUnits("0.20", 18), parseUnits("0.10", 18), 0n, 0n], {
    account: owner.account,
  });

  const entry = await futures.read.getMarketPrice();
  const deliveryDate = data.config.deliveryDates[0];
  const qty = 10n;
  const traderDeposit = entry * 4n;
  const colluderDeposit = entry * 4n;
  await vault.write.deposit([traderDeposit], { account: trader.account });
  await vault.write.deposit([colluderDeposit], { account: colluder.account });

  await futures.write.createOrder([entry, deliveryDate, -qty, TimeInForce.GTC], {
    account: colluder.account,
  });
  await futures.write.createOrder([entry, deliveryDate, qty, TimeInForce.GTC], {
    account: trader.account,
  });

  const fund = await vault.read.INSURANCE_FUND_ADDR();
  const names = new Map<string, string>([
    [getAddress(trader.account.address), "trader"],
    [getAddress(colluder.account.address), "colluder"],
    [getAddress(fund), "fund"],
    [getAddress(futures.address), "futures"],
    [zeroAddress, "mint/burn"],
  ]);
  const name = (addr: string) => names.get(getAddress(addr)) ?? addr;
  const usd = (x: bigint) => formatUnits(x, USDC_DECIMALS);
  const lots = (x: bigint) => `${x > 0n ? "+" : ""}${x}`;
  const accounts = [trader.account.address, colluder.account.address, fund];

  return {
    ...data,
    trader,
    colluder,
    config: { ...data.config, entry, deliveryDate, qty, traderDeposit, colluderDeposit },
    usd,

    /** Prints each account's vault balance, position, mark PnL, equity and margins, then the fund. */
    async logState(label: string) {
      console.log(`\n  ── ${label} · mark ${usd(await futures.read.getMarketPrice())}`);
      for (const addr of [trader.account.address, colluder.account.address]) {
        const [balance, position, risk, [im, mm]] = await Promise.all([
          vault.read.balanceOf([addr]),
          futures.read.getUserPosition([addr, deliveryDate]),
          futures.read.getRiskView([addr]),
          pme.read.computePortfolioMargins([addr]),
        ]);
        const equity = balance + risk.unrealizedPnl - risk.pendingFunding;
        console.log(
          `     ${name(addr).padEnd(9)} balance ${usd(balance).padStart(9)}` +
            ` | position ${lots(position.netQuantity).padStart(4)}` +
            ` | uPnL ${usd(risk.unrealizedPnl).padStart(8)}` +
            ` | equity ${usd(equity).padStart(8)}` +
            ` | IM ${usd(im).padStart(7)} | MM ${usd(mm).padStart(7)}` +
            (balance < mm ? " | LIQUIDATABLE" : ""),
        );
      }
      const [fundBalance, badDebtTotal] = await Promise.all([
        vault.read.balanceOf([fund]),
        vault.read.traderBadDebtTotal(),
      ]);
      console.log(
        `     fund      balance ${usd(fundBalance)} | traderBadDebtTotal ${usd(badDebtTotal)}`,
      );
    },

    /** Sends a transaction and prints its fills, vault transfers and bad debt in log order. */
    async send(label: string, tx: Promise<`0x${string}`>): Promise<TransactionReceipt> {
      console.log(`\n  ▶ ${label}`);
      const receipt = await pc.waitForTransactionReceipt({ hash: await tx });
      assert.equal(receipt.status, "success");
      for (const log of receipt.logs) {
        const addr = getAddress(log.address);
        if (addr === getAddress(futures.address)) {
          for (const evt of parseEventLogs({ abi: futures.abi, logs: [log] })) {
            if (evt.eventName === "OrderMatched") {
              const { maker, taker, tradePrice, takerQuantity } = evt.args;
              const side = takerQuantity > 0n ? "buys" : "sells";
              const absQty = takerQuantity < 0n ? -takerQuantity : takerQuantity;
              console.log(
                `     fill      ${name(taker)} ${side} ${absQty} @ ${usd(tradePrice)} from ${name(maker)}`,
              );
            }
          }
        } else if (addr === getAddress(vault.address)) {
          for (const evt of parseEventLogs({ abi: vault.abi, logs: [log] })) {
            if (evt.eventName === "Transfer") {
              const { from, to, value } = evt.args;
              console.log(`     transfer  ${name(from)} → ${name(to)} ${usd(value)}`);
            } else if (evt.eventName === "BadDebt") {
              const { payer, receiver, amount } = evt.args;
              console.log(
                `     BAD DEBT  ${name(payer)} could not pay ${name(receiver)} ${usd(amount)}`,
              );
            }
          }
        }
      }
      return receipt;
    },

    /** Asserts the order reverts with `InsufficientMarginBalance` and leaves every balance and position untouched. */
    async expectRejected(label: string, tx: Promise<`0x${string}`>) {
      console.log(`\n  ▶ ${label}`);
      const snapshot = () =>
        Promise.all([
          ...accounts.map((a) => vault.read.balanceOf([a])),
          ...accounts.map((a) =>
            futures.read.getUserPosition([a, deliveryDate]).then((p) => p.netQuantity),
          ),
          vault.read.traderBadDebtTotal(),
        ]);
      const before = await snapshot();
      await viem.assertions.revertWithCustomError(tx, futures, "InsufficientMarginBalance");
      console.log("     reverted  InsufficientMarginBalance");
      assert.deepEqual(await snapshot(), before);
    },

    badDebts(receipt: TransactionReceipt) {
      return parseEventLogs({ logs: receipt.logs, abi: vault.abi, eventName: "BadDebt" });
    },
  };
}

describe("Futures - voluntary fills cannot create bad debt", function () {
  describe("rejects an off-market close the trader cannot pay", function () {
    it("createOrder: a full close whose loss exceeds the balance", async function () {
      const data = await networkHelpers.loadFixture(collusionFixture);
      const { futures, portfolioMarginEngine: pme } = data.contracts;
      const { trader, colluder, usd } = data;
      const { entry, deliveryDate, qty, traderDeposit, priceLadderStep: tick } = data.config;

      await data.send(
        "colluder bids 10 @ one tick",
        futures.write.createOrder([tick, deliveryDate, qty, TimeInForce.GTC], {
          account: colluder.account,
        }),
      );
      await data.logState("before the off-market close");
      assert.equal(await pme.read.isLiquidatable([trader.account.address]), false);

      console.log(
        `\n     trader would lose ${usd((entry - tick) * qty)} but holds ${usd(traderDeposit)}`,
      );
      await data.expectRejected(
        "trader sells 10 @ one tick (reduce-only IOC via createOrder)",
        futures.write.createOrder([tick, deliveryDate, -qty, TimeInForce.IOC], {
          account: trader.account,
        }),
      );
    });

    it("createOrders: the same close through the strict batch path", async function () {
      const data = await networkHelpers.loadFixture(collusionFixture);
      const { futures } = data.contracts;
      const { trader, colluder } = data;
      const { deliveryDate, qty, priceLadderStep: tick } = data.config;

      await data.send(
        "colluder bids 10 @ one tick",
        futures.write.createOrder([tick, deliveryDate, qty, TimeInForce.GTC], {
          account: colluder.account,
        }),
      );
      await data.expectRejected(
        "trader sells 10 @ one tick (IOC via createOrders)",
        futures.write.createOrders(
          [
            [
              {
                price: tick,
                expirationAt: deliveryDate,
                quantity: -qty,
                timeInForce: TimeInForce.IOC,
              },
            ],
          ],
          { account: trader.account },
        ),
      );
    });

    it("createOrder: a partial close the trader can pay but that leaves the remainder with negative equity", async function () {
      const data = await networkHelpers.loadFixture(collusionFixture);
      const { futures, hashpriceUsd } = data.contracts;
      const { trader, colluder } = data;
      const { entry, deliveryDate, qty, traderDeposit, priceLadderStep: tick } = data.config;
      const slice = 4n;

      await scaleHashprice(hashpriceUsd, 85n, 100n);
      const mark = await futures.read.getMarketPrice();
      assert.ok((entry - tick) * slice <= traderDeposit, "the fill alone is paid in full");
      assert.ok(
        traderDeposit - (entry - tick) * slice < (entry - mark) * (qty - slice),
        "remainder equity < 0",
      );

      await data.send(
        "colluder bids 4 @ one tick",
        futures.write.createOrder([tick, deliveryDate, slice, TimeInForce.GTC], {
          account: colluder.account,
        }),
      );
      await data.logState("mark -15%: trader losing but above MM");
      await data.expectRejected(
        "trader sells 4 @ one tick (reduce-only IOC via createOrder)",
        futures.write.createOrder([tick, deliveryDate, -slice, TimeInForce.IOC], {
          account: trader.account,
        }),
      );
    });
  });

  describe("still lets losing traders reduce", function () {
    it("a full close at an off-market price the trader can pay", async function () {
      const data = await networkHelpers.loadFixture(collusionFixture);
      const { futures, collateralVault: vault } = data.contracts;
      const { trader, colluder, usd } = data;
      const { entry, deliveryDate, qty, traderDeposit } = data.config;
      const exit = entry - parseUnits("13", USDC_DECIMALS);
      const loss = (entry - exit) * qty;
      assert.ok(loss <= traderDeposit);
      const fund = await vault.read.INSURANCE_FUND_ADDR();

      await data.send(
        `colluder bids 10 @ ${usd(exit)}`,
        futures.write.createOrder([exit, deliveryDate, qty, TimeInForce.GTC], {
          account: colluder.account,
        }),
      );
      const fundBefore = await vault.read.balanceOf([fund]);
      const receipt = await data.send(
        `trader sells 10 @ ${usd(exit)}, losing ${usd(loss)} of its ${usd(traderDeposit)}`,
        futures.write.createOrder([exit, deliveryDate, -qty, TimeInForce.IOC], {
          account: trader.account,
        }),
      );
      await data.logState("after the close");

      assert.equal(data.badDebts(receipt).length, 0);
      assert.equal(
        (await futures.read.getUserPosition([trader.account.address, deliveryDate])).netQuantity,
        0n,
      );
      assert.equal(await vault.read.balanceOf([trader.account.address]), traderDeposit - loss);
      assert.equal(
        await vault.read.balanceOf([fund]),
        fundBefore,
        "the colluder's gain is the trader's own loss",
      );
    });

    it("a below-IM trader reduces near the mark and stays below IM", async function () {
      const data = await networkHelpers.loadFixture(collusionFixture);
      const {
        futures,
        collateralVault: vault,
        portfolioMarginEngine: pme,
        hashpriceUsd,
      } = data.contracts;
      const { trader, colluder } = data;
      const { deliveryDate, priceLadderStep: tick } = data.config;
      const traderAddr = trader.account.address;

      await scaleHashprice(hashpriceUsd, 70n, 100n);
      const price = (await futures.read.getMarketPrice()) - tick;
      await data.logState("mark -30%: trader below IM, above MM");
      assert.ok(
        (await vault.read.balanceOf([traderAddr])) <
          (await pme.read.computePortfolioIM([traderAddr])),
      );
      assert.equal(await pme.read.isLiquidatable([traderAddr]), false);

      await data.send(
        "colluder bids 1 one tick under the mark",
        futures.write.createOrder([price, deliveryDate, 1n, TimeInForce.GTC], {
          account: colluder.account,
        }),
      );
      const receipt = await data.send(
        "trader sells 1 one tick under the mark",
        futures.write.createOrder([price, deliveryDate, -1n, TimeInForce.IOC], {
          account: trader.account,
        }),
      );
      await data.logState("after the reduce");

      assert.equal(data.badDebts(receipt).length, 0);
      assert.equal(
        (await futures.read.getUserPosition([traderAddr, deliveryDate])).netQuantity,
        9n,
      );
      assert.ok(
        (await vault.read.balanceOf([traderAddr])) <
          (await pme.read.computePortfolioIM([traderAddr])),
      );
    });

    it("a liquidatable trader reduces near the mark without growing its MM deficit", async function () {
      const data = await networkHelpers.loadFixture(collusionFixture);
      const {
        futures,
        collateralVault: vault,
        portfolioMarginEngine: pme,
        hashpriceUsd,
      } = data.contracts;
      const { trader, colluder } = data;
      const { deliveryDate, priceLadderStep: tick } = data.config;
      const traderAddr = trader.account.address;
      const deficit = async () =>
        (await pme.read.computePortfolioMM([traderAddr])) -
        (await vault.read.balanceOf([traderAddr]));

      await scaleHashprice(hashpriceUsd, 64n, 100n);
      const price = (await futures.read.getMarketPrice()) - tick;
      await data.logState("mark -36%: trader below MM");
      assert.equal(await pme.read.isLiquidatable([traderAddr]), true);
      const deficitBefore = await deficit();

      await data.send(
        "colluder bids 2 one tick under the mark",
        futures.write.createOrder([price, deliveryDate, 2n, TimeInForce.GTC], {
          account: colluder.account,
        }),
      );
      const receipt = await data.send(
        "trader sells 2 one tick under the mark",
        futures.write.createOrder([price, deliveryDate, -2n, TimeInForce.IOC], {
          account: trader.account,
        }),
      );
      await data.logState("after the reduce");

      assert.equal(data.badDebts(receipt).length, 0);
      assert.equal(
        (await futures.read.getUserPosition([traderAddr, deliveryDate])).netQuantity,
        8n,
      );
      assert.ok((await deficit()) < deficitBefore);
    });
  });
});
