import { viem } from "hardhat";
import { parseUnits, maxUint256, encodeFunctionData, formatUnits } from "viem";
import { deployTokenOraclesAndMulticall3 } from "./fixtures-2";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

export async function deployFuturesFixture() {
  // Get wallet clients
  const data = await loadFixture(deployTokenOraclesAndMulticall3);
  return deployOnlyFuturesFixture(data);
}

export async function deployOnlyFuturesFixture(
  data: Awaited<ReturnType<typeof deployTokenOraclesAndMulticall3>>
) {
  const { contracts, accounts, config } = data;
  const { usdcMock, hashrateOracle, btcPriceOracleMock } = contracts;
  const { validator, seller, buyer, buyer2, owner, pc, tc } = accounts;
  const { oracle } = config;

  const liquidationMarginPercent = 20;
  const speedHps = parseUnits("100", 12); // 100 TH/s
  const deliveryDurationDays = 7;
  const deliveryDurationSeconds = deliveryDurationDays * 24 * 3600; // 30 days
  const priceLadderStep = parseUnits("0.01", 6); // 0.01 USDC
  const orderFee = parseUnits("1", 6); // 1 USDC
  const { timestamp: now } = await pc.getBlock({ blockTag: "latest" });
  const futureDeliveryDatesCount = 10;
  const firstFutureDeliveryDate = now + BigInt(deliveryDurationSeconds);
  const collateralAmount = parseUnits("10000", 6);
  const validatorURL = "//shev8.validator:anything@stratum.braiins.com:3333";

  // Deploy Futures contract
  const futuresImpl = await viem.deployContract("contracts/Futures.sol:Futures", []);
  const futuresProxy = await viem.deployContract("ERC1967Proxy", [
    futuresImpl.address,
    encodeFunctionData({
      abi: futuresImpl.abi,
      functionName: "initialize",
      args: [
        usdcMock.address,
        hashrateOracle.address,
        validator.account.address,
        liquidationMarginPercent,
        speedHps,
        priceLadderStep,
        deliveryDurationDays,
        deliveryDurationDays,
        futureDeliveryDatesCount,
        firstFutureDeliveryDate,
      ],
    }),
  ]);
  const futures = await viem.getContractAt("Futures", futuresProxy.address);
  await futures.write.setOrderFee([orderFee], { account: owner.account });
  await futures.write.setValidatorURL([validatorURL], { account: owner.account });
  const deliveryDates = await futures.read.getDeliveryDates();
  // Approve futures contract to spend USDC for all accounts
  await usdcMock.write.approve([futures.address, maxUint256], { account: seller.account });
  await usdcMock.write.approve([futures.address, maxUint256], { account: buyer.account });
  await usdcMock.write.approve([futures.address, maxUint256], { account: buyer2.account });
  await usdcMock.write.approve([futures.address, maxUint256], { account: validator.account });
  await usdcMock.write.approve([futures.address, maxUint256], { account: owner.account });

  await futures.write.depositReservePool([collateralAmount], { account: owner.account });

  return {
    config: {
      oracle,
      speedHps,
      liquidationMarginPercent,
      deliveryDurationSeconds,
      priceLadderStep,
      orderFee,
      deliveryDates,
      futureDeliveryDatesCount,
      firstFutureDeliveryDate,
      deliveryDurationDays,
      deliveryIntervalDays: deliveryDurationDays,
    },
    contracts: {
      usdcMock,
      btcPriceOracleMock,
      hashrateOracle,
      futures,
    },
    accounts: {
      owner,
      seller,
      buyer,
      buyer2,
      validator,
      pc,
      tc,
    },
  };
}

export async function deployOnlyFuturesWithDummyData(
  data: Awaited<ReturnType<typeof deployTokenOraclesAndMulticall3>>
) {
  const _data = await deployOnlyFuturesFixture(data);
  const { contracts, accounts, config } = _data;
  const { futures } = contracts;
  const { seller, buyer, buyer2 } = accounts;

  // create participants
  const mp = await futures.read.getMarketPrice();
  const inc = config.priceLadderStep;
  const marginAmount = mp * BigInt(config.deliveryDurationDays);
  await futures.write.addMargin([marginAmount], { account: seller.account });
  await futures.write.addMargin([marginAmount], { account: buyer.account });
  await futures.write.addMargin([marginAmount], { account: buyer2.account });

  // create positions
  let d = config.deliveryDates[0];
  const dst = "//shev8.contract:anything@stratum.braiins.com:3333";
  // sell orders
  await futures.write.createOrder([mp + inc, d, "", -1], { account: seller.account });
  await futures.write.createOrder([mp + 2n * inc, d, "", -1], { account: seller.account });
  await futures.write.createOrder([mp + 3n * inc, d, "", -1], { account: seller.account });

  // buy orders
  await futures.write.createOrder([mp - inc, d, dst, 1], { account: buyer.account });
  await futures.write.createOrder([mp - 2n * inc, d, dst, 1], { account: buyer.account });
  await futures.write.createOrder([mp - 3n * inc, d, dst, 1], { account: buyer.account });

  // matched orders => position
  await futures.write.createOrder([mp, d, dst, -1], { account: seller.account });
  await futures.write.createOrder([mp, d, dst, 1], { account: buyer.account });

  const totalPayment = mp * BigInt(config.deliveryDurationDays);

  const buyerBalance = await contracts.usdcMock.read.balanceOf([buyer.account.address]);
  console.log("buyer balance:", formatUnits(buyerBalance, 6));
  console.log("total payment", formatUnits(totalPayment, 6));

  // pay for the order
  await futures.write.addMargin([totalPayment], { account: buyer.account });
  await futures.write.depositDeliveryPayment([totalPayment, d], { account: buyer.account });
  return _data;
}
