import { graphqlRequest } from "../graphql";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PerpsOrderBookQuery } from "../queries/perps";
import { snapshotFedQueryOptions } from "../snapshot/config";
import { readViaSnapshot } from "../snapshot/snapshotFed";

export const PERPS_ORDER_BOOK_QK = "PerpsOrderBook";

/// Kept fresh by `usePerpsSnapshot`, which writes this cache entry directly
/// whenever the book fits in a single page. Books deeper than `PAGE_SIZE` fall
/// back to this hook's own paginating fetcher.
export const usePerpsOrderBook = () => {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [PERPS_ORDER_BOOK_QK],
    queryFn: () =>
      readViaSnapshot(qc, "perpetual", [PERPS_ORDER_BOOK_QK], fetchPerpsOrderBookAsync),
    ...snapshotFedQueryOptions,
  });

  return query;
};

export const PAGE_SIZE = 100;

/// Shared with `PerpsSnapshotQuery`'s `book` alias, which writes this cache
/// entry directly. Both paths must produce identical shapes.
export const mapPerpsPriceLevels = (rows: PerpsPriceLevelRow[]): PerpsPriceLevel[] =>
  rows.map((level) => ({
    id: level.id,
    price: BigInt(level.price),
    isBid: level.isBid,
    orderCount: level.orderCount,
    totalQuantity: BigInt(level.totalQuantity),
  }));

/// Also called by `usePerpsSnapshot` for books too deep to ride along in the
/// snapshot response.
export const fetchPerpsOrderBookAsync = async () => {
  const priceLevels: PerpsPriceLevel[] = [];
  let lastId = "";
  let blockNumber = 0;

  while (true) {
    const response = await graphqlRequest<PerpsOrderBookResponse>(
      PerpsOrderBookQuery,
      { bookFirst: PAGE_SIZE, bookLastId: lastId },
      process.env.REACT_APP_SUBGRAPH_PERPS_URL,
    );

    blockNumber = response._meta.block.number;

    priceLevels.push(...mapPerpsPriceLevels(response.book));

    if (response.book.length < PAGE_SIZE) break;
    lastId = response.book[response.book.length - 1].id;
  }

  const data: PerpsOrderBook = { priceLevels };

  return {
    data,
    blockNumber,
  };
};

export type PerpsOrderBook = {
  priceLevels: PerpsPriceLevel[];
};

export type PerpsPriceLevel = {
  id: string;
  price: bigint;
  isBid: boolean;
  orderCount: number;
  totalQuantity: bigint;
};

export type PerpsPriceLevelRow = {
  id: string;
  price: string;
  isBid: boolean;
  orderCount: number;
  totalQuantity: string;
};

type PerpsOrderBookResponse = {
  _meta: {
    block: {
      number: number;
      timestamp: string;
    };
  };
  book: PerpsPriceLevelRow[];
};
