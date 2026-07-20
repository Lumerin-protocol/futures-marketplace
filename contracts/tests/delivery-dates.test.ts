import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { deployFuturesFixture } from "./fixtures.ts";
import { refreshHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

describe("Delivery Date Management", () => {
  it("should return correct expiration dates array", async () => {
    const { contracts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    const deliveryDates = await futures.read.getExpirationDates();
    assert.equal(deliveryDates.length, config.futureExpirationDatesCount);

    for (let i = 1; i < deliveryDates.length; i++) {
      assert.ok(deliveryDates[i] > deliveryDates[i - 1]);
    }
  });

  it("should calculate expiration dates correctly based on interval", async () => {
    const { contracts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    const deliveryDates = await futures.read.getExpirationDates();
    const firstFutureExpirationDate = await futures.read.firstFutureExpirationDate();
    const expirationIntervalDays = await futures.read.expirationIntervalDays();

    assert.equal(deliveryDates[0], firstFutureExpirationDate);

    for (let i = 1; i < deliveryDates.length; i++) {
      const expectedInterval = BigInt(expirationIntervalDays) * 86400n;
      const actualInterval = deliveryDates[i] - deliveryDates[i - 1];
      assert.equal(actualInterval, expectedInterval);
    }
  });

  it("should allow owner to update future expiration dates count", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner, pc } = accounts;

    const initialDeliveryDates = await futures.read.getExpirationDates();
    assert.equal(initialDeliveryDates.length, config.futureExpirationDatesCount);

    const newCount = config.futureExpirationDatesCount + 1;
    const txHash = await futures.write.setFutureExpirationDatesCount([newCount], {
      account: owner.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    assert.equal(receipt.status, "success");

    const updatedCount = await futures.read.futureExpirationDatesCount();
    assert.equal(updatedCount, newCount);

    const updatedDeliveryDates = await futures.read.getExpirationDates();
    assert.equal(updatedDeliveryDates.length, newCount);

    for (let i = 0; i < initialDeliveryDates.length; i++) {
      assert.equal(updatedDeliveryDates[i], initialDeliveryDates[i]);
    }
  });

  it("should reject updating future expiration dates count to zero", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.setFutureExpirationDatesCount([0], { account: owner.account }),
      futures,
      "ValueOutOfRange",
    );
  });

  it("should reject non-owner from updating future expiration dates count", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.setFutureExpirationDatesCount([5], { account: seller.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
  });

  it("should correctly read firstFutureExpirationDate", async () => {
    const { contracts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;

    assert.equal(await futures.read.firstFutureExpirationDate(), config.firstFutureExpirationDate);
  });

  it("should correctly read expiration interval days", async () => {
    const { contracts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    assert.equal(await contracts.futures.read.expirationIntervalDays(), config.expirationIntervalDays);
  });

  it("should update expiration dates when count is increased", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    const initialDeliveryDates = await futures.read.getExpirationDates();
    const newCount = initialDeliveryDates.length + 2;
    await futures.write.setFutureExpirationDatesCount([newCount], { account: owner.account });

    const updatedDeliveryDates = await futures.read.getExpirationDates();
    assert.equal(updatedDeliveryDates.length, newCount);

    const firstFutureExpirationDate = await futures.read.firstFutureExpirationDate();
    const expirationIntervalDays = await futures.read.expirationIntervalDays();
    const expirationIntervalSeconds = BigInt(expirationIntervalDays) * 86400n;

    for (let i = 0; i < updatedDeliveryDates.length; i++) {
      const expectedDate = firstFutureExpirationDate + expirationIntervalSeconds * BigInt(i);
      assert.equal(updatedDeliveryDates[i], expectedDate);
    }
  });

  it("should update expiration dates when count is decreased", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner } = accounts;

    await futures.write.setFutureExpirationDatesCount([5], { account: owner.account });

    const newCount = 2;
    await futures.write.setFutureExpirationDatesCount([newCount], { account: owner.account });

    const updatedDeliveryDates = await futures.read.getExpirationDates();
    assert.equal(updatedDeliveryDates.length, newCount);

    const firstFutureExpirationDate = await futures.read.firstFutureExpirationDate();
    const expirationIntervalDays = await futures.read.expirationIntervalDays();
    const expirationIntervalSeconds = BigInt(expirationIntervalDays) * 86400n;

    for (let i = 0; i < updatedDeliveryDates.length; i++) {
      const expectedDate = firstFutureExpirationDate + expirationIntervalSeconds * BigInt(i);
      assert.equal(updatedDeliveryDates[i], expectedDate);
    }
  });

  it("should return correct expiration dates array when time has passed", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { tc } = accounts;

    await tc.setNextBlockTimestamp({ timestamp: config.firstFutureExpirationDate + 1n });
    await tc.mine({ blocks: 1 });

    const deliveryDates = await futures.read.getExpirationDates();
    assert.equal(deliveryDates.length, config.futureExpirationDatesCount);

    for (let i = 0; i < deliveryDates.length; i++) {
      const expectedDate =
        config.firstFutureExpirationDate + BigInt(config.expirationIntervalSeconds * (i + 1));
      assert.equal(deliveryDates[i], expectedDate);
    }
  });

  it("should validate expiration date correctly", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { tc, seller } = accounts;

    const price = await futures.read.getMarketPrice();
    await collateralVault.write.deposit([price * 100n], { account: seller.account });

    await tc.setNextBlockTimestamp({ timestamp: config.firstFutureExpirationDate + 1n });
    await tc.mine({ blocks: 1 });
    await refreshHashprice(contracts.hashrateOracle);

    // in the past
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, config.firstFutureExpirationDate, 1], {
        account: seller.account,
      }),
      futures,
      "ExpirationDateShouldBeInTheFuture",
    );

    // in the past and not aligned with interval
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, config.firstFutureExpirationDate + 1n, 1], {
        account: seller.account,
      }),
      futures,
      "ExpirationDateShouldBeInTheFuture",
    );

    // within available range but not aligned with interval
    const dateWithinRangeNotAligned =
      config.firstFutureExpirationDate + BigInt(config.expirationIntervalSeconds) + 1n;
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, dateWithinRangeNotAligned, 1], {
        account: seller.account,
      }),
      futures,
      "ExpirationDateNotAvailable",
    );

    // out of available range
    const dateOutOfRange =
      config.firstFutureExpirationDate +
      BigInt(config.expirationIntervalSeconds) * BigInt(config.futureExpirationDatesCount + 1);
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, dateOutOfRange, 1], { account: seller.account }),
      futures,
      "ExpirationDateNotAvailable",
    );

    // out of available range and not aligned with interval
    const dateOutOfRangeNotAligned = dateOutOfRange + 1n;
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, dateOutOfRangeNotAligned, 1], {
        account: seller.account,
      }),
      futures,
      "ExpirationDateNotAvailable",
    );

    // all valid dates
    for (let i = 0; i < config.futureExpirationDatesCount; i++) {
      const date =
        config.firstFutureExpirationDate + BigInt(config.expirationIntervalSeconds) * BigInt(i + 1);
      await futures.write.createOrder([price, date, 1], { account: seller.account });
    }
  });
});
