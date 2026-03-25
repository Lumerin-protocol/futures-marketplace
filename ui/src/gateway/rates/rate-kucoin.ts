import type { Rates } from "./interfaces";

/**
 * Returns ETH and BTC prices in USD from kucoin api
 */
export const getRateKucoin = async (): Promise<Rates> => {
  const baseUrl = "https://api.kucoin.com/api";

  const [ETH, BTC] = await Promise.all(
    ["ETH-USDT", "BTC-USDC"].map(async (pair) => {
      const searchParams = new URLSearchParams();
      searchParams.append("symbol", pair);

      const res = await fetch(`${baseUrl}/v1/market/orderbook/level1?${searchParams.toString()}`);
      const data = await res.json();

      const price = Number(data?.data?.price);
      if (!price) {
        throw new Error(`invalid price response for ${pair} from kucoin: ${data}`);
      }
      return price;
    }),
  );

  return { ETH, BTC };
};
