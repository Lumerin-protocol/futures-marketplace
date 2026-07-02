import { useMemo } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { graphqlRequest } from "./graphql";

export const DEFAULT_HISTORY_PAGE_SIZE = 10;

export interface PaginatedHistoryResult<TItem> {
  /// Flattened, de-duplicated rows across every loaded page.
  data: TItem[];
  /// True only during the initial fetch (first page), not while loading more.
  loading: boolean;
  /// True while fetching an additional page via `loadMore`.
  isFetchingMore: boolean;
  /// Whether another page is likely available (last page was full).
  hasMore: boolean;
  /// Fetch the next page of older records and append them.
  loadMore: () => void;
  /// Discard every loaded page and refetch only the newest page.
  refresh: () => void;
  error: unknown;
}

interface UsePaginatedHistoryOptions<TRaw, TItem> {
  /// Base react-query key. The page size is appended internally so different
  /// page sizes never collide, and mutation handlers can reset by the base key
  /// prefix.
  queryKey: QueryKey;
  /// gql query string. Must accept `$first: Int!` and `$skip: Int!`.
  query: string;
  /// Variables shared across pages (e.g. address, statuses). `first`/`skip`
  /// are injected per page and must NOT be provided here.
  variables?: Record<string, unknown>;
  /// Optional subgraph URL override (defaults to the futures subgraph).
  subgraphUrl?: string;
  /// Pull the raw row array out of the GraphQL response.
  selectRows: (response: TRaw) => unknown[];
  /// Map a single raw row to the entity-specific shape.
  mapRow: (raw: any) => TItem;
  /// Stable unique id for a mapped row, used to de-duplicate while appending.
  getId: (item: TItem) => string;
  pageSize?: number;
  enabled?: boolean;
  /// Optional background refetch interval (ms) for the currently loaded pages.
  refetchInterval?: number;
}

/// Reusable incremental "Load More" pagination for The Graph history tables.
///
/// Built on `useInfiniteQuery` with offset (`first`/`skip`) pagination. Each
/// click of `loadMore` fetches the next `pageSize` older records and appends
/// them; `refresh` resets back to the newest page (used after mutations).
export const usePaginatedHistory = <TRaw, TItem>({
  queryKey,
  query,
  variables,
  subgraphUrl,
  selectRows,
  mapRow,
  getId,
  pageSize = DEFAULT_HISTORY_PAGE_SIZE,
  enabled = true,
  refetchInterval,
}: UsePaginatedHistoryOptions<TRaw, TItem>): PaginatedHistoryResult<TItem> => {
  const queryClient = useQueryClient();

  // Page size is part of the cache key so changing it can't surface a stale
  // mix of differently-sized pages.
  const fullKey = useMemo(() => [...queryKey, pageSize], [queryKey, pageSize]);

  const infinite = useInfiniteQuery({
    queryKey: fullKey,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const response = await graphqlRequest<TRaw>(
        query,
        { ...variables, first: pageSize, skip: pageParam },
        subgraphUrl,
      );
      return selectRows(response).map((row) => mapRow(row));
    },
    // A short page means the subgraph has nothing older to give us.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < pageSize ? undefined : allPages.length * pageSize,
    enabled,
    refetchInterval,
  });

  const data = useMemo<TItem[]>(() => {
    const pages = infinite.data?.pages ?? [];
    const seen = new Set<string>();
    const flat: TItem[] = [];
    for (const page of pages) {
      for (const item of page) {
        const id = getId(item);
        if (seen.has(id)) continue;
        seen.add(id);
        flat.push(item);
      }
    }
    return flat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infinite.data?.pages]);

  return {
    data,
    loading: infinite.isLoading,
    isFetchingMore: infinite.isFetchingNextPage,
    hasMore: infinite.hasNextPage,
    loadMore: () => {
      if (infinite.hasNextPage && !infinite.isFetchingNextPage) {
        infinite.fetchNextPage();
      }
    },
    refresh: () => {
      queryClient.resetQueries({ queryKey: fullKey });
    },
    error: infinite.error,
  };
};
