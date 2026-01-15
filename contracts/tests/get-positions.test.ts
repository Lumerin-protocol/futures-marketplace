import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFuturesFixture } from "./fixtures";
import { catchError } from "../../lib";

describe("Get Positions", function () {
  it("should get positions by participant and delivery date", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, buyer } = accounts;
    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];
    await futures.write.addMargin([price * 10n], { account: seller.account });
    await futures.write.addMargin([price * 10n], { account: buyer.account });
    await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });
    await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
      account: buyer.account,
    });
    const positions = await futures.read.getPositionsByParticipantDeliveryDate([
      seller.account.address,
      deliveryDate,
    ]);
  });
});
