import { request, gql } from "graphql-request";
import { getAddress } from "viem/utils";
import { abs } from "./lib.ts";

export class Subgraph {
  private apiKey: string;
  private url: string;

  constructor(url: string, apiKey?: string) {
    this.apiKey = apiKey ?? "";
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

  async getCurrentOrders(deliveryDate: bigint, address: `0x${string}`) {
    const res = await request<CurrentOrdersRes>(this.url, CurrentOrdersQuery, {
      addr: address,
      deliveryAt: deliveryDate.toString(),
    });
    const orderPriceToQty = new Map<bigint, bigint>();
    for (const order of res.orders) {
      const price = BigInt(order.pricePerDay);
      const qty = order.isBuy ? 1n : -1n;
      orderPriceToQty.set(price, (orderPriceToQty.get(price) ?? 0n) + qty);
    }
    return Array.from(orderPriceToQty.entries())
      .map(([price, qty]) => ({
        price: price,
        qty: qty,
      }))
      .sort((a, b) => Number(a.price - b.price));
  }

  async getCurrentPosition(deliveryDate: bigint, address: `0x${string}`) {
    const res = await request<CurrentPositionRes>(this.url, CurrentPositionQuery, {
      addr: address,
      deliveryAt: deliveryDate.toString(),
    });
    let position = 0n;
    let totalPrice = 0n;
    for (const pos of res.positions) {
      if (getAddress(pos.seller.id) === getAddress(address)) {
        position -= 1n;
        totalPrice += BigInt(pos.sellPricePerDay);
      } else {
        position += 1n;
        totalPrice += BigInt(pos.buyPricePerDay);
      }
    }
    return {
      position: position,
      averagePrice: position !== 0n ? totalPrice / abs(position) : 0n,
    };
  }
}

export type Order = { price: bigint; qty: bigint };

export const HistoricalPricesQuery = gql`
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

export const MarketPriceQuery = gql`
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

export const CurrentPositionQuery = gql`
  query CurrentPosition($addr: String, $deliveryAt: BigInt) {
    positions(
      where: {
        and: [
          { deliveryAt: $deliveryAt, isActive: true, closedAt: null }
          { or: [{ buyer: $addr }, { seller: $addr }] }
        ]
      }
    ) {
      id
      seller {
        id
      }
      buyer {
        id
      }
      sellPricePerDay
      buyPricePerDay
    }
  }
`;

type CurrentPositionRes = {
  positions: {
    id: string;
    seller: {
      id: string;
    };
    buyer: {
      id: string;
    };
    sellPricePerDay: string;
    buyPricePerDay: string;
  }[];
};

export const CurrentOrdersQuery = gql`
  query CurrentOrders($deliveryAt: BigInt, $addr: String) {
    orders(where: { deliveryAt: $deliveryAt, participant: $addr, isActive: true, closedAt: null }) {
      id
      isBuy
      pricePerDay
      isActive
    }
  }
`;

type CurrentOrdersRes = {
  orders: {
    id: string;
    isBuy: boolean;
    pricePerDay: string;
    isActive: boolean;
  }[];
};

const SECONDS_PER_DAY = 3600n * 24n;

function hashesForTokenToPrice(hashesForToken: bigint) {
  return (SECONDS_PER_DAY * 100n * 10n ** 12n) / hashesForToken;
}
