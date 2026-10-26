import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import type {
  AccountSnapshot,
  FuturesRestingOrders,
  RestingOrders,
} from "@hashpower/portfolio-margin";
import { CollateralVaultAbi } from "collateral-margin-abi/CollateralVault.ts";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";
import { PAYMENT_TOKEN_DECIMALS, QUANTITY_DECIMALS } from "../../lib/units";
import { useGetFutureBalance } from "./useGetFutureBalance";
import { useFuturesCollateralVault } from "./useFuturesCollateralVault";
import { withErrors } from "../../lib/withErrors";

// The pinned derivatives ABI still exposes the legacy averaged-entry tuple.
// Keep this narrow override local until the exact-position ABI is published.
const PERPS_EXACT_POSITION_ABI = [
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

/// A single `useReadContracts` entry, narrowed to what we actually consume.
type ReadResult = { status: "success"; result: unknown } | { status: "failure" };

/// The `getRiskView` tuple, narrowed to the fields the margin model reads.
type RiskView = { pendingFunding: bigint };

/// A book with no resting orders.
const NO_ORDERS: RestingOrders = {
  buyQty: 0n,
  sellQty: 0n,
  buyPQ: 0n,
  buyP2Q: 0n,
  sellPQ: 0n,
  sellP2Q: 0n,
};

/// Reads every input `PortfolioMarginEngine._computeMargin` consumes, so the
/// margin requirement can be re-evaluated off-chain at an arbitrary price by
/// `@hashpower/portfolio-margin` — the same model the keeper runs.
///
/// The futures leg is one aggregate per active expiry, and the expiry list has
/// to be read before those aggregates can be fetched, so the reads happen in
/// two waves. Wagmi batches each wave through multicall.
///
/// Resting orders are each venue's per-side quantity and price moments, which the
/// margin model bounds fill loss from at any price: perps `getOrderAggregate`,
/// futures `getOrderAggregateAtExpiration` per expiry in `getExpirationDates()`,
/// kept per expiry with its settlement price because the venue bounds each expiry
/// at its own price.
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
  const { data: collateralVaultAddress } = useFuturesCollateralVault();
  const accountDebtQuery = useReadContract({
    address: collateralVaultAddress,
    abi: withErrors(CollateralVaultAbi),
    functionName: "accountDebt",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!collateralVaultAddress,
      refetchInterval: 10000,
    },
  });

  const futuresQuery = useReadContracts({
    contracts: [
      {
        address: futuresAddress,
        abi: withErrors(HashPowerFuturesAbi),
        functionName: "getRiskView",
        args: [address as `0x${string}`],
      },
      {
        address: futuresAddress,
        abi: withErrors(HashPowerFuturesAbi),
        functionName: "getActiveExpirationDates",
        args: [address as `0x${string}`],
      },
      {
        address: futuresAddress,
        abi: withErrors(HashPowerFuturesAbi),
        functionName: "getExpirationDates",
      },
    ],
    query: { enabled: !!address && !!futuresAddress, refetchInterval: 10000 },
  });

  // Optional leg: the engine skips perps entirely when the DEX is unregistered.
  const perpsQuery = useReadContracts({
    contracts: [
      {
        address: perpsAddress,
        abi: withErrors(PERPS_EXACT_POSITION_ABI),
        functionName: "getUserPosition",
        args: [address as `0x${string}`],
      },
      {
        address: perpsAddress,
        abi: withErrors(HashPowerPerpsDEXAbi),
        functionName: "getRiskView",
        args: [address as `0x${string}`],
      },
      {
        address: perpsAddress,
        abi: withErrors(HashPowerPerpsDEXAbi),
        functionName: "getOrderAggregate",
        args: [address as `0x${string}`],
      },
      { address: perpsAddress, abi: withErrors(HashPowerPerpsDEXAbi), functionName: "QUANTITY_DECIMALS" },
    ],
    query: { enabled: !!address && !!perpsAddress, refetchInterval: 10000 },
  });

  const positionExpirationAts = useMemo(() => {
    const result = (futuresQuery.data as ReadResult[] | undefined)?.[1];
    if (result?.status !== "success") return undefined;
    return result.result as readonly bigint[];
  }, [futuresQuery.data]);

  const orderExpirationAts = useMemo(() => {
    const result = (futuresQuery.data as ReadResult[] | undefined)?.[2];
    if (result?.status !== "success") return undefined;
    return result.result as readonly bigint[];
  }, [futuresQuery.data]);

  const hasPositions = (positionExpirationAts?.length ?? 0) > 0;
  const hasOrderWindow = (orderExpirationAts?.length ?? 0) > 0;

  const aggregatesQuery = useReadContracts({
    contracts: (positionExpirationAts ?? []).map((expirationAt) => ({
      address: futuresAddress,
      abi: withErrors(HashPowerFuturesAbi),
      functionName: "getUserPosition" as const,
      args: [address as `0x${string}`, expirationAt] as const,
    })),
    query: { enabled: !!address && !!futuresAddress && hasPositions, refetchInterval: 10000 },
  });

  // A settled expiry marks at its recorded price rather than spot, so its PnL
  // is constant in `P` and it drops out of the stress delta.
  const settlementQuery = useReadContracts({
    contracts: (positionExpirationAts ?? []).map((expirationAt) => ({
      address: futuresAddress,
      abi: withErrors(HashPowerFuturesAbi),
      functionName: "settlementPrice" as const,
      args: [expirationAt] as const,
    })),
    query: { enabled: !!futuresAddress && hasPositions, refetchInterval: 10000 },
  });

  // Each window expiry's book, then its settlement price (zero until it settles).
  const orderAggregatesQuery = useReadContracts({
    contracts: [
      ...(orderExpirationAts ?? []).map((expirationAt) => ({
        address: futuresAddress,
        abi: withErrors(HashPowerFuturesAbi),
        functionName: "getOrderAggregateAtExpiration" as const,
        args: [address as `0x${string}`, expirationAt] as const,
      })),
      ...(orderExpirationAts ?? []).map((expirationAt) => ({
        address: futuresAddress,
        abi: withErrors(HashPowerFuturesAbi),
        functionName: "settlementPrice" as const,
        args: [expirationAt] as const,
      })),
    ],
    query: { enabled: !!address && !!futuresAddress && hasOrderWindow, refetchInterval: 10000 },
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
        positionExpirationAts,
      ),
    [aggregatesQuery.data, settlementQuery.data, positionExpirationAts],
  );

  const futuresOrders = useMemo(
    () =>
      readFuturesOrders(
        futuresQuery.data as ReadResult[] | undefined,
        orderAggregatesQuery.data as ReadResult[] | undefined,
        orderExpirationAts,
      ),
    [futuresQuery.data, orderAggregatesQuery.data, orderExpirationAts],
  );

  const snapshot = useMemo<AccountSnapshot | undefined>(() => {
    const balance = balanceQuery.data as bigint | undefined;
    const accountDebt = accountDebtQuery.data as bigint | undefined;
    if (
      !address ||
      balance === undefined ||
      accountDebt === undefined ||
      !futuresOrders ||
      !perps ||
      !positions
    ) {
      return undefined;
    }
    return {
      user: address,
      balance,
      accountDebt,
      perp: perps.perp,
      futures: { positions, orders: futuresOrders },
    };
  }, [address, balanceQuery.data, accountDebtQuery.data, futuresOrders, perps, positions]);

  return {
    snapshot,
    // The venues no longer expose `decimals()`; the collateral token is fixed
    // per deployment, so it comes from config rather than an extra RPC hop.
    tokenDecimals: PAYMENT_TOKEN_DECIMALS,
    perpQuantityDecimals: perps?.perpQuantityDecimals ?? QUANTITY_DECIMALS,
    isLoading:
      balanceQuery.isLoading ||
      accountDebtQuery.isLoading ||
      futuresQuery.isLoading ||
      perpsQuery.isLoading ||
      aggregatesQuery.isLoading ||
      settlementQuery.isLoading ||
      orderAggregatesQuery.isLoading,
    isError:
      balanceQuery.isError ||
      accountDebtQuery.isError ||
      futuresQuery.isError ||
      perpsQuery.isError ||
      aggregatesQuery.isError ||
      settlementQuery.isError ||
      orderAggregatesQuery.isError,
  };
}

