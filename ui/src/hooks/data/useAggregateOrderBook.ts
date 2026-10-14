import { graphqlRequest } from "./graphql";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AggregateOrderBookQuery } from "./queries/futures";
import { snapshotFedQueryOptions } from "./snapshot/config";
import { readViaSnapshot } from "./snapshot/snapshotFed";

export const AGGREGATE_ORDER_BOOK_QK = "AggregateOrderBook";

/// Kept fresh by `useFuturesSnapshot`, which writes this cache entry directly
/// whenever the book fits in a single page. Books deeper than `PAGE_SIZE` fall
/// back to this hook's own paginating fetcher.
export const useAggregateOrderBook = (expirationAt: number | undefined) => {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [AGGREGATE_ORDER_BOOK_QK, expirationAt],
    queryFn: () =>
      readViaSnapshot(qc, "futures", [AGGREGATE_ORDER_BOOK_QK, expirationAt], () =>
        fetchAggregateOrderBookAsync(expirationAt),
      ),
    enabled: !!expirationAt,
    ...snapshotFedQueryOptions,
  });

  return query;
};

export const PAGE_SIZE = 100;

const EMPTY_RESULT = { data: { priceLevels: [] } as AggregateOrderBook, blockNumber: 0 };

/// Fed by the `book` slice, batched into a venue tick or fetched standalone.
export const mapPriceLevels = (rows: AggregateOrderBookResponse["book"]): AggregatePriceLevel[] =>
  rows.map((level) => ({
    id: level.id,
    price: BigInt(level.price),
    isBid: level.isBid,
    expirationAt: BigInt(level.expirationAt),
    totalQuantity: level.totalQuantity,
  }));

/// Also called by `useFuturesSnapshot` for books too deep to ride along in the
/// snapshot response.
export const fetchAggregateOrderBookAsync = async (expirationAt: number | undefined) => {
  // Defensive guard: TanStack Query's `invalidateQueries({ queryKey: [AGGREGATE_ORDER_BOOK_QK] })`
  // (used in PlaceOrderForm / CancelOrderForm / ModifyOrderForm post-confirmation hooks)
  // refetches active observers even when `enabled: false`, so we may be entered with no
  // expiration date selected (e.g. before `useGetExpirationDates()` resolves). The indexer's
  // `priceLevels` collection is keyed by `(expirationAt, price, side)` and `$expirationAt`
  // is non-nullable, so sending `undefined` produces a hard GraphQL error.
  if (expirationAt === undefined) return EMPTY_RESULT;

  const priceLevels: AggregatePriceLevel[] = [];
  let lastId = "";
  let blockNumber = 0;

  while (true) {
    const response = await graphqlRequest<AggregateOrderBookResponse>(AggregateOrderBookQuery, {
      expirationAt: expirationAt,
      bookFirst: PAGE_SIZE,
      bookLastId: lastId,
    });

    blockNumber = response._meta.block.number;

    priceLevels.push(...mapPriceLevels(response.book));

    if (response.book.length < PAGE_SIZE) break;
    lastId = response.book[response.book.length - 1].id;
  }

  const data: AggregateOrderBook = { priceLevels };

  return {
    data,
    blockNumber,
  };
};

export type AggregateOrderBook = {
  priceLevels: AggregatePriceLevel[];
};

export type AggregatePriceLevel = {
  id: string;
  price: bigint;
  isBid: boolean;
  expirationAt: bigint;
  totalQuantity: number;
};

export type PriceLevelRow = {
  id: string;
  price: string;
  isBid: boolean;
  expirationAt: string;
  totalQuantity: number;
};

type AggregateOrderBookResponse = {
  _meta: {
    block: {
      number: number;
      timestamp: string;
    };
  };
  book: PriceLevelRow[];
};
