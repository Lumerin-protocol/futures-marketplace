import { graphqlRequest } from "./graphql";

const PAGE_SIZE = 1000;
/** 1D is ~390 ticks; never walk a month of ticks even if a caller passes a wide window. */
const MAX_PAGES = 2;

/**
 * Walk a timeseries newest-first by timestamp cursor. `skip` tops out around
 * 5000 on graph-node, which is not enough for a month of oracle ticks.
 */
export async function paginateOracleTicks<T extends { timestamp: string }>(
  query: string,
  field: string,
  startMicros: string,
): Promise<T[]> {
  const start = BigInt(startMicros);
  let cursor = (BigInt(Date.now()) * 1000n + 1_000_000n).toString();
  const all: T[] = [];

  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    const req = await graphqlRequest<Record<string, T[]>>(
      query,
      { startDate: startMicros, cursor, first: PAGE_SIZE },
      process.env.REACT_APP_SUBGRAPH_ORACLES_URL,
    );
    const page = req[field] ?? [];
    if (page.length === 0) break;
    all.push(...page);
    const oldest = page[page.length - 1];
    if (page.length < PAGE_SIZE || BigInt(oldest.timestamp) <= start) break;
    if (oldest.timestamp === cursor) break;
    cursor = oldest.timestamp;
  }

  return all.filter((row) => BigInt(row.timestamp) >= start);
}
