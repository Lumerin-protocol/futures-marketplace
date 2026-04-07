import {
  erc20Abi,
  type Hex,
  hexToNumber,
  type PartialBy,
  slice,
  type WalletClient,
  zeroAddress,
} from "viem";
import { useReadContracts, useWalletClient } from "wagmi";

import { useState } from "react";
import { ierc20PermitAbi } from "../../../abi/ierc20Permit";
import { ierc5267Abi } from "../../../abi/ierc5267";

export function usePermit({ contractAddress, spenderAddress, ttl = 3n * 60n }: UsePermitProps) {
  const [signature, setSignature] = useState<PermitSignature | undefined>();
  const [error, setError] = useState<Error>();

  const { data: defaultWalletClient } = useWalletClient();
  const walletClientToUse = defaultWalletClient;
  const ownerToUse = walletClientToUse?.account.address ?? zeroAddress;
  const chainId = walletClientToUse?.chain.id;

  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      {
        address: contractAddress,
        abi: erc20Abi,
        functionName: "name",
      },
      {
        address: contractAddress,
        abi: [
          {
            inputs: [],
            name: "version",
            outputs: [{ internalType: "string", name: "", type: "string" }],
            stateMutability: "view",
            type: "function",
          },
        ],
        functionName: "version",
      },
      {
        address: contractAddress,
        abi: ierc20PermitAbi,
        functionName: "nonces",
        args: [ownerToUse],
      },
      {
        address: contractAddress,
        abi: ierc5267Abi,
        functionName: "eip712Domain",
      },
    ],
    query: {
      enabled: !!contractAddress && !!ownerToUse,
    },
  });

  return {
    signPermit: async (
      props: PartialBy<
        Eip2612Props,
        "ownerAddress" | "contractAddress" | "spenderAddress" | "deadline" | "value"
      > & {
        walletClient?: WalletClient;
      },
    ) => {
      if (!walletClientToUse || !chainId || !contractAddress || !spenderAddress) {
        return;
      }
      let domain:
        | {
            name: string;
            version: string;
            chainId: number;
            verifyingContract: `0x${string}`;
          }
        | undefined;
      let nonce: bigint | undefined;
      if (reads.data && chainId) {
        const [name, version, _nonce, eip712Domain] = reads.data;
        if (_nonce.status === "failure") {
          throw new Error(`Failed to get nonce: ${_nonce.error?.message}`);
        }
        nonce = _nonce.result;
        if (eip712Domain.status === "success") {
          const [, name, version, chainId, verifyingContract] = eip712Domain.result;
          domain = {
            name: name,
            version: version,
            chainId: Number(chainId),
            verifyingContract: verifyingContract,
          };
        } else {
          if (name.status === "failure")
            throw new Error(`Failed to get name: ${name.error?.message}`);
          domain = {
            name: name.result,
            version: version.result || "1",
            chainId: chainId,
            verifyingContract: contractAddress,
          };
        }
      }
      if (!domain || !nonce || !props.value) {
        return;
      }

      try {
        const nowBigInt = BigInt(Math.floor(Date.now() / 1000));
        const deadline = nowBigInt + ttl;
        const signature = await signPermit(props.walletClient ?? walletClientToUse, domain, {
          ownerAddress: walletClientToUse.account.address,
          contractAddress: contractAddress,
          spenderAddress: spenderAddress ?? zeroAddress,
          nonce,
          deadline,
          value: props.value,
        });
        setSignature(signature);
        return { signature, deadline };
      } catch (error) {
        setError(error as Error);
        throw error;
      }
    },
    signature,
    error,
  };
}

const types = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * Signs a permit for a given ERC-2612 ERC20 token using the specified parameters.
 */
export const signPermit = async (
  walletClient: WalletClient,
  domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` },
  {
    ownerAddress,
    spenderAddress,
    value,
    deadline,
    nonce,
  }: Omit<Eip2612Props, "chainId" | "erc20Name" | "permitVersion">,
): Promise<PermitSignature> => {
  const message = {
    owner: ownerAddress,
    spender: spenderAddress,
    value,
    nonce,
    deadline,
  };

  const signature = await walletClient.signTypedData({
    account: ownerAddress,
    message,
    domain,
    primaryType: "Permit",
    types,
  });
  const [r, s, v] = [slice(signature, 0, 32), slice(signature, 32, 64), slice(signature, 64, 65)];
  return { r, s, v: hexToNumber(v) };
};

export type PermitSignature = {
  r: Hex;
  s: Hex;
  v: number;
};

export type PermitDomain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
};

export type SignPermitProps = {
  /** Address of the token to approve */
  contractAddress: Hex;
  /** Owner of the tokens. Usually the currently connected address. */
  ownerAddress: Hex;
  /** Address to grant allowance to */
  spenderAddress: Hex;
  /** Expiration of this approval, in SECONDS */
  deadline: bigint;
  /** Permit nonce for the specific address and token contract. You can get the nonce from the `nonces` method on the token contract. */
  nonce: bigint;
};

export type Eip2612Props = SignPermitProps & {
  /** Amount to approve */
  value: bigint;
};

export type UsePermitProps = {
  contractAddress: `0x${string}`;
  spenderAddress: `0x${string}`;
  ttl?: bigint;
};
