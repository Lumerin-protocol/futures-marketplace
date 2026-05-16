/**
 * Remote connection adapter for using fixtures with a spawned Hardhat node.
 */
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  getContract,
} from "viem";
import { hardhat } from "viem/chains";
import type { NetworkConnection } from "hardhat/types/network";
import { loadFixture as _loadFixture } from "./load-fixture.ts";

/**
 * Create a NetworkConnection wrapper that works over RPC to a remote Hardhat node.
 */
export function createRemoteConnection(rpcUrl: string): NetworkConnection {
  const publicClient = createPublicClient({
    chain: hardhat,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: hardhat,
    transport: http(rpcUrl),
  });

  const testClient = createTestClient({
    chain: hardhat,
    transport: http(rpcUrl),
    mode: "hardhat",
  });

  const conn = {
    viem: {
      async deployContract(contractName: string, args: unknown[] = []): Promise<never> {
        await walletClient.deployContract({
          abi,
          bytecode,
          args,
        });

        throw new Error("deployContract not supported over RPC. Use local connection.");
      },

      async getContractAt(name: string, address: Address) {
        // Dynamically import ABI from generated files
        const { abi } = await import(`../../abi/${name}.ts`);
        return getContract({
          abi,
          address,
          client: { public: publicClient, wallet: walletClient },
        });
      },

      async getWalletClients() {
        return await walletClient.getAddresses();
      },

      async getPublicClient() {
        return publicClient;
      },

      async getTestClient() {
        testClient;
      },
    },
  };

  conn.networkHelpers = {
    async loadFixture<T>(fn: () => Promise<T>): Promise<T> {
      return _loadFixture(fn, conn);
    },
  };

  return conn;
}

export {
  deployTokenOraclesAndMulticall3,
  deployOnlyFuturesFixture,
  deployFuturesFixture,
  deployOnlyFuturesWithDummyData,
  type TokenOraclesFixture,
  type FuturesFixture,
} from "../../tests/fixtures.ts";
