import { graphqlRequest } from "./graphql";
import { QueryClient, useQuery } from "@tanstack/react-query";
import type { GetResponse } from "../../gateway/interfaces";
import { AggregateOrderBookQuery } from "./graphql-queries";

export const AGGREGATE_ORDER_BOOK_QK = "AggregateOrderBook";

export const useAggregateOrderBook = (
  deliveryDate: number | undefined,
  props?: { refetch?: boolean; interval?: number },
) => {
  const query = useQuery({
    queryKey: [AGGREGATE_ORDER_BOOK_QK, deliveryDate],
    queryFn: () => fetchAggregateOrderBookAsync(deliveryDate),
    enabled: !!deliveryDate,
    refetchInterval: props?.interval ?? 10000,
    refetchIntervalInBackground: true,
  });

  return query;
};

const PAGE_SIZE = 100;

const EMPTY_RESULT = { data: { priceLevels: [] } as AggregateOrderBook, blockNumber: 0 };

const fetchAggregateOrderBookAsync = async (deliveryDate: number | undefined) => {
  // Defensive guard: TanStack Query's `invalidateQueries({ queryKey: [AGGREGATE_ORDER_BOOK_QK] })`
  // (used in PlaceOrderForm / CloseOrderForm / ModifyOrderForm post-confirmation hooks)
  // refetches active observers even when `enabled: false`, so we may be entered with no
  // delivery date selected (e.g. before `useGetDeliveryDates()` resolves). The indexer's
  // `priceLevels` collection is keyed by `(deliveryAt, price, side)` and `$deliveryAt`
  // is non-nullable, so sending `undefined` produces a hard GraphQL error.
  if (deliveryDate === undefined) return EMPTY_RESULT;

  const priceLevels: AggregatePriceLevel[] = [];
  let lastId = "";
  let blockNumber = 0;

  while (true) {
    const response = await graphqlRequest<AggregateOrderBookResponse>(AggregateOrderBookQuery, {
      deliveryAt: deliveryDate,
      first: PAGE_SIZE,
      lastId,
    });

    blockNumber = response._meta.block.number;

    for (const level of response.priceLevels) {
      priceLevels.push({
        id: level.id,
        price: BigInt(level.price),
        isBid: level.isBid,
        deliveryAt: BigInt(level.deliveryAt),
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

export const waitForAggregateBlockNumber = async (blockNumber: bigint, qc: QueryClient, deliveryDate?: number) => {
  // Without a delivery date there's no specific aggregate cache slot to poll; the
  // caller is post-tx but the form never resolved a delivery context (e.g. cancel
  // path on perps). Skip the wait — the matching tx-side invalidator still runs.
  if (deliveryDate === undefined) return;

  const delay = 1000;
  const maxAttempts = 30; // 30 attempts with 1s delay = max 30 seconds wait

  let attempts = 0;
  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    // Force a fresh fetch of the data
    await qc.refetchQueries({ queryKey: [AGGREGATE_ORDER_BOOK_QK, deliveryDate] });

    const data = qc.getQueryData<GetResponse<AggregateOrderBook>>([AGGREGATE_ORDER_BOOK_QK, deliveryDate]);
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
  deliveryAt: bigint;
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
    deliveryAt: string;
    totalQuantity: number;
  }[];
};
