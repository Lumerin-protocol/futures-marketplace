import { sumTradeFees } from "../../../lib/portfolioPnl";
import { graphqlRequest } from "../graphql";
import { WindowFeesQuery } from "../queries/futures";

/** `$feesFirst`: the most graph-node returns in one page. */
export const FEES_PAGE_SIZE = 1000;

/** `$feesAfterId` for the first page. Every trade id sorts after the empty byte string. */
export const FEES_FIRST_CURSOR = "0x";

/** One row of the `feesInWindow` slice. */
export interface WindowFeeRow {
  id: string;
  tradingFee: string;
  liquidationFee: string | null;
}

interface WindowFeesScope {
  /** Lowercased, as the subgraph stores it. */
  address: string;
  cutoff: number;
  /** Omitted for the futures subgraph, which is `graphqlRequest`'s default. */
  subgraphUrl?: string;
}

/**
 * Fees paid inside the window, given the first page of `feesInWindow` that a
 * request already carried.
 *
 * A full page may not be all of them, so the rest are paged in by id here. It is
 * the same deal the deep book makes: an extra request on the tick, paid only by
 * an account with more than a page of fee-bearing trades in the window.
 */
export const totalWindowFees = async (
  firstPage: readonly WindowFeeRow[],
  { address, cutoff, subgraphUrl }: WindowFeesScope,
): Promise<bigint> => {
  let total = sumTradeFees(firstPage);
  let page = firstPage;
  while (page.length === FEES_PAGE_SIZE) {
    const response = await graphqlRequest<{ feesInWindow: WindowFeeRow[] }>(
      WindowFeesQuery,
      { address, cutoff, feesFirst: FEES_PAGE_SIZE, feesAfterId: page[page.length - 1].id },
      subgraphUrl,
    );
    page = response.feesInWindow;
    total += sumTradeFees(page);
  }
  return total;
};
