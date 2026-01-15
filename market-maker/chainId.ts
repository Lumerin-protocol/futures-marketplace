import { arbitrum, arbitrumSepolia, hardhat } from "viem/chains";

const chains = {
  [arbitrumSepolia.id]: arbitrumSepolia,
  [arbitrum.id]: arbitrum,
  [hardhat.id]: hardhat,
} as const;

export function getChain(chainId: number) {
  const chain = chains[chainId as keyof typeof chains];
  if (!chain) {
    throw new Error(`Chain with id ${chainId} not supported`);
  }
  return chain;
}
