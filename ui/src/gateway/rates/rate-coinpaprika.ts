import type { Rates } from "./interfaces";

/**
 * Returns ETH and BTC prices in USD from coinpaprika api
 */
export const getRateCoinpaprika = async (): Promise<Rates> => {
  const baseUrl = "https://api.coinpaprika.com";

  const [ETH, BTC] = await Promise.all(
    ["eth-ethereum", "btc-bitcoin"].map(async (coin) => {
      const res = await fetch(`${baseUrl}/v1/tickers/${coin}`);
      const data = await res.json();
      const price = data?.quotes?.USD?.price;
      if (!price) {
        throw new Error(`invalid price response for ${coin} from coinpaprika: ${data}`);
      }
      return price;
    }),
  );

  return { ETH, BTC };
};
