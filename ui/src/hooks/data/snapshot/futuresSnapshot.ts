import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { clearSnapshotRunner, runSnapshotOnce, setSnapshotRunner } from "./driverRegistry";
import { realizedPnlSinceBaseline, windowCutoffSeconds } from "../../../lib/portfolioPnl";
import { graphqlRequest } from "../graphql";
import { futuresSlices } from "../queries/futures";
import { buildDocument, type Slice } from "../queries/slice";
import { dueGroups, onTheSchedule, type TickGroup } from "./groupSchedule";
import {
  AGGREGATE_ORDER_BOOK_QK,
  type AggregateOrderBook,
  PAGE_SIZE as BOOK_PAGE_SIZE,
  fetchAggregateOrderBookAsync,
  mapPriceLevels,
  type PriceLevelRow,
} from "../useAggregateOrderBook";
import {
  ACTIVE_ORDER_STATUSES,
  type FuturesOrderRow,
  mapParticipant,
  ORDER_PAGE_SIZE,
  PARTICIPANT_QK,
} from "../getUserFuturesOrders";
import {
  mapPositionBook,
  POSITION_BOOK_QK,
  type PositionSessionRow,
} from "../getUserFuturesPositions";
import {
  mapContractSpecs,
  type ContractSpecsRow,
  FUTURES_CONTRACT_SPECS_QK,
} from "../useFuturesContractSpecs";
import {
  mapRecentTrades,
  RECENT_TRADES_DEFAULT_FIRST,
  RECENT_TRADES_QK,
  type RecentTradeRow,
  recentTradeQuantityScale,
} from "../useRecentTrades";
import { type FuturesExposureRow, mapFuturesExposure } from "../pnl/exposure";
import {
  LIQUIDATIONS_FIRST,
  type LiquidationRow,
  mapLiquidations,
  USER_LIQUIDATIONS_QK,
} from "../useUserLiquidations";
import { PORTFOLIO_OPEN_EXPOSURE_QK } from "../pnl/usePortfolioUnrealizedPnl";
import { PORTFOLIO_REALIZED_PNL_QK } from "../pnl/usePortfolioRealizedPnl";
import { SNAPSHOT_TICK_MS, snapshotQueryOptions } from "./config";
import { writeIfChanged, writeResponseIfChanged } from "./writeIfChanged";

export const FUTURES_SNAPSHOT_QK = "FuturesSnapshot";

/** Matches `PnlVenue.id` for this venue, and `PnlVenue.quantityScale`. */
const VENUE_ID = "futures";
const VENUE_QUANTITY_SCALE = 1n;

/** Upper bound on concurrently open expirations, mirroring `pnl/exposure.ts`. */
const EXPOSURE_LIMIT = 200;

/**
 * Every field is optional: which of them the response carries depends on which
 * groups were due, so each one is guarded at the fan-out below.
 */
interface FuturesSnapshotResponse {
  _meta: { block: { number: number; timestamp: string } };
  specs?: ContractSpecsRow | null;
  book?: PriceLevelRow[];
  recentTrades?: RecentTradeRow[];
  myOrders?: FuturesOrderRow[];
  positions?: PositionSessionRow[];
  exposure?: FuturesExposureRow[];
  liquidations?: LiquidationRow[];
  me?: { realizedPnl: string } | null;
  realizedBaseline?: { cumulativeRealizedPnl: string }[];
}

export interface FuturesSnapshotResult {
  /** The head block this snapshot read at; what post-transaction waits compare against. */
  blockNumber: number;
  /** Which groups this tick carried. Nothing reads it; it is for tests and debugging. */
  groups: readonly TickGroup[];
}

export interface FuturesSnapshotContext {
  address?: `0x${string}`;
  expirationAt?: number;
  /** False while the perps tab is the one on screen; suppresses market slices. */
  isActiveVenue?: boolean;
  /** Ask for every applicable group regardless of when it last went out. */
  force?: boolean;
}

/**
 * The slices this venue asks for, given which groups are due.
 *
 * Everything conditional lives here rather than in `@include` directives: a
 * slice that does not apply is simply not in the document. That keeps the
 * request as small as what is actually being read, and keeps the document
 * readable — there is no `$hasAddress` to trace through.
 */
const slicesForTick = (groups: readonly TickGroup[], expirationAt: number | undefined) => {
  const due = new Set(groups);
  const slices: Slice[] = [];

  if (due.has("constants")) slices.push(futuresSlices.specs);
  if (due.has("market")) {
    // No expiration means `getExpirationDates()` has not come back from the
    // chain yet, so there is no book to ask for.
    if (expirationAt !== undefined) slices.push(futuresSlices.book);
    slices.push(futuresSlices.recentTrades);
  }
  if (due.has("account")) {
    slices.push(
      futuresSlices.myOrders,
      futuresSlices.positions,
      futuresSlices.exposure,
      futuresSlices.liquidations,
      futuresSlices.me,
      futuresSlices.realizedBaseline,
    );
  }

  return slices;
};

/**
 * Fetches what the futures venue is due to read this tick in one request, then
 * fans the result out into the individual query caches the hooks already read
 * from.
 *
 * The fan-out runs here rather than in an `onSuccess` callback because v5
 * removed those from `useQuery`; the query function is the only place that runs
 * exactly once per fetch regardless of how many components subscribe.
 */
