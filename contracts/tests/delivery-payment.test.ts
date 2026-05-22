import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { refreshHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

describe("Futures Delivery Payment", () => {
  describe("depositDeliveryPayment", () => {
    it("should allow buyer to deposit delivery payment before delivery date", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      const { lotId: positionId } = positionEvent.args;

      const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
      const contractBalanceBefore = await collateralVault.read.balanceOf([futures.address]);

      const depositTxHash = await futures.write.depositDeliveryPaymentV2([positionId], {
        account: buyer.account,
      });

      const depositReceipt = await pc.waitForTransactionReceipt({ hash: depositTxHash });
      assert.equal(depositReceipt.status, "success");

      const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);
      const contractBalanceAfter = await collateralVault.read.balanceOf([futures.address]);

      assert.equal(buyerBalanceAfter, buyerBalanceBefore - totalPayment);
      assert.equal(contractBalanceAfter, contractBalanceBefore + totalPayment);

      const position = await futures.read.getPositionById([positionId]);
      assert.equal(position.paid, true);
    });

    it("should reject deposit after delivery date has passed", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });
      const { lotId: positionId } = positionEvent.args;

      await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n });

      await viem.assertions.revertWithCustomError(
        futures.write.depositDeliveryPaymentV2([positionId], { account: buyer.account }),
        futures,
        "DeliveryDateExpired",
      );
    });
  });

  describe("depositDeliveryPayment (position ids)", () => {
    it("should allow buyer to deposit delivery payment for specific positions", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, buyer2, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const durationDays = BigInt(config.deliveryDurationDays);

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer2.account });

      const createPosition = async (sellerAccount: typeof seller.account, destURL: string) => {
        await futures.write.createOrder([price, deliveryDate, "", -1], { account: sellerAccount });
        const txHash = await futures.write.createOrder([price, deliveryDate, destURL, 1], {
          account: buyer.account,
        });
        const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
        const [event] = parseEventLogs({
          logs: receipt.logs,
          abi: futures.abi,
          eventName: "LotCreated",
        });
        return event.args.lotId;
      };

      const positionId1 = await createPosition(seller.account, "https://dest1.com");
      const positionId2 = await createPosition(buyer2.account, "https://dest2.com");

      const paymentPerPosition = price * durationDays;
      const totalPayment = paymentPerPosition * 2n;

      const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
      const contractBalanceBefore = await collateralVault.read.balanceOf([futures.address]);

      await futures.write.depositDeliveryPayment([[positionId1, positionId2]], {
        account: buyer.account,
      });

      const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);
      const contractBalanceAfter = await collateralVault.read.balanceOf([futures.address]);

      assert.equal(buyerBalanceAfter, buyerBalanceBefore - totalPayment);
      assert.equal(contractBalanceAfter, contractBalanceBefore + totalPayment);

      const position1 = await futures.read.getPositionById([positionId1]);
      const position2 = await futures.read.getPositionById([positionId2]);

      assert.equal(position1.paid, true);
      assert.equal(position2.paid, true);
    });

    it("should revert if delivery date already passed for a position", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n });

      await viem.assertions.revertWithCustomError(
        futures.write.depositDeliveryPayment([[positionEvent.args.lotId]], {
          account: buyer.account,
        }),
        futures,
        "DeliveryDateExpired",
      );
    });

    it("should revert when caller is not the position buyer", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      await viem.assertions.revertWithCustomError(
        futures.write.depositDeliveryPayment([[positionEvent.args.lotId]], {
          account: seller.account,
        }),
        futures,
        "OnlyPositionBuyer",
      );
    });

    it("should revert if position was already paid", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      await futures.write.depositDeliveryPayment([[positionEvent.args.lotId]], {
        account: buyer.account,
      });

      await viem.assertions.revertWithCustomError(
        futures.write.depositDeliveryPayment([[positionEvent.args.lotId]], {
          account: buyer.account,
        }),
        futures,
        "PositionAlreadyPaid",
      );
    });

    it("should revert when position destination URL is not set", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

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
        eventName: "LotCreated",
      });

      await viem.assertions.revertWithCustomError(
        futures.write.depositDeliveryPayment([[positionEvent.args.lotId]], {
          account: buyer.account,
        }),
        futures,
        "PositionDestURLNotSet",
      );
    });
  });

  describe("withdrawDeliveryPayment", () => {
    it("should allow seller to withdraw delivery payment after delivery finished", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      const { lotId: positionId } = positionEvent.args;

      await futures.write.depositDeliveryPaymentV2([positionId], { account: buyer.account });

      const deliveryEndTime = deliveryDate + BigInt(config.deliveryDurationSeconds);
      await tc.setNextBlockTimestamp({ timestamp: deliveryEndTime + 1n });

      const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
      const contractBalanceBefore = await collateralVault.read.balanceOf([futures.address]);

      const withdrawTxHash = await futures.write.withdrawDeliveryPayment([deliveryDate], {
        account: seller.account,
      });

      const withdrawReceipt = await pc.waitForTransactionReceipt({ hash: withdrawTxHash });
      assert.equal(withdrawReceipt.status, "success");

      const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
      const contractBalanceAfter = await collateralVault.read.balanceOf([futures.address]);

      assert.equal(sellerBalanceAfter, sellerBalanceBefore + totalPayment);
      assert.equal(contractBalanceAfter, contractBalanceBefore - totalPayment);

      const position = await futures.read.getPositionById([positionId]);
      assert.equal(position.seller, "0x0000000000000000000000000000000000000000");
    });

    it("should reject withdrawal before delivery is finished", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const hash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      await futures.write.depositDeliveryPaymentV2([positionEvent.args.lotId], {
        account: buyer.account,
      });

      const deliveryEndTime = deliveryDate + BigInt(config.deliveryDurationSeconds);
      await tc.setNextBlockTimestamp({ timestamp: deliveryEndTime - 1n });

      await viem.assertions.revertWithCustomError(
        futures.write.withdrawDeliveryPayment([deliveryDate], { account: seller.account }),
        futures,
        "DeliveryNotFinishedYet",
      );
    });

    it("should only allow seller to withdraw their own positions", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, buyer2, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer2.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash1 = await futures.write.createOrder(
        [price, deliveryDate, "https://dest1.com", 1],
        { account: buyer.account },
      );

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: buyer2.account });
      const txHash2 = await futures.write.createOrder(
        [price, deliveryDate, "https://dest2.com", 1],
        { account: buyer.account },
      );

      const receipt1 = await pc.waitForTransactionReceipt({ hash: txHash1 });
      const [positionEvent1] = parseEventLogs({
        logs: receipt1.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      const receipt2 = await pc.waitForTransactionReceipt({ hash: txHash2 });
      const [positionEvent2] = parseEventLogs({
        logs: receipt2.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      await futures.write.depositDeliveryPaymentV2([positionEvent1.args.lotId], {
        account: buyer.account,
      });
      await futures.write.depositDeliveryPaymentV2([positionEvent2.args.lotId], {
        account: buyer.account,
      });

      const deliveryEndTime = deliveryDate + BigInt(config.deliveryDurationSeconds);
      await tc.setNextBlockTimestamp({ timestamp: deliveryEndTime + 1n });

      const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
      const buyer2BalanceBefore = await collateralVault.read.balanceOf([buyer2.account.address]);

      await futures.write.withdrawDeliveryPayment([deliveryDate], { account: seller.account });

      const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
      assert.equal(sellerBalanceAfter, sellerBalanceBefore + totalPayment);

      await futures.write.withdrawDeliveryPayment([deliveryDate], { account: buyer2.account });

      const buyer2BalanceAfter = await collateralVault.read.balanceOf([buyer2.account.address]);
      assert.equal(buyer2BalanceAfter, buyer2BalanceBefore + totalPayment);
    });

    it("should only withdraw positions that are marked as paid", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, buyer2, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer2.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash1 = await futures.write.createOrder(
        [price, deliveryDate, "https://dest1.com", 1],
        { account: buyer.account },
      );

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash2 = await futures.write.createOrder(
        [price, deliveryDate, "https://dest2.com", 1],
        { account: buyer2.account },
      );

      const receipt1 = await pc.waitForTransactionReceipt({ hash: txHash1 });
      const [positionEvent1] = parseEventLogs({
        logs: receipt1.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      const receipt2 = await pc.waitForTransactionReceipt({ hash: txHash2 });
      const [positionEvent2] = parseEventLogs({
        logs: receipt2.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      // Only buyer deposits, buyer2 does not.
      await futures.write.depositDeliveryPaymentV2([positionEvent1.args.lotId], {
        account: buyer.account,
      });

      const deliveryEndTime = deliveryDate + BigInt(config.deliveryDurationSeconds);
      await tc.setNextBlockTimestamp({ timestamp: deliveryEndTime + 1n });

      const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);

      await futures.write.withdrawDeliveryPayment([deliveryDate], { account: seller.account });

      const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
      assert.equal(sellerBalanceAfter, sellerBalanceBefore + totalPayment);

      const position1 = await futures.read.getPositionById([positionEvent1.args.lotId]);
      const position2 = await futures.read.getPositionById([positionEvent2.args.lotId]);
      assert.equal(position1.seller, "0x0000000000000000000000000000000000000000");
      assert.equal(position2.paid, false);
    });
  });

  describe("Cash Settlement when buyer doesn't deposit", () => {
    it("should allow cash settlement via closeDelivery when buyer didn't deposit", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, validator, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      const { lotId: positionId } = positionEvent.args;

      const positionBefore = await futures.read.getPositionById([positionId]);
      assert.equal(positionBefore.paid, false);

      await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n });
      await refreshHashprice(contracts.hashrateOracle);

      const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
      const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);

      const closeTxHash = await futures.write.closeDelivery([positionId, true], {
        account: validator.account,
      });

      const closeReceipt = await pc.waitForTransactionReceipt({ hash: closeTxHash });
      const [closeEvent] = parseEventLogs({
        logs: closeReceipt.logs,
        abi: futures.abi,
        eventName: "LotClosed",
      });

      assert.equal(closeEvent.args.lotId, positionId);
      assert.equal(closeEvent.args.reason, 2);

      const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
      const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);

      assert.ok(
        sellerBalanceBefore !== sellerBalanceAfter || buyerBalanceBefore !== buyerBalanceAfter,
      );
    });

    it("should allow buyer to close delivery via cash settlement when they didn't deposit", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      const { lotId: positionId } = positionEvent.args;

      await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n });
      await refreshHashprice(contracts.hashrateOracle);

      const closeTxHash = await futures.write.closeDelivery([positionId, true], {
        account: buyer.account,
      });

      const closeReceipt = await pc.waitForTransactionReceipt({ hash: closeTxHash });
      const [closeEvent] = parseEventLogs({
        logs: closeReceipt.logs,
        abi: futures.abi,
        eventName: "LotClosed",
      });

      assert.equal(closeEvent.args.lotId, positionId);
      assert.equal(closeEvent.args.reason, 2);
      assert.equal(getAddress(closeEvent.args.closedBy), getAddress(buyer.account.address));
    });

    it("should allow seller to close delivery via cash settlement when buyer didn't deposit", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { seller, buyer, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      const { lotId: positionId } = positionEvent.args;

      await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n });
      await refreshHashprice(contracts.hashrateOracle);

      const closeTxHash = await futures.write.closeDelivery([positionId, false], {
        account: seller.account,
      });

      const closeReceipt = await pc.waitForTransactionReceipt({ hash: closeTxHash });
      const [closeEvent] = parseEventLogs({
        logs: closeReceipt.logs,
        abi: futures.abi,
        eventName: "LotClosed",
      });

      assert.equal(closeEvent.args.lotId, positionId);
      assert.equal(closeEvent.args.reason, 2);
      assert.equal(getAddress(closeEvent.args.closedBy), getAddress(seller.account.address));
    });
  });

  describe("BREACH with buyer prepayment", () => {
    it("should settle from escrow and refund buyer instead of charging buyer vault again", async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const { owner, seller, buyer, validator, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      await collateralVault.write.deposit([marginAmount], { account: seller.account });
      await collateralVault.write.deposit([marginAmount], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [lotEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LotCreated",
      });

      const { lotId: positionId } = lotEvent.args;

      // Neutralize breach penalty so balance delta only reflects escrow delivery/refund flow.
      await futures.write.setBreachPenaltyRatePerDay([0n], { account: owner.account });

      const contractBalanceBeforeDeposit = await collateralVault.read.balanceOf([futures.address]);
      await futures.write.depositDeliveryPaymentV2([positionId], { account: buyer.account });

      const buyerBalanceAfterDeposit = await collateralVault.read.balanceOf([buyer.account.address]);
      const contractBalanceAfterDeposit = await collateralVault.read.balanceOf([futures.address]);
      assert.equal(contractBalanceAfterDeposit - contractBalanceBeforeDeposit, totalPayment);

      await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n });
      await refreshHashprice(contracts.hashrateOracle);

      const closeTxHash = await futures.write.closeDelivery([positionId, false], {
        account: validator.account,
      });
      const closeReceipt = await pc.waitForTransactionReceipt({ hash: closeTxHash });
      const [closeEvent] = parseEventLogs({
        logs: closeReceipt.logs,
        abi: futures.abi,
        eventName: "LotClosed",
      });

      assert.equal(closeEvent.args.lotId, positionId);
      assert.equal(closeEvent.args.reason, 2); // BREACH

      const buyerBalanceAfterClose = await collateralVault.read.balanceOf([buyer.account.address]);
      const contractBalanceAfterClose = await collateralVault.read.balanceOf([futures.address]);

      // Escrow delta should be fully consumed (seller payment + buyer refund).
      assert.equal(contractBalanceAfterClose, contractBalanceBeforeDeposit);
      // Critical regression check: closeDelivery should not take additional payment from buyer vault.
      assert.ok(buyerBalanceAfterClose > buyerBalanceAfterDeposit);
    });
  });
});
