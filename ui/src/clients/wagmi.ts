import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { konekt } from "konekt-ui/wagmi";
import { chain } from "../config/chains";

const projectId = process.env.REACT_APP_WALLET_CONNECT_ID;

// Connector is registered up front; Konekt itself is imported and
// `Provider.init()` runs only when wagmi first asks for the provider
// (reconnect or a connect click). No relay socket unless a saved session exists.
export const config = createConfig({
  chains: [chain],
  connectors: [
    injected(),
    konekt({
      projectId,
      metadata: {
        name: "Lumerin Marketplace",
        description: "Buy, sell, and own hashpower through your Web3 wallet",
        url: process.env.REACT_APP_URL,
        icons: ["https://avatars.githubusercontent.com/u/179229932"],
      },
    }),
  ],
  transports: {
    [chain.id]: http(process.env.REACT_APP_READ_ONLY_ETH_NODE_URL, { retryCount: 0 }),
  },
  // wagmi already aggregates contract reads through Multicall3, but its default
  // window is one microtask, so reads that resolve a few milliseconds apart each
  // get their own request: a cold load was measured sending 11 multicalls for 33
  // reads, none of them anywhere near the size cap. A window wide enough to span
  // the hooks settling collapses those into a handful, at the cost of up to
  // `wait` milliseconds of latency on a read that would otherwise go alone.
  batch: { multicall: { wait: 50 } },
});
