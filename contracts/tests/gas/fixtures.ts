import type { NetworkConnection } from "hardhat/types/network";
import {
  deployOnlyFuturesFixture,
  deployTokenOraclesAndMulticall3,
} from "../fixtures.ts";

const GAS_BENCHMARK_TIMESTAMP = 1_800_000_000n;

export async function deployFuturesGasFixture(conn: NetworkConnection) {
  const { viem } = conn;
  const tc = await viem.getTestClient();
  await tc.setNextBlockTimestamp({ timestamp: GAS_BENCHMARK_TIMESTAMP });
  await tc.mine({ blocks: 1 });

  const dependencies = await deployTokenOraclesAndMulticall3(conn);
  return await deployOnlyFuturesFixture(conn, dependencies);
}
