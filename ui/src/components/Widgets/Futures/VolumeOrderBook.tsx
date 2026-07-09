import { useEffect, useMemo, useRef, useState } from "react";
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

// Number of empty placeholder rows padded above the asks and below the bids so
// the ladder always extends past the outermost real level.
const PAD_ROWS = 10;

type DerivedLevel = {
  price: number;
  units: number;
  size: number;
  total: number;
  highlight: boolean;
  isEmpty?: boolean;
};

// Size/Total are notional values (quantity * price), which are large, so use
// compact notation (e.g. 15.04K, 17.5M) to match the Binance-style layout.
const formatVolume = (value: number): string =>
  value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });

// Full-precision notional for the tooltip (e.g. 105,877.29).
const formatFull = (value: number): string =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

// Sub-dollar markets (e.g. perps ~0.99) need more decimals than the 2 used for
// dollar-plus futures prices.
const formatPrice = (price: number): string =>
  Math.abs(price) < 1 ? price.toFixed(4) : price.toFixed(2);

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
  const { askLevels, bidLevels, maxAskTotal, maxBidTotal, bestAsk, bestBid } = useMemo(() => {
    // Input rows are sorted high -> low price.
    let askRows = rows.filter((r) => r.askUnits && r.askUnits > 0);
    let bidRows = rows.filter((r) => r.bidUnits && r.bidUnits > 0);

    // Hide crossed / overlapping levels: relative to the market price an ask
    // priced below market (or a bid priced above it) would cross the book, so
    // drop those levels entirely.
    if (marketPrice != null) {
      askRows = askRows.filter((r) => r.price >= marketPrice);
      bidRows = bidRows.filter((r) => r.price <= marketPrice);
    }

    // Derive the price tick from the smallest gap between adjacent levels so
    // the padded rows follow the market's real increment (e.g. 0.01, 0.0001).
    const allPrices = [...askRows, ...bidRows].map((r) => r.price).sort((a, b) => a - b);
    let step = Infinity;
    for (let i = 1; i < allPrices.length; i++) {
      const gap = allPrices[i] - allPrices[i - 1];
      if (gap > 1e-9 && gap < step) step = gap;
    }
    if (!isFinite(step)) step = 0.01;
    const snap = (value: number) => Number(value.toFixed(8));

    // Ask cumulative: iterate from best ask (lowest price = last element)
    // towards higher prices. Preserve high -> low order for rendering.
    // Size is notional (units * price); Total is the cumulative sum of Size.
    const asks: DerivedLevel[] = new Array(askRows.length);
    let askRunningTotal = 0;
    for (let i = askRows.length - 1; i >= 0; i--) {
      const units = askRows[i].askUnits as number;
      const size = units * askRows[i].price;
      askRunningTotal += size;
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
    const bids: DerivedLevel[] = bidRows.map((r) => {
      const units = r.bidUnits as number;
      const size = units * r.price;
      bidRunningTotal += size;
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

    const bestAsk = asks.length > 0 ? asks[asks.length - 1].price : null;
    const bestBid = bids.length > 0 ? bids[0].price : null;

    const emptyLevel = (price: number): DerivedLevel => ({
      price,
      units: 0,
      size: 0,
      total: 0,
      highlight: false,
      isEmpty: true,
    });

    // Pad above the highest ask (higher prices). Anchor to the highest ask, or
    // to the market price when there are no asks yet.
    const askAnchor = asks.length > 0 ? asks[0].price : marketPrice != null ? snap(marketPrice) : null;
    const askPads: DerivedLevel[] = [];
    if (askAnchor != null) {
      for (let i = PAD_ROWS; i >= 1; i--) {
        askPads.push(emptyLevel(snap(askAnchor + i * step)));
      }
    }

    // Pad below the lowest bid (lower prices). Anchor to the lowest bid, or to
    // the market price when there are no bids yet.
    const bidAnchor =
      bids.length > 0 ? bids[bids.length - 1].price : marketPrice != null ? snap(marketPrice) : null;
    const bidPads: DerivedLevel[] = [];
    if (bidAnchor != null) {
      for (let i = 1; i <= PAD_ROWS; i++) {
        const p = snap(bidAnchor - i * step);
        if (p <= 0) break;
        bidPads.push(emptyLevel(p));
      }
    }

    return {
      askLevels: [...askPads, ...asks],
      bidLevels: [...bids, ...bidPads],
      maxAskTotal,
      maxBidTotal,
      bestAsk,
      bestBid,
    };
  }, [rows, marketPrice]);

  const renderRow = (level: DerivedLevel, side: "ask" | "bid") => {
    // Empty padding rows: show the price ladder only, no depth bars/tooltip.
    if (level.isEmpty) {
      return (
        <Row
          key={`${side}-${level.price}`}
          $side={side}
          $empty
          onClick={() => onRowClick?.(formatPrice(level.price), null)}
        >
          <PriceCol $side={side}>{formatPrice(level.price)}</PriceCol>
          <SizeCol>0</SizeCol>
          <TotalCol />
        </Row>
      );
    }

    // Both bars share the same scale (largest cumulative total) so the bright
    // bar — this level's actual size — always sits nested inside the darker
    // accumulated-depth bar (size ≤ total at every level).
    const maxTotal = side === "ask" ? maxAskTotal : maxBidTotal;
    const sizeWidth = maxTotal > 0 ? Math.min(100, (level.size / maxTotal) * 100) : 0;
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
        onClick={() => onRowClick?.(formatPrice(level.price), level.units)}
        onMouseEnter={showTooltip}
        onMouseMove={showTooltip}
        onMouseLeave={() => setTooltip(null)}
      >
        <DimLayer $side={side} $width={totalWidth} />
        <BrightLayer $side={side} $width={sizeWidth} />
        <PriceCol $side={side}>{formatPrice(level.price)}</PriceCol>
        <SizeCol>{formatVolume(level.size)}</SizeCol>
        <TotalCol>{formatVolume(level.total)}</TotalCol>
      </Row>
    );
  };

  // Best price = the order-book level (best ask or best bid) closest to the
  // market price. Its color/arrow reflects whether it sits above or below the
  // market price.
  let bestPrice: number | null;
  if (bestAsk != null && bestBid != null && marketPrice != null) {
    bestPrice = Math.abs(bestAsk - marketPrice) <= Math.abs(bestBid - marketPrice) ? bestAsk : bestBid;
  } else {
    bestPrice = bestAsk ?? bestBid ?? marketPrice;
  }

  const isUp = bestPrice != null && marketPrice != null ? bestPrice >= marketPrice : true;

  // Center the spread on first load so asks scroll to their bottom (best ask)
  // and bids to their top (best bid), keeping the market-price row in view.
  const containerRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const hasCenteredRef = useRef(false);
  useEffect(() => {
    if (hasCenteredRef.current) return;
    if (askLevels.length === 0 && bidLevels.length === 0) return;
    const center = centerRef.current;
    const scroller = containerRef.current?.parentElement;
    if (!center || !scroller) return;
    scroller.scrollTop = Math.max(
      0,
      center.offsetTop - scroller.clientHeight / 2 + center.clientHeight / 2,
    );
    hasCenteredRef.current = true;
  }, [askLevels.length, bidLevels.length]);

  return (
    <Container ref={containerRef}>
      <ColumnHeader>
        <span>Price</span>
        <span>Size</span>
        <span>Total</span>
      </ColumnHeader>

      <AskSection>{askLevels.map((level) => renderRow(level, "ask"))}</AskSection>

      <CenterRow ref={centerRef}>
        <span className={`best ${isUp ? "up" : "down"}`}>
          {bestPrice != null ? formatPrice(bestPrice) : "—"}
          <span className="arrow">{isUp ? "↑" : "↓"}</span>
        </span>
        <span className="market">{marketPrice != null ? formatPrice(marketPrice) : "—"}</span>
      </CenterRow>

      <BidSection>{bidLevels.map((level) => renderRow(level, "bid"))}</BidSection>

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
  min-height: 480px;
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

// Asks fill the space above the center row, stacked so the best (lowest) ask
// sits just above the market-price row even when there are only a few levels.
const AskSection = styled("div")`
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
`;

// Bids fill the space below the center row, anchored to the top so the best
// (highest) bid sits just below the market-price row.
const BidSection = styled("div")`
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
`;

const Row = styled("div")<{ $side: "ask" | "bid"; $highlight?: boolean; $empty?: boolean }>`
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  align-items: center;
  height: 22px;
  padding: 0 0.5rem;
  cursor: pointer;
  font-size: 0.75rem;
  font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
  border-bottom: 1px solid transparent;
  opacity: ${(props) => (props.$empty ? 0.35 : 1)};

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
  height: 22px;
  padding: 0 0.5rem;
  background-color: ${tokens.surface.inputIsland};
  border-top: 1px solid ${tokens.overlay.white10};
  border-bottom: 1px solid ${tokens.overlay.white10};

  .best {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.8rem;
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
    font-size: 0.75rem;
  }

  .market {
    font-size: 0.75rem;
    font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
    color: ${tokens.trading.info};
  }
`;
