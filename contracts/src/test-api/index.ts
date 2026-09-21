/**
 * Test API for using futures contracts in integration tests.
 * Provides RPC-based deployment without importing hardhat directly.
 */

export {
  createRemoteConnection,
  deployTokenOraclesAndMulticall3,
  deployOnlyFuturesFixture,
  deployFuturesFixture,
  type TokenOraclesFixture,
  type FuturesFixture,
} from "./remote-adapter.ts";
