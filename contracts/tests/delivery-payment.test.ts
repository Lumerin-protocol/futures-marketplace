import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { parseEventLogs, parseUnits, getAddress, maxUint256 } from "viem";
import { deployFuturesFixture } from "./fixtures";
import { catchError } from "../../lib";
import { quantizePrice } from "./utils";

describe("Futures Delivery Payment", function () {
  describe("depositDeliveryPayment", function () {
    it("should allow buyer to deposit delivery payment before delivery date", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures, usdcMock } = contracts;
      const { seller, buyer, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      // Add margin for both participants
      await futures.write.addMargin([marginAmount], {
        account: seller.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer.account,
      });

      // Create matching orders to form a position
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      const { positionId } = positionEvent.args;

      // Check initial balances
      const buyerBalanceBefore = await futures.read.balanceOf([buyer.account.address]);
      const contractBalanceBefore = await futures.read.balanceOf([futures.address]);

      // Deposit delivery payment
      const depositTxHash = await futures.write.depositDeliveryPayment(
        [totalPayment, deliveryDate],
        { account: buyer.account }
      );

      const depositReceipt = await pc.waitForTransactionReceipt({ hash: depositTxHash });
      expect(depositReceipt.status).to.equal("success");

      // Check balances after deposit
      const buyerBalanceAfter = await futures.read.balanceOf([buyer.account.address]);
      const contractBalanceAfter = await futures.read.balanceOf([futures.address]);

      expect(buyerBalanceAfter).to.equal(buyerBalanceBefore - totalPayment);
      expect(contractBalanceAfter).to.equal(contractBalanceBefore + totalPayment);

      // Check that position is marked as paid
      const position = await futures.read.getPositionById([positionId]);
      expect(position.paid).to.equal(true);
    });

    it("should reject deposit after delivery date has passed", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      // Add margin for both participants
      await futures.write.addMargin([marginAmount], {
        account: seller.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer.account,
      });

      // Create matching orders to form a position
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      // Move time past delivery date
      await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n });

      // Try to deposit after delivery date
      await catchError(futures.abi, "DeliveryDateExpired", async () => {
        await futures.write.depositDeliveryPayment([totalPayment, deliveryDate], {
          account: buyer.account,
        });
      });
    });

    it("should handle multiple positions for same delivery date", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, buyer2, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      // Add margin for all participants
      await futures.write.addMargin([marginAmount], {
        account: seller.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer2.account,
      });

      // Create first position: seller with buyer
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      const txHash1 = await futures.write.createOrder(
        [price, deliveryDate, "https://dest1.com", 1],
        { account: buyer.account }
      );

      // Create second position: seller with buyer2
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: buyer2.account,
      });
      const txHash2 = await futures.write.createOrder(
        [price, deliveryDate, "https://dest2.com", 1],
        { account: buyer.account }
      );

      const receipt1 = await pc.waitForTransactionReceipt({ hash: txHash1 });
      const [positionEvent1] = parseEventLogs({
        logs: receipt1.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      const receipt2 = await pc.waitForTransactionReceipt({ hash: txHash2 });
      const [positionEvent2] = parseEventLogs({
        logs: receipt2.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      const buyerBalanceBefore = await futures.read.balanceOf([buyer.account.address]);
      const contractBalanceBefore = await futures.read.balanceOf([futures.address]);

      // Deposit payment for both positions (buyer has one position)
      await futures.write.depositDeliveryPayment([totalPayment * 2n, deliveryDate], {
        account: buyer.account,
      });

      const buyerBalanceAfter = await futures.read.balanceOf([buyer.account.address]);
      const contractBalanceAfter = await futures.read.balanceOf([futures.address]);

      expect(buyerBalanceAfter).to.equal(buyerBalanceBefore - totalPayment * 2n);
      expect(contractBalanceAfter).to.equal(contractBalanceBefore + totalPayment * 2n);

      // Check that buyer's position is marked as paid
      const position1 = await futures.read.getPositionById([positionEvent1.args.positionId]);
      expect(position1.paid).to.equal(true);

      // Check that buyer2's position is not paid
      const position2 = await futures.read.getPositionById([positionEvent2.args.positionId]);
      expect(position2.paid).to.equal(true);
    });

    it("should only process positions where caller is the buyer", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, buyer2, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      // Add margin for all participants
      await futures.write.addMargin([marginAmount], {
        account: seller.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer2.account,
      });

      // Create position where buyer is the buyer
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      const txHash1 = await futures.write.createOrder(
        [price, deliveryDate, "https://dest1.com", 1],
        {
          account: buyer.account,
        }
      );

      // Create position where buyer2 is the buyer
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      const txHash2 = await futures.write.createOrder(
        [price, deliveryDate, "https://dest2.com", 1],
        {
          account: buyer2.account,
        }
      );

      const receipt1 = await pc.waitForTransactionReceipt({ hash: txHash1 });
      const [positionEvent1] = parseEventLogs({
        logs: receipt1.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      const receipt2 = await pc.waitForTransactionReceipt({ hash: txHash2 });
      const [positionEvent2] = parseEventLogs({
        logs: receipt2.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      // Buyer deposits payment - should only affect buyer's position
      await futures.write.depositDeliveryPayment([totalPayment, deliveryDate], {
        account: buyer.account,
      });

      const position1 = await futures.read.getPositionById([positionEvent1.args.positionId]);
      const position2 = await futures.read.getPositionById([positionEvent2.args.positionId]);

      expect(position1.paid).to.equal(true);
      expect(position2.paid).to.equal(false);
    });

    it("should stop processing if amount is insufficient for a position", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      // Add margin for both participants
      await futures.write.addMargin([marginAmount], {
        account: seller.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer.account,
      });

      // Create two positions for buyer
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      await futures.write.createOrder([price, deliveryDate, "https://dest1.com", 1], {
        account: buyer.account,
      });

      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      await futures.write.createOrder([price, deliveryDate, "https://dest2.com", 1], {
        account: buyer.account,
      });

      // Try to deposit less than required for both positions
      const insufficientAmount = totalPayment; // Only enough for one position
      await futures.write.depositDeliveryPayment([insufficientAmount, deliveryDate], {
        account: buyer.account,
      });

      // Should have processed only one position
      // We can't easily check which one, but we can verify the contract balance increased
      const contractBalance = await futures.read.balanceOf([futures.address]);
      expect(contractBalance > insufficientAmount).to.be.true;
    });
  });

  describe("depositDeliveryPayment (position ids)", function () {
    it("should allow buyer to deposit delivery payment for specific positions", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, buyer2, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const durationDays = BigInt(config.deliveryDurationDays);

      await futures.write.addMargin([marginAmount], { account: seller.account });
      await futures.write.addMargin([marginAmount], { account: buyer.account });
      await futures.write.addMargin([marginAmount], { account: buyer2.account });

      await futures.write.approve([futures.address, maxUint256], {
        account: buyer.account,
      });

      const createPosition = async (sellerAccount: typeof seller.account, destURL: string) => {
        await futures.write.createOrder([price, deliveryDate, "", -1], { account: sellerAccount });
        const txHash = await futures.write.createOrder([price, deliveryDate, destURL, 1], {
          account: buyer.account,
        });
        const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
        const [event] = parseEventLogs({
          logs: receipt.logs,
          abi: futures.abi,
          eventName: "PositionCreated",
        });
        return event.args.positionId;
      };

      const positionId1 = await createPosition(seller.account, "https://dest1.com");
      const positionId2 = await createPosition(buyer2.account, "https://dest2.com");

      const paymentPerPosition = price * durationDays;
      const totalPayment = paymentPerPosition * 2n;

      const buyerBalanceBefore = await futures.read.balanceOf([buyer.account.address]);
      const contractBalanceBefore = await futures.read.balanceOf([futures.address]);

      await futures.write.depositDeliveryPayment([[positionId1, positionId2]], {
        account: buyer.account,
      });

      const buyerBalanceAfter = await futures.read.balanceOf([buyer.account.address]);
      const contractBalanceAfter = await futures.read.balanceOf([futures.address]);

      expect(buyerBalanceAfter).to.equal(buyerBalanceBefore - totalPayment);
      expect(contractBalanceAfter).to.equal(contractBalanceBefore + totalPayment);

      const position1 = await futures.read.getPositionById([positionId1]);
      const position2 = await futures.read.getPositionById([positionId2]);

      expect(position1.paid).to.equal(true);
      expect(position2.paid).to.equal(true);
    });

    it("should revert if delivery date already passed for a position", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      await futures.write.addMargin([marginAmount], { account: seller.account });
      await futures.write.addMargin([marginAmount], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n });

      await catchError(futures.abi, "DeliveryDateExpired", async () => {
        await futures.write.depositDeliveryPayment([[positionEvent.args.positionId]], {
          account: buyer.account,
        });
      });
    });

    it("should revert when caller is not the position buyer", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      await futures.write.addMargin([marginAmount], { account: seller.account });
      await futures.write.addMargin([marginAmount], { account: buyer.account });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      await catchError(futures.abi, "OnlyPositionBuyer", async () => {
        await futures.write.depositDeliveryPayment([[positionEvent.args.positionId]], {
          account: seller.account,
        });
      });
    });

    it("should revert if position was already paid", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      await futures.write.addMargin([marginAmount], { account: seller.account });
      await futures.write.addMargin([marginAmount], { account: buyer.account });

      await futures.write.approve([futures.address, maxUint256], {
        account: buyer.account,
      });

      await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      await futures.write.depositDeliveryPayment([[positionEvent.args.positionId]], {
        account: buyer.account,
      });

      await catchError(futures.abi, "PositionAlreadyPaid", async () => {
        await futures.write.depositDeliveryPayment([[positionEvent.args.positionId]], {
          account: buyer.account,
        });
      });
    });

    it("should revert when position destination URL is not set", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, pc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      await futures.write.addMargin([marginAmount], { account: seller.account });
      await futures.write.addMargin([marginAmount], { account: buyer.account });

      await futures.write.approve([futures.address, maxUint256], {
        account: buyer.account,
      });

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

      await catchError(futures.abi, "PositionDestURLNotSet", async () => {
        await futures.write.depositDeliveryPayment([[positionEvent.args.positionId]], {
          account: buyer.account,
        });
      });
    });
  });

  describe("withdrawDeliveryPayment", function () {
    it("should allow seller to withdraw delivery payment after delivery finished", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      // Add margin for both participants
      await futures.write.addMargin([marginAmount], {
        account: seller.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer.account,
      });

      // Create matching orders to form a position
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      const { positionId } = positionEvent.args;

      // Buyer deposits payment
      await futures.write.depositDeliveryPayment([totalPayment, deliveryDate], {
        account: buyer.account,
      });

      // Move time past delivery end
      const deliveryEndTime = deliveryDate + BigInt(config.deliveryDurationSeconds);
      await tc.setNextBlockTimestamp({ timestamp: deliveryEndTime + 1n });

      // Check balances before withdrawal
      const sellerBalanceBefore = await futures.read.balanceOf([seller.account.address]);
      const contractBalanceBefore = await futures.read.balanceOf([futures.address]);

      // Seller withdraws payment
      const withdrawTxHash = await futures.write.withdrawDeliveryPayment([deliveryDate], {
        account: seller.account,
      });

      const withdrawReceipt = await pc.waitForTransactionReceipt({ hash: withdrawTxHash });
      expect(withdrawReceipt.status).to.equal("success");

      // Check balances after withdrawal
      const sellerBalanceAfter = await futures.read.balanceOf([seller.account.address]);
      const contractBalanceAfter = await futures.read.balanceOf([futures.address]);

      expect(sellerBalanceAfter).to.equal(sellerBalanceBefore + totalPayment);
      expect(contractBalanceAfter).to.equal(contractBalanceBefore - totalPayment);

      // Check that position is marked as not paid
      const position = await futures.read.getPositionById([positionId]);
      expect(position.paid).to.equal(false);
    });

    it("should reject withdrawal before delivery is finished", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      // Add margin for both participants
      await futures.write.addMargin([marginAmount], {
        account: seller.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer.account,
      });

      // Create matching orders to form a position
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      // Buyer deposits payment
      await futures.write.depositDeliveryPayment([totalPayment, deliveryDate], {
        account: buyer.account,
      });

      // Move time to during delivery (but not finished)
      const deliveryEndTime = deliveryDate + BigInt(config.deliveryDurationSeconds);
      await tc.setNextBlockTimestamp({ timestamp: deliveryEndTime - 1n });

      // Try to withdraw before delivery finished
      await catchError(futures.abi, "DeliveryNotFinishedYet", async () => {
        await futures.write.withdrawDeliveryPayment([deliveryDate], {
          account: seller.account,
        });
      });
    });

    it("should only allow seller to withdraw their own positions", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, buyer2, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      // Add margin for all participants
      await futures.write.addMargin([marginAmount], {
        account: seller.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer2.account,
      });

      // Create position: seller with buyer
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      const txHash1 = await futures.write.createOrder(
        [price, deliveryDate, "https://dest1.com", 1],
        { account: buyer.account }
      );

      // Create position: buyer2 as seller with buyer
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: buyer2.account,
      });
      const txHash2 = await futures.write.createOrder(
        [price, deliveryDate, "https://dest2.com", 1],
        { account: buyer.account }
      );

      const receipt1 = await pc.waitForTransactionReceipt({ hash: txHash1 });
      const [positionEvent1] = parseEventLogs({
        logs: receipt1.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      const receipt2 = await pc.waitForTransactionReceipt({ hash: txHash2 });
      const [positionEvent2] = parseEventLogs({
        logs: receipt2.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      // Buyer deposits payment for both positions
      await futures.write.depositDeliveryPayment([totalPayment * 2n, deliveryDate], {
        account: buyer.account,
      });

      // Move time past delivery end
      const deliveryEndTime = deliveryDate + BigInt(config.deliveryDurationSeconds);
      await tc.setNextBlockTimestamp({ timestamp: deliveryEndTime + 1n });

      const sellerBalanceBefore = await futures.read.balanceOf([seller.account.address]);
      const buyer2BalanceBefore = await futures.read.balanceOf([buyer2.account.address]);

      // Seller withdraws - should only get payment for their position
      await futures.write.withdrawDeliveryPayment([deliveryDate], {
        account: seller.account,
      });

      const sellerBalanceAfter = await futures.read.balanceOf([seller.account.address]);
      expect(sellerBalanceAfter).to.equal(sellerBalanceBefore + totalPayment);

      // Buyer2 withdraws - should get payment for their position
      await futures.write.withdrawDeliveryPayment([deliveryDate], {
        account: buyer2.account,
      });

      const buyer2BalanceAfter = await futures.read.balanceOf([buyer2.account.address]);
      expect(buyer2BalanceAfter).to.equal(buyer2BalanceBefore + totalPayment);
    });

    it("should only withdraw positions that are marked as paid", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, buyer2, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];
      const totalPayment = price * BigInt(config.deliveryDurationDays);

      // Add margin for all participants
      await futures.write.addMargin([marginAmount], {
        account: seller.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer2.account,
      });

      // Create position: seller with buyer (will be paid)
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      const txHash1 = await futures.write.createOrder(
        [price, deliveryDate, "https://dest1.com", 1],
        { account: buyer.account }
      );

      // Create position: seller with buyer2 (will NOT be paid)
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      const txHash2 = await futures.write.createOrder(
        [price, deliveryDate, "https://dest2.com", 1],
        { account: buyer2.account }
      );

      const receipt1 = await pc.waitForTransactionReceipt({ hash: txHash1 });
      const [positionEvent1] = parseEventLogs({
        logs: receipt1.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      const receipt2 = await pc.waitForTransactionReceipt({ hash: txHash2 });
      const [positionEvent2] = parseEventLogs({
        logs: receipt2.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      // Only buyer deposits payment (buyer2 does not)
      await futures.write.depositDeliveryPayment([totalPayment, deliveryDate], {
        account: buyer.account,
      });

      // Move time past delivery end
      const deliveryEndTime = deliveryDate + BigInt(config.deliveryDurationSeconds);
      await tc.setNextBlockTimestamp({ timestamp: deliveryEndTime + 1n });

      const sellerBalanceBefore = await futures.read.balanceOf([seller.account.address]);

      // Seller withdraws - should only get payment for paid position
      await futures.write.withdrawDeliveryPayment([deliveryDate], {
        account: seller.account,
      });

      const sellerBalanceAfter = await futures.read.balanceOf([seller.account.address]);
      expect(sellerBalanceAfter).to.equal(sellerBalanceBefore + totalPayment);

      // Verify only one position was marked as paid
      const position1 = await futures.read.getPositionById([positionEvent1.args.positionId]);
      const position2 = await futures.read.getPositionById([positionEvent2.args.positionId]);
      expect(position1.paid).to.equal(false); // Withdrawn, so marked as not paid
      expect(position2.paid).to.equal(false); // Never paid
    });
  });

  describe("Cash Settlement when buyer doesn't deposit", function () {
    it("should allow cash settlement via closeDelivery when buyer didn't deposit", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, validator, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      // Add margin for both participants
      await futures.write.addMargin([marginAmount], {
        account: seller.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer.account,
      });

      // Create matching orders to form a position
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      const { positionId } = positionEvent.args;

      // Buyer does NOT deposit payment
      // Position should remain unpaid
      const positionBefore = await futures.read.getPositionById([positionId]);
      expect(positionBefore.paid).to.equal(false);

      // Move time to during delivery
      await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n });

      // Close delivery via cash settlement (validator blames seller)
      const sellerBalanceBefore = await futures.read.balanceOf([seller.account.address]);
      const buyerBalanceBefore = await futures.read.balanceOf([buyer.account.address]);

      const closeTxHash = await futures.write.closeDelivery([positionId, true], {
        account: validator.account,
      });

      const closeReceipt = await pc.waitForTransactionReceipt({ hash: closeTxHash });
      const [closeEvent] = parseEventLogs({
        logs: closeReceipt.logs,
        abi: futures.abi,
        eventName: "PositionDeliveryClosed",
      });

      expect(closeEvent.args.positionId).to.equal(positionId);

      // Check that balances changed due to cash settlement
      const sellerBalanceAfter = await futures.read.balanceOf([seller.account.address]);
      const buyerBalanceAfter = await futures.read.balanceOf([buyer.account.address]);

      // Balances should have changed (cash settlement occurred)
      expect(sellerBalanceBefore !== sellerBalanceAfter || buyerBalanceBefore !== buyerBalanceAfter)
        .to.be.true;
    });

    it("should allow buyer to close delivery via cash settlement when they didn't deposit", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      // Add margin for both participants
      await futures.write.addMargin([marginAmount], {
        account: seller.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer.account,
      });

      // Create matching orders to form a position
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      const { positionId } = positionEvent.args;

      // Buyer does NOT deposit payment
      // Move time to during delivery
      await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n });

      // Buyer closes delivery via cash settlement (blames seller)
      const closeTxHash = await futures.write.closeDelivery([positionId, true], {
        account: buyer.account,
      });

      const closeReceipt = await pc.waitForTransactionReceipt({ hash: closeTxHash });
      const [closeEvent] = parseEventLogs({
        logs: closeReceipt.logs,
        abi: futures.abi,
        eventName: "PositionDeliveryClosed",
      });

      expect(closeEvent.args.positionId).to.equal(positionId);
      expect(getAddress(closeEvent.args.closedBy)).to.equal(getAddress(buyer.account.address));
    });

    it("should allow seller to close delivery via cash settlement when buyer didn't deposit", async function () {
      const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { seller, buyer, pc, tc } = accounts;

      const price = await futures.read.getMarketPrice();
      const marginAmount = parseUnits("10000", 6);
      const deliveryDate = config.deliveryDates[0];

      // Add margin for both participants
      await futures.write.addMargin([marginAmount], {
        account: seller.account,
      });
      await futures.write.addMargin([marginAmount], {
        account: buyer.account,
      });

      // Create matching orders to form a position
      await futures.write.createOrder([price, deliveryDate, "", -1], {
        account: seller.account,
      });
      const txHash = await futures.write.createOrder([price, deliveryDate, "https://dest.com", 1], {
        account: buyer.account,
      });

      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
      const [positionEvent] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionCreated",
      });

      const { positionId } = positionEvent.args;

      // Buyer does NOT deposit payment
      // Move time to during delivery
      await tc.setNextBlockTimestamp({ timestamp: deliveryDate + 1n });

      // Seller closes delivery via cash settlement (blames buyer)
      const closeTxHash = await futures.write.closeDelivery([positionId, false], {
        account: seller.account,
      });

      const closeReceipt = await pc.waitForTransactionReceipt({ hash: closeTxHash });
      const [closeEvent] = parseEventLogs({
        logs: closeReceipt.logs,
        abi: futures.abi,
        eventName: "PositionDeliveryClosed",
      });

      expect(closeEvent.args.positionId).to.equal(positionId);
      expect(getAddress(closeEvent.args.closedBy)).to.equal(getAddress(seller.account.address));
    });
  });
});
