import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { FuturesAbi } from "../../abi/Futures";
import { HashPowerPerpsDEXAbi } from "../../abi/Perps";
import { QUANTITY_DECIMALS } from "../../lib/units";
import type { FuturesAggregate, PortfolioSnapshot } from "../../lib/portfolioMargin";
import { useGetFutureBalance } from "./useGetFutureBalance";

/// A single `useReadContracts` entry, narrowed to what we actually consume.
type ReadResult = { status: "success"; result: unknown } | { status: "failure" };

/// Reads every input `PortfolioMarginEngine._computeMargin` consumes, so the
/// margin requirement can be re-evaluated off-chain at an arbitrary price.
///
/// The futures leg is one aggregate per active expiry, and the expiry list has
/// to be read before those aggregates can be fetched, so the reads happen in
/// two waves. Wagmi batches each wave through multicall.
///
/// The snapshot stays `undefined` until every read has succeeded — a partial
/// one would silently understate the margin requirement.
export function usePortfolioSnapshot(address: `0x${string}` | undefined) {
  const futuresAddress = process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as
    | `0x${string}`
    | undefined;
  const perpsAddress = process.env.REACT_APP_PERPS_TOKEN_ADDRESS as
    | `0x${string}`
    | undefined;

  const balanceQuery = useGetFutureBalance(address);

  const futuresQuery = useReadContracts({
    contracts: [
      {
        address: futuresAddress,
        abi: FuturesAbi,
        functionName: "getOrderMargin",
        args: [address as `0x${string}`],
      },
      {
        address: futuresAddress,
        abi: FuturesAbi,
        functionName: "getActiveExpirationDates",
        args: [address as `0x${string}`],
      },
      { address: futuresAddress, abi: FuturesAbi, functionName: "decimals" },
    ],
    query: { enabled: !!address && !!futuresAddress, refetchInterval: 10000 },
  });

  // Optional leg: the engine skips perps entirely when the DEX is unregistered.
  const perpsQuery = useReadContracts({
    contracts: [
      {
        address: perpsAddress,
        abi: HashPowerPerpsDEXAbi,
        functionName: "getUserPosition",
        args: [address as `0x${string}`],
      },
      {
        address: perpsAddress,
        abi: HashPowerPerpsDEXAbi,
        functionName: "getOrderMargin",
        args: [address as `0x${string}`],
      },
      {
        address: perpsAddress,
        abi: HashPowerPerpsDEXAbi,
        functionName: "getPendingFunding",
        args: [address as `0x${string}`],
      },
      { address: perpsAddress, abi: HashPowerPerpsDEXAbi, functionName: "QUANTITY_DECIMALS" },
      { address: perpsAddress, abi: HashPowerPerpsDEXAbi, functionName: "decimals" },
    ],
    query: { enabled: !!address && !!perpsAddress, refetchInterval: 10000 },
  });

  const expirationAts = useMemo(() => {
    const result = (futuresQuery.data as ReadResult[] | undefined)?.[1];
    if (result?.status !== "success") return undefined;
    return result.result as readonly bigint[];
  }, [futuresQuery.data]);

  const hasExpiries = (expirationAts?.length ?? 0) > 0;

  const aggregatesQuery = useReadContracts({
    contracts: (expirationAts ?? []).map((expirationAt) => ({
      address: futuresAddress,
      abi: FuturesAbi,
      functionName: "getUserPosition" as const,
      args: [address as `0x${string}`, expirationAt] as const,
    })),
    query: { enabled: !!address && !!futuresAddress && hasExpiries, refetchInterval: 10000 },
  });

  // A settled expiry marks at its recorded price rather than spot, so its PnL
  // is constant in `P` and it drops out of the stress delta.
  const settlementQuery = useReadContracts({
    contracts: (expirationAts ?? []).map((expirationAt) => ({
      address: futuresAddress,
      abi: FuturesAbi,
      functionName: "settlementPrice" as const,
      args: [expirationAt] as const,
    })),
    query: { enabled: !!futuresAddress && hasExpiries, refetchInterval: 10000 },
  });

  const perps = useMemo(
    () => readPerps(perpsQuery.data as ReadResult[] | undefined, !!perpsAddress),
    [perpsQuery.data, perpsAddress],
  );

  const positions = useMemo(
    () =>
      readPositions(
        aggregatesQuery.data as ReadResult[] | undefined,
        settlementQuery.data as ReadResult[] | undefined,
        expirationAts,
      ),
    [aggregatesQuery.data, settlementQuery.data, expirationAts],
  );

  const futures = useMemo(
    () => readFutures(futuresQuery.data as ReadResult[] | undefined),
    [futuresQuery.data],
  );

  const snapshot = useMemo<PortfolioSnapshot | undefined>(() => {
    const balance = balanceQuery.data as bigint | undefined;
    if (balance === undefined || !futures || !perps || !positions) return undefined;
    return {
      balance,
      perp: perps.perp,
      futures: { orderMargin: futures.orderMargin, positions },
    };
  }, [balanceQuery.data, futures, perps, positions]);

  return {
    snapshot,
    // `_fromWad` reads decimals off the perps DEX whenever it is registered,
    // and falls back to the futures contract otherwise.
    tokenDecimals: perps?.tokenDecimals ?? futures?.decimals,
    perpQuantityDecimals: perps?.perpQuantityDecimals ?? QUANTITY_DECIMALS,
    isLoading:
      balanceQuery.isLoading ||
      futuresQuery.isLoading ||
      perpsQuery.isLoading ||
      aggregatesQuery.isLoading ||
      settlementQuery.isLoading,
    isError:
      balanceQuery.isError ||
      futuresQuery.isError ||
      perpsQuery.isError ||
      aggregatesQuery.isError ||
      settlementQuery.isError,
  };
}

