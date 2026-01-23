import { gql, request } from "graphql-request";

export class OraclesSubgraph {
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  async getHistoricalPrices(startSeconds: number, endSeconds: number) {
    const res: HistoricalPricesRes = await request(this.url, HistoricalPricesQuery, {
      from: startSeconds,
      to: endSeconds,
    });

    return res.hashrateIndexes.map((item) => ({
      date: Number(item.updatedAt),
      price: hashesForTokenToPrice(BigInt(item.hashesForToken)),
    }));
  }

  async getCurrentPrice() {
    const res = await request<MarketPriceRes>(this.url, MarketPriceQuery);
    return {
      hashpriceIndex: BigInt(res.hashrateIndexes[0].hashesForToken),
    };
  }
}

const HistoricalPricesQuery = gql`
  query MyQuery($from: BigInt!, $to: BigInt!) {
    hashrateIndexes(
      orderBy: updatedAt
      orderDirection: asc
      where: { updatedAt_gt: $from, updatedAt_lte: $to }
    ) {
      id
      hashesForToken
      updatedAt
    }
  }
`;

type HistoricalPricesRes = {
  hashrateIndexes: {
    id: number;
    hashesForToken: string;
    updatedAt: string;
  }[];
};

const MarketPriceQuery = gql`
  query MyQuery {
    hashrateIndexes(orderBy: updatedAt, orderDirection: desc, first: 1) {
      hashesForToken
      updatedAt
    }
  }
`;

type MarketPriceRes = {
  hashrateIndexes: {
    hashesForToken: string;
    updatedAt: string;
  }[];
};

const SECONDS_PER_DAY = 3600n * 24n;

function hashesForTokenToPrice(hashesForToken: bigint) {
  return (SECONDS_PER_DAY * 100n * 10n ** 12n) / hashesForToken;
}
