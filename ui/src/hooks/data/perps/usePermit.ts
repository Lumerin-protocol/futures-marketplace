import { type Hex, hexToNumber, type PartialBy, slice, type WalletClient, zeroAddress } from "viem";
import { useReadContracts, useWalletClient } from "wagmi";

import { useState } from "react";

export function usePermit({ contractAddress, spenderAddress, ttl = 3n * 60n }: UsePermitProps) {
  const [signature, setSignature] = useState<PermitSignature | undefined>();
  const [error, setError] = useState<Error>();

  const { data: defaultWalletClient } = useWalletClient();
  const walletClientToUse = defaultWalletClient;
  const ownerToUse = walletClientToUse?.account.address ?? zeroAddress;
  const chainId = walletClientToUse?.chain.id;

  const reads = useReadContracts({
    allowFailure: false,
    contracts: [
      // {
      //   address: contractAddress,
      //   abi: PermitABI,
      //   functionName: "version",
      // },
      {
        address: contractAddress,
        abi: PermitABI,
        functionName: "name",
      },
      {
        address: contractAddress,
        abi: PermitABI,
        functionName: "nonces",
        args: [ownerToUse],
      },
    ],
    query: {
      enabled: !!contractAddress && !!ownerToUse,
    },
  });

  const [/*versionFromContract,*/ name, nonce] = reads.data ?? [];

  // const validatedVersionFromContract = [1, 2, "1", "2"].includes(versionFromContract ?? "")
  //   ? versionFromContract
  //   : null;

  const version = /*validatedVersionFromContract ??*/ "1";

  const ready =
    walletClientToUse !== null &&
    walletClientToUse !== undefined &&
    spenderAddress !== undefined &&
    chainId !== undefined &&
    contractAddress !== undefined &&
    name !== undefined &&
    nonce !== undefined;

  return {
    signPermit: ready
      ? async (
          props: PartialBy<
            Eip2612Props,
            | "chainId"
            | "ownerAddress"
            | "contractAddress"
            | "spenderAddress"
            | "nonce"
            | "erc20Name"
            | "permitVersion"
            | "deadline"
          > & {
            walletClient?: WalletClient;
          },
        ) => {
          try {
            const nowBigInt = BigInt(Math.floor(Date.now() / 1000));
            const deadline = nowBigInt + ttl;
            const signature = await signPermit(props.walletClient ?? walletClientToUse, {
              chainId,
              ownerAddress: walletClientToUse.account.address,
              contractAddress: contractAddress,
              spenderAddress: spenderAddress ?? zeroAddress,
              erc20Name: name,
              nonce,
              permitVersion: version,
              deadline,
              ...props,
            });
            setSignature(signature);
            return { signature, deadline };
          } catch (error) {
            setError(error as Error);
            throw error;
          }
        }
      : undefined,
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
  {
    contractAddress,
    erc20Name,
    ownerAddress,
    spenderAddress,
    value,
    deadline,
    nonce,
    chainId,
    permitVersion,
  }: Eip2612Props,
): Promise<PermitSignature> => {
  const domainData = {
    name: erc20Name,
    /** We assume 1 if permit version is not specified */
    version: permitVersion ?? "1",
    chainId: chainId,
    verifyingContract: contractAddress,
  };

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
    domain: domainData,
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

export type SignPermitProps = {
  /** Address of the token to approve */
  contractAddress: Hex;
  /** Name of the token to approve.
   * Corresponds to the `name` method on the ERC-20 contract. Please note this must match exactly byte-for-byte */
  erc20Name: string;
  /** Owner of the tokens. Usually the currently connected address. */
  ownerAddress: Hex;
  /** Address to grant allowance to */
  spenderAddress: Hex;
  /** Expiration of this approval, in SECONDS */
  deadline: bigint;
  /** Numerical chainId of the token contract */
  chainId: number;
  /** Defaults to 1. Some tokens need a different version, check the [PERMIT INFORMATION](https://github.com/vacekj/wagmi-permit/blob/main/PERMIT.md) for more information */
  permitVersion?: string;
  /** Permit nonce for the specific address and token contract. You can get the nonce from the `nonces` method on the token contract. */
  nonce: bigint;
};

export type Eip2612Props = SignPermitProps & {
  /** Amount to approve */
  value: bigint;
};

const PermitABI = [
  {
    inputs: [],
    stateMutability: "view",
    type: "function",
    name: "name",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
    name: "nonces",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
  },
  {
    inputs: [],
    name: "version",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type UsePermitProps = {
  contractAddress: `0x${string}`;
  spenderAddress: `0x${string}`;
  ttl?: bigint;
};
