import styled from "@mui/material/styles/styled";
import { tokens } from "../../../styles/tokens";
import type { OrderBookData } from "./orderBookHelpers";
import type { ContractMode } from "../../../types/types";

export type OrderBookRow = OrderBookData & {
  highlightBid?: boolean;
  highlightAsk?: boolean;
};

interface ClassicOrderBookProps {
  rows: OrderBookRow[];
  maxBidAmount: number;
  maxAskAmount: number;
  contractMode?: ContractMode;
  onRowClick?: (price: string, amount: number | null) => void;
}

export const ClassicOrderBook = ({
  rows,
  maxBidAmount,
  maxAskAmount,
  contractMode = "futures",
  onRowClick,
}: ClassicOrderBookProps) => {
  return (
    <Table>
      <thead>
        <tr>
          <th>Bid</th>
          <th>Price</th>
          <th>Ask</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          // Calculate fill percentages for bid and ask
          const bidFillPercent = row.bidUnits && maxBidAmount > 0 ? (row.bidUnits / maxBidAmount) * 100 : 0;
          const askFillPercent = row.askUnits && maxAskAmount > 0 ? (row.askUnits / maxAskAmount) * 100 : 0;

          return (
            <TableRow
              key={row.price}
              $bidFillPercent={bidFillPercent}
              $askFillPercent={askFillPercent}
              onClick={() => {
                // Use askUnits if available, otherwise bidUnits, otherwise null
                const amount = row.askUnits || row.bidUnits || null;
                onRowClick?.(row.price.toFixed(2), amount);
              }}
            >
              <BidCell $isHighlighted={row.highlightBid}>
                {row.bidUnits
                  ? contractMode === "perpetual"
                    ? (row.bidUnits * row.price).toFixed(2)
                    : `${row.bidUnits} (${(row.bidUnits * row.price).toFixed(2)})`
                  : ""}
              </BidCell>
              <PriceCell $isLastHashprice={row.isLastHashprice}>{row.price.toFixed(2)}</PriceCell>
              <AskCell $isHighlighted={row.highlightAsk}>
                {row.askUnits
                  ? contractMode === "perpetual"
                    ? (row.askUnits * row.price).toFixed(2)
                    : `${row.askUnits} (${(row.askUnits * row.price).toFixed(2)})`
                  : ""}
              </AskCell>
            </TableRow>
          );
        })}
      </tbody>
    </Table>
  );
};

const Table = styled("table")`
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;

  th {
    text-align: center;
    padding: 0.3rem 0.4rem;
    font-size: 0.65rem;
    font-weight: 600;
    color: ${tokens.text.secondary};
    border-bottom: 1px solid ${tokens.overlay.white10};
    position: sticky;
    top: -1px;
    background-color: ${tokens.surface.panel};
    z-index: 2;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    width: 33.33%;
  }

  td {
    text-align: center;
    padding: 0.15rem 0.4rem;
    font-size: 0.75rem;
    color: ${tokens.text.onDark};
    height: 20px;
    line-height: 20px;
    width: 33.33%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

const TableRow = styled("tr")<{
  $bidFillPercent?: number;
  $askFillPercent?: number;
}>`
  position: relative;
  cursor: pointer;
  border-bottom: 1px solid ${tokens.overlay.white05};
  
  /* Background fills for order book depth visualization */
  background: ${(props) => {
    const bidFill = props.$bidFillPercent || 0;
    const askFill = props.$askFillPercent || 0;

    // Both bid and ask fills - split gradient
    if (bidFill > 0 && askFill > 0) {
      // Bid fills from center-left to left, Ask fills from center-right to right
      // Using 33% as bid column width, 33% center, 33% ask column width
      const bidStart = 33 - bidFill * 0.33;
      const askEnd = 67 + askFill * 0.33;
      return `linear-gradient(
        to right,
        transparent 0%,
        transparent ${bidStart}%,
        ${tokens.trading.longRowBgAlt} ${bidStart}%,
        ${tokens.trading.longRowBgAlt} 33%,
        transparent 33%,
        transparent 67%,
        ${tokens.trading.shortRowBgAlt} 67%,
        ${tokens.trading.shortRowBgAlt} ${askEnd}%,
        transparent ${askEnd}%,
        transparent 100%
      )`;
    }

    // Only bid fill - green from right edge of bid column
    if (bidFill > 0) {
      const bidStart = 33 - bidFill * 0.33;
      return `linear-gradient(
        to right,
        transparent 0%,
        transparent ${bidStart}%,
        ${tokens.trading.longRowBgAlt} ${bidStart}%,
        ${tokens.trading.longRowBgAlt} 33%,
        transparent 33%,
        transparent 100%
      )`;
    }

    // Only ask fill - red from left edge of ask column
    if (askFill > 0) {
      const askEnd = 67 + askFill * 0.33;
      return `linear-gradient(
        to right,
        transparent 0%,
        transparent 67%,
        ${tokens.trading.shortRowBgAlt} 67%,
        ${tokens.trading.shortRowBgAlt} ${askEnd}%,
        transparent ${askEnd}%,
        transparent 100%
      )`;
    }

    return "transparent";
  }};
  
  &:hover {
    background: ${tokens.overlay.white10} !important;
  }
  
  &:last-child {
    border-bottom: none;
  }
`;

const BidCell = styled("td")<{ $isHighlighted?: boolean }>`
  border-right: 1px solid ${tokens.overlay.white05};
  background-color: ${(props) => (props.$isHighlighted ? tokens.trading.longHighlightBg : "transparent")};
  ${(props) =>
    props.$isHighlighted &&
    `
    box-shadow: inset 0 0 8px ${tokens.trading.longHighlightGlow};
  `}
`;

const AskCell = styled("td")<{ $isHighlighted?: boolean }>`
  border-left: 1px solid ${tokens.overlay.white05};
  background-color: ${(props) => (props.$isHighlighted ? tokens.trading.shortHighlightBg : "transparent")};
  ${(props) =>
    props.$isHighlighted &&
    `
    box-shadow: inset 0 0 8px ${tokens.trading.shortHighlightGlow};
  `}
`;

const PriceCell = styled("td")<{ $isLastHashprice?: boolean }>`
  background-color: ${(props) => (props.$isLastHashprice ? tokens.trading.infoHighlightBg : "transparent")};
  font-weight: ${(props) => (props.$isLastHashprice ? "700" : "normal")};
  font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
  position: relative;
  
  ${(props) =>
    props.$isLastHashprice &&
    `
    box-shadow: 0 0 8px ${tokens.trading.infoHighlightGlow};
    outline: 1px solid ${tokens.trading.infoBorder};
    outline-offset: -1px;
  `}
`;
