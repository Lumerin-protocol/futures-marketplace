import { describe, it } from "node:test";
import { network } from "hardhat";
import { type Client, parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { quantizePrice, refreshHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

describe("Futures Delivery", () => {
  async function positionFixture() {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    async function logBalance(client: Client, name: string) {
      if (!client.account) return;
      const balance = await collateralVault.read.balanceOf([client.account.address]);
      console.log(`${name} balance`, balance);
    }

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const marginAmount = parseUnits("1000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([marginAmount], { account: seller.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer.account });

    const dst = "https://destination-url.com";
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const txHash = await futures.write.createOrder([price, deliveryDate, dst, 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [orderEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });
    const { positionId } = orderEvent.args;

    return {
      ...data,
      position: { positionId, deliveryDate, price, marginAmount, seller, buyer },
      logBalance,
    };
  }

  it("check behaviour when 50% is not delivered and price not changed", async () => {
    const data = await positionFixture();
    const { contracts, position, accounts, config } = data;
    const { tc, validator } = accounts;
    const { futures, collateralVault } = contracts;

    await tc.setNextBlockTimestamp({
      timestamp: position.deliveryDate + BigInt(config.deliveryDurationSeconds) / 2n,
    });
    await refreshHashprice(contracts.hashrateOracle);
    await futures.write.closeDelivery([position.positionId, true], {
      account: validator.account,
    });
  });

  it("should handle expired positions", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc, tc } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * BigInt(config.deliveryDurationDays);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [orderEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    const { positionId } = orderEvent.args;

    await tc.setNextBlockTimestamp({
      timestamp: deliveryDate + BigInt(config.deliveryDurationSeconds) + 1n,
    });

    await viem.assertions.revertWithCustomError(
      futures.write.closeDelivery([positionId, false], { account: buyer.account }),
      futures,
      "PositionDeliveryExpired",
    );
  });
});

describe("Position Management", () => {
  it("should not allow buyer to close position before start time", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = parseUnits("100", 6);
    const deliveryDate = config.deliveryDates[0];
    const marginAmount = parseUnits("1000", 6);

    await collateralVault.write.deposit([marginAmount], { account: seller.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [positionEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    const { positionId } = positionEvent.args;

    await viem.assertions.revertWithCustomError(
      futures.write.closeDelivery([positionId, false], { account: buyer.account }),
      futures,
      "PositionDeliveryNotStartedYet",
    );
  });

  it("should not allow seller to close position before start time", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = parseUnits("100", 6);
    const deliveryDate = config.deliveryDates[0];
    const marginAmount = parseUnits("1000", 6);

    await collateralVault.write.deposit([marginAmount], { account: seller.account });
    await collateralVault.write.deposit([marginAmount], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [createdEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    const { positionId } = createdEvent.args;

    await viem.assertions.revertWithCustomError(
      futures.write.closeDelivery([positionId, false], { account: seller.account }),
      futures,
      "PositionDeliveryNotStartedYet",
    );
  });

  it("should reject closing position by non-participant", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, buyer2, pc } = accounts;

    const price = parseUnits("100", 6);
    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const txHash = await futures.write.createOrder([price, deliveryDate, "", 1], {
      account: buyer.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [createdEvent] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionCreated",
    });

    const { positionId } = createdEvent.args;

    await viem.assertions.revertWithCustomError(
      futures.write.closeDelivery([positionId, false], { account: buyer2.account }),
      futures,
      "OnlyValidatorOrPositionParticipant",
    );
  });
});
