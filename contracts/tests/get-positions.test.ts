import { describe, it } from "node:test";
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
});
