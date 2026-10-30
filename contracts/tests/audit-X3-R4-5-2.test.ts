import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { maxUint256, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";
import { scaleHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/**
 * X3-R4-5-2: a vault halt must stop every fill. `unwindBackstop` skipped the halt check, so
 * during a halt it matched a user's resting order and opened a position the user could not
 * reduce (createOrder reverts `TradingHalted`) while liquidations stayed live.
 */
describe("X3-R4-5-2 — futures backstop unwind opens no user position while halted", () => {
  it("leaves a resting order unfilled while the vault is halted", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, portfolioMarginEngine, collateralVault, usdcMock, hashpriceUsd } = contracts;
    const { owner, seller, buyer, buyer2 } = accounts;
    // `defaultBuyer`: funded with USDC by the fixture but not returned by it.
    const carol = (await viem.getWalletClients())[6];

    await portfolioMarginEngine.write.setShocks(
      [parseUnits("0.20", 18), parseUnits("0.10", 18), 0n, 0n],
      { account: owner.account },
    );
    await futures.write.setMakerFeeBps([0], { account: owner.account });
    await futures.write.setTakerFeeBps([0], { account: owner.account });

    const entry = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];
    const lotCount = 10n;
    await usdcMock.write.approve([collateralVault.address, maxUint256], { account: carol.account, chain: carol.chain });
    await collateralVault.write.deposit([(entry * 22n) / 10n], { account: buyer.account });
    await collateralVault.write.deposit([entry * 100n], { account: seller.account });
    await collateralVault.write.deposit([entry * 100n], { account: buyer2.account });
    await collateralVault.write.deposit([entry * 10n], { account: carol.account });
    await futures.write.createOrder([entry, deliveryDate, -lotCount, TimeInForce.GTC], {
      account: seller.account,
    });
    await futures.write.createOrder([entry, deliveryDate, lotCount, TimeInForce.GTC], {
      account: buyer.account,
    });

    // A 15% crash liquidates the buyer; the backstop inherits the long.
    await scaleHashprice(hashpriceUsd, 85n, 100n);
    await futures.write.liquidatePositions([buyer.account.address, [deliveryDate], [lotCount]], {
      account: buyer2.account,
    });
    const backstop = await futures.read.BACKSTOP();
    assert.equal(
      (await futures.read.getUserPosition([backstop, deliveryDate])).netQuantity,
      lotCount,
    );

    // Flat carol rests a bid at the mark, inside the unwind band; then the vault halts.
    const mark = await futures.read.getMarketPrice();
    await futures.write.createOrder([mark, deliveryDate, 1n, TimeInForce.GTC], {
      account: carol.account,
    });
    await collateralVault.write.halt({ account: owner.account });

    try {
      await futures.write.unwindBackstop([deliveryDate, 1n], { account: buyer2.account });
    } catch {}

    assert.equal(
      (await futures.read.getUserPosition([carol.account.address, deliveryDate])).netQuantity,
      0n,
      "halt-time unwind opened a position carol cannot reduce",
    );
    assert.equal(
      (await futures.read.getUserPosition([backstop, deliveryDate])).netQuantity,
      lotCount,
    );
  });
});
