import { type Chain, defineChain } from "viem";
import { arbitrum, arbitrumSepolia, base, baseSepolia, hardhat } from "viem/chains";

const KNOWN_CHAINS: Chain[] = [baseSepolia, base, arbitrumSepolia, arbitrum, hardhat];

/** The viem chain for `chainId`, always talking to `rpcUrl`. */
export function chainFor(chainId: number, rpcUrl: string): Chain {
  const known = KNOWN_CHAINS.find((chain) => chain.id === chainId);
  const chain =
    known ??
    defineChain({
      id: chainId,
      name: `Chain ${chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
  return { ...chain, rpcUrls: { default: { http: [rpcUrl] } } };
}

/** Origin only: provider URLs such as Alchemy carry the API key in the path. */
export function redactRpcUrl(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).origin;
  } catch {
    return "(invalid url)";
  }
}
