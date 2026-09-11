import {
  verifyContract as hreVerify,
  type VerifyContractArgs,
} from "@nomicfoundation/hardhat-verify/verify";
import hre from "hardhat";
import { getAddress, isAddress } from "viem";

/// Providers we attempt by default. Independent indexers — verifying on more
/// than one is fine, and a failure on one (e.g. Etherscan being picky about
/// constructor encoding for proxies) shouldn't mask a success on another.
const DEFAULT_PROVIDERS = ["etherscan", "blockscout", "sourcify"] as const;
type Provider = NonNullable<VerifyContractArgs["provider"]>;

export type VerifyOpts = {
  /** Fully qualified name, e.g. `contracts/HashPowerFutures.sol:HashPowerFutures`. */
  contract?: string;
  force?: boolean;
};

/// Verify on each provider in turn. Never throws — failures are logged so the
/// deploy script can keep going.
export async function verifyContract(
  address: string,
  constructorArgs?: readonly unknown[],
  providers: readonly Provider[] = DEFAULT_PROVIDERS,
  opts: VerifyOpts = {},
) {
  // hardhat-verify defaults to the built-in `production` profile (runs=200, no
  // viaIR). Deploy/compile use `default` (viaIR + our optimizer settings).
  // Force `default` so the compiler input matches on-chain bytecode.
  if (hre.globalOptions.buildProfile === undefined) {
    hre.globalOptions.buildProfile = "default";
  }

  const normalizedArgs = (constructorArgs ?? []).map((arg) =>
    typeof arg === "string" && isAddress(arg) ? getAddress(arg) : arg,
  );

  const args: Omit<VerifyContractArgs, "provider"> = {
    address: getAddress(address),
    constructorArgs: normalizedArgs as unknown[],
    contract: opts.contract,
    force: opts.force,
  };

  for (const provider of providers) {
    console.log(`\nVerifying ${args.address} on ${provider}...`);
    try {
      await hreVerify({ ...args, provider }, hre);
      console.log(`  ${provider}: verified.`);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (msg.includes("Already Verified") || msg.includes("already been verified")) {
        console.log(`  ${provider}: already verified.`);
      } else {
        console.warn(`  ${provider}: verification failed — ${msg}`);
      }
    }
  }
}
