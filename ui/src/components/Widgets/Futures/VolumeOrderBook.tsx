import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "@mui/material/styles/styled";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useVirtualizer } from "@tanstack/react-virtual";
import { tokens } from "../../../styles/tokens";
import type { OrderBookRow } from "./ClassicOrderBook";
import type { ContractMode } from "../../../types/types";

interface VolumeOrderBookProps {
  rows: OrderBookRow[];
  contractMode?: ContractMode;
  onRowClick?: (price: string, amount: number | null) => void;
  marketPrice: number | null;
}

// Fixed row height (px). Used both for the styled rows and as the virtualizer's
// size estimate so scroll math stays exact.
const ROW_HEIGHT = 22;

// Scroll offset that puts the given row index in the vertical middle of the
// viewport. Deterministic because every row is exactly ROW_HEIGHT tall.
const centerOffset = (scroller: HTMLDivElement, index: number): number =>
  Math.max(0, index * ROW_HEIGHT - scroller.clientHeight / 2 + ROW_HEIGHT / 2);

type Depth = { size: number; total: number };

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
  const scrollRef = useRef<HTMLDivElement>(null);

  // On mobile the hover tooltip (price/total/distance-from-market) is more of a
  // hindrance than help, so suppress it entirely for touch/narrow layouts.
  const isMobile = useMediaQuery("(max-width: 768px)", { noSsr: true });

  // Compute cumulative depth per side once per order-book update. Rows arrive as
  // one contiguous, tick-by-tick ladder sorted high -> low (empty rows included),
  // with exactly one row flagged `isLastHashprice` marking the market price.
  const { askDepth, bidDepth, maxAskTotal, maxBidTotal, bestAsk, bestBid, centerIndex } = useMemo(() => {
    const askDepth = new Map<number, Depth>();
    const bidDepth = new Map<number, Depth>();

    let centerIndex = rows.findIndex((r) => r.isLastHashprice);
    if (centerIndex < 0 && marketPrice != null && rows.length > 0) {
      // Fallback: closest row to the market price.
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < rows.length; i++) {
        const dist = Math.abs(rows[i].price - marketPrice);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      centerIndex = best;
    }

    // Asks sit above the market price. Best ask = lowest ask (closest to market);
    // cumulative depth grows from the best ask outward to higher prices. Walk the
    // ladder bottom -> top so the running total accumulates in that direction.
    let askRunning = 0;
    let bestAsk: number | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.isLastHashprice) continue;
      const units = r.askUnits ?? 0;
      if (units > 0 && (marketPrice == null || r.price >= marketPrice)) {
        const size = units * r.price;
        askRunning += size;
        askDepth.set(r.price, { size, total: askRunning });
        if (bestAsk == null) bestAsk = r.price;
      }
    }
    const maxAskTotal = askRunning;

    // Bids sit below the market price. Best bid = highest bid; cumulative depth
    // grows downward to lower prices. Walk top -> bottom.
    let bidRunning = 0;
    let bestBid: number | null = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.isLastHashprice) continue;
      const units = r.bidUnits ?? 0;
      if (units > 0 && (marketPrice == null || r.price <= marketPrice)) {
        const size = units * r.price;
        bidRunning += size;
        bidDepth.set(r.price, { size, total: bidRunning });
        if (bestBid == null) bestBid = r.price;
      }
    }
    const maxBidTotal = bidRunning;

    return { askDepth, bidDepth, maxAskTotal, maxBidTotal, bestAsk, bestBid, centerIndex };
  }, [rows, marketPrice]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Keep the market-price row centered by default. Row height is fixed, so the
  // target offset is deterministic (no dependency on the virtualizer having
  // measured yet, which made `scrollToIndex` unreliable on first paint). We keep
  // re-centering as the market price moves, but stop once the user scrolls so we
  // never fight their navigation.
  const userScrolledRef = useRef(false);
  const lastTargetRef = useRef<number | null>(null);
  // Overlay "Scroll to Market" button, shown when the market row is scrolled
  // out of view. `dir` points the user back towards it.
  const [marketButton, setMarketButton] = useState<{ show: boolean; dir: "up" | "down" }>({
    show: false,
    dir: "down",
  });

  // Toggle the overlay button based on whether the market row is inside the
  // current viewport (with the ladder potentially thousands of rows tall).
  const updateMarketButton = useCallback(
    (scroller: HTMLDivElement) => {
      if (centerIndex < 0) {
        setMarketButton((prev) => (prev.show ? { show: false, dir: prev.dir } : prev));
        return;
      }
      const centerPx = centerIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const viewTop = scroller.scrollTop;
      const viewBottom = viewTop + scroller.clientHeight;
      const next: { show: boolean; dir: "up" | "down" } =
        centerPx < viewTop
          ? { show: true, dir: "up" }
          : centerPx > viewBottom
            ? { show: true, dir: "down" }
            : { show: false, dir: "down" };
      setMarketButton((prev) => (prev.show === next.show && prev.dir === next.dir ? prev : next));
    },
    [centerIndex],
  );

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || rows.length === 0 || centerIndex < 0) return;
    // Once the user has taken over scrolling we no longer auto-center, but the
    // market row may have moved in/out of view, so keep the button in sync.
    if (userScrolledRef.current) {
      updateMarketButton(scroller);
      return;
    }
    const target = centerOffset(scroller, centerIndex);
    lastTargetRef.current = target;
    scroller.scrollTop = target;
    setMarketButton((prev) => (prev.show ? { show: false, dir: prev.dir } : prev));
  }, [rows.length, centerIndex, updateMarketButton]);

  // Distinguish user scrolling from our programmatic centering: our set lands on
  // `lastTargetRef`, so any material deviation means the user took over.
  const handleScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    // Hide the hover tooltip on scroll: Safari doesn't fire a row's onMouseLeave
    // when rows move out from under a stationary cursor, so it would get stuck.
    setTooltip(null);
    if (lastTargetRef.current == null || Math.abs(scroller.scrollTop - lastTargetRef.current) > 2) {
      userScrolledRef.current = true;
    }
    updateMarketButton(scroller);
  };

  const handleScrollToMarketClick = () => {
    const scroller = scrollRef.current;
    if (!scroller || centerIndex < 0) return;
    const target = centerOffset(scroller, centerIndex);
    lastTargetRef.current = target;
    userScrolledRef.current = false; // resume auto-centering
    scroller.scrollTop = target;
    setMarketButton((prev) => (prev.show ? { show: false, dir: prev.dir } : prev));
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

  const renderRow = (index: number) => {
    const row = rows[index];

    // Market-price row: rendered as the Binance-style center marker instead of a
    // regular ladder level.
    if (row.isLastHashprice) {
      return (
        <CenterRow>
          <span className={`best ${isUp ? "up" : "down"}`}>
            {bestPrice != null ? formatPrice(bestPrice) : "—"}
            <span className="arrow">{isUp ? "↑" : "↓"}</span>
          </span>
          <span className="market">{marketPrice != null ? formatPrice(marketPrice) : "—"}</span>
        </CenterRow>
      );
    }

    // Side is derived from position relative to the center row so it stays
    // correct even when the market price is unavailable.
    const side: "ask" | "bid" = centerIndex >= 0 && index < centerIndex ? "ask" : "bid";
    const depth = side === "ask" ? askDepth.get(row.price) : bidDepth.get(row.price);

    // Empty ladder rows: show only the price so the user can click any tick
    // (e.g. 3.01, 3.02, ...) to place an order there even with no resting order.
    if (!depth) {
      return (
        <Row $side={side} $empty onClick={() => onRowClick?.(formatPrice(row.price), null)}>
          <PriceCol $side={side}>{formatPrice(row.price)}</PriceCol>
          <SizeCol />
          <TotalCol />
        </Row>
      );
    }

    const highlight = side === "ask" ? Boolean(row.highlightAsk) : Boolean(row.highlightBid);
    const units = side === "ask" ? row.askUnits : row.bidUnits;

    // One scale for both sides (max cumulative across the book) so a thin ask
    // book does not stretch to full width next to a deep bid book. Bright size
    // bar stays nested inside the darker cumulative-total bar.
    const maxTotal = Math.max(maxAskTotal, maxBidTotal);
    const sizeWidth = maxTotal > 0 ? Math.min(100, (depth.size / maxTotal) * 100) : 0;
    const totalWidth = maxTotal > 0 ? Math.min(100, (depth.total / maxTotal) * 100) : 0;

    const showTooltip = (e: React.MouseEvent) => {
      if (isMobile) return;
      const distancePct =
        marketPrice != null && marketPrice !== 0
          ? ((row.price - marketPrice) / marketPrice) * 100
          : null;
      setTooltip({ price: row.price, total: depth.total, distancePct, x: e.clientX, y: e.clientY });
    };

    return (
      <Row
        $side={side}
        $highlight={highlight}
        onClick={() => onRowClick?.(formatPrice(row.price), units ?? null)}
        onMouseEnter={showTooltip}
        onMouseMove={showTooltip}
        onMouseLeave={() => setTooltip(null)}
      >
        <DimLayer $side={side} $width={totalWidth} />
        <BrightLayer $side={side} $width={sizeWidth} />
        <PriceCol $side={side}>{formatPrice(row.price)}</PriceCol>
        <SizeCol>{formatVolume(depth.size)}</SizeCol>
        <TotalCol>{formatVolume(depth.total)}</TotalCol>
      </Row>
    );
  };

  return (
    <Container>
      <ColumnHeader>
        <span>Price</span>
        <span>Size</span>
        <span>Total</span>
      </ColumnHeader>

      <Scroller ref={scrollRef} onScroll={handleScroll}>
        <ListInner style={{ height: rowVirtualizer.getTotalSize() }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => (
            <VirtualRow
              key={virtualRow.key}
              style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
            >
              {renderRow(virtualRow.index)}
            </VirtualRow>
          ))}
        </ListInner>
      </Scroller>

      {marketButton.show && (
        <ScrollToMarketButton type="button" onClick={handleScrollToMarketClick}>
          <span className="arrow">{marketButton.dir === "up" ? "↑" : "↓"}</span>
          Scroll to Market
        </ScrollToMarketButton>
      )}

      {tooltip && !isMobile && (
        <Tooltip
          style={{
            left: Math.max(8, tooltip.x - 236),
            top: tooltip.y + 12,
          }}
        >
          <div className="row">
            <span className="label">Price</span>
            <span className="value">{formatPrice(tooltip.price)}</span>
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
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

// Floating pill shown when the market row is scrolled out of view; clicking it
// re-centers the ladder on the market price and resumes auto-centering.
const ScrollToMarketButton = styled("button")`
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.8rem;
  border: 1px solid ${tokens.overlay.white20};
  border-radius: 999px;
  background: ${tokens.surface.tabActive};
  color: #ffffff;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  transition: background 0.15s ease, transform 0.05s ease;

  .arrow {
    font-size: 0.8rem;
    line-height: 1;
  }

  &:hover {
    background: ${tokens.surface.tabHover};
  }

  &:active {
    transform: translateX(-50%) scale(0.97);
  }
`;

const ColumnHeader = styled("div")`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
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

// Virtualized scroll viewport. Only the rows currently in view are mounted.
// Fills the remaining height below the sticky column header (the parent
// OrderBookArea sets the overall clamped height); the virtualizer reads this
// element's live clientHeight, so no fixed viewport height is needed.
const Scroller = styled("div")`
  position: relative;
  overflow-y: auto;
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: ${tokens.overlay.white05};
    border-radius: 2px;
  }

  &::-webkit-scrollbar-thumb {
    background: ${tokens.overlay.white20};
    border-radius: 2px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: ${tokens.overlay.white40};
  }
`;

// Spacer sized to the full ladder height; virtual rows are absolutely
// positioned within it.
const ListInner = styled("div")`
  position: relative;
  width: 100%;
`;

const VirtualRow = styled("div")`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
`;

const Row = styled("div")<{ $side: "ask" | "bid"; $highlight?: boolean; $empty?: boolean }>`
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  align-items: center;
  height: ${ROW_HEIGHT}px;
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
  height: ${ROW_HEIGHT}px;
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
