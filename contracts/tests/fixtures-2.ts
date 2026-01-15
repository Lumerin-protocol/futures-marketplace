import { viem } from "hardhat";
import {
  parseUnits,
  parseEventLogs,
  maxUint256,
  maxUint32,
  encodeFunctionData,
  zeroAddress,
  formatUnits,
} from "viem";
import { hoursToSeconds } from "../../lib/utils";
import { THPStoHPS } from "../../lib/utils";
import { compressPublicKey, getPublicKey } from "../../lib/pubkey";
import type { WalletClient } from "@nomicfoundation/hardhat-viem/types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

type ContractConfigWithCount = {
  config: {
    speedTHPS: number;
    lengthHours: number;
    profitTargetPercent: number;
  };
  count: number;
};

export const sampleContracts: ContractConfigWithCount[] = [
  { config: { speedTHPS: 100, lengthHours: 1, profitTargetPercent: 5 }, count: 2 },
  { config: { speedTHPS: 300, lengthHours: 0.5, profitTargetPercent: 10 }, count: 2 },
  { config: { speedTHPS: 800, lengthHours: 0.1, profitTargetPercent: 20 }, count: 3 },
  { config: { speedTHPS: 100, lengthHours: 2, profitTargetPercent: 15 }, count: 2 },
  { config: { speedTHPS: 100, lengthHours: 24, profitTargetPercent: 0 }, count: 1 },
];

