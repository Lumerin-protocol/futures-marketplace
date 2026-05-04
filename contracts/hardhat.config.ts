import { configVariable, defineConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import codegenPlugin from "./plugins/codegen/index.ts";
import { tryLoadEnvFile } from "./lib/env.ts";

tryLoadEnvFile("./../.env");
tryLoadEnvFile(".env");

export default defineConfig({
  plugins: [hardhatToolboxViem, codegenPlugin],
  codegen: {
    contracts: [
      "Futures",
      "USDCMock",
      "Multicall3",
      "HashrateOracle",
      "BTCPriceOracleMock",
      "ICollateralVault",
      "IPortfolioMarginEngine",
      "CollateralVault",
      "ERC20",
    ],
  },
  paths: {
    tests: "tests",
  },
  solidity: {
    npmFilesToBuild: [
      "@openzeppelin/contracts/token/ERC20/IERC20.sol",
      "multicall3/src/Multicall3.sol",
      "@openzeppelin/contracts/token/ERC20/ERC20.sol",
      "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol",
      "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol",
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol",
      "collateral-margin/contracts/contracts/CollateralVault.sol",
      "collateral-margin/contracts/contracts/PortfolioMarginEngine.sol",
      "collateral-margin/contracts/contracts/interfaces/ICollateralVault.sol",
      "collateral-margin/contracts/contracts/interfaces/IPortfolioMarginEngine.sol",
      "collateral-margin/contracts/contracts/mocks/PerpsDEXMock.sol",
      "collateral-margin/contracts/contracts/mocks/OptionsEngineMock.sol",
      "hashprice-oracle/contracts/contracts/HashrateOracle.sol",
    ],
    compilers: [
      {
        version: "0.8.30",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        // multicall3 has a strict `pragma solidity 0.8.12;`
        version: "0.8.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 10_000_000,
          },
        },
      },
    ],
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
      enabled: true,
    },
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      mining: {
        auto: true,
      },
    },
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
    },
    "base-sepolia": {
      type: "http",
      chainType: "l1",
      chainId: 84532,
      url: configVariable("ALCHEMY_API_KEY", "https://base-sepolia.g.alchemy.com/v2/{variable}"),
      accounts: [configVariable("PRIVATE_KEY")],
    },
    "base-mainnet": {
      type: "http",
      chainType: "l1",
      chainId: 8453,
      url: configVariable("ALCHEMY_API_KEY", "https://base-mainnet.g.alchemy.com/v2/{variable}"),
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
});
