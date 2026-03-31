import { waitForAggregateBlockNumber, AGGREGATE_ORDER_BOOK_QK } from "../../hooks/data/useAggregateOrderBook";
import { waitForPerpsBlockNumber, PERPS_ORDER_BOOK_QK } from "../../hooks/data/perps/usePerpsOrderBook";
import type { QueryClient } from "@tanstack/react-query";
import type { ContractMode } from "../../types/types";

/**
 * Wait for the order book to sync to a specific block number based on contract mode
 */
export const waitForOrderBookBlockNumber = async (
  blockNumber: bigint,
  qc: QueryClient,
  contractMode: ContractMode,
  deliveryDate?: number,
) => {
  if (contractMode === "perpetual") {
    await waitForPerpsBlockNumber(blockNumber, qc);
  } else {
    await waitForAggregateBlockNumber(blockNumber, qc, deliveryDate);
  }
};

/**
 * Get the order book query key based on contract mode
 */
export const getOrderBookQueryKey = (contractMode: ContractMode) => {
  return contractMode === "perpetual" ? PERPS_ORDER_BOOK_QK : AGGREGATE_ORDER_BOOK_QK;
};