/// The six moment fields of a venue's `RestingOrderAggregate`.
function moments(aggregate: RestingOrders): RestingOrders {
  return {
    buyQty: aggregate.buyQty,
    sellQty: aggregate.sellQty,
    buyPQ: aggregate.buyPQ,
    buyP2Q: aggregate.buyP2Q,
    sellPQ: aggregate.sellPQ,
    sellP2Q: aggregate.sellP2Q,
  };
}

/// One book per window expiry that has resting orders.
function readFuturesOrders(
  wave1: ReadResult[] | undefined,
  orderReads: ReadResult[] | undefined,
  orderExpirationAts: readonly bigint[] | undefined,
): FuturesRestingOrders[] | undefined {
  if (!allSucceeded(wave1, 3) || orderExpirationAts === undefined) return undefined;
  const count = orderExpirationAts.length;
  if (count === 0) return [];

  const values = allSucceeded(orderReads, count * 2);
  if (!values) return undefined;

  const books: FuturesRestingOrders[] = [];
  for (let i = 0; i < count; i++) {
    const aggregate = values[i] as RestingOrders;
    if (aggregate.buyQty === 0n && aggregate.sellQty === 0n) continue;
    books.push({
      ...moments(aggregate),
      expirationAt: orderExpirationAts[i],
      settlementPrice: values[count + i] as bigint,
    });
  }
  return books;
}