function readFutures(
  results: ReadResult[] | undefined,
): { orderMargin: bigint; decimals: number } | undefined {
  const values = allSucceeded(results, 3);
  if (!values) return undefined;
  return { orderMargin: values[0] as bigint, decimals: values[2] as number };
}

function readPerps(
  results: ReadResult[] | undefined,
  hasPerps: boolean,
):
  | {
      perp: PortfolioSnapshot["perp"];
      tokenDecimals: number | undefined;
      perpQuantityDecimals: number | undefined;
    }
  | undefined {
  if (!hasPerps) {
    return {
      perp: { netQty: 0n, entryPrice: 0n, orderMargin: 0n, fundingOwed: 0n },
      tokenDecimals: undefined,
      perpQuantityDecimals: undefined,
    };
  }

  const values = allSucceeded(results, 5);
  if (!values) return undefined;

  const position = values[0] as { netQuantity: bigint; aggregatedEntryPrice: bigint };
  const pendingFunding = values[2] as bigint;

  return {
    perp: {
      netQty: position.netQuantity,
      entryPrice: position.aggregatedEntryPrice,
      orderMargin: values[1] as bigint,
      // The engine only counts funding the user owes.
      fundingOwed: pendingFunding > 0n ? pendingFunding : 0n,
    },
    tokenDecimals: values[4] as number,
    perpQuantityDecimals: Number(values[3]),
  };
}

/// Zips the per-expiry aggregate and settlement reads, dropping flat legs.
function readPositions(
  aggregates: ReadResult[] | undefined,
  settlements: ReadResult[] | undefined,
  expirationAts: readonly bigint[] | undefined,
): FuturesAggregate[] | undefined {
  if (!expirationAts) return undefined;
  if (expirationAts.length === 0) return [];

  const positionValues = allSucceeded(aggregates, expirationAts.length);
  const settlementValues = allSucceeded(settlements, expirationAts.length);
  if (!positionValues || !settlementValues) return undefined;

  const result: FuturesAggregate[] = [];
  for (let i = 0; i < expirationAts.length; i++) {
    const { netQuantity, netEntryValue } = positionValues[i] as {
      netQuantity: bigint;
      netEntryValue: bigint;
    };
    if (netQuantity === 0n) continue;
    result.push({
      expirationAt: expirationAts[i],
      netQuantity,
      netEntryValue,
      settlementPrice: settlementValues[i] as bigint,
    });
  }
  return result;
}

function allSucceeded(results: ReadResult[] | undefined, expected: number): unknown[] | undefined {
  if (!results || results.length !== expected) return undefined;
  const values: unknown[] = [];
  for (const entry of results) {
    if (entry.status !== "success") return undefined;
    values.push(entry.result);
  }
  return values;
}
