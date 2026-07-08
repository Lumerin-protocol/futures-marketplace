import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { deployFuturesFixture } from "./fixtures.ts";
import { refreshHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

describe("Delivery Date Management", () => {
  it("should return correct delivery dates array", async () => {
    const { contracts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    const deliveryDates = await futures.read.getDeliveryDates();
    assert.equal(deliveryDates.length, config.futureDeliveryDatesCount);

    for (let i = 1; i < deliveryDates.length; i++) {
      assert.ok(deliveryDates[i] > deliveryDates[i - 1]);
    }
  });

  it("should calculate delivery dates correctly based on interval", async () => {
    const { contracts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    const deliveryDates = await futures.read.getDeliveryDates();
    const firstFutureDeliveryDate = await futures.read.firstFutureDeliveryDate();
    const deliveryIntervalDays = await futures.read.deliveryIntervalDays();

    assert.equal(deliveryDates[0], firstFutureDeliveryDate);

    for (let i = 1; i < deliveryDates.length; i++) {
      const expectedInterval = BigInt(deliveryIntervalDays) * 86400n;
      const actualInterval = deliveryDates[i] - deliveryDates[i - 1];
      assert.equal(actualInterval, expectedInterval);
    }
  });

  it("should allow owner to update future delivery dates count", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner, pc } = accounts;

    const initialDeliveryDates = await futures.read.getDeliveryDates();
    assert.equal(initialDeliveryDates.length, config.futureDeliveryDatesCount);

    const newCount = config.futureDeliveryDatesCount + 1;
    const txHash = await futures.write.setFutureDeliveryDatesCount([newCount], {
      account: owner.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    assert.equal(receipt.status, "success");

    const updatedCount = await futures.read.futureDeliveryDatesCount();
    assert.equal(updatedCount, newCount);

    const updatedDeliveryDates = await futures.read.getDeliveryDates();
    assert.equal(updatedDeliveryDates.length, newCount);

    for (let i = 0; i < initialDeliveryDates.length; i++) {
      assert.equal(updatedDeliveryDates[i], initialDeliveryDates[i]);
    }
  });

  it("should reject updating future delivery dates count to zero", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.setFutureDeliveryDatesCount([0], { account: owner.account }),
      futures,
      "ValueOutOfRange",
    );
  });

  it("should reject non-owner from updating future delivery dates count", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.setFutureDeliveryDatesCount([5], { account: seller.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
  });

  it("should correctly read firstFutureDeliveryDate", async () => {
    const { contracts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    assert.equal(await futures.read.firstFutureDeliveryDate(), config.firstFutureDeliveryDate);
  });

  it("should correctly read expiration interval days", async () => {
    const { contracts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    assert.equal(await contracts.futures.read.expirationIntervalDays(), config.expirationIntervalDays);
  });

  it("legacy deliveryIntervalDays() getter mirrors expirationIntervalDays()", async () => {
    const { contracts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    assert.equal(
      await futures.read.deliveryIntervalDays(),
      await futures.read.expirationIntervalDays(),
    );
  });

  it("should update delivery dates when count is increased", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    const initialDeliveryDates = await futures.read.getDeliveryDates();
    const newCount = initialDeliveryDates.length + 2;
    await futures.write.setFutureDeliveryDatesCount([newCount], { account: owner.account });

    const updatedDeliveryDates = await futures.read.getDeliveryDates();
    assert.equal(updatedDeliveryDates.length, newCount);

    const firstFutureDeliveryDate = await futures.read.firstFutureDeliveryDate();
    const deliveryIntervalDays = await futures.read.deliveryIntervalDays();
    const deliveryIntervalSeconds = BigInt(deliveryIntervalDays) * 86400n;

    for (let i = 0; i < updatedDeliveryDates.length; i++) {
      const expectedDate = firstFutureDeliveryDate + deliveryIntervalSeconds * BigInt(i);
      assert.equal(updatedDeliveryDates[i], expectedDate);
    }
  });

  it("should update delivery dates when count is decreased", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    await futures.write.setFutureDeliveryDatesCount([5], { account: owner.account });

    const newCount = 2;
    await futures.write.setFutureDeliveryDatesCount([newCount], { account: owner.account });

    const updatedDeliveryDates = await futures.read.getDeliveryDates();
    assert.equal(updatedDeliveryDates.length, newCount);

    const firstFutureDeliveryDate = await futures.read.firstFutureDeliveryDate();
    const deliveryIntervalDays = await futures.read.deliveryIntervalDays();
    const deliveryIntervalSeconds = BigInt(deliveryIntervalDays) * 86400n;

    for (let i = 0; i < updatedDeliveryDates.length; i++) {
      const expectedDate = firstFutureDeliveryDate + deliveryIntervalSeconds * BigInt(i);
      assert.equal(updatedDeliveryDates[i], expectedDate);
    }
  });

  it("should return correct delivery dates array when time has passed", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { tc } = accounts;

    await tc.setNextBlockTimestamp({ timestamp: config.firstFutureDeliveryDate + 1n });
    await tc.mine({ blocks: 1 });

    const deliveryDates = await futures.read.getDeliveryDates();
    assert.equal(deliveryDates.length, config.futureDeliveryDatesCount);

    for (let i = 0; i < deliveryDates.length; i++) {
      const expectedDate =
        config.firstFutureDeliveryDate + BigInt(config.expirationIntervalSeconds * (i + 1));
      assert.equal(deliveryDates[i], expectedDate);
    }
  });

  it("should validate delivery date correctly", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { tc, seller } = accounts;

    const price = await futures.read.getMarketPrice();
    await collateralVault.write.deposit([price * 100n], { account: seller.account });

    await tc.setNextBlockTimestamp({ timestamp: config.firstFutureDeliveryDate + 1n });
    await tc.mine({ blocks: 1 });
    await refreshHashprice(contracts.hashrateOracle);

    // in the past
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, config.firstFutureDeliveryDate, "", 1], {
        account: seller.account,
      }),
      futures,
      "DeliveryDateShouldBeInTheFuture",
    );

    // in the past and not aligned with interval
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, config.firstFutureDeliveryDate + 1n, "", 1], {
        account: seller.account,
      }),
      futures,
      "DeliveryDateShouldBeInTheFuture",
    );

    // within available range but not aligned with interval
    const dateWithinRangeNotAligned =
      config.firstFutureDeliveryDate + BigInt(config.expirationIntervalSeconds) + 1n;
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, dateWithinRangeNotAligned, "", 1], {
        account: seller.account,
      }),
      futures,
      "DeliveryDateNotAvailable",
    );

    // out of available range
    const dateOutOfRange =
      config.firstFutureDeliveryDate +
      BigInt(config.expirationIntervalSeconds) * BigInt(config.futureDeliveryDatesCount + 1);
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, dateOutOfRange, "", 1], { account: seller.account }),
      futures,
      "DeliveryDateNotAvailable",
    );

    // out of available range and not aligned with interval
    const dateOutOfRangeNotAligned = dateOutOfRange + 1n;
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, dateOutOfRangeNotAligned, "", 1], {
        account: seller.account,
      }),
      futures,
      "DeliveryDateNotAvailable",
    );

    // all valid dates
    for (let i = 0; i < config.futureDeliveryDatesCount; i++) {
      const date =
        config.firstFutureDeliveryDate + BigInt(config.expirationIntervalSeconds) * BigInt(i + 1);
      await futures.write.createOrder([price, date, "", 1], { account: seller.account });
    }
  });
});
