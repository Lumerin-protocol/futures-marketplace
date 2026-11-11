/**
 * Every non-obvious header in the futures and perps trading tables.
 * `ColumnHeader` is the only reader; add a column's hint here rather than
 * inline on the `<th>`.
 */
export const COLUMN_HINTS = {
  marginFutures:
    "Initial margin this delivery date accounts for, in USDC — how much the account's requirement would fall without it. Collateral is pooled across every expiry and the perps venue, so these do not add up to Margin Used, and a hedging leg accounts for none of it.",
  marginPerps:
    "Initial margin this position accounts for, in USDC — how much the account's requirement would fall if it were closed. Collateral is pooled across futures and perps, so a leg that hedges the rest of the book can account for none of it.",
  marginOrder:
    "Initial margin this order accounts for, in USDC — the margin cancelling it would free. An order that hedges the rest of the book can account for none of it.",
  realizedPnl:
    "Net of trading and liquidation fees, in USDC. Positive is a gain.",
  realizedPnlSession:
    "Net of trading and liquidation fees, in USDC. Positive is a gain. Funding is not included.",
  unrealizedPnl:
    "Open profit or loss at the current mark, in USDC. Positive is a gain. It settles only when the position closes.",
  feesFT:
    "F is the funding fee and T is the trading fee, both in USDC, written as funding / trading. − means you paid that fee; + means you received it.",
  tradingFee:
    "Fee on this fill, in USDC. A positive amount was paid; a negative amount is a rebate.",
  filledOverQuantity: "Contracts filled so far, then the order's full size.",
  filledOverSize: "USDC notional filled so far, then the order's full notional.",
  sizeOverMax:
    "Current notional size, then the largest notional this session reached, both in USDC.",
  sizeUsdc: "Notional size, price times quantity, in USDC.",
  entryPrice: "Average price the position was opened at, in USDC.",
  entryPriceAfter: "Average entry price of the position after this fill, in USDC.",
  closePrice: "Price the position was closed at, in USDC.",
  orderPrice: "Limit price of the order, in USDC.",
  positionPrice: "Average entry price of the position, in USDC.",
  tradePrice: "Price of this fill, in USDC.",
  quantity: "Number of contracts.",
  maxQuantity: "Most contracts the position held.",
  closeReason: "How the position ended: closed by a trade, settled at expiry, or liquidated.",
} as const;

export type ColumnHint = keyof typeof COLUMN_HINTS;
