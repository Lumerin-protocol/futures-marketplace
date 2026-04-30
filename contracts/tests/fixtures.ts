import type { NetworkConnection } from "hardhat/types/network";
import { parseUnits, maxUint256, encodeFunctionData, formatUnits, parseEventLogs } from "viem";

const BITCOIN_DECIMALS = 8;
const USDC_DECIMALS = 6;
const DIFFICULTY_TO_HASHRATE_FACTOR = 2n ** 32n;
const HASHPRICE_DECIMALS = 8; // matches HashpriceUSD.decimals()

const TOP_UP_BALANCE_USDC = parseUnits("10000", USDC_DECIMALS);

/** Token + oracle setup shared by every Futures fixture. */
export async function deployTokenOraclesAndMulticall3(conn: NetworkConnection) {
  const { viem } = conn;

  const [owner, seller, buyer, validator, validator2, buyer2, defaultBuyer, unregistered] =
    await viem.getWalletClients();
  const pc = await viem.getPublicClient();
  const tc = await viem.getTestClient();

  // 1. Deploy Multicall3
  const multicall3 = await viem.deployContract("Multicall3", []);

  // 2. Deploy USDC Mock
  const usdcMockRaw = await viem.deployContract("USDCMock", []);
  const usdcMock = await viem.getContractAt(
    "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol:IERC20Metadata",
    usdcMockRaw.address,
  );

  for (const w of [buyer, buyer2, seller, defaultBuyer, unregistered]) {
    await usdcMock.write.transfer([w.account.address, TOP_UP_BALANCE_USDC]);
  }

  // 3. Deploy BTC/USD Feed
  const hashrateOracle = await viem.deployContract("PriceFeedMock", [
    HASHPRICE_DECIMALS,
    "The price of 100 TH/s per day in USD",
  ]);
  const hashpriceUsdFeedDecimals = await hashrateOracle.read.decimals();
  const hashpriceUsdFeedPrice = parseUnits("3.44", hashpriceUsdFeedDecimals);
  await hashrateOracle.write.setPrice([hashpriceUsdFeedPrice]);

  return {
    config: { oracle: { hashpriceUsdFeedDecimals, hashpriceUsdFeedPrice } },
    contracts: {
      usdcMock,
      hashrateOracle,
      multicall3,
    },
    accounts: {
      owner,
      seller,
      buyer,
      buyer2,
      defaultBuyer,
      validator,
      validator2,
      pc,
      tc,
      unregistered,
    },
  };
}

export type TokenOraclesFixture = Awaited<ReturnType<typeof deployTokenOraclesAndMulticall3>>;

