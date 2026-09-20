import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { clearSnapshotRunner, runSnapshotOnce, setSnapshotRunner } from "./driverRegistry";
import { QUANTITY_SCALE, QUANTITY_SCALE_NUM } from "../../../lib/units";
import { realizedPnlSinceBaseline, windowCutoffSeconds } from "../../../lib/portfolioPnl";
import { graphqlRequest } from "../graphql";
import { perpsSlices } from "../queries/perps";
import { buildDocument, type Slice } from "../queries/slice";
import { dueGroups, onTheSchedule, type TickGroup } from "./groupSchedule";
import {
  FUNDING_RATE_QK,
  type FundingUpdateRow,
  mapFundingRate,
} from "../perps/useFundingRate";
import {
  mapPerpsCollection,
  PERPS_COLLECTION_QK,
  type PerpsCollectionRow,
} from "../perps/usePerpsCollection";
import {
  fetchPerpsOrderBookAsync,
  mapPerpsPriceLevels,
  PAGE_SIZE as BOOK_PAGE_SIZE,
  PERPS_ORDER_BOOK_QK,
  type PerpsOrderBook,
  type PerpsPriceLevelRow,
} from "../perps/usePerpsOrderBook";
import {
  ACTIVE_PERPS_ORDER_STATUSES,
  mapUserPerpsOrders,
  type PerpsOrderRow,
  userPerpsOrdersKey,
} from "../perps/useUserPerpsOrders";
import {
  mapUserPositionSessions,
  type PositionSessionRow,
  SESSION_PAGE_SIZE,
  USER_POSITION_SESSIONS_QK,
} from "../perps/useUserPositionSessions";
import {
  mapRecentTrades,
  RECENT_TRADES_DEFAULT_FIRST,
  RECENT_TRADES_QK,
  type RecentTradeRow,
} from "../useRecentTrades";
import { mapPerpsExposure, type PerpsExposureRow } from "../pnl/exposure";
import {
  LIQUIDATIONS_FIRST,
  type LiquidationRow,
  mapLiquidations,
  USER_LIQUIDATIONS_QK,
} from "../useUserLiquidations";
import { PORTFOLIO_OPEN_EXPOSURE_QK } from "../pnl/usePortfolioUnrealizedPnl";
import { PORTFOLIO_REALIZED_PNL_QK } from "../pnl/usePortfolioRealizedPnl";
import { SNAPSHOT_TICK_MS, snapshotQueryOptions } from "./config";
import { isDeepEqual, writeIfChanged, writeResponseIfChanged } from "./writeIfChanged";

export const PERPS_SNAPSHOT_QK = "PerpsSnapshot";

/** Matches `PnlVenue.id` for this venue. */
const VENUE_ID = "perpetual";




/**
 * Every field is optional: which of them the response carries depends on which
 * groups were due, so each one is guarded at the fan-out below.
 */
interface PerpsSnapshotResponse {
  _meta: { block: { number: number; timestamp: number } };
  collection?: PerpsCollectionRow[];
  funding?: FundingUpdateRow[];
  book?: PerpsPriceLevelRow[];
  recentTrades?: RecentTradeRow[];
  myOrders?: PerpsOrderRow[];
  sessions?: PositionSessionRow[];
  liquidations?: LiquidationRow[];
  me?: (PerpsExposureRow & { realizedPnl: string }) | null;
  realizedBaseline?: { cumulativeRealizedPnl: string }[];
}

export interface PerpsSnapshotResult {
  /** The head block this snapshot read at; what post-transaction waits compare against. */
  blockNumber: number;
  /** Which groups this tick carried. Nothing reads it; it is for tests and debugging. */
  groups: readonly TickGroup[];
}

export interface PerpsSnapshotContext {
  address?: `0x${string}`;
  /** False while the futures tab is the one on screen; suppresses market slices. */
  isActiveVenue?: boolean;
  force?: boolean;
}

/** See the futures counterpart for why the conditionals live here. */
const slicesForTick = (groups: readonly TickGroup[]) => {
  const due = new Set(groups);
  const slices: Slice[] = [];

  if (due.has("constants")) slices.push(perpsSlices.collection);
  if (due.has("market")) {
    slices.push(perpsSlices.book, perpsSlices.recentTrades, perpsSlices.funding);
  }
  if (due.has("account")) {
    slices.push(
      perpsSlices.myOrders,
      perpsSlices.sessions,
      perpsSlices.liquidations,
      perpsSlices.me,
      perpsSlices.realizedBaseline,
    );
  }

  return slices;
};

/**
 * Fetches what the perps venue is due to read this tick in one request, then
 * fans the result out into the individual query caches the hooks already read
 * from.
 *
 * See `futuresSnapshot.ts` for why the fan-out lives in the query function.
 */
