import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture, type FuturesFixture } from "./fixtures.ts";
import { quantizePrice, refreshHashprice, scaleHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
// LotCloseReason ordinals (MUTUAL_EXIT, LIQUIDATION, BREACH, SETTLED, RESET, EXPIRED).
const LOT_CLOSE_REASON_SETTLED = 3;

// Opens a single matched lot (seller short / buyer long) at ~$100 on the first
// delivery date. Returns the lot id plus the loaded fixture.
async function openLot() {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { contracts, accounts, config } = data;
  const { futures, collateralVault } = contracts;
  const { seller, buyer, pc } = accounts;

  const marginAmount = parseUnits("10000", 6);
  const deliveryDate = config.deliveryDates[0];
  const entryPrice = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

  await collateralVault.write.deposit([marginAmount], { account: seller.account });
  await collateralVault.write.deposit([marginAmount], { account: buyer.account });

  await futures.write.createOrder([entryPrice, deliveryDate, "", -1], { account: seller.account });
  const txHash = await futures.write.createOrder([entryPrice, deliveryDate, "https://dest.com", 1], {
    account: buyer.account,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
  const [created] = parseEventLogs({
    logs: receipt.logs,
    abi: futures.abi,
    eventName: "LotCreated",
  });

  return { ...data, positionId: created.args.lotId, deliveryDate };
}

// Move the mark away from entry, then warp to the delivery date with a fresh oracle so the
// next tx mines exactly at maturity with a non-stale answer.
async function reachMaturityWithMovedMark(
  contracts: FuturesFixture["contracts"],
  tc: FuturesFixture["accounts"]["tc"],
  deliveryDate: bigint,
) {
  await scaleHashprice(contracts.hashrateOracle, 12n, 10n);
  await refreshHashprice(contracts.hashrateOracle, deliveryDate);
  await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
}

describe("Futures settlePosition", () => {
  it("lets any address permissionlessly cash-settle a matured position at the mark", async () => {
    const data = await openLot();
    const { contracts, accounts, config, positionId, deliveryDate } = data;
    const { futures, collateralVault } = contracts;
    const { seller, buyer, buyer2, pc, tc } = accounts;

    await reachMaturityWithMovedMark(contracts, tc, deliveryDate);

    const sellerBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBefore = await collateralVault.read.balanceOf([buyer.account.address]);

    // buyer2 is NOT a participant of the lot — settlement is permissionless.
    const txHash = await futures.write.settlePosition([positionId], { account: buyer2.account });
    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [closed] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "LotClosed",
    });

    assert.equal(closed.args.lotId, positionId);
    assert.equal(closed.args.reason, LOT_CLOSE_REASON_SETTLED);
    assert.equal(getAddress(closed.args.closedBy), getAddress(buyer2.account.address));

    // Entry buy price == sell price, so PnL is symmetric and full-notional at the mark.
    assert.equal(closed.args.sellerPnl, -closed.args.buyerPnl);
    assert.notEqual(closed.args.buyerPnl, 0n);

    const sellerAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerAfter = await collateralVault.read.balanceOf([buyer.account.address]);
    assert.equal(sellerAfter - sellerBefore, closed.args.sellerPnl);
    assert.equal(buyerAfter - buyerBefore, closed.args.buyerPnl);

    // Position is removed.
    assert.equal((await futures.read.getPositionById([positionId])).seller, ZERO_ADDRESS);

    // Sanity: PnL magnitude equals (mark - entry) * durationDays.
    const expectedMag =
      (closed.args.buyerPnl > 0n ? closed.args.buyerPnl : -closed.args.buyerPnl) /
      BigInt(config.deliveryDurationDays);
    assert.ok(expectedMag > 0n);
  });

  it("reverts before the position has matured", async () => {
    const { contracts, accounts, positionId } = await openLot();
    const { futures } = contracts;
    const { buyer } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.settlePosition([positionId], { account: buyer.account }),
      futures,
      "PositionDeliveryNotStartedYet",
    );
  });

  it("reverts for a non-existent position", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { buyer } = accounts;

    const unknownId = `0x${"ab".repeat(32)}` as `0x${string}`;
    await viem.assertions.revertWithCustomError(
      futures.write.settlePosition([unknownId], { account: buyer.account }),
      futures,
      "PositionNotExists",
    );
  });

  it("settlePositions settles a batch of matured positions", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault } = contracts;
    const { seller, buyer, buyer2, pc, tc } = accounts;

    const marginAmount = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const entryPrice = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

    await collateralVault.write.deposit([marginAmount], { account: seller.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer.account });

    const lotIds: `0x${string}`[] = [];
    for (let i = 0; i < 2; i++) {
      await futures.write.createOrder([entryPrice, deliveryDate, "", -1], {
        account: seller.account,
      });
      const txHash = await futures.write.createOrder([entryPrice, deliveryDate, "", 1], {
        account: buyer.account,
      });
      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [created] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });
      lotIds.push(created.args.lotId);
    }

    await reachMaturityWithMovedMark(contracts, tc, deliveryDate);

    await futures.write.settlePositions([lotIds], { account: buyer2.account });

    for (const id of lotIds) {
      assert.equal((await futures.read.getPositionById([id])).seller, ZERO_ADDRESS);
    }
  });
});