export const fetchFuturesSnapshot = async (
  qc: QueryClient,
  { address, expirationAt, isActiveVenue = true, force = false }: FuturesSnapshotContext,
): Promise<FuturesSnapshotResult> => {
  const cutoff = windowCutoffSeconds();
  // Anything written to these caches after this instant is newer than what this
  // request can possibly return, and must not be overwritten by it.
  const startedAt = Date.now();

  const groups = dueGroups("futures", { hasAddress: !!address, isActiveVenue, force });
  const slices = slicesForTick(groups, expirationAt);
  if (slices.length === 0) return { blockNumber: 0, groups };

  const response = await onTheSchedule("futures", groups, startedAt, () =>
    graphqlRequest<FuturesSnapshotResponse>(buildDocument("FuturesTick", slices), {
      address: address?.toLowerCase() ?? "",
      statuses: [...ACTIVE_ORDER_STATUSES],
      now: Math.floor(Date.now() / 1000),
      expirationAt: expirationAt ?? 0,
      orderFirst: ORDER_PAGE_SIZE,
      orderSkip: 0,
      bookFirst: BOOK_PAGE_SIZE,
      bookLastId: "",
      tradesFirst: RECENT_TRADES_DEFAULT_FIRST,
      exposureFirst: EXPOSURE_LIMIT,
      liquidationsFirst: LIQUIDATIONS_FIRST,
      cutoff,
    }),
  );

  const blockNumber = response._meta.block.number;

  // Market-wide slices.
  if (response.specs) {
    writeResponseIfChanged(
      qc,
      [FUTURES_CONTRACT_SPECS_QK],
      mapContractSpecs(response.specs),
      blockNumber,
      startedAt,
    );
  }
  if (response.recentTrades) {
    writeIfChanged(
      qc,
      [RECENT_TRADES_QK, VENUE_ID, RECENT_TRADES_DEFAULT_FIRST],
      mapRecentTrades(response.recentTrades, recentTradeQuantityScale(VENUE_ID)),
      startedAt,
    );
  }

  if (expirationAt !== undefined && response.book) {
    if (response.book.length < BOOK_PAGE_SIZE) {
      const book: AggregateOrderBook = { priceLevels: mapPriceLevels(response.book) };
      writeResponseIfChanged(
        qc,
        [AGGREGATE_ORDER_BOOK_QK, expirationAt],
        book,
        blockNumber,
        startedAt,
      );
    } else {
      // A full page back means the book may be deeper than one request can
      // carry, and writing it would silently truncate the far side. Page the
      // rest in here rather than invalidating the hook's query: that hook reads
      // through this same snapshot, so its refetch would sit waiting on the
      // request it was called from and neither would ever finish. Costs an extra
      // request per tick, but only for books that are actually this deep.
      const deep = await fetchAggregateOrderBookAsync(expirationAt);
      writeResponseIfChanged(
        qc,
        [AGGREGATE_ORDER_BOOK_QK, expirationAt],
        deep.data,
        deep.blockNumber,
        startedAt,
      );
    }
  }

  // Account slices.
  if (address) {
    if (response.myOrders) {
      writeResponseIfChanged(
        qc,
        [PARTICIPANT_QK, address],
        mapParticipant(response.myOrders, address),
        blockNumber,
        startedAt,
      );
    }
    if (response.positions) {
      writeResponseIfChanged(
        qc,
        [POSITION_BOOK_QK, address],
        mapPositionBook(response.positions),
        blockNumber,
        startedAt,
      );
    }
    if (response.exposure) {
      writeIfChanged(
        qc,
        [PORTFOLIO_OPEN_EXPOSURE_QK, VENUE_ID, address],
        mapFuturesExposure(response.exposure, VENUE_QUANTITY_SCALE),
        startedAt,
      );
    }
    if (response.liquidations) {
      writeIfChanged(
        qc,
        [USER_LIQUIDATIONS_QK, VENUE_ID, address],
        mapLiquidations(response.liquidations, "futures"),
        startedAt,
      );
    }
    if (response.me !== undefined) {
      // A missing `User` row means the account has never traded this venue.
      const realized = response.me
        ? realizedPnlSinceBaseline(
            BigInt(response.me.realizedPnl),
            response.realizedBaseline?.length
              ? BigInt(response.realizedBaseline[0].cumulativeRealizedPnl)
              : null,
          )
        : 0n;
      writeIfChanged(
        qc,
        [PORTFOLIO_REALIZED_PNL_QK, VENUE_ID, address, cutoff],
        realized,
        startedAt,
      );
    }
  }

  return { blockNumber, groups };
};

/**
 * Drives the futures venue's data. Mount once, high in the tree.
 *
 * Every futures indexer hook reads a cache entry this writes, so they carry no
 * interval of their own — one request per tick replaces roughly ten.
 */
export const useFuturesSnapshot = (context: FuturesSnapshotContext) => {
  const qc = useQueryClient();

  const { address, expirationAt, isActiveVenue = true } = context;
  const runner = useCallback(
    (force: boolean) => fetchFuturesSnapshot(qc, { address, expirationAt, isActiveVenue, force }),
    [qc, address, expirationAt, isActiveVenue],
  );

  // Registered during render, not only in an effect, so the snapshot-fed hooks in
  // child widgets find it before their own first fetch could start. See
  // `driverRegistry`.
  setSnapshotRunner("futures", runner);
  // Re-asserted on commit as well, because StrictMode's remount runs this
  // effect's cleanup after the render above has already registered; without the
  // second registration the venue would be left with no driver in development
  // and every fed hook would fetch for itself.
  useEffect(() => {
    setSnapshotRunner("futures", runner);
    return () => clearSnapshotRunner("futures");
  }, [runner]);

  return useQuery({
    queryKey: [FUTURES_SNAPSHOT_QK, context.address, context.expirationAt, isActiveVenue],
    // Shares the coalescing path with the fed hooks, so a cold load in which
    // they all fetch at once still costs exactly one request.
    queryFn: () => runSnapshotOnce("futures") ?? fetchFuturesSnapshot(qc, context),
    refetchInterval: SNAPSHOT_TICK_MS,
    ...snapshotQueryOptions,
  });
};