export async function deployTokenOraclesAndMulticall3() {
  // Get wallet clients
  const [owner, seller, buyer, validator, validator2, buyer2, defaultBuyer, unregistered] =
    await viem.getWalletClients();
  const pc = await viem.getPublicClient();
  const tc = await viem.getTestClient();
  const topUpBalance = parseUnits("1000", 8);
  const topUpBalanceUSDC = parseUnits("10000", 6);

  const multicall3 = await viem.deployContract("Multicall3", []);

  // Deploy Lumerin Token (for fees)
  const _lumerinToken = await viem.deployContract("contracts/token/LumerinToken.sol:Lumerin", []);
  const lumerinToken = await getIERC20Metadata(_lumerinToken.address);

  // Deploy USDC Mock (for payments)
  const _usdcMock = await viem.deployContract("contracts/mocks/USDCMock.sol:USDCMock", []);
  const usdcMock = await getIERC20Metadata(_usdcMock.address);

  // Deploy BTC Price Oracle Mock
  const btcPriceOracleMock = await viem.deployContract(
    "contracts/mocks/BTCPriceOracleMock.sol:BTCPriceOracleMock",
    []
  );

  // Top up buyer with tokens

  await usdcMock.write.transfer([buyer.account.address, topUpBalanceUSDC]);
  await lumerinToken.write.transfer([buyer.account.address, topUpBalance]);
  await usdcMock.write.transfer([buyer2.account.address, topUpBalanceUSDC]);
  await lumerinToken.write.transfer([buyer2.account.address, topUpBalance]);
  await usdcMock.write.transfer([seller.account.address, topUpBalanceUSDC]);
  await lumerinToken.write.transfer([seller.account.address, topUpBalance]);
  await usdcMock.write.transfer([defaultBuyer.account.address, topUpBalanceUSDC]);
  await lumerinToken.write.transfer([defaultBuyer.account.address, topUpBalance]);
  await usdcMock.write.transfer([unregistered.account.address, topUpBalanceUSDC]);
  await lumerinToken.write.transfer([unregistered.account.address, topUpBalance]);

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
    "contracts/marketplace/HashrateOracle.sol:HashrateOracle",
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
      lumerinToken,
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
  const { lumerinToken, usdcMock, btcPriceOracleMock, hashrateOracle, multicall3 } = contracts;
  const { oracle } = config;
  const { owner, seller, buyer, buyer2, defaultBuyer, validator, validator2, pc, tc } = accounts;

  const btcPrice = await btcPriceOracleMock.read.latestRoundData();
  // console.log("BTC price:", btcPrice);

  const hfb = await hashrateOracle.read.getHashesForBTC();
  // console.log("Hashes for 1 unit of btc:", hfb);

  const rewardPerTHinToken = await hashrateOracle.read.getHashesforToken();
  // console.log("Hashes for 1 unit of token:", rewardPerTHinToken);

  // Deploy Faucet
  const faucet = await viem.deployContract("contracts/faucet/Faucet.sol:Faucet", [
    lumerinToken.address,
    parseUnits("800", 8), // FAUCET_DAILY_MAX_LMR
    parseUnits("2", 8), // FAUCET_LMR_PAYOUT
    parseUnits("0.01", 18), // FAUCET_ETH_PAYOUT
  ]);

  // Deploy Multicall3

  // Deploy Implementation and Beacon
  const mockImplementation = await viem.deployContract(
    "contracts/marketplace/Implementation.sol:Implementation",
    [zeroAddress, zeroAddress, zeroAddress, zeroAddress]
  );

  const beacon = await viem.deployContract(
    "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol:UpgradeableBeacon",
    [mockImplementation.address, owner.account.address]
  );

  // Deploy CloneFactory
  const cloneFactoryConfig = {
    validatorFeeRateScaled:
      parseUnits("0.01", 18) *
      10n ** BigInt((await lumerinToken.read.decimals()) - (await usdcMock.read.decimals())),
    contractAddresses: [] as `0x${string}`[],
    minSellerStake: parseUnits("100", 8),
    minContractDuration: 0,
    maxContractDuration: Number(maxUint32),
    defaultBuyerProfitTarget: -5,
  };
  const cloneFactoryImpl = await viem.deployContract(
    "contracts/marketplace/CloneFactory.sol:CloneFactory",
    []
  );
  const cloneFactoryProxy = await viem.deployContract("ERC1967Proxy", [
    cloneFactoryImpl.address,
    encodeFunctionData({
      abi: cloneFactoryImpl.abi,
      functionName: "initialize",
      args: [
        beacon.address, // baseImplementation (beacon)
        hashrateOracle.address, // hashrateOracle
        usdcMock.address, // paymentToken (USDC)
        lumerinToken.address, // feeToken (LMR)
        cloneFactoryConfig.validatorFeeRateScaled,
        cloneFactoryConfig.minSellerStake,
        cloneFactoryConfig.minContractDuration,
        cloneFactoryConfig.maxContractDuration,
      ],
    }),
  ]);

  const cloneFactory = await viem.getContractAt("CloneFactory", cloneFactoryProxy.address);

  // await cloneFactory.write.setDefaultBuyer(
  //   [
  //     defaultBuyer.account.address,
  //     cloneFactoryConfig.defaultBuyerProfitTarget,
  //     "default.buyer.com:1234",
  //     "default.buyer.com:1234",
  //   ],
  //   { account: owner.account }
  // );

  const implementation = await viem.deployContract(
    "contracts/marketplace/Implementation.sol:Implementation",
    [cloneFactory.address, hashrateOracle.address, usdcMock.address, lumerinToken.address]
  );

  await beacon.write.upgradeTo([implementation.address], {
    account: owner.account,
  });

  // Deploy ValidatorRegistry
  const validatorRegistryConfig = {
    validatorStakeMinimum: parseUnits("0.1", 8),
    validatorStakeRegister: parseUnits("1", 8),
    validatorPunishAmount: parseUnits("0.1", 8),
    validatorPunishThreshold: 3,
  };
  const validatorRegistryImpl = await viem.deployContract(
    "contracts/validator-registry/ValidatorRegistry.sol:ValidatorRegistry",
    []
  );

  const validatorRegistryProxy = await viem.deployContract("ERC1967Proxy", [
    validatorRegistryImpl.address,
    encodeFunctionData({
      abi: validatorRegistryImpl.abi,
      functionName: "initialize",
      args: [
        lumerinToken.address,
        validatorRegistryConfig.validatorStakeMinimum,
        validatorRegistryConfig.validatorStakeRegister,
        validatorRegistryConfig.validatorPunishAmount,
        validatorRegistryConfig.validatorPunishThreshold,
      ],
    }),
  ]);

  const validatorRegistry = await viem.getContractAt(
    "ValidatorRegistry",
    validatorRegistryProxy.address
  );

  // add validators to ValidatorRegistry
  const exp = {
    host: "localhost:3000",
    stake: parseUnits("1", 8),
  };

  // Register validator 1
  await lumerinToken.write.transfer([validator.account.address, exp.stake]);
  await lumerinToken.write.approve([validatorRegistry.address, exp.stake], {
    account: validator.account,
  });
  const pubKey = compressPublicKey(await getPublicKey(validator));
  const hash = await validatorRegistry.write.validatorRegister(
    [exp.stake, pubKey.yParity, pubKey.x, exp.host],
    { account: validator.account }
  );
  await pc.waitForTransactionReceipt({ hash });

  // Register validator 2
  await lumerinToken.write.transfer([validator2.account.address, exp.stake]);
  await lumerinToken.write.approve([validatorRegistry.address, exp.stake], {
    account: validator2.account,
  });
  const pubKey2 = compressPublicKey(await getPublicKey(validator2));
  const hash2 = await validatorRegistry.write.validatorRegister(
    [exp.stake, pubKey2.yParity, pubKey2.x, exp.host],
    { account: validator2.account }
  );
  await pc.waitForTransactionReceipt({ hash: hash2 });

  // Register seller
  await lumerinToken.write.approve([cloneFactory.address, maxUint256], {
    account: seller.account,
  });
  await usdcMock.write.approve([cloneFactory.address, maxUint256], {
    account: seller.account,
  });
  await cloneFactory.write.sellerRegister([cloneFactoryConfig.minSellerStake], {
    account: seller.account,
  });

  console.log("seller registered================");

  // Register buyer as seller (reseller)
  await lumerinToken.write.approve([cloneFactory.address, maxUint256], {
    account: buyer.account,
  });
  await usdcMock.write.approve([cloneFactory.address, maxUint256], {
    account: buyer.account,
  });

  console.log(
    "==========\nbuyer approved\n buyer: ",
    buyer.account.address,
    "\ncloneFactory: ",
    cloneFactory.address
  );
  await cloneFactory.write.sellerRegister([cloneFactoryConfig.minSellerStake], {
    account: buyer.account,
  });

  // Register buyer2 as seller (reseller)
  await lumerinToken.write.approve([cloneFactory.address, maxUint256], {
    account: buyer2.account,
  });
  await usdcMock.write.approve([cloneFactory.address, maxUint256], {
    account: buyer2.account,
  });
  await cloneFactory.write.sellerRegister([cloneFactoryConfig.minSellerStake], {
    account: buyer2.account,
  });

  // Approve default buyer
  await lumerinToken.write.approve([cloneFactory.address, maxUint256], {
    account: defaultBuyer.account,
  });
  await usdcMock.write.approve([cloneFactory.address, maxUint256], {
    account: defaultBuyer.account,
  });

  const hashrateContracts: Awaited<ReturnType<typeof getImplementation>>[] = [];

  // Create contracts
  // for (const contract of sampleContracts) {
  //   for (let i = 0; i < contract.count; i++) {
  //     const hash = await cloneFactory.write.setCreateNewRentalContractV2(
  //       [
  //         BigInt(THPStoHPS(contract.config.speedTHPS)),
  //         BigInt(hoursToSeconds(contract.config.lengthHours)),
  //         Number(contract.config.profitTargetPercent),
  //         await getPublicKey(seller),
  //       ],
  //       {
  //         account: seller.account,
  //       }
  //     );

  //     const receipt = await pc.waitForTransactionReceipt({ hash });
  //     const [event] = parseEventLogs({
  //       logs: receipt.logs,
  //       abi: cloneFactory.abi,
  //       eventName: "contractCreated",
  //     });
  //     const address = event.args._address;

  //     const hrContract = await viem.getContractAt("Implementation", address);

  //     cloneFactoryConfig.contractAddresses.push(address);
  //     hashrateContracts.push(hrContract);
  //   }
  // }

  // await buyContract(
  //   cloneFactoryConfig.contractAddresses[0],
  //   lumerinToken,
  //   cloneFactory,
  //   buyer,
  //   usdcMock,
  //   validator
  // );
  // await buyContract(
  //   cloneFactoryConfig.contractAddresses[1],
  //   lumerinToken,
  //   cloneFactory,
  //   buyer,
  //   usdcMock,
  //   validator
  // );

  // await time.increaseTo(
  //   Math.round(new Date().getTime() / 1000) - (sampleContracts[0].config.lengthHours * 3600) / 2
  // );

  // await tc.increaseTime({ seconds: sampleContracts[0].config.lengthHours * 3600 + 1 });

  // await buyContract(
  //   cloneFactoryConfig.contractAddresses[0],
  //   lumerinToken,
  //   cloneFactory,
  //   buyer,
  //   usdcMock,
  //   validator
  // );

  // await buyContract(
  //   cloneFactoryConfig.contractAddresses[1],
  //   lumerinToken,
  //   cloneFactory,
  //   buyer,
  //   usdcMock,
  //   validator
  // );

  // // await time.increaseTo(Math.round(new Date().getTime() / 1000));

  await tc.increaseTime({ seconds: (sampleContracts[0].config.lengthHours * 3600) / 2 });

  // const c1 = await viem.getContractAt("Implementation", cloneFactoryConfig.contractAddresses[0]);
  // await c1.write.closeEarly([0], {
  //   account: buyer.account,
  // });
  // await pc.waitForTransactionReceipt({ hash });

  // Return all deployed contracts and accounts
  return {
    config: {
      cloneFactory: cloneFactoryConfig,
      validatorRegistry: validatorRegistryConfig,
      oracle,
    },
    contracts: {
      lumerinToken,
      usdcMock,
      btcPriceOracleMock,
      hashrateOracle,
      faucet,
      cloneFactory,
      implementation,
      validatorRegistry,
      multicall3,
      hashrate: hashrateContracts,
    },
    accounts,
  };
}

async function buyContract(
  contractAddress: string,
  lumerinToken: IERC20Metadata,
  cloneFactory: ICloneFactory,
  buyer: WalletClient,
  usdcMock: IERC20Metadata,
  validator: WalletClient
) {
  console.log("buying contract", contractAddress);
  const c1 = await viem.getContractAt("Implementation", contractAddress as `0x${string}`);

  const purchaseTx = await cloneFactory.write.setPurchaseRentalContractV2(
    [c1.address, validator.account.address, "", "", 0, true, false, 10n],
    { account: buyer.account }
  );
}

function getCloneFactory(addr: `0x${string}`) {
  return viem.getContractAt("CloneFactory", addr);
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

function getImplementation(addr: `0x${string}`) {
  return viem.getContractAt("Implementation", addr);
}

type ICloneFactory = Awaited<ReturnType<typeof getCloneFactory>>;
type IERC20 = Awaited<ReturnType<typeof getIERC20>>;
type IERC20Metadata = Awaited<ReturnType<typeof getIERC20Metadata>>;
