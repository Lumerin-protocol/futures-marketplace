import type { NetworkConnection } from "hardhat/types/network";
import type { ArtifactMap } from "hardhat/types/artifacts";
import { parseUnits, maxUint256, encodeFunctionData, getContract } from "viem";
import type { Abi, Address, PublicClient, WalletClient, GetContractReturnType } from "viem";
import { TimeInForce } from "./timeInForce.ts";

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

const _BITCOIN_DECIMALS = 8;
const USDC_DECIMALS = 6;
const _DIFFICULTY_TO_HASHRATE_FACTOR = 2n ** 32n;
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

  // 3. Deploy HashpriceUSD mock feed
  const hashpriceUsd = await deployContract<"PriceFeedMock">(
    walletClient,
    pc,
    "../artifacts/contracts/mocks/PriceFeedMock.sol/PriceFeedMock.json",
    [HASHPRICE_DECIMALS, "The price of 1 PH/s per day in USD"],
  );
  const hashpriceUsdFeedDecimals = await hashpriceUsd.read.decimals();
  // Seed at the former mark ($34.40 = $3.44 × 10) so dollar sizing stays unchanged
  // after the oracle unit moved from 100 TH/s·day to 1 PH/s·day.
  const hashpriceUsdFeedPrice = parseUnits("34.4", hashpriceUsdFeedDecimals);
  await (
    hashpriceUsd.write.setPrice as (
      args: [bigint],
      opts?: { account?: unknown },
    ) => Promise<unknown>
  )([hashpriceUsdFeedPrice], { account: walletClient.account });

  return {
    config: { oracle: { hashpriceUsdFeedDecimals, hashpriceUsdFeedPrice } },
    contracts: {
      usdcMock,
      hashpriceUsd,
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

/** Full Futures stack — vault, PME, HashPowerFutures proxy, validator config, approvals. */
export async function deployOnlyFuturesFixture(conn: NetworkConnection, data: TokenOraclesFixture) {
  const { viem } = conn;
  const { contracts, accounts, config } = data;
  const { usdcMock, hashpriceUsd } = contracts;
  const { validator, seller, buyer, buyer2, owner, pc, tc } = accounts;
  const { oracle } = config;

  const liquidationMarginPercent = 20;
  // Compile-time constant CONTRACT_SIZE_HPS_DAY on HashPowerFutures.sol; mirrored here for expected-price math in tests.
  const contractSizeHpsDay = parseUnits("1000", 12); // 1e15 = 1 PH/s over a day (hashes/s·day) → one unit = 1 PH/s/day
  const expirationIntervalDays = 30;
  const expirationIntervalSeconds = expirationIntervalDays * 24 * 3600;
  const priceLadderStep = parseUnits("0.01", USDC_DECIMALS);
  const makerFeeBps = 0;
  const takerFeeBps = 0; // 0 bps — tests that need fees set them explicitly
  const { timestamp: now } = await pc.getBlock({ blockTag: "latest" });
  const futureExpirationDatesCount = 10;
  const firstFutureExpirationDate = now + BigInt(expirationIntervalSeconds);
  const collateralAmount = parseUnits("10000", USDC_DECIMALS);

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

  await usdcMock.write.approve([collateralVault.address, collateralAmount], {
    account: owner.account,
    chain: owner.chain,
  });
  await collateralVault.write.depositInsuranceFund([collateralAmount], { account: owner.account });

  const futuresImpl = await deployContract<"HashPowerFutures">(
    walletClient,
    pc,
    "../artifacts/contracts/HashPowerFutures.sol/HashPowerFutures.json",
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
          hashpriceUsd.address,
          liquidationMarginPercent,
          futureExpirationDatesCount,
          firstFutureExpirationDate,
        ],
      }),
    ],
  );
  const futures = getContract({
    abi: futuresImpl.abi,
    address: futuresProxy.address,
    client: { public: pc, wallet: walletClient },
  });
  await collateralVault.write.setAuthorizedCaller([futures.address, true]);

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
        args: [],
      }),
    ],
  );
  const portfolioMarginEngine = getContract({
    abi: portfolioMarginEngineImpl.abi,
    address: portfolioMarginEngineProxy.address,
    client: { public: pc, wallet: walletClient },
  });

  await portfolioMarginEngine.write.setVault([collateralVault.address]);
  // Point the PME's own spot source at the same hashprice feed the futures
  // contract uses — oracle moves then flow into PME stress math automatically.
  // The perps mock is NOT registered on the PME by default — tests that need a
  // perps leg call `pme.addLinearMarket(perpsDEXMock.address)` themselves.
  await portfolioMarginEngine.write.setOracle([hashpriceUsd.address]);

  // Register futures so PME picks up the cross-product margin path used by
  // `liquidate*` / `computePortfolioMM`.
  await portfolioMarginEngine.write.addLinearMarket([futures.address]);

  // Align the PME stress shocks with the legacy futures `liquidationMarginPercent`
  // so test fixtures that previously calibrated deposits/moves around the
  // futures-only `getMinMargin` formula continue to trigger liquidations under
  // the cross-product PME model. The default PME shocks (10% IM / 5% MM) are
  // tuned for perps and would otherwise let the futures-only test cases stay
  // healthy through moves the legacy contract treated as liquidatable.
  const liqShockWad = (BigInt(liquidationMarginPercent) * 10n ** 18n) / 100n;
  await portfolioMarginEngine.write.setShocks([liqShockWad, liqShockWad, 0n, 0n]);

  await futures.write.setPortfolioMargin([portfolioMarginEngine.address]);
  await collateralVault.write.setMarginEngine([portfolioMarginEngine.address]);

  await futures.write.setMakerFeeBps([makerFeeBps]);
  await futures.write.setTakerFeeBps([takerFeeBps]);
  const deliveryDates = await futures.read.getExpirationDates();

  // `depositFor` pulls USDC via the vault — approve the vault, not HashPowerFutures.
  for (const w of [seller, buyer, buyer2, validator, owner]) {
    await usdcMock.write.approve([collateralVault.address, maxUint256], {
      account: w.account,
      chain: w.chain,
    });
  }

  await collateralVault.write.depositInsuranceFund([collateralAmount], {
    account: owner.account,
  });

  return {
    config: {
      oracle,
      contractSizeHpsDay,
      liquidationMarginPercent,
      expirationIntervalSeconds,
      priceLadderStep,
      makerFeeBps,
      takerFeeBps,
      deliveryDates,
      futureExpirationDatesCount,
      firstFutureExpirationDate,
      expirationIntervalDays,
      collateralAmount,
    },
    contracts: {
      usdcMock,
      hashpriceUsd,
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
export async function deployFuturesFixture(
  conn: NetworkConnection,
): ReturnType<typeof deployOnlyFuturesFixture> {
  const data = await conn.networkHelpers.loadFixture(deployTokenOraclesAndMulticall3);
  return await deployOnlyFuturesFixture(conn, data);
}

/** Futures stack pre-loaded with sample orders and a paid position. Used by deploy-local. */
export async function deployOnlyFuturesWithDummyData(
  conn: NetworkConnection,
  data: TokenOraclesFixture,
) {
  const ctx = await deployOnlyFuturesFixture(conn, data);
  const { contracts, accounts, config } = ctx;
  const { futures, collateralVault } = contracts;
  const { seller, buyer, buyer2 } = accounts;

  const mp = await futures.read.getMarketPrice();
  const inc = config.priceLadderStep;
  const marginAmount = mp;
  await collateralVault.write.deposit([marginAmount], { account: seller.account });
  await collateralVault.write.deposit([marginAmount], { account: buyer.account });
  await collateralVault.write.deposit([marginAmount], { account: buyer2.account });

  // create positions
  const d = config.deliveryDates[0];
  const _dst = "//shev8.contract:anything@stratum.braiins.com:3333";

  await futures.write.createOrder([mp + inc, d, -1n, TimeInForce.GTC], { account: seller.account });
  await futures.write.createOrder([mp + 2n * inc, d, -1n, TimeInForce.GTC], {
    account: seller.account,
  });
  await futures.write.createOrder([mp + 3n * inc, d, -1n, TimeInForce.GTC], {
    account: seller.account,
  });

  await futures.write.createOrder([mp - inc, d, 1n, TimeInForce.GTC], { account: buyer.account });
  await futures.write.createOrder([mp - 2n * inc, d, 1n, TimeInForce.GTC], {
    account: buyer.account,
  });
  await futures.write.createOrder([mp - 3n * inc, d, 1n, TimeInForce.GTC], {
    account: buyer.account,
  });

  await futures.write.createOrder([mp, d, -1n, TimeInForce.GTC], { account: seller.account });
  await futures.write.createOrder([mp, d, 1n, TimeInForce.GTC], { account: buyer.account });

  // Physical-delivery escrow is disabled; futures cash-settle at maturity via
  // `settlePosition`, so no delivery payment is deposited for the seeded position.
  return ctx;
}
