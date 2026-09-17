import { subgraphTimestampToMs } from "../../lib/chartCandles";
import type { AverageTick } from "../../lib/chartBars";
import { graphqlRequest } from "./graphql";

/** One page covers a month of hourly bars (744). */
const HOUR_PAGE_SIZE = 1000;

export type HourAggRow = {
  id: string | number;
  sum: string;
  count: string;
  timestamp: string;
};

export const hourAggToAverageTick = (row: HourAggRow): AverageTick => ({
  id: String(row.id),
  timeMs: subgraphTimestampToMs(row.timestamp),
  sum: Number(row.sum),
  count: Number(row.count),
});

/** Goldsky hour aggregations — one request, no tick paging. */
export async function fetchOracleHourAggRows(
  query: string,
  field: string,
  startMicros: string,
): Promise<HourAggRow[]> {
  const req = await graphqlRequest<Record<string, HourAggRow[]>>(
    query,
    { interval: "hour", first: HOUR_PAGE_SIZE, skip: 0, startTimestamp: startMicros },
    process.env.REACT_APP_SUBGRAPH_ORACLES_URL,
  );
  const start = BigInt(startMicros);
  return (req[field] ?? []).filter((row) => BigInt(row.timestamp) >= start);
}
