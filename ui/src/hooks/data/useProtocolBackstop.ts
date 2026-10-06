import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { withErrors } from "../../lib/withErrors";
import { useFuturesCollateralVault } from "./useFuturesCollateralVault";
import type { ContractMode } from "../../types/types";

/// Keyless protocol ledger that inherits liquidated positions
/// (`CollateralVault.BACKSTOP_ADDR`). Positions parked here are reduced by
/// permissionless `unwindBackstop` calls.
export const BACKSTOP_ADDR = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" as const;

export const isBackstopAddress = (address: string | undefined | null): boolean =>
  !!address && address.toLowerCase() === BACKSTOP_ADDR.toLowerCase();

// The pinned collateral-margin / derivatives ABIs predate the backstop, so the
// getters are declared locally until the packages are re-pinned.
const VAULT_BACKSTOP_ABI = [
  {
    type: "function",
    name: "backstopParams",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "unwindBandBps", type: "uint16" },
      { name: "unwindFeeBps", type: "uint16" },
    ],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const PERPS_POSITION_ABI = [
  {
    type: "function",
    name: "getUserPosition",
    stateMutability: "view",
    inputs: [{ name: "_user", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "netQuantity", type: "int256" },
          { name: "netEntryValue", type: "int256" },
        ],
      },
    ],
  },
] as const;

type ReadResult = { status: "success"; result: unknown } | { status: "failure" };

export type BackstopLeg = {
  /// Futures delivery date (unix seconds); `undefined` for the perps leg.
  expirationAt?: bigint;
  /// Signed net quantity the backstop is carrying (user-sign convention).
  netQuantity: bigint;
  /// Signed entry notional of that quantity, payment-token units.
  netEntryValue: bigint;
};

export type ProtocolBackstop = {
  /// Open legs on the selected venue. Empty when the backstop is flat.
  legs: BackstopLeg[];
  /// Receipt-token balance of the backstop ledger (it is left unfunded, so usually 0).
  balance: bigint | undefined;
  unwindBandBps: number | undefined;
  unwindFeeBps: number | undefined;
};

/// Reads the protocol backstop's open exposure on one venue plus the shared
/// vault unwind parameters. Futures needs two waves (expiry list, then one
/// position per active expiry); wagmi multicalls each wave.
export function useProtocolBackstop(contractMode: ContractMode = "futures") {
  const futuresAddress = process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}` | undefined;
  const perpsAddress = process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}` | undefined;
  const isPerps = contractMode === "perpetual";
  const vaultQuery = useFuturesCollateralVault();
  const vaultAddress = vaultQuery.data as `0x${string}` | undefined;

  const vaultReads = useReadContracts({
    contracts: [
      { address: vaultAddress, abi: VAULT_BACKSTOP_ABI, functionName: "backstopParams" },
      { address: vaultAddress, abi: VAULT_BACKSTOP_ABI, functionName: "balanceOf", args: [BACKSTOP_ADDR] },
    ],
    query: { enabled: !!vaultAddress, refetchInterval: 15000 },
  });

  const expiriesQuery = useReadContracts({
    contracts: [
      {
        address: futuresAddress,
        abi: withErrors(HashPowerFuturesAbi),
        functionName: "getActiveExpirationDates",
        args: [BACKSTOP_ADDR],
      },
    ],
    query: { enabled: !isPerps && !!futuresAddress, refetchInterval: 15000 },
  });

  const expirationAts = useMemo(() => {
    const result = (expiriesQuery.data as ReadResult[] | undefined)?.[0];
    if (result?.status !== "success") return undefined;
    return result.result as readonly bigint[];
  }, [expiriesQuery.data]);

  const futuresLegsQuery = useReadContracts({
    contracts: (expirationAts ?? []).map((expirationAt) => ({
      address: futuresAddress,
      abi: withErrors(HashPowerFuturesAbi),
      functionName: "getUserPosition" as const,
      args: [BACKSTOP_ADDR, expirationAt] as const,
    })),
    query: { enabled: !isPerps && !!futuresAddress && (expirationAts?.length ?? 0) > 0, refetchInterval: 15000 },
  });

  const perpsQuery = useReadContracts({
    contracts: [
      { address: perpsAddress, abi: PERPS_POSITION_ABI, functionName: "getUserPosition", args: [BACKSTOP_ADDR] },
    ],
    query: { enabled: isPerps && !!perpsAddress, refetchInterval: 15000 },
  });

  const data = useMemo((): ProtocolBackstop | undefined => {
    const vaultRows = vaultReads.data as ReadResult[] | undefined;
    const params = vaultRows?.[0]?.status === "success" ? (vaultRows[0].result as readonly [number, number]) : undefined;
    const balance = vaultRows?.[1]?.status === "success" ? (vaultRows[1].result as bigint) : undefined;

    let legs: BackstopLeg[] | undefined;
    if (isPerps) {
      const row = (perpsQuery.data as ReadResult[] | undefined)?.[0];
      if (row?.status !== "success") return undefined;
      const pos = row.result as { netQuantity: bigint; netEntryValue: bigint };
      legs = pos.netQuantity === 0n ? [] : [pos];
    } else {
      if (expirationAts === undefined) return undefined;
      if (expirationAts.length === 0) {
        legs = [];
      } else {
        const rows = futuresLegsQuery.data as ReadResult[] | undefined;
        if (!rows || rows.length !== expirationAts.length) return undefined;
        legs = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (row?.status !== "success") return undefined;
          const pos = row.result as { netQuantity: bigint; netEntryValue: bigint };
          if (pos.netQuantity === 0n) continue;
          legs.push({ expirationAt: expirationAts[i], ...pos });
        }
      }
    }

    return {
      legs,
      balance,
      unwindBandBps: params?.[0],
      unwindFeeBps: params?.[1],
    };
  }, [isPerps, vaultReads.data, perpsQuery.data, expirationAts, futuresLegsQuery.data]);

  return { data, isLoading: data === undefined };
}
