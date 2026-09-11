import { graphqlRequest } from "../graphql";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { GetResponse } from "../../../gateway/interfaces";
import { PerpsOrderBookQuery } from "./graphql-queries";

export const PERPS_ORDER_BOOK_QK = "PerpsOrderBook";

export const usePerpsOrderBook = (props?: { refetch?: boolean; interval?: number }) => {
  const query = useQuery({
    queryKey: [PERPS_ORDER_BOOK_QK],
    queryFn: () => fetchPerpsOrderBookAsync(),
    refetchInterval: props?.interval ?? 10000,
    refetchIntervalInBackground: true,
  });

  return query;
};

const PAGE_SIZE = 100;

const fetchPerpsOrderBookAsync = async () => {
  const priceLevels: PerpsPriceLevel[] = [];
  let lastId = "";
  let blockNumber = 0;

  while (true) {
    const response = await graphqlRequest<PerpsOrderBookResponse>(
      PerpsOrderBookQuery,
      { first: PAGE_SIZE, lastId },
      process.env.REACT_APP_SUBGRAPH_PERPS_URL,
    );

    blockNumber = response._meta.block.number;

    for (const level of response.priceLevels) {
      priceLevels.push({
        id: level.id,
        price: BigInt(level.price),
        isBid: level.isBid,
        orderCount: level.orderCount,
        totalQuantity: BigInt(level.totalQuantity),
      });
    }

    if (response.priceLevels.length < PAGE_SIZE) break;
    lastId = response.priceLevels[response.priceLevels.length - 1].id;
  }

  const data: PerpsOrderBook = { priceLevels };

  return {
    data,
    blockNumber,
  };
};

export const waitForPerpsBlockNumber = async (blockNumber: bigint, qc: QueryClient) => {
  const delay = 1000;
  const maxAttempts = 30; // 30 attempts with 1s delay = max 30 seconds wait

  let attempts = 0;
  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    // Force a fresh fetch of the data
    await qc.refetchQueries({ queryKey: [PERPS_ORDER_BOOK_QK] });

    const data = qc.getQueryData<GetResponse<PerpsOrderBook>>([PERPS_ORDER_BOOK_QK]);
    const currentBlock = data?.blockNumber;

    if (currentBlock !== undefined && currentBlock >= Number(blockNumber)) {
      return;
    }
    attempts++;
  }

  throw new Error(`Timeout waiting for block number ${blockNumber}`);
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

type PerpsOrderBookResponse = {
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
    orderCount: number;
    totalQuantity: string;
  }[];
};
