import { tokens } from "../../../styles/tokens";
import styled from "@mui/material/styles/styled";
import { SmallWidget } from "../../Cards/Cards.styled";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useGetExpirationDates } from "../../../hooks/data/useGetExpirationDates";
import { useAggregateOrderBook } from "../../../hooks/data/useAggregateOrderBook";
import { usePerpsOrderBook } from "../../../hooks/data/perps/usePerpsOrderBook";
import { usePerpsCollection } from "../../../hooks/data/perps/usePerpsCollection";
import { useGetMarketPrice } from "../../../hooks/data/useGetMarketPrice";
import { createFinalOrderBookData, createPerpsOrderBookData } from "./orderBookHelpers";
import { MOBILE_TOGGLE_METRICS } from "./mobile/mobileTradingLayout";
import { ClassicOrderBook } from "./ClassicOrderBook";
import { VolumeOrderBook } from "./VolumeOrderBook";
import { PerpsVolumeOrderBook } from "./PerpsVolumeOrderBook";
import { TradesList } from "./TradesList";
import type { UseQueryResult } from "@tanstack/react-query";
import type { GetResponse } from "../../../gateway/interfaces";
import type { FuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
import type { ContractMode } from "../../../types/types";
import { PAYMENT_TOKEN_SCALE_NUM, QUANTITY_SCALE_NUM } from "../../../lib/units";

interface OrderBookTableProps {
  onRowClick?: (price: string, amount: number | null) => void;
  onExpirationAtChange?: (expirationAt: number | undefined) => void;
  contractSpecsQuery: UseQueryResult<GetResponse<FuturesContractSpecs>, Error>;
  previousOrderBookStateRef: React.MutableRefObject<Map<number, { bidUnits: number | null; askUnits: number | null }>>;
  contractMode?: ContractMode;
  // When set, the carousel snaps to the matching expiration date (futures only).
  // Used by the close-position flow to align the order book with the position
  // being closed.
  targetExpirationAt?: number;
}

const normalizePrice = (price: number, minimumPriceIncrement: number | null): number => {
  if (minimumPriceIncrement !== null) {
    return Math.round(price / minimumPriceIncrement) * minimumPriceIncrement;
  }
  return Math.round(price * 100) / 100;
};

export const OrderBookTable = ({
  onRowClick,
  onExpirationAtChange,
  contractSpecsQuery,
  previousOrderBookStateRef,
  contractMode = "futures",
  targetExpirationAt,
}: OrderBookTableProps) => {
  const [selectedDateIndex, setSelectedDateIndex] = useState(0);
  // Order book display mode: Classic / Volume ladders, or the all-users Trades feed.
  const [viewMode, setViewMode] = useState<"classic" | "volume" | "trades">("volume");
  const tableContainerRef = useRef<HTMLDivElement>(null);
  // Track previous basePrice to detect changes
  const previousBasePriceRef = useRef<number | null>(null);
  const [priceHighlights, setPriceHighlights] = useState<Map<number, { highlightBid: boolean; highlightAsk: boolean }>>(
    new Map(),
  );

  const { data: expirationDatesRaw, isLoading, isError } = useGetExpirationDates();
  const { data: marketPrice } = useGetMarketPrice();
  const perpsCollectionQuery = usePerpsCollection();

  // The contiguous ladder needs the exact tick size for the active market.
  // Futures specs are passed in as a prop, but perps carry their own increment
  // on the collection, so resolve it per mode.
  const minimumPriceIncrement = useMemo(() => {
    const rawIncrement =
      contractMode === "perpetual"
        ? perpsCollectionQuery.data?.data?.minimumPriceIncrement
        : contractSpecsQuery.data?.data?.minimumPriceIncrement;
    if (rawIncrement == null) return null;
    return Number(rawIncrement) / PAYMENT_TOKEN_SCALE_NUM;
  }, [contractMode, perpsCollectionQuery.data?.data?.minimumPriceIncrement, contractSpecsQuery.data?.data?.minimumPriceIncrement]);

  // Transform expiration dates from bigint[] to [{ expirationAt: number }]
  // Filter out dates that are earlier than now
  const expirationDates = useMemo(() => {
    if (!expirationDatesRaw) return [];
    const now = Math.floor(Date.now() / 1000); // Current time in Unix timestamp (seconds)
    return expirationDatesRaw
      .map((date) => ({
        expirationAt: Number(date),
      }))
      .filter(({ expirationAt }) => expirationAt >= now)
      .sort((a, b) => a.expirationAt - b.expirationAt); // Sort by date ascending
  }, [expirationDatesRaw]);

  // Reset selected date index if it's out of bounds after filtering
  useEffect(() => {
    if (expirationDates.length > 0 && selectedDateIndex >= expirationDates.length) {
      setSelectedDateIndex(0);
    }
  }, [expirationDates.length, selectedDateIndex]);

  // Snap the carousel to a target expiration date when the parent requests it
  // (e.g. closing a position on a different expiry than the one currently shown).
  // `selectedDateIndex` is deliberately omitted: with it listed, manually paging
  // the carousel would immediately snap back to the target while it is still set.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    if (!targetExpirationAt || expirationDates.length === 0) return;
    const idx = expirationDates.findIndex((d) => d.expirationAt === targetExpirationAt);
    if (idx >= 0 && idx !== selectedDateIndex) {
      setSelectedDateIndex(idx);
    }
  }, [targetExpirationAt, expirationDates]);

  // Get selected expiration date
  const selectedExpirationAt = expirationDates[selectedDateIndex]?.expirationAt;

  // Notify parent component when expiration date changes.
  // `onExpirationAtChange` is an optional prop that callers pass inline, so it is
  // a new function on every parent render; listing it would fire this
  // notification on every render instead of only when the expiry changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    if (selectedExpirationAt) {
      onExpirationAtChange?.(selectedExpirationAt);
    } else {
      onExpirationAtChange?.(undefined);
    }
  }, [selectedExpirationAt]);

  // Fetch order book based on contract mode
  const futuresOrderBookQuery = useAggregateOrderBook(
    contractMode === "futures" ? selectedExpirationAt : undefined,
    { refetch: true, interval: 15000 }
  );
  const perpsOrderBookQuery = usePerpsOrderBook(
    contractMode === "perpetual" ? { refetch: true, interval: 15000 } : undefined
  );

  const orderBookQuery = contractMode === "perpetual" ? perpsOrderBookQuery : futuresOrderBookQuery;

  // Both subgraphs expose the same `priceLevels` collection (one row per
  // {price, isBid} pair, plus `expirationAt` on futures). Reduce either source
  // to the per-price shape the renderer expects.
  //
  // The only schema difference is how `totalQuantity` is denominated:
  //   - perps: scaled BigInt (divide by QUANTITY_SCALE_NUM to get units)
  //   - futures: raw integer contract count (quantityDecimals is 0)
  const orderBookData = useMemo(() => {
    const futuresPriceLevels = futuresOrderBookQuery.data?.data?.priceLevels;
    const perpsPriceLevels = perpsOrderBookQuery.data?.data?.priceLevels;

    const priceLevels =
      contractMode === "perpetual" ? perpsPriceLevels : futuresPriceLevels;

    if (!priceLevels) return [];

    const quantityScale = contractMode === "perpetual" ? QUANTITY_SCALE_NUM : 1;

    const priceLevelMap = new Map<
      string,
      { buyOrdersCount: number; sellOrdersCount: number; price: bigint }
    >();

    for (const level of priceLevels) {
      const key = level.price.toString();
      const existing =
        priceLevelMap.get(key) ?? { buyOrdersCount: 0, sellOrdersCount: 0, price: level.price };

      const quantity = Number(level.totalQuantity) / quantityScale;

      if (level.isBid) {
        existing.buyOrdersCount = quantity;
      } else {
        existing.sellOrdersCount = quantity;
      }

      priceLevelMap.set(key, existing);
    }

    return Array.from(priceLevelMap.values());
  }, [
    contractMode,
    perpsOrderBookQuery.data?.data?.priceLevels,
    futuresOrderBookQuery.data?.data?.priceLevels,
  ]);

  // Drop the highlight baseline and refetch when the user pages to another
  // expiry. `selectedDateIndex` is the trigger rather than a value read here, and
  // `orderBookQuery` swaps between the futures and perps query objects, so
  // listing its `refetch` would fire an extra request whenever the mode flips.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    previousOrderBookStateRef.current = new Map();
    orderBookQuery.refetch();
  }, [selectedDateIndex]);

  // Get current order book state from pre-aggregated data
  const currentOrderBookState = useMemo(() => {
    const state = new Map<number, { bidUnits: number; askUnits: number }>();

    if (!orderBookData || orderBookData.length <= 0) {
      return state;
    }

    // Data is already aggregated with buyOrdersCount and sellOrdersCount
    for (const order of orderBookData) {
      const rawPrice = Number(order.price) / PAYMENT_TOKEN_SCALE_NUM;
      const price = normalizePrice(rawPrice, minimumPriceIncrement);
      state.set(price, {
        bidUnits: order.buyOrdersCount,
        askUnits: order.sellOrdersCount,
      });
    }

    return state;
  }, [orderBookData, minimumPriceIncrement]);

  // Create final order book data.
  // - Futures: a contiguous tick ladder (empty + live rows) spanning +/-50% of
  //   the market price.
  // - Perpetuals: the pre-#209 compact book (live levels + a small static
  //   window), with no empty gaps between real price levels.
  // Memoized because the futures ladder can produce thousands of rows.
  const finalOrderBookData = useMemo(
    () =>
      contractMode === "perpetual"
        ? createPerpsOrderBookData(orderBookData, marketPrice, minimumPriceIncrement)
        : createFinalOrderBookData(orderBookData, marketPrice, minimumPriceIncrement),
    [contractMode, orderBookData, marketPrice, minimumPriceIncrement],
  );

  // Add highlighting to final order book data based on price changes
  const finalOrderBookDataWithHighlights = useMemo(() => {
    return finalOrderBookData.map((row) => {
      const highlight = priceHighlights.get(row.price);
      return {
        ...row,
        highlightBid: highlight?.highlightBid ?? false,
        highlightAsk: highlight?.highlightAsk ?? false,
      };
    });
  }, [finalOrderBookData, priceHighlights]);

  // Calculate max bid and ask amounts for fill width calculation
  const { maxBidAmount, maxAskAmount } = useMemo(() => {
    let maxBid = 0;
    let maxAsk = 0;
    for (const row of finalOrderBookDataWithHighlights) {
      if (row.bidUnits && row.bidUnits > maxBid) {
        maxBid = row.bidUnits;
      }
      if (row.askUnits && row.askUnits > maxAsk) {
        maxAsk = row.askUnits;
      }
    }
    return { maxBidAmount: maxBid, maxAskAmount: maxAsk };
  }, [finalOrderBookDataWithHighlights]);

  const currentBasePrice = finalOrderBookDataWithHighlights.find((o) => o.isLastHashprice);

  // Market price (in token units) for the Binance-style center row. Falls back
  // to the ladder's base/hashprice row when the raw market price is unavailable.
  const marketPriceNumber =
    marketPrice != null ? Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM : currentBasePrice?.price ?? null;

  // Only closes over a ref, so it stays stable and can be listed as an effect
  // dependency without retriggering anything. Declared above the effects that
  // use it because dependency arrays are evaluated during render.
  const scrollToOrder = useCallback((orderIndex: number) => {
    setTimeout(() => {
      if (orderIndex !== -1 && tableContainerRef.current) {
        const rowHeight = 26; // Fixed row height from styles

        // Calculate scroll position to center the row in the viewport
        // (row index * row height) - (container height / 2) + (row height / 2)
        const scrollPosition = orderIndex * rowHeight - 9 * rowHeight;

        // Smooth scroll to center the row
        tableContainerRef.current.scrollTo({
          top: Math.max(0, scrollPosition),
          behavior: "smooth",
        });
      }
    }, 100);
  }, []);

  // Auto-scroll to last hashprice row when basePrice (hashprice) updates
  useEffect(() => {
    if (!tableContainerRef.current) {
      return;
    }
    if (!finalOrderBookData.length || !currentBasePrice) {
      return;
    }
    if (previousBasePriceRef.current) {
      return;
    }

    previousBasePriceRef.current = currentBasePrice.price;

    setTimeout(() => {
      // Find the last hashprice row index
      const lastHashpriceIndex = finalOrderBookDataWithHighlights.findIndex((row) => row.isLastHashprice);
      scrollToOrder(lastHashpriceIndex);
    }, 100);
  }, [currentBasePrice, finalOrderBookDataWithHighlights, finalOrderBookData.length, scrollToOrder]);

  // Track order book changes and highlight changed prices.
  // `finalOrderBookDataWithHighlights` must stay out of the dependency list: this
  // effect calls `setPriceHighlights`, which is what that value is derived from,
  // so listing it would loop forever.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    const previousState = previousOrderBookStateRef.current;

    if (!orderBookData.length || !previousState.size) {
      // First load or no previous state - just store current state
      previousOrderBookStateRef.current = new Map(currentOrderBookState);
      return;
    }

    const newHighlights = new Map<number, { highlightBid: boolean; highlightAsk: boolean }>();

    // Check all prices in current state
    for (const [price, current] of currentOrderBookState.entries()) {
      const previous = previousState.get(price);

      if (previous && previous.askUnits === current.askUnits && previous.bidUnits === current.bidUnits) {
        continue;
      }

      const highlightBid = !previous ? current.bidUnits > 0 : current.bidUnits > (previous.bidUnits ?? 0);

      const highlightAsk = !previous ? current.askUnits > 0 : current.askUnits > (previous.askUnits ?? 0);

      if (highlightBid || highlightAsk) {
        newHighlights.set(price, { highlightBid, highlightAsk });
      }
    }

    // Update highlights if there are any changes
    if (newHighlights.size > 0) {
      setPriceHighlights(newHighlights);

      const firstItemToHightlight = finalOrderBookDataWithHighlights.findIndex(
        (row) => row.price === newHighlights.keys().next().value,
      );
      scrollToOrder(firstItemToHightlight);

      // Clear highlights after 2 seconds
      setTimeout(() => {
        setPriceHighlights(new Map());
      }, 3000);
    }

    previousOrderBookStateRef.current = new Map(currentOrderBookState);
  }, [orderBookData, currentOrderBookState]);

  // Navigation functions
  const goToPreviousDate = () => {
    if (selectedDateIndex > 0) {
      setSelectedDateIndex(selectedDateIndex - 1);
    }
  };

  const goToNextDate = () => {
    if (selectedDateIndex < expirationDates.length - 1) {
      setSelectedDateIndex(selectedDateIndex + 1);
    }
  };

  // Format expiration date for display
  const formatExpirationAt = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const selectedDateDisplay = selectedExpirationAt
    ? formatExpirationAt(selectedExpirationAt)
    : isLoading
      ? "Loading..."
      : "No dates available";

  // Show error state
  if (isError) {
    return (
      <OrderBookWidget>
        <Header>
          <button type="button" className="nav-arrow" disabled>
            ←
          </button>
          <h3>Error</h3>
          <button type="button" className="nav-arrow" disabled>
            →
          </button>
        </Header>
        <TableContainer>
          <div style={{ textAlign: "center", padding: "2rem", color: tokens.trading.short }}>Failed to load order book data</div>
        </TableContainer>
      </OrderBookWidget>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <OrderBookWidget>
        <Header>
          <button type="button" className="nav-arrow" disabled>
            ←
          </button>
          <h3>Loading...</h3>
          <button type="button" className="nav-arrow" disabled>
            →
          </button>
        </Header>
        <TableContainer>
          <div style={{ textAlign: "center", padding: "2rem", color: tokens.text.secondary }}>Loading order book data...</div>
        </TableContainer>
      </OrderBookWidget>
    );
  }

  return (
    <OrderBookWidget>
      <TopBar>
        <ViewToggle>
          {/* <ToggleButton
            type="button"
            $active={viewMode === "classic"}
            onClick={() => setViewMode("classic")}
          >
            Classic
          </ToggleButton> */}
          <ToggleButton
            type="button"
            $active={viewMode === "volume"}
            onClick={() => setViewMode("volume")}
          >
            Order Book
          </ToggleButton>
          <ToggleButton
            type="button"
            $active={viewMode === "trades"}
            onClick={() => setViewMode("trades")}
          >
            Trades
          </ToggleButton>
        </ViewToggle>
        {contractMode === "futures" && viewMode !== "trades" && (
          <DateSwitcher>
            <button
              type="button"
              onClick={goToPreviousDate}
              className="nav-arrow"
              disabled={selectedDateIndex === 0 || isLoading}
            >
              ←
            </button>
            <span className="date-label">{selectedDateDisplay}</span>
            <button
              type="button"
              onClick={goToNextDate}
              className="nav-arrow"
              disabled={selectedDateIndex === expirationDates.length - 1 || isLoading}
            >
              →
            </button>
          </DateSwitcher>
        )}
      </TopBar>

      <TableContainer ref={tableContainerRef}>
        {viewMode === "trades" ? (
          <TradesList contractMode={contractMode} />
        ) : viewMode === "volume" ? (
          contractMode === "perpetual" ? (
            <PerpsVolumeOrderBook
              rows={finalOrderBookDataWithHighlights}
              contractMode={contractMode}
              onRowClick={onRowClick}
              marketPrice={marketPriceNumber}
              minimumPriceIncrement={minimumPriceIncrement}
            />
          ) : (
            <VolumeOrderBook
              rows={finalOrderBookDataWithHighlights}
              contractMode={contractMode}
              onRowClick={onRowClick}
              marketPrice={marketPriceNumber}
            />
          )
        ) : (
          <ClassicOrderBook
            rows={finalOrderBookDataWithHighlights}
            maxBidAmount={maxBidAmount}
            maxAskAmount={maxAskAmount}
            contractMode={contractMode}
            onRowClick={onRowClick}
          />
        )}
      </TableContainer>
    </OrderBookWidget>
  );
};

