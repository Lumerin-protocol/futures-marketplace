import type { NetworkConnection } from "hardhat/types/network";
import type { ArtifactMap } from "hardhat/types/artifacts";
import {
  parseUnits,
  maxUint256,
  encodeFunctionData,
  formatUnits,
  parseEventLogs,
  getContract,
} from "viem";
import type { Abi, Address, PublicClient, WalletClient, GetContractReturnType } from "viem";

// Contract ABIs mapping from Hardhat's artifact map
type ContractAbis = {
  [K in keyof ArtifactMap]: ArtifactMap[K] extends { abi: infer A } ? A : never;
};

// Return type for a deployed contract
type ContractInstance<ContractName extends keyof ContractAbis> = GetContractReturnType<
  ContractAbis[ContractName],
  { public: PublicClient; wallet: WalletClient },
  Address
>;

/**
 * Deploy a contract using raw viem with dynamically loaded artifact.
 * The contract name is used as a generic to provide full type inference.
 *
 * @param walletClient - Viem wallet client
 * @param publicClient - Viem public client (for waiting on receipt)
 * @param artifactPath - Relative path to artifact JSON, e.g., "../artifacts/Contract.json"
 * @param args - Constructor arguments
 * @returns Typed contract instance
 */
export async function deployContract<ContractName extends keyof ContractAbis>(
  walletClient: WalletClient,
  publicClient: PublicClient,
  artifactPath: string,
  args: unknown[] = [],
): Promise<ContractInstance<ContractName>> {
  // Load artifact dynamically
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(new URL(artifactPath, import.meta.url), "utf-8");
  const artifact = JSON.parse(content);

  const abi = artifact.abi as Abi;
  const bytecode = (artifact.bytecode?.object ?? artifact.bytecode) as `0x${string}`;

  // Deploy contract
  const { deployContract: viemDeploy } = await import("viem/actions");
  if (walletClient.account === undefined) {
    throw new Error("Wallet client must have an account");
  }
  const txHash = await viemDeploy(walletClient, {
    abi,
    bytecode,
    args,
    account: walletClient.account,
    chain: walletClient.chain,
  });

  // Wait for receipt to get the contract address
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (!receipt.contractAddress) {
    throw new Error(`Contract deployment failed: no contract address in receipt`);
  }

  // Return typed contract instance
  return getContract({
    address: receipt.contractAddress,
    abi,
    client: { public: publicClient, wallet: walletClient, chain: walletClient.chain },
  }) as unknown as ContractInstance<ContractName>;
}

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

  // 1. Deploy Multicall3 using raw viem with dynamically loaded artifact
  const [walletClient] = await viem.getWalletClients();
  const multicall3 = await deployContract<"Multicall3">(
    walletClient,
    pc,
    "../artifacts/multicall3/src/Multicall3.sol/Multicall3.json",
    [],
  );

  // 2. Deploy USDC Mock
  const usdcMock = await deployContract<"USDCMock">(
    walletClient,
    pc,
    "../artifacts/contracts/mocks/USDCMock.sol/USDCMock.json",
    [],
  );

  for (const w of [buyer, buyer2, seller, defaultBuyer, unregistered]) {
    await usdcMock.write.transfer([w.account.address, TOP_UP_BALANCE_USDC], {
      account: walletClient.account.address,
      chain: walletClient.chain,
    });
  }

  // 3. Deploy BTC/USD Feed
  const hashrateOracle = await deployContract<"PriceFeedMock">(
    walletClient,
    pc,
    "../artifacts/contracts/mocks/PriceFeedMock.sol/PriceFeedMock.json",
    [HASHPRICE_DECIMALS, "The price of 100 TH/s per day in USD"],
  );
  const hashpriceUsdFeedDecimals = await hashrateOracle.read.decimals();
  const hashpriceUsdFeedPrice = parseUnits("3.44", hashpriceUsdFeedDecimals);
  await (
    hashrateOracle.write.setPrice as (
      args: [bigint],
      opts?: { account?: unknown },
    ) => Promise<unknown>
  )([hashpriceUsdFeedPrice], { account: walletClient.account });

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

  // Get wallet client for deployments
  const [walletClient] = await viem.getWalletClients();

  const vaultImpl = await deployContract<"CollateralVault">(
    walletClient,
    pc,
    "../artifacts/collateral-margin/contracts/contracts/CollateralVault.sol/CollateralVault.json",
    [],
  );
  const collateralVaultInit = encodeFunctionData({
    abi: vaultImpl.abi,
    functionName: "initialize",
    args: [usdcMock.address],
  });
  const collateralVaultProxy = await deployContract<"ERC1967Proxy">(
    walletClient,
    pc,
    "../artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json",
    [vaultImpl.address, collateralVaultInit],
  );
  const collateralVault = getContract({
    abi: vaultImpl.abi,
    address: collateralVaultProxy.address,
    client: { public: pc, wallet: walletClient },
  });

  const futuresImpl = await deployContract<"Futures">(
    walletClient,
    pc,
    "../artifacts/contracts/Futures.sol/Futures.json",
    [collateralVault.address],
  );
  const futuresProxy = await deployContract<"ERC1967Proxy">(
    walletClient,
    pc,
    "../artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json",
    [
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
    ],
  );
  const futures = getContract({
    abi: futuresImpl.abi,
    address: futuresProxy.address,
    client: { public: pc, wallet: walletClient },
  });
  await collateralVault.write.setAuthorizedCaller([futures.address, true], {
    account: owner.account,
  });

  // PME stack with stub mocks for the non-futures products.
  const perpsDEXMock = await deployContract<"PerpsDEXMock">(
    walletClient,
    pc,
    "../artifacts/collateral-margin/contracts/contracts/mocks/PerpsDEXMock.sol/PerpsDEXMock.json",
    [],
  );
  const optionsEngineMock = await deployContract<"OptionsEngineMock">(
    walletClient,
    pc,
    "../artifacts/collateral-margin/contracts/contracts/mocks/OptionsEngineMock.sol/OptionsEngineMock.json",
    [],
  );
  const portfolioMarginEngineImpl = await deployContract<"PortfolioMarginEngine">(
    walletClient,
    pc,
    "../artifacts/collateral-margin/contracts/contracts/PortfolioMarginEngine.sol/PortfolioMarginEngine.json",
    [],
  );
  const portfolioMarginEngineProxy = await deployContract<"ERC1967Proxy">(
    walletClient,
    pc,
    "../artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json",
    [
      portfolioMarginEngineImpl.address,
      encodeFunctionData({
        abi: portfolioMarginEngineImpl.abi,
        functionName: "initialize",
        args: [collateralVault.address],
      }),
    ],
  );
  const portfolioMarginEngine = getContract({
    abi: portfolioMarginEngineImpl.abi,
    address: portfolioMarginEngineProxy.address,
    client: { public: pc, wallet: walletClient },
  });

  // Seed the perps mock's market price for any test that opts in to perps add-ons.
  // The mock is intentionally NOT registered on the PME by default: registering it
  // would make PME's `_getSpotPriceWad` source spot from the static mock price
  // (perps takes precedence over futures), which would then desync from the
  // hashprice oracle the futures tests move around. Tests that need a perps leg
  // can call `pme.setPerps(perpsDEXMock.address)` themselves.
  const marketPrice = await futures.read.getMarketPrice();
  await (
    perpsDEXMock.write.setMarketPrice as (
      args: [bigint],
      opts?: { account?: unknown },
    ) => Promise<unknown>
  )([marketPrice], { account: walletClient.account });

  // Register futures so PME picks up the cross-product margin path used by
  // `marginCall` / `computePortfolioMM`.
  await portfolioMarginEngine.write.setFutures([futures.address], { account: owner.account });

  // Align the PME stress shocks with the legacy futures `liquidationMarginPercent`
  // so test fixtures that previously calibrated deposits/moves around the
  // futures-only `getMinMargin` formula continue to trigger margin calls under
  // the cross-product PME model. The default PME shocks (10% IM / 5% MM) are
  // tuned for perps and would otherwise let the futures-only test cases stay
  // healthy through moves the legacy contract treated as liquidatable.
  const liqShockWad = (BigInt(liquidationMarginPercent) * 10n ** 18n) / 100n;
  await portfolioMarginEngine.write.setShocks([liqShockWad, liqShockWad, 0n, 0n], {
    account: owner.account,
  });

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
  const data = await conn.networkHelpers.loadFixture(deployTokenOraclesAndMulticall3);
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
