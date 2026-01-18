import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFuturesFixture } from "./fixtures";

it("should handle exiting positions from both parties at the same time", async function () {
  const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
  const { futures } = contracts;
  const { seller: partA, buyer: partB, buyer2: partC, owner } = accounts;

  const price = await futures.read.getMarketPrice();
  const price2 = price - config.priceLadderStep;
  const margin = price * BigInt(config.deliveryDurationDays) * 2n;
  const deliveryDate = config.deliveryDates[0];

  await futures.write.setOrderFee([0n], { account: owner.account });

  // setup margin for all participants
  await futures.write.addMargin([margin], { account: partA.account });
  await futures.write.addMargin([margin], { account: partB.account });
  await futures.write.addMargin([margin], { account: partC.account });

  // Step 1: A sells and B buys at price, creating initial positions
  //   - A is short (owes delivery)
  //   - B is long (expects delivery)
  await futures.write.createOrder([price, deliveryDate, "", -1], {
    account: partA.account,
  });
  await futures.write.createOrder([price, deliveryDate, "", 1], {
    account: partB.account,
  });

  // Step 2: Both parties want to exit, so they place opposite orders at price2
  //   - A places a buy order to close short
  //   - B places a sell order to close long
  //   - Orders match, offsetting both positions
  await futures.write.createOrder([price2, deliveryDate, "", -1], {
    account: partB.account,
  });
  await futures.write.createOrder([price2, deliveryDate, "", 1], {
    account: partA.account,
  });

  // Step 3: Verify positions are closed
  //   - A should have no positions left
  //   - B should have no positions left
  const partAPositions = await futures.read.getPositionsByParticipantDeliveryDate([
    partA.account.address,
    deliveryDate,
  ]);
  expect(partAPositions.length).to.equal(0);
  const partBPositions = await futures.read.getPositionsByParticipantDeliveryDate([
    partB.account.address,
    deliveryDate,
  ]);
  expect(partBPositions.length).to.equal(0);

  // Step 4: Verify pnl is credited to the parties
  const expPartApnl = (price - price2) * BigInt(config.deliveryDurationDays);
  const expPartBpnl = (price2 - price) * BigInt(config.deliveryDurationDays);

  const partABalance = await futures.read.balanceOf([partA.account.address]);
  const partBBalance = await futures.read.balanceOf([partB.account.address]);

  const partADelta = partABalance - margin;
  const partBDelta = partBBalance - margin;
  expect([partADelta, partBDelta]).to.deep.equal([expPartApnl, expPartBpnl]);
});
