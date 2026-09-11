/** Generic subgraph / indexer response wrapper used by futures/perps queries. */
export type GetResponse<T> = {
  data: T;
  blockNumber: number;
};