function readPerps(
  results: ReadResult[] | undefined,
  hasPerps: boolean,
):
  | { perp: AccountSnapshot["perp"]; perpQuantityDecimals: number | undefined }
  | undefined {
  const flat: AccountSnapshot["perp"] = {
    netQty: 0n,
    entryPrice: 0n,
    orders: NO_ORDERS,
    fundingOwed: 0n,
  };

  if (!hasPerps) return { perp: flat, perpQuantityDecimals: undefined };

  const values = allSucceeded(results, 4);
  if (!values) return undefined;

  const position = values[0] as { netQuantity: bigint; netEntryValue: bigint };
  const risk = values[1] as RiskView;
  const absNetQuantity =
    position.netQuantity < 0n ? -position.netQuantity : position.netQuantity;
  const absNetEntryValue =
    position.netEntryValue < 0n ? -position.netEntryValue : position.netEntryValue;

  return {
    perp: {
      netQty: position.netQuantity,
      entryPrice:
        absNetQuantity === 0n ? 0n : (absNetEntryValue * 1_000_000n) / absNetQuantity,
      orders: moments(values[2] as RestingOrders),
      // The engine only counts funding the user owes.
      fundingOwed: risk.pendingFunding > 0n ? risk.pendingFunding : 0n,
    },
    perpQuantityDecimals: Number(values[3]),
  };
}

/// Zips the per-expiry aggregate and settlement reads, dropping flat legs.
function readPositions(
  aggregates: ReadResult[] | undefined,
  settlements: ReadResult[] | undefined,
  expirationAts: readonly bigint[] | undefined,
): AccountSnapshot["futures"]["positions"] | undefined {
  if (!expirationAts) return undefined;
  if (expirationAts.length === 0) return [];

  const positionValues = allSucceeded(aggregates, expirationAts.length);
  const settlementValues = allSucceeded(settlements, expirationAts.length);
  if (!positionValues || !settlementValues) return undefined;

  const result: AccountSnapshot["futures"]["positions"] = [];
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
