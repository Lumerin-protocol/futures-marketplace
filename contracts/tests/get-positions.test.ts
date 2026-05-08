import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { deployFuturesFixture } from "./fixtures.ts";

const { networkHelpers } = await network.getOrCreate();

describe("Get Positions", () => {
  it("should get positions by participant and delivery date", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer } = accounts;

    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];
    await collateralVault.write.deposit([price * 10n], { account: seller.account });
    await collateralVault.write.deposit([price * 10n], { account: buyer.account });
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
      account: buyer.account,
    });
    await futures.read.getPositionsByParticipantDeliveryDate([
      seller.account.address,
      deliveryDate,
    ]);
  });

  it("does not return a position after the exiting participant offsets it", async () => {
    // Scenario:
    //   1. seller sells, buyer buys → P1 (seller short, buyer long).
    //   2. buyer2 places a resting buy order at the same price/date.
    //   3. buyer places a sell order that immediately matches buyer2's resting buy,
    //      offsetting buyer's existing long position.
    //
    // Expected: getPositionsByParticipantDeliveryDate returns an empty list for
    //   the exiting participant (buyer) at that delivery date. The remaining
    //   short obligation (seller) is rewired to face buyer2.
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, buyer2, owner } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * BigInt(config.deliveryDurationDays) * 2n;
    const deliveryDate = config.deliveryDates[0];

    await futures.write.setOrderFee([0n], { account: owner.account });

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await collateralVault.write.deposit([margin], { account: buyer2.account });

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, "", 1], { account: buyer.account });

    const buyerPositionsBefore = await futures.read.getPositionsByParticipantDeliveryDate([
      buyer.account.address,
      deliveryDate,
    ]);
    assert.equal(buyerPositionsBefore.length, 1, "buyer should hold one long before exiting");

    await futures.write.createOrder([price, deliveryDate, "", 1], { account: buyer2.account });
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: buyer.account });

    const buyerPositionsAfter = await futures.read.getPositionsByParticipantDeliveryDate([
      buyer.account.address,
      deliveryDate,
    ]);
    assert.equal(
      buyerPositionsAfter.length,
      0,
      "buyer's offset position should not be returned after exiting",
    );
    assert.equal(
      buyerPositionsAfter.includes(buyerPositionsBefore[0]),
      false,
      "the original position id should be absent from the participant's list",
    );

    const sellerPositions = await futures.read.getPositionsByParticipantDeliveryDate([
      seller.account.address,
      deliveryDate,
    ]);
    const buyer2Positions = await futures.read.getPositionsByParticipantDeliveryDate([
      buyer2.account.address,
      deliveryDate,
    ]);
    assert.equal(sellerPositions.length, 1, "seller should still hold one short");
    assert.equal(buyer2Positions.length, 1, "buyer2 should hold the rewired long");
    assert.equal(
      sellerPositions[0],
      buyer2Positions[0],
      "seller and buyer2 should share the rewired position",
    );
  });
});
