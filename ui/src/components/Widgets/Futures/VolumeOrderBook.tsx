import { useMemo, useState } from "react";
import styled from "@mui/material/styles/styled";
import { tokens } from "../../../styles/tokens";
import type { OrderBookRow } from "./ClassicOrderBook";
import type { ContractMode } from "../../../types/types";

interface VolumeOrderBookProps {
  rows: OrderBookRow[];
  contractMode?: ContractMode;
  onRowClick?: (price: string, amount: number | null) => void;
  marketPrice: number | null;
}

type DerivedLevel = {
  price: number;
  units: number;
  size: number;
  total: number;
  highlight: boolean;
};

// Size/Total are notional values (quantity * price), which are large, so use
// compact notation (e.g. 15.04K, 17.5M) to match the Binance-style layout.
const formatVolume = (value: number): string =>
  value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });

// Full-precision notional for the tooltip (e.g. 105,877.29).
const formatFull = (value: number): string =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

type TooltipState = {
  price: number;
  total: number;
  distancePct: number | null;
  x: number;
  y: number;
};

export const VolumeOrderBook = ({ rows, onRowClick, marketPrice }: VolumeOrderBookProps) => {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  // Compute cumulative totals once per order book update (not per row).
  const { asks, bids, maxAskSize, maxBidSize, maxAskTotal, maxBidTotal } = useMemo(() => {
    // Input rows are sorted high -> low price.
    const askRows = rows.filter((r) => r.askUnits && r.askUnits > 0);
    const bidRows = rows.filter((r) => r.bidUnits && r.bidUnits > 0);

    // Ask cumulative: iterate from best ask (lowest price = last element)
    // towards higher prices. Preserve high -> low order for rendering.
    // Size is notional (units * price); Total is the cumulative sum of Size.
    const asks: DerivedLevel[] = new Array(askRows.length);
    let askRunningTotal = 0;
    let maxAskSize = 0;
    for (let i = askRows.length - 1; i >= 0; i--) {
      const units = askRows[i].askUnits as number;
      const size = units * askRows[i].price;
      askRunningTotal += size;
      if (size > maxAskSize) maxAskSize = size;
      asks[i] = {
        price: askRows[i].price,
        units,
        size,
        total: askRunningTotal,
        highlight: Boolean(askRows[i].highlightAsk),
      };
    }
    // Top row (highest ask) holds the largest cumulative total.
    const maxAskTotal = asks.length > 0 ? asks[0].total : 0;

    // Bid cumulative: iterate from best bid (highest price = first element)
    // towards lower prices.
    let bidRunningTotal = 0;
    let maxBidSize = 0;
    const bids: DerivedLevel[] = bidRows.map((r) => {
      const units = r.bidUnits as number;
      const size = units * r.price;
      bidRunningTotal += size;
      if (size > maxBidSize) maxBidSize = size;
      return {
        price: r.price,
        units,
        size,
        total: bidRunningTotal,
        highlight: Boolean(r.highlightBid),
      };
    });
    // Bottom row (lowest bid) holds the largest cumulative total.
    const maxBidTotal = bids.length > 0 ? bids[bids.length - 1].total : 0;

    return { asks, bids, maxAskSize, maxBidSize, maxAskTotal, maxBidTotal };
  }, [rows]);

  const renderRow = (level: DerivedLevel, side: "ask" | "bid") => {
    const maxSize = side === "ask" ? maxAskSize : maxBidSize;
    const maxTotal = side === "ask" ? maxAskTotal : maxBidTotal;
    const sizeWidth = maxSize > 0 ? Math.min(100, (level.size / maxSize) * 100) : 0;
    const totalWidth = maxTotal > 0 ? Math.min(100, (level.total / maxTotal) * 100) : 0;

    const showTooltip = (e: React.MouseEvent) => {
      const distancePct =
        marketPrice != null && marketPrice !== 0
          ? ((level.price - marketPrice) / marketPrice) * 100
          : null;
      setTooltip({ price: level.price, total: level.total, distancePct, x: e.clientX, y: e.clientY });
    };

    return (
      <Row
        key={`${side}-${level.price}`}
        $side={side}
        $highlight={level.highlight}
        onClick={() => onRowClick?.(level.price.toFixed(2), level.units)}
        onMouseEnter={showTooltip}
        onMouseMove={showTooltip}
        onMouseLeave={() => setTooltip(null)}
      >
        <DimLayer $side={side} $width={totalWidth} />
        <BrightLayer $side={side} $width={sizeWidth} />
        <PriceCol $side={side}>{level.price.toFixed(2)}</PriceCol>
        <SizeCol>{formatVolume(level.size)}</SizeCol>
        <TotalCol>{formatVolume(level.total)}</TotalCol>
      </Row>
    );
  };

  // Best price = the order-book level (best ask or best bid) closest to the
  // market price. Its color/arrow reflects whether it sits above or below the
  // market price.
  const bestAsk = asks.length > 0 ? asks[asks.length - 1].price : null;
  const bestBid = bids.length > 0 ? bids[0].price : null;

  let bestPrice: number | null;
  if (bestAsk != null && bestBid != null && marketPrice != null) {
    bestPrice = Math.abs(bestAsk - marketPrice) <= Math.abs(bestBid - marketPrice) ? bestAsk : bestBid;
  } else {
    bestPrice = bestAsk ?? bestBid ?? marketPrice;
  }

  const isUp = bestPrice != null && marketPrice != null ? bestPrice >= marketPrice : true;

  return (
    <Container>
      <ColumnHeader>
        <span>Price</span>
        <span>Size</span>
        <span>Total</span>
      </ColumnHeader>

      <Section>{asks.map((level) => renderRow(level, "ask"))}</Section>

      <CenterRow>
        <span className={`best ${isUp ? "up" : "down"}`}>
          {bestPrice != null ? bestPrice.toFixed(2) : "—"}
          <span className="arrow">{isUp ? "↑" : "↓"}</span>
        </span>
        <span className="market">{marketPrice != null ? marketPrice.toFixed(2) : "—"}</span>
      </CenterRow>

      <Section>{bids.map((level) => renderRow(level, "bid"))}</Section>

      {tooltip && (
        <Tooltip
          style={{
            left: Math.max(8, tooltip.x - 236),
            top: tooltip.y + 12,
          }}
        >
          <div className="row">
            <span className="label">Price</span>
            <span className="value">{tooltip.price.toFixed(2)}</span>
          </div>
          <div className="row">
            <span className="label">Total</span>
            <span className="value">{formatFull(tooltip.total)}</span>
          </div>
          <div className="row">
            <span className="label">Distance from Market</span>
            <span className="value">
              {tooltip.distancePct != null
                ? `${tooltip.distancePct >= 0 ? "+" : ""}${tooltip.distancePct.toFixed(2)}%`
                : "—"}
            </span>
          </div>
        </Tooltip>
      )}
    </Container>
  );
};

