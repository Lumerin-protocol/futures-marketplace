import { parseAbi } from "viem";

export { erc20Abi } from "viem";

/** The slice of HashPowerFutures the tests read. */
export const futuresAbi = parseAbi([
  "function vault() view returns (address)",
  "function getMarketPrice() view returns (uint256)",
  "function getExpirationDates() view returns (uint256[])",
]);

/** What HashPowerFutures and HashPowerPerpsDEX both expose and the tests read. */
export const venueAbi = parseAbi(["function minimumPriceIncrement() view returns (uint256)"]);

/** The slice of CollateralVault the tests read or top up through. */
export const vaultAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function collateralToken() view returns (address)",
  "function deposit(uint256 amount)",
]);
