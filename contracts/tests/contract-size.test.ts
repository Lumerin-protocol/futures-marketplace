import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { deployFuturesFixture } from "./fixtures.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/** EIP-170: a contract's runtime code may not exceed 24,576 bytes on mainnet-compatible chains. */
const EIP170_LIMIT = 24_576;

describe("HashPowerFutures - contract size", () => {
  it("keeps the implementation runtime within the EIP-170 limit", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const implementation = await viem.deployContract("HashPowerFutures", [data.contracts.collateralVault.address]);
    const pc = await viem.getPublicClient();
    const code = await pc.getCode({ address: implementation.address });
    assert.ok(code);
    const runtimeSize = (code.length - 2) / 2;
    console.log(`  HashPowerFutures runtime: ${runtimeSize.toLocaleString()} B`);
    assert.ok(runtimeSize <= EIP170_LIMIT, `runtime ${runtimeSize} B exceeds EIP-170`);
  });
});