const OrderBookWidget = styled(SmallWidget)`
  width: 100%;
  padding: 0.875rem 1rem;
  justify-content: space-between;
  margin-bottom: 0;
  border: 1px solid ${tokens.border.muted04};
`;

const TopBar = styled("div")`
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;

  /* MOBILE-ONLY (see MOBILE_TRADING_QUERY): the book shares its row with the
     place-order form, so the view tabs and the date switcher stack instead of
     squeezing each other out. */
  @media (max-width: 768px) {
    flex-wrap: wrap;
    gap: 0.25rem;
  }
`;

const Header = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.4rem;

  h3 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .nav-arrow {
    background: none;
    border: none;
    color: ${tokens.text.onDark};
    font-size: 0.9rem;
    cursor: pointer;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    transition: all 0.2s ease;

    &:hover:not(:disabled) {
      background-color: ${tokens.overlay.white10};
    }

    &:disabled {
      color: ${tokens.text.orderBookMuted};
      cursor: not-allowed;
      opacity: 0.5;
    }
  }
`;

const DateSwitcher = styled("div")`
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;

  .date-label {
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
    color: ${tokens.text.onDark};
  }

  /* MOBILE-ONLY: half-width column, so the expiry label steps down a size. */
  @media (max-width: 768px) {
    .date-label {
      font-size: 0.7rem;
    }
  }

  .nav-arrow {
    background: none;
    border: none;
    color: ${tokens.text.onDark};
    font-size: 0.9rem;
    cursor: pointer;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    transition: all 0.2s ease;

    &:hover:not(:disabled) {
      background-color: ${tokens.overlay.white10};
    }

    &:disabled {
      color: ${tokens.text.orderBookMuted};
      cursor: not-allowed;
      opacity: 0.5;
    }
  }