const Container = styled("div")`
  width: 100%;
  display: flex;
  flex-direction: column;
`;

const ColumnHeader = styled("div")`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  position: sticky;
  top: -1px;
  z-index: 2;
  background-color: ${tokens.surface.panel};
  border-bottom: 1px solid ${tokens.overlay.white10};
  padding: 0.3rem 0.5rem;

  span {
    font-size: 0.65rem;
    font-weight: 600;
    color: ${tokens.text.secondary};
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  span:first-of-type {
    text-align: left;
  }

  span:not(:first-of-type) {
    text-align: right;
  }
`;

const Section = styled("div")`
  display: flex;
  flex-direction: column;
`;

const Row = styled("div")<{ $side: "ask" | "bid"; $highlight?: boolean }>`
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  align-items: center;
  height: 22px;
  padding: 0 0.5rem;
  cursor: pointer;
  font-size: 0.75rem;
  font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;

  ${(props) =>
    props.$highlight &&
    `box-shadow: inset 0 0 8px ${
      props.$side === "ask" ? tokens.trading.shortHighlightGlow : tokens.trading.longHighlightGlow
    };`}

  &:hover {
    background: ${tokens.overlay.white10};
  }
`;

// Dim background layer represents the cumulative Total. Rendered behind the
// bright layer, anchored to the right edge.
const DimLayer = styled("div")<{ $side: "ask" | "bid"; $width: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  z-index: 0;
  width: ${(props) => props.$width}%;
  background-color: ${(props) =>
    props.$side === "ask" ? tokens.trading.shortRowBg : tokens.trading.longRowBg};
`;

// Bright background layer represents the current Size at this price level.
const BrightLayer = styled("div")<{ $side: "ask" | "bid"; $width: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  z-index: 1;
  width: ${(props) => props.$width}%;
  background-color: ${(props) =>
    props.$side === "ask" ? tokens.trading.shortHighlightBg : tokens.trading.longHighlightBg};
`;

const PriceCol = styled("span")<{ $side: "ask" | "bid" }>`
  position: relative;
  z-index: 2;
  text-align: left;
  color: ${(props) => (props.$side === "ask" ? tokens.trading.short : tokens.trading.long)};
`;

const SizeCol = styled("span")`
  position: relative;
  z-index: 2;
  text-align: right;
  color: ${tokens.text.onDark};
`;

const TotalCol = styled("span")`
  position: relative;
  z-index: 2;
  text-align: right;
  color: ${tokens.text.onDark};
`;

const Tooltip = styled("div")`
  position: fixed;
  z-index: 1000;
  pointer-events: none;
  min-width: 224px;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  background-color: ${tokens.surface.panel};
  border: 1px solid ${tokens.overlay.white10};
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 0.15rem 0;
  }

  .label {
    font-size: 0.75rem;
    color: ${tokens.text.secondary};
  }

  .value {
    font-size: 0.8rem;
    font-weight: 600;
    font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
    color: ${tokens.text.onDark};
  }
`;

const CenterRow = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0.5rem;
  background-color: ${tokens.overlay.white05};
  border-top: 1px solid ${tokens.overlay.white10};
  border-bottom: 1px solid ${tokens.overlay.white10};

  .best {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 1.15rem;
    font-weight: 700;
    font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
  }

  .best.up {
    color: ${tokens.trading.long};
  }

  .best.down {
    color: ${tokens.trading.short};
  }

  .best .arrow {
    font-size: 0.95rem;
  }

  .market {
    font-size: 0.85rem;
    font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
    color: ${tokens.trading.info};
  }
`;
