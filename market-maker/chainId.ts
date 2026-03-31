import { arbitrum, arbitrumSepolia, base, baseSepolia, hardhat } from "viem/chains";

const chains = {
  [arbitrumSepolia.id]: arbitrumSepolia,
  [arbitrum.id]: arbitrum,
  [baseSepolia.id]: baseSepolia,
  [base.id]: base,
  [hardhat.id]: hardhat,
} as const;

export function getChain(chainId: number) {
  const chain = chains[chainId as keyof typeof chains];
  if (!chain) {
    throw new Error(`Chain with id ${chainId} not supported`);
  }
  return chain;
}
