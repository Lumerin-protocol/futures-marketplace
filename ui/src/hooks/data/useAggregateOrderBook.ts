import { graphqlRequest } from "./graphql";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { GetResponse } from "../../gateway/interfaces";
import { AggregateOrderBookQuery } from "./graphql-queries";

export const AGGREGATE_ORDER_BOOK_QK = "AggregateOrderBook";

export const useAggregateOrderBook = (
  expirationAt: number | undefined,
  props?: { refetch?: boolean; interval?: number },
) => {
  const query = useQuery({
    queryKey: [AGGREGATE_ORDER_BOOK_QK, expirationAt],
    queryFn: () => fetchAggregateOrderBookAsync(expirationAt),
    enabled: !!expirationAt,
    refetchInterval: props?.interval ?? 10000,
    refetchIntervalInBackground: true,
  });

  return query;
};

const PAGE_SIZE = 100;

const EMPTY_RESULT = { data: { priceLevels: [] } as AggregateOrderBook, blockNumber: 0 };

const fetchAggregateOrderBookAsync = async (expirationAt: number | undefined) => {
  // Defensive guard: TanStack Query's `invalidateQueries({ queryKey: [AGGREGATE_ORDER_BOOK_QK] })`
  // (used in PlaceOrderForm / CloseOrderForm / ModifyOrderForm post-confirmation hooks)
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
      first: PAGE_SIZE,
      lastId,
    });

    blockNumber = response._meta.block.number;

    for (const level of response.priceLevels) {
      priceLevels.push({
        id: level.id,
        price: BigInt(level.price),
        isBid: level.isBid,
        expirationAt: BigInt(level.expirationAt),
        totalQuantity: level.totalQuantity,
      });
    }

    if (response.priceLevels.length < PAGE_SIZE) break;
    lastId = response.priceLevels[response.priceLevels.length - 1].id;
  }

  const data: AggregateOrderBook = { priceLevels };

  return {
    data,
    blockNumber,
  };
};

export const waitForAggregateBlockNumber = async (blockNumber: bigint, qc: QueryClient, expirationAt?: number) => {
  // Without a expiration date there's no specific aggregate cache slot to poll; the
  // caller is post-tx but the form never resolved a delivery context (e.g. cancel
  // path on perps). Skip the wait — the matching tx-side invalidator still runs.
  if (expirationAt === undefined) return;

  const delay = 1000;
  const maxAttempts = 30; // 30 attempts with 1s delay = max 30 seconds wait

  let attempts = 0;
  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    // Force a fresh fetch of the data
    await qc.refetchQueries({ queryKey: [AGGREGATE_ORDER_BOOK_QK, expirationAt] });

    const data = qc.getQueryData<GetResponse<AggregateOrderBook>>([AGGREGATE_ORDER_BOOK_QK, expirationAt]);
    const currentBlock = data?.blockNumber;

    if (currentBlock !== undefined && currentBlock >= Number(blockNumber)) {
      return;
    }
    attempts++;
  }

  throw new Error(`Timeout waiting for block number ${blockNumber}`);
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

type AggregateOrderBookResponse = {
  _meta: {
    block: {
      number: number;
      timestamp: string;
    };
  };
  priceLevels: {
    id: string;
    price: string;
    isBid: boolean;
    expirationAt: string;
    totalQuantity: number;
  }[];
};