/** Full Futures stack — vault, PME, Futures proxy, validator config, approvals. */
export async function deployOnlyFuturesFixture(conn: NetworkConnection, data: TokenOraclesFixture) {
  const { viem } = conn;
  const { contracts, accounts, config } = data;
  const { usdcMock, hashrateOracle } = contracts;
  const { validator, seller, buyer, buyer2, owner, pc, tc } = accounts;
  const { oracle } = config;

  const liquidationMarginPercent = 20;
  const speedHps = parseUnits("100", 12); // 100 TH/s
  const deliveryDurationDays = 7;
  const deliveryDurationSeconds = deliveryDurationDays * 24 * 3600;
  const priceLadderStep = parseUnits("0.01", USDC_DECIMALS);
  const orderFee = parseUnits("1", USDC_DECIMALS);
  const { timestamp: now } = await pc.getBlock({ blockTag: "latest" });
  const futureDeliveryDatesCount = 10;
  const firstFutureDeliveryDate = now + BigInt(deliveryDurationSeconds);
  const collateralAmount = parseUnits("10000", USDC_DECIMALS);
  const validatorURL = "//shev8.validator:anything@stratum.braiins.com:3333";

  const vaultImpl = await viem.deployContract("CollateralVault", []);
  const collateralVaultInit = encodeFunctionData({
    abi: vaultImpl.abi,
    functionName: "initialize",
    args: [usdcMock.address],
  });
  const collateralVaultProxy = await viem.deployContract("ERC1967Proxy", [
    vaultImpl.address,
    collateralVaultInit,
  ]);
  const collateralVault = await viem.getContractAt("CollateralVault", collateralVaultProxy.address);

  const futuresImpl = await viem.deployContract("Futures", [collateralVault.address]);
  const futuresProxy = await viem.deployContract("ERC1967Proxy", [
    futuresImpl.address,
    encodeFunctionData({
      abi: futuresImpl.abi,
      functionName: "initialize",
      args: [
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
  await collateralVault.write.setAuthorizedCaller([futures.address, true], {
    account: owner.account,
  });

  // PME stack with stub mocks for the non-futures products.
  const perpsDEXMock = await viem.deployContract("PerpsDEXMock", []);
  const optionsEngineMock = await viem.deployContract("OptionsEngineMock", []);
  const portfolioMarginEngineImpl = await viem.deployContract("PortfolioMarginEngine", []);
  const portfolioMarginEngineProxy = await viem.deployContract("ERC1967Proxy", [
    portfolioMarginEngineImpl.address,
    encodeFunctionData({
      abi: portfolioMarginEngineImpl.abi,
      functionName: "initialize",
      args: [collateralVault.address],
    }),
  ]);
  const portfolioMarginEngine = await viem.getContractAt(
    "PortfolioMarginEngine",
    portfolioMarginEngineProxy.address,
  );

  // Seed the perps mock's market price so PM-engine stress scenarios have a price reference.
  const marketPrice = await futures.read.getMarketPrice();
  await perpsDEXMock.write.setMarketPrice([marketPrice]);

  await futures.write.setMarginEngine([portfolioMarginEngine.address], { account: owner.account });
  await collateralVault.write.setMarginEngine([portfolioMarginEngine.address], {
    account: owner.account,
  });

  await futures.write.setOrderFee([orderFee], { account: owner.account });
  await futures.write.setValidatorURL([validatorURL], { account: owner.account });
  const deliveryDates = await futures.read.getDeliveryDates();

  // `depositFor` pulls USDC via the vault — approve the vault, not Futures.
  for (const w of [seller, buyer, buyer2, validator, owner]) {
    await usdcMock.write.approve([collateralVault.address, maxUint256], { account: w.account });
  }

  await collateralVault.write.depositInsuranceFund([collateralAmount], {
    account: owner.account,
  });

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
      collateralAmount,
    },
    contracts: {
      usdcMock,
      hashrateOracle,
      futures,
      collateralVault,
      portfolioMarginEngine,
      perpsDEXMock,
      optionsEngineMock,
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

export type FuturesFixture = Awaited<ReturnType<typeof deployOnlyFuturesFixture>>;

/** Convenience: oracles + Futures stack in a single fixture (the common case). */
export async function deployFuturesFixture(conn: NetworkConnection) {
  const data = await deployTokenOraclesAndMulticall3(conn);
  return deployOnlyFuturesFixture(conn, data);
}

/** Futures stack pre-loaded with sample orders and a paid position. Used by deploy-local. */
export async function deployOnlyFuturesWithDummyData(
  conn: NetworkConnection,
  data: TokenOraclesFixture,
) {
  const ctx = await deployOnlyFuturesFixture(conn, data);
  const { contracts, accounts, config } = ctx;
  const { futures, collateralVault } = contracts;
  const { seller, buyer, buyer2, pc } = accounts;

  const mp = await futures.read.getMarketPrice();
  const inc = config.priceLadderStep;
  const marginAmount = mp * BigInt(config.deliveryDurationDays);
  await collateralVault.write.deposit([marginAmount], { account: seller.account });
  await collateralVault.write.deposit([marginAmount], { account: buyer.account });
  await collateralVault.write.deposit([marginAmount], { account: buyer2.account });

  // create positions
  const d = config.deliveryDates[0];
  const dst = "//shev8.contract:anything@stratum.braiins.com:3333";

  await futures.write.createOrder([mp + inc, d, "", -1], { account: seller.account });
  await futures.write.createOrder([mp + 2n * inc, d, "", -1], { account: seller.account });
  await futures.write.createOrder([mp + 3n * inc, d, "", -1], { account: seller.account });

  await futures.write.createOrder([mp - inc, d, dst, 1], { account: buyer.account });
  await futures.write.createOrder([mp - 2n * inc, d, dst, 1], { account: buyer.account });
  await futures.write.createOrder([mp - 3n * inc, d, dst, 1], { account: buyer.account });

  await futures.write.createOrder([mp, d, dst, -1], { account: seller.account });
  const txhash = await futures.write.createOrder([mp, d, dst, 1], { account: buyer.account });

  const receipt = await pc.waitForTransactionReceipt({ hash: txhash });
  const [event] = parseEventLogs({
    logs: receipt.logs,
    abi: futures.abi,
    eventName: "PositionCreated",
  });
  const positionId = event.args.positionId;

  const totalPayment = mp * BigInt(config.deliveryDurationDays);
  const buyerBalance = await contracts.usdcMock.read.balanceOf([buyer.account.address]);
  console.log("buyer balance:", formatUnits(buyerBalance, USDC_DECIMALS));
  console.log("total payment", formatUnits(totalPayment, USDC_DECIMALS));

  await collateralVault.write.deposit([totalPayment], { account: buyer.account });

  await futures.write.depositDeliveryPaymentV2([positionId], { account: buyer.account });
  return ctx;
}