export const fetchPerpsSnapshot = async (
  qc: QueryClient,
  { address, isActiveVenue = true, force = false }: PerpsSnapshotContext,
): Promise<PerpsSnapshotResult> => {
  const cutoff = windowCutoffSeconds();
  // Anything written to these caches after this instant is newer than what this
  // request can possibly return, and must not be overwritten by it.
  const startedAt = Date.now();

  const groups = dueGroups("perpetual", { hasAddress: !!address, isActiveVenue, force });
  const slices = slicesForTick(groups);
  if (slices.length === 0) return { blockNumber: 0, groups };

  const response = await onTheSchedule("perpetual", groups, startedAt, () =>
    graphqlRequest<PerpsSnapshotResponse>(
      buildDocument("PerpsTick", slices),
      {
        address: address?.toLowerCase() ?? "",
        statuses: ACTIVE_PERPS_ORDER_STATUSES,
        bookFirst: BOOK_PAGE_SIZE,
        bookLastId: "",
        sessionFirst: SESSION_PAGE_SIZE,
        tradesFirst: RECENT_TRADES_DEFAULT_FIRST,
        liquidationsFirst: LIQUIDATIONS_FIRST,
        cutoff,
      },
      process.env.REACT_APP_SUBGRAPH_PERPS_URL,
    ),
  );

  const blockNumber = response._meta.block.number;
  const timestamp = Number(response._meta.block.timestamp);

  // Market-wide slices.
  if (response.collection && response.collection.length > 0) {
    writeIfChanged(
      qc,
      [PERPS_COLLECTION_QK],
      { data: mapPerpsCollection(response.collection[0]) },
      startedAt,
    );
  }
  if (response.funding) {
    writeIfChanged(qc, [FUNDING_RATE_QK], mapFundingRate(response.funding), startedAt);
  }
  if (response.recentTrades) {
    writeIfChanged(
      qc,
      [RECENT_TRADES_QK, VENUE_ID, RECENT_TRADES_DEFAULT_FIRST],
      mapRecentTrades(response.recentTrades, QUANTITY_SCALE_NUM),
      startedAt,
    );
  }

  if (response.book) {
    if (response.book.length < BOOK_PAGE_SIZE) {
      const book: PerpsOrderBook = { priceLevels: mapPerpsPriceLevels(response.book) };
      writeResponseIfChanged(qc, [PERPS_ORDER_BOOK_QK], book, blockNumber, startedAt);
    } else {
      // Deeper than one request can carry; writing it would truncate the far side
      // of the book. Page the rest in here rather than invalidating the hook's
      // query: that hook reads through this same snapshot, so its refetch would
      // sit waiting on the request it was called from and neither would finish.
      const deep = await fetchPerpsOrderBookAsync();
      writeResponseIfChanged(qc, [PERPS_ORDER_BOOK_QK], deep.data, deep.blockNumber, startedAt);
    }
  }

  // Account slices.
  if (address) {
    if (response.myOrders) {
      // This entry carries a block timestamp alongside the usual `GetResponse`
      // fields, so it is written by hand rather than via the shared helper.
      const key = userPerpsOrdersKey(address, ACTIVE_PERPS_ORDER_STATUSES, undefined);
      const data = mapUserPerpsOrders(response.myOrders);
      const updatedAt = qc.getQueryState(key)?.dataUpdatedAt;
      const superseded = updatedAt !== undefined && updatedAt > startedAt;
      const prev = qc.getQueryData<{ data: typeof data }>(key);
      if (!superseded && (!prev || !isDeepEqual(prev.data, data))) {
        qc.setQueryData(key, { data, blockNumber, timestamp });
      }
    }
    if (response.sessions) {
      writeIfChanged(
        qc,
        [USER_POSITION_SESSIONS_QK, address],
        mapUserPositionSessions(response.sessions),
        startedAt,
      );
    }
    if (response.liquidations) {
      writeIfChanged(
        qc,
        [USER_LIQUIDATIONS_QK, VENUE_ID, address],
        mapLiquidations(response.liquidations, "perps"),
        startedAt,
      );
    }
    if (response.me !== undefined) {
      writeIfChanged(
        qc,
        [PORTFOLIO_OPEN_EXPOSURE_QK, VENUE_ID, address],
        mapPerpsExposure(response.me, QUANTITY_SCALE),
        startedAt,
      );

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
 * Drives the perps venue's data. Mount once, high in the tree.
 *
 * Every perps indexer hook reads a cache entry this writes, so they carry no
 * interval of their own — one request per tick replaces roughly eight.
 */
export const usePerpsSnapshot = (context: PerpsSnapshotContext) => {
  const qc = useQueryClient();

  const { address, isActiveVenue = true } = context;
  const runner = useCallback(
    (force: boolean) => fetchPerpsSnapshot(qc, { address, isActiveVenue, force }),
    [qc, address, isActiveVenue],
  );

  // Registered in render and again on commit; see `futuresSnapshot` for why both
  // are needed, and `driverRegistry` for why render-time is the important one.
  setSnapshotRunner("perpetual", runner);
  useEffect(() => {
    setSnapshotRunner("perpetual", runner);
    return () => clearSnapshotRunner("perpetual");
  }, [runner]);

  return useQuery({
    queryKey: [PERPS_SNAPSHOT_QK, address, isActiveVenue],
    queryFn: () => runSnapshotOnce("perpetual") ?? fetchPerpsSnapshot(qc, context),
    refetchInterval: SNAPSHOT_TICK_MS,
    ...snapshotQueryOptions,
  });
};
