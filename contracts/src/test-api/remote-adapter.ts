/**
 * Remote connection adapter for using fixtures with a spawned Hardhat node.
 */
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  type Address,
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
      async deployContract(_contractName: string, _args: unknown[] = []): Promise<never> {
        throw new Error("deployContract not supported over RPC. Use local connection.");
      },

      async getContractAt(name: string, address: Address) {
        // Dynamically import ABI from generated files (`export const FooAbi = …`).
        const mod = (await import(`../../abi/${name}.ts`)) as Record<string, unknown>;
        const abi = mod[`${name}Abi`] ?? mod.abi;
        return getContract({
          abi: abi as never,
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
        return testClient;
      },
    },
    networkHelpers: {
      async loadFixture<T>(fn: (connection?: NetworkConnection) => Promise<T>): Promise<T> {
        return _loadFixture(fn, conn as unknown as NetworkConnection);
      },
    },
  };

  return conn as unknown as NetworkConnection;
}

export {
  deployTokenOraclesAndMulticall3,
  deployOnlyFuturesFixture,
  deployFuturesFixture,
  deployOnlyFuturesWithDummyData,
  type TokenOraclesFixture,
  type FuturesFixture,
} from "../../tests/fixtures.ts";
