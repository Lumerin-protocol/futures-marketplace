import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";

const { viem, networkHelpers } = await network.getOrCreate();

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
// LotCloseReason ordinals (MUTUAL_EXIT, LIQUIDATION, BREACH, SETTLED, RESET, EXPIRED).
const LOT_CLOSE_REASON_SETTLED = 3;
const LOT_CLOSE_REASON_EXPIRED = 5;

describe("Futures cancelExpiredPosition", () => {
  async function createPosition(destURL: string) {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = await futures.read.getMarketPrice();
    const marginAmount = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([marginAmount], { account: seller.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const txHash = await futures.write.createOrder([price, deliveryDate, destURL, 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [created] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });

    return { ...data, positionId: created.args.lotId, deliveryDate, price };
  }

  async function expireWindow(
    tc: Awaited<ReturnType<typeof deployFuturesFixture>>["accounts"]["tc"],
    deliveryDate: bigint,
    deliveryDurationSeconds: number,
  ) {
    await tc.setNextBlockTimestamp({
      timestamp: deliveryDate + BigInt(deliveryDurationSeconds) + 1n,
    });
  }

  it("voids an unpaid expired position with no transfers", async () => {
    const { contracts, accounts, config, positionId, deliveryDate } =
      await createPosition("");
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc, tc } = accounts;

    const positionBefore = await futures.read.getPositionById([positionId]);
    assert.equal(positionBefore.paid, false);

    await expireWindow(tc, deliveryDate, config.deliveryDurationSeconds);

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
    const contractBalanceBefore = await collateralVault.read.balanceOf([futures.address]);

    const txHash = await futures.write.cancelExpiredPosition([positionId], {
      account: buyer.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [closed] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "LotClosed",
    });

    assert.equal(closed.args.lotId, positionId);
    assert.equal(closed.args.reason, LOT_CLOSE_REASON_EXPIRED);
    assert.equal(closed.args.sellerPnl, 0n);
    assert.equal(closed.args.buyerPnl, 0n);
    assert.equal(getAddress(closed.args.closedBy), getAddress(buyer.account.address));

    // Pure void — no balances move.
    assert.equal(
      await collateralVault.read.balanceOf([seller.account.address]),
      sellerBalanceBefore,
    );
    assert.equal(await collateralVault.read.balanceOf([buyer.account.address]), buyerBalanceBefore);
    assert.equal(await collateralVault.read.balanceOf([futures.address]), contractBalanceBefore);

    const positionAfter = await futures.read.getPositionById([positionId]);
    assert.equal(positionAfter.seller, ZERO_ADDRESS);
  });

  it("pays the seller when an expired position was paid (delivery assumed successful)", async () => {
    const { contracts, accounts, config, positionId, price, deliveryDate } =
      await createPosition("https://dest.com");
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc, tc } = accounts;

    const totalPayment = price * BigInt(config.deliveryDurationDays);

    await futures.write.depositDeliveryPaymentV2([positionId], { account: buyer.account });
    assert.equal((await futures.read.getPositionById([positionId])).paid, true);

    await expireWindow(tc, deliveryDate, config.deliveryDurationSeconds);

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
    const contractBalanceBefore = await collateralVault.read.balanceOf([futures.address]);

    // Either participant can trigger cleanup; the buyer doing so still pays the seller.
    const txHash = await futures.write.cancelExpiredPosition([positionId], {
      account: buyer.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });

    const [closed] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "LotClosed",
    });
    const [withdrawn] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "LotPaymentWithdrawn",
    });

    // Funded + window elapsed with no breach → delivery assumed successful, settled to seller.
    assert.equal(closed.args.reason, LOT_CLOSE_REASON_SETTLED);
    assert.equal(withdrawn.args.lotId, positionId);

    // Seller is paid `sellPricePerDay * days`; the buyer's escrow leaves the contract.
    assert.equal(
      await collateralVault.read.balanceOf([seller.account.address]),
      sellerBalanceBefore + totalPayment,
    );
    assert.equal(await collateralVault.read.balanceOf([buyer.account.address]), buyerBalanceBefore);
    assert.equal(
      await collateralVault.read.balanceOf([futures.address]),
      contractBalanceBefore - totalPayment,
    );

    const positionAfter = await futures.read.getPositionById([positionId]);
    assert.equal(positionAfter.seller, ZERO_ADDRESS);
  });

  it("allows the validator to cancel an expired position", async () => {
    const { contracts, accounts, config, positionId, deliveryDate } =
      await createPosition("");
    const { futures } = contracts;
    const { validator, pc, tc } = accounts;

    await expireWindow(tc, deliveryDate, config.deliveryDurationSeconds);

    const txHash = await futures.write.cancelExpiredPosition([positionId], {
      account: validator.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    assert.equal(receipt.status, "success");
    assert.equal((await futures.read.getPositionById([positionId])).seller, ZERO_ADDRESS);
  });

  it("reverts when the delivery window has not closed yet", async () => {
    const { contracts, accounts, config, positionId, deliveryDate } =
      await createPosition("");
    const { futures } = contracts;
    const { buyer, tc } = accounts;

    // Inside the window: delivery started but not yet expired.
    await tc.setNextBlockTimestamp({
      timestamp: deliveryDate + BigInt(config.deliveryDurationSeconds) - 1n,
    });

    await viem.assertions.revertWithCustomError(
      futures.write.cancelExpiredPosition([positionId], { account: buyer.account }),
      futures,
      "PositionDeliveryNotExpired",
    );
  });

  it("reverts when called by a non-participant", async () => {
    const { contracts, accounts, config, positionId, deliveryDate } =
      await createPosition("");
    const { futures } = contracts;
    const { buyer2, tc } = accounts;

    await expireWindow(tc, deliveryDate, config.deliveryDurationSeconds);

    await viem.assertions.revertWithCustomError(
      futures.write.cancelExpiredPosition([positionId], { account: buyer2.account }),
      futures,
      "OnlyValidatorOrPositionParticipant",
    );
  });

  it("reverts for a non-existent position", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { buyer } = accounts;

    const unknownId = `0x${"de".repeat(32)}` as `0x${string}`;
    await viem.assertions.revertWithCustomError(
      futures.write.cancelExpiredPosition([unknownId], { account: buyer.account }),
      futures,
      "PositionNotExists",
    );
  });
});
