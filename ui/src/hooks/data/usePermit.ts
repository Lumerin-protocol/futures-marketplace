import { useCallback } from "react";
import { erc20Abi, hexToNumber, slice, type Hex } from "viem";
import { useReadContracts, useWalletClient } from "wagmi";
import { ierc20PermitAbi } from "../../abi/ierc20Permit";
import { ierc5267Abi } from "../../abi/ierc5267";

export type PermitSignature = {
  r: Hex;
  s: Hex;
  v: number;
};

const tokenVersionAbi = [
  {
    type: "function",
    inputs: [],
    name: "version",
    outputs: [{ name: "", internalType: "string", type: "string" }],
    stateMutability: "view",
  },
] as const;

const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

interface UsePermitProps {
  /** ERC20 token to sign a permit for. */
  tokenAddress?: `0x${string}`;
  /** Address the permit grants an allowance to (e.g. the CollateralVault). */
  spenderAddress?: `0x${string}`;
  /** How long the signed permit stays valid for, in seconds. */
  ttlSeconds?: bigint;
}

/**
 * EIP-2612 permit signing for `tokenAddress`, scoped to a single `spenderAddress`.
 *
 * Domain is discovered via EIP-5267 `eip712Domain()` when the token implements
 * it, else falls back to `name()` + `version()` (defaulting version to "1"),
 * matching the detection used by the market-maker's `vaultDeposit.ts`.
 *
 * `isSupported` is `undefined` while the detection reads are in flight, `true`/
 * `false` once resolved — `false` means the token doesn't implement EIP-2612
 * (its `nonces()` call reverted), so callers should fall back to approve+deposit.
 */
export function usePermit({ tokenAddress, spenderAddress, ttlSeconds = 5n * 60n }: UsePermitProps) {
  const { data: walletClient } = useWalletClient();
  const owner = walletClient?.account.address;

  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: tokenAddress, abi: erc20Abi, functionName: "name" },
      { address: tokenAddress, abi: tokenVersionAbi, functionName: "version" },
      { address: tokenAddress, abi: ierc20PermitAbi, functionName: "nonces", args: owner ? [owner] : undefined },
      { address: tokenAddress, abi: ierc5267Abi, functionName: "eip712Domain" },
    ],
    query: {
      enabled: !!tokenAddress && !!owner,
    },
  });

  const [nameResult, versionResult, nonceResult, domainResult] = reads.data ?? [];
  const isSupported = reads.isSuccess ? nonceResult?.status === "success" : undefined;

  const signPermit = useCallback(
    async (value: bigint) => {
      if (!walletClient || !owner || !tokenAddress || !spenderAddress) return undefined;
      if (!nonceResult || nonceResult.status === "failure") {
        throw new Error("Token does not support EIP-2612 permit");
      }

      let domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
      if (domainResult?.status === "success") {
        const [, name, version, chainId, verifyingContract] = domainResult.result;
        domain = { name, version, chainId: Number(chainId), verifyingContract };
      } else {
        if (!nameResult || nameResult.status === "failure") {
          throw new Error("Unable to resolve permit domain");
        }
        domain = {
          name: nameResult.result,
          version: versionResult?.status === "success" ? versionResult.result || "1" : "1",
          chainId: walletClient.chain.id,
          verifyingContract: tokenAddress,
        };
      }

      const nonce = nonceResult.result;
      const deadline = BigInt(Math.floor(Date.now() / 1000)) + ttlSeconds;

      const signature = await walletClient.signTypedData({
        account: owner,
        domain,
        types: permitTypes,
        primaryType: "Permit",
        message: { owner, spender: spenderAddress, value, nonce, deadline },
      });

      const permitSignature: PermitSignature = {
        r: slice(signature, 0, 32),
        s: slice(signature, 32, 64),
        v: hexToNumber(slice(signature, 64, 65)),
      };

      return { signature: permitSignature, deadline };
    },
    [walletClient, owner, tokenAddress, spenderAddress, nonceResult, domainResult, nameResult, versionResult, ttlSeconds],
  );

  return { signPermit, isSupported };
}