`;

const TableContainer = styled("div")`
  position: relative;
  overflow-y: auto;
  width: 100%;
  /* Always reserve the scrollbar gutter so the inner content width stays fixed
     whether or not the view overflows (avoids a horizontal jump between the
     order book and trades tabs, and between perps and futures). */
  scrollbar-gutter: stable;
  /* Fill the widget (sized by OrderBookArea: chart-height, clamped 437-540px)
     and scroll internally. min-height 0 lets this flex child shrink so it never
     overflows its parent and spawns a second scrollbar. The shared height lives
     on OrderBookArea, so perps/futures and the order book/trades tabs all match
     and don't resize on tab or data changes. */
  flex: 1 1 auto;
  min-height: 0;
  max-height: 540px;
  background-color: ${tokens.surface.panel};

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

const ViewToggle = styled("div")`
  display: inline-flex;
  border: 1px solid ${tokens.overlay.white15};
  border-radius: 6px;
  overflow: hidden;
`;

const ToggleButton = styled("button")<{ $active?: boolean }>`
  border: none;
  cursor: pointer;
  padding: 0.2rem 0.6rem;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  transition: background 0.15s ease, color 0.15s ease;
  background: ${(props) => (props.$active ? tokens.surface.tabActive : "transparent")};
  color: ${(props) => (props.$active ? "#FFFFFF" : tokens.text.secondary)};

  &:hover {
    background: ${(props) => (props.$active ? tokens.surface.tabHover : tokens.overlay.white08)};
    color: #FFFFFF;
  }

  /* MOBILE-ONLY: keep both tabs on one line inside the half-width column, using
     the metrics the place-order toggles also follow so the two columns align. */
  @media (max-width: 768px) {
    ${MOBILE_TOGGLE_METRICS}
  }
`;

const _PerpsInfoHeader = styled("div")`
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 0.75rem 1rem;
  background-color: ${tokens.overlay.white05};
  border-radius: 8px;
  gap: 1rem;
`;

const _InfoLabel = styled("div")`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  
  .label {
    font-size: 0.85rem;
    color: ${tokens.text.secondary};
    font-weight: 500;
  }
  
  .value {
    font-size: 1.1rem;
    color: ${tokens.text.onDark};
    font-weight: 600;
  }
`;
