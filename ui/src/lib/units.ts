import { formatUnits } from "./formatUnits";

type Unit = {
  decimals: number;
  symbol: string;
  name: string;
};

type Value = {
  value: string;
  valueRounded: string;
  symbol: string;
  name: string;
  full: string;
};

const usdcToken: Unit = {
  decimals: 6,
  symbol: "USDC",
  name: "USDC Coin",
} as const;

const petahashPerSecond: Unit = {
  decimals: 15,
  symbol: "PH/s",
  name: "Petahash per second",
} as const;

export const paymentToken = usdcToken;

// Scaling factors for on-chain values. Payment-token values (USDC, prices,
// margins, balances, PnL, fees) and quantities are both stored with 6 decimals
// of precision on-chain. These constants should be used instead of hardcoded
// `1e6` / `1000000n` / `10 ** 6` literals.
export const PAYMENT_TOKEN_DECIMALS = paymentToken.decimals;
export const PAYMENT_TOKEN_SCALE = 10n ** BigInt(PAYMENT_TOKEN_DECIMALS);
export const PAYMENT_TOKEN_SCALE_NUM = 10 ** PAYMENT_TOKEN_DECIMALS;

export const QUANTITY_DECIMALS = 6;
export const QUANTITY_DECIMALS_BIGINT = BigInt(QUANTITY_DECIMALS);
export const QUANTITY_SCALE = 10n ** QUANTITY_DECIMALS_BIGINT;
export const QUANTITY_SCALE_NUM = 10 ** QUANTITY_DECIMALS;

export const formatHashratePHPS = (speedHashPerSecond: string | bigint): Value => {
  return formatValue(speedHashPerSecond, petahashPerSecond);
};

export const formatValue = (units: string | bigint, token: Unit) => {
  const { full, unrounded } = formatUnits(BigInt(units), token.decimals, {
    maxChars: 5,
  });
  return {
    value: unrounded,
    valueRounded: full,
    symbol: token.symbol,
    name: token.name,
    full: `${full} ${token.symbol}`,
  };
};
