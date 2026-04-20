import { viem } from "hardhat";
import { parseUnits } from "viem";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const HASHPRICE_DECIMALS = 8; // matches HashpriceUSD.decimals()

export async function deployTokenOraclesAndMulticall3() {
  // Get wallet clients
  const [owner, seller, buyer, validator, validator2, buyer2, defaultBuyer, unregistered] =
    await viem.getWalletClients();
  const pc = await viem.getPublicClient();
  const tc = await viem.getTestClient();
  const topUpBalanceUSDC = parseUnits("10000", 6);

  const multicall3 = await viem.deployContract("Multicall3", []);

  // Deploy USDC Mock (for payments)
  const _usdcMock = await viem.deployContract("contracts/USDCMock.sol:USDCMock", []);
  const usdcMock = await getIERC20Metadata(_usdcMock.address);

  // Top up buyer with tokens

  await usdcMock.write.transfer([buyer.account.address, topUpBalanceUSDC]);
  await usdcMock.write.transfer([buyer2.account.address, topUpBalanceUSDC]);
  await usdcMock.write.transfer([seller.account.address, topUpBalanceUSDC]);
  await usdcMock.write.transfer([defaultBuyer.account.address, topUpBalanceUSDC]);
  await usdcMock.write.transfer([unregistered.account.address, topUpBalanceUSDC]);

  // Compute a realistic initial hashprice in USD (8 decimals) from a representative
  // BTC price + difficulty + block reward, so test prices are recognisable.
  const oracle = (() => {
    const BITCOIN_DECIMALS = 8;
    const USDC_DECIMALS = 6;
    const DIFFICULTY_TO_HASHRATE_FACTOR = 2n ** 32n;
    // 100 TH/s per day = 100 * 10^12 hashes/sec * 86400 sec = 864 * 10^16 hashes/day
    const HASHES_PER_100_THS_PER_DAY_E16 = 864n;

    const btcPriceUsd8 = parseUnits("84524.2", HASHPRICE_DECIMALS); // BTC/USD with 8 decimals
    const btcPrice = parseUnits("84524.2", USDC_DECIMALS);
    const blockReward = parseUnits("3.125", BITCOIN_DECIMALS);
    const difficulty = 121n * 10n ** 12n;
    const hashesForBTC = (difficulty * DIFFICULTY_TO_HASHRATE_FACTOR) / blockReward;

    // Hashprice in BTC (8 decimals = satoshis) for 100 TH/s per day
    const hashpriceBtc8 = (HASHES_PER_100_THS_PER_DAY_E16 * 10n ** 16n) / hashesForBTC;
    // Hashprice in USD (8 decimals) = hashpriceBtc8 * btcPriceUsd8 / 1e8
    const hashpriceUsd8 = (hashpriceBtc8 * btcPriceUsd8) / 10n ** BigInt(HASHPRICE_DECIMALS);

    return {
      btcPrice,
      blockReward,
      difficulty,
      decimals: USDC_DECIMALS,
      hashesForBTC,
      hashpriceUsd: hashpriceUsd8,
      hashpriceDecimals: HASHPRICE_DECIMALS,
    };
  })();

  // Deploy a generic AggregatorV3Interface mock that stands in for the production
  // HashpriceUSD oracle. Tests can call `setPrice` directly to move the market price.
  // Field name kept as `hashrateOracle` for consistency with the on-chain getter.
  const hashrateOracle = await viem.deployContract("contracts/PriceFeedMock.sol:PriceFeedMock", [
    HASHPRICE_DECIMALS,
    "The price of 100 TH/s per day in USD",
  ]);
  await hashrateOracle.write.setPrice([oracle.hashpriceUsd]);

  return {
    config: {
      oracle,
    },
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

export async function deployLocalFixture() {
  const { contracts, accounts, config } = await loadFixture(deployTokenOraclesAndMulticall3);
  const { usdcMock, hashrateOracle, multicall3 } = contracts;
  const { oracle } = config;

  // Return all deployed contracts and accounts
  return {
    config: {
      oracle,
    },
    contracts: {
      usdcMock,
      hashrateOracle,
      multicall3,
    },
    accounts,
  };
}

function getIERC20Metadata(addr: `0x${string}`) {
  return viem.getContractAt(
    "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol:IERC20Metadata",
    addr,
  );
}
