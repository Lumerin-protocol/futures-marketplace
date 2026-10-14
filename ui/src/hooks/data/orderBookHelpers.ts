import { AGGREGATE_ORDER_BOOK_QK } from "../../hooks/data/useAggregateOrderBook";
import { PERPS_ORDER_BOOK_QK } from "../../hooks/data/perps/usePerpsOrderBook";
import { waitForIndexedBlock } from "./snapshot/waitForIndexedBlock";
import type { QueryClient } from "@tanstack/react-query";
import type { ContractMode } from "../../types/types";

/**
 * Wait for the venue's subgraph to have indexed a specific block.
 *
 * `qc` and `expirationAt` are vestigial: this used to poll a particular order
 * book cache entry, which meant the futures path silently skipped waiting at
 * all when no expiration had been resolved. The indexed head is a property of
 * the subgraph, not of any one entry, so both arguments are ignored. They are
 * kept so the call sites read unchanged.
 */
export const waitForOrderBookBlockNumber = async (
  blockNumber: bigint,
  _qc: QueryClient,
  contractMode: ContractMode,
  _expirationAt?: number,
) => {
  await waitForIndexedBlock(contractMode, blockNumber);
};

/**
 * Get the order book query key based on contract mode
 */
export const getOrderBookQueryKey = (contractMode: ContractMode) => {
  return contractMode === "perpetual" ? PERPS_ORDER_BOOK_QK : AGGREGATE_ORDER_BOOK_QK;
};
