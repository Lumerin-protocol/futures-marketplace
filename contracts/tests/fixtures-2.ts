import { viem } from "hardhat";
import { parseUnits, maxUint256, encodeFunctionData } from "viem";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

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

  // Deploy BTC Price Oracle Mock
  const btcPriceOracleMock = await viem.deployContract(
    "hashprice-oracle/contracts/contracts/BTCPriceOracleMock.sol:BTCPriceOracleMock",
    []
  );

  // Top up buyer with tokens

  await usdcMock.write.transfer([buyer.account.address, topUpBalanceUSDC]);
  await usdcMock.write.transfer([buyer2.account.address, topUpBalanceUSDC]);
  await usdcMock.write.transfer([seller.account.address, topUpBalanceUSDC]);
  await usdcMock.write.transfer([defaultBuyer.account.address, topUpBalanceUSDC]);
  await usdcMock.write.transfer([unregistered.account.address, topUpBalanceUSDC]);

  const oracle = (() => {
    const BITCOIN_DECIMALS = 8;
    const USDC_DECIMALS = 6;
    const DIFFICULTY_TO_HASHRATE_FACTOR = 2n ** 32n;

    const btcPrice = parseUnits("84524.2", USDC_DECIMALS);
    const blockReward = parseUnits("3.125", BITCOIN_DECIMALS);
    const difficulty = 121n * 10n ** 12n;
    const hashesForBTC = (difficulty * DIFFICULTY_TO_HASHRATE_FACTOR) / blockReward;
    return {
      btcPrice,
      blockReward,
      difficulty,
      decimals: USDC_DECIMALS,
      hashesForBTC,
    };
  })();

  await btcPriceOracleMock.write.setPrice([oracle.btcPrice, oracle.decimals]);

  // Deploy HashrateOracle
  const hashrateOracleImpl = await viem.deployContract(
    "hashprice-oracle/contracts/contracts/HashrateOracle.sol:HashrateOracle",
    [btcPriceOracleMock.address, await _usdcMock.read.decimals()]
  );
  const hashrateOracleProxy = await viem.deployContract("ERC1967Proxy", [
    hashrateOracleImpl.address,
    encodeFunctionData({
      abi: hashrateOracleImpl.abi,
      functionName: "initialize",
      args: [],
    }),
  ]);
  const hashrateOracle = await viem.getContractAt("HashrateOracle", hashrateOracleProxy.address);

  await hashrateOracle.write.setTTL([maxUint256, maxUint256]);
  await hashrateOracle.write.setUpdaterAddress([owner.account.address]);
  await hashrateOracle.write.setHashesForBTC([oracle.hashesForBTC]);

  return {
    config: {
      oracle,
    },
    contracts: {
      usdcMock,
      btcPriceOracleMock,
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
  const { usdcMock, btcPriceOracleMock, hashrateOracle, multicall3 } = contracts;
  const { oracle } = config;

  // Deploy Multicall3

  // Register buyer2 as seller (reseller)

  // Return all deployed contracts and accounts
  return {
    config: {
      oracle,
    },
    contracts: {
      usdcMock,
      btcPriceOracleMock,
      hashrateOracle,
      multicall3,
    },
    accounts,
  };
}

function getIERC20(addr: `0x${string}`) {
  return viem.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", addr);
}

function getIERC20Metadata(addr: `0x${string}`) {
  return viem.getContractAt(
    "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol:IERC20Metadata",
    addr
  );
}

type IERC20 = Awaited<ReturnType<typeof getIERC20>>;
type IERC20Metadata = Awaited<ReturnType<typeof getIERC20Metadata>>;
