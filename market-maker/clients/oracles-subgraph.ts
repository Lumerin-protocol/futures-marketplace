import { gql, request } from "graphql-request";

export class OraclesSubgraph {
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Fetch HashpriceUSD samples in `[startSeconds, endSeconds]`.
   *
   * The subgraph stores `HashpriceUsd` as a timeseries with `Timestamp` in
   * microseconds and `price` denominated in 8 decimals (see HashpriceUSD.sol).
   * We paginate on `timestamp_gte` to bypass graph-node's 5000-skip cap and
   * convert each sample to `{ date: seconds, price: 6-decimal USDC }` to match
   * what `getMarketPrice()` on the futures contract returns.
   */
  async getHistoricalPrices(startSeconds: number, endSeconds: number) {
    const startMicros = BigInt(startSeconds) * 1_000_000n;
    const endMicros = BigInt(endSeconds) * 1_000_000n;

    const out: { date: number; price: bigint }[] = [];
    const seen = new Set<string>();
    let cursor = startMicros.toString();

    while (true) {
      const res = await request<HistoricalPricesRes>(this.url, HistoricalPricesQuery, {
        from: cursor,
        to: endMicros.toString(),
        first: PAGE_SIZE,
      });
      const rows = res.hashpriceUsds;

      let added = 0;
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        out.push({
          date: Math.floor(Number(BigInt(row.timestamp) / 1_000_000n)),
          price: hashpriceUsdToCollateral(BigInt(row.price)),
        });
        added++;
      }

      if (rows.length < PAGE_SIZE) break;
      // Two rows can share a microsecond timestamp (rare, but possible across
      // BTC/USD and HashpriceBTC updates). When that happens, bump the cursor
      // past the last timestamp so we make forward progress; otherwise resume
      // from the last timestamp to also pick up duplicates that share it.
      cursor = added === 0
        ? (BigInt(rows[rows.length - 1].timestamp) + 1n).toString()
        : rows[rows.length - 1].timestamp;
    }

    return out;
  }

  async getCurrentPrice() {
    const res = await request<MarketPriceRes>(this.url, MarketPriceQuery);
    return {
      hashpriceIndex: hashpriceUsdToCollateral(BigInt(res.hashpriceUsds[0].price)),
    };
  }
}

const PAGE_SIZE = 1000;

const HistoricalPricesQuery = gql`
  query HistoricalPrices($from: Timestamp!, $to: Timestamp!, $first: Int!) {
    hashpriceUsds(
      orderBy: timestamp
      orderDirection: asc
      first: $first
      where: { timestamp_gte: $from, timestamp_lte: $to }
    ) {
      id
      price
      timestamp
    }
  }
`;

type HistoricalPricesRes = {
  hashpriceUsds: {
    id: string;
    price: string;
    timestamp: string;
  }[];
};

const MarketPriceQuery = gql`
  query MarketPrice {
    hashpriceUsds(orderBy: timestamp, orderDirection: desc, first: 1) {
      price
      timestamp
    }
  }
`;

type MarketPriceRes = {
  hashpriceUsds: {
    price: string;
    timestamp: string;
  }[];
};

// HashpriceUSD oracle returns 8-decimal USD; the futures contract scales to
// the collateral token's decimals (USDC = 6) before exposing it as the index
// price. Mirror that scaling so historical samples are comparable.
const HASHPRICE_USD_DECIMALS = 8n;
const COLLATERAL_DECIMALS = 6n;
const SCALE = 10n ** (HASHPRICE_USD_DECIMALS - COLLATERAL_DECIMALS);

function hashpriceUsdToCollateral(price: bigint): bigint {
  return price / SCALE;
}
