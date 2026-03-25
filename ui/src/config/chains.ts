import { type Chain, arbitrum, arbitrumSepolia, baseSepolia, hardhat } from "viem/chains";
import { ArbitrumLogo, ArbitrumSepoliaLogo, BaseSepoliaLogo, HardhatLogo } from "../images";

export const chains = {
  [arbitrumSepolia.id]: arbitrumSepolia,
  [arbitrum.id]: arbitrum,
  [baseSepolia.id]: baseSepolia,
  [hardhat.id]: hardhat,
} as Record<number, Chain>;

const chain = chains[process.env.REACT_APP_CHAIN_ID];
if (!chain) {
  throw new Error(`Chain ${process.env.REACT_APP_CHAIN_ID} not supported`);
}

// Supported chains icons
export const chainIcons = {
  [arbitrum.id]: ArbitrumLogo,
  [arbitrumSepolia.id]: ArbitrumSepoliaLogo,
  [baseSepolia.id]: BaseSepoliaLogo,
  [hardhat.id]: HardhatLogo,
} as Record<number, React.ComponentType<React.SVGProps<SVGSVGElement>>>;

const ChainIcon = chainIcons[process.env.REACT_APP_CHAIN_ID as keyof typeof chainIcons];
if (!ChainIcon) {
  throw new Error(`Chain icon for ${process.env.REACT_APP_CHAIN_ID} not found`);
}

export { ChainIcon, chain };
