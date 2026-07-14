import { tokens } from "../../../styles/tokens";
import styled from "@mui/material/styles/styled";
import { SmallWidget } from "../../Cards/Cards.styled";
import { useState, useEffect, useRef, useMemo } from "react";
import { useGetDeliveryDates } from "../../../hooks/data/useGetDeliveryDates";
import { useAggregateOrderBook } from "../../../hooks/data/useAggregateOrderBook";
import { usePerpsOrderBook } from "../../../hooks/data/perps/usePerpsOrderBook";
import { usePerpsCollection } from "../../../hooks/data/perps/usePerpsCollection";
import { useGetMarketPrice } from "../../../hooks/data/useGetMarketPrice";
import { createFinalOrderBookData } from "./orderBookHelpers";
import { ClassicOrderBook } from "./ClassicOrderBook";
import { VolumeOrderBook } from "./VolumeOrderBook";
import { TradesList } from "./TradesList";
import type { UseQueryResult } from "@tanstack/react-query";
import type { GetResponse } from "../../../gateway/interfaces";
import type { FuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
import type { ContractMode } from "../../../types/types";
import { PAYMENT_TOKEN_SCALE_NUM, QUANTITY_SCALE_NUM } from "../../../lib/units";

interface OrderBookTableProps {
  onRowClick?: (price: string, amount: number | null) => void;
  onDeliveryDateChange?: (deliveryDate: number | undefined) => void;
  contractSpecsQuery: UseQueryResult<GetResponse<FuturesContractSpecs>, Error>;
  previousOrderBookStateRef: React.MutableRefObject<Map<number, { bidUnits: number | null; askUnits: number | null }>>;
  contractMode?: ContractMode;
  // When set, the carousel snaps to the matching delivery date (futures only).
  // Used by the close-position flow to align the order book with the position
  // being closed.
  targetDeliveryDate?: number;
}

export const OrderBookTable = ({
  onRowClick,
  onDeliveryDateChange,
  contractSpecsQuery,
  previousOrderBookStateRef,
  contractMode = "futures",
  targetDeliveryDate,
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

  const { data: deliveryDatesRaw, isLoading, isError } = useGetDeliveryDates();
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

  // Transform delivery dates from bigint[] to [{ deliveryDate: number }]
  // Filter out dates that are earlier than now
  const deliveryDates = useMemo(() => {
    if (!deliveryDatesRaw) return [];
    const now = Math.floor(Date.now() / 1000); // Current time in Unix timestamp (seconds)
    return deliveryDatesRaw
      .map((date) => ({
        deliveryDate: Number(date),
      }))
      .filter(({ deliveryDate }) => deliveryDate >= now)
      .sort((a, b) => a.deliveryDate - b.deliveryDate); // Sort by date ascending
  }, [deliveryDatesRaw]);

  // Reset selected date index if it's out of bounds after filtering
  useEffect(() => {
    if (deliveryDates.length > 0 && selectedDateIndex >= deliveryDates.length) {
      setSelectedDateIndex(0);
    }
  }, [deliveryDates.length, selectedDateIndex]);

  // Snap the carousel to a target delivery date when the parent requests it
  // (e.g. closing a position on a different expiry than the one currently shown).
  useEffect(() => {
    if (!targetDeliveryDate || deliveryDates.length === 0) return;
    const idx = deliveryDates.findIndex((d) => d.deliveryDate === targetDeliveryDate);
    if (idx >= 0 && idx !== selectedDateIndex) {
      setSelectedDateIndex(idx);
    }
  }, [targetDeliveryDate, deliveryDates]);

  // Get selected delivery date
  const selectedDeliveryDate = deliveryDates[selectedDateIndex]?.deliveryDate;

  // Notify parent component when delivery date changes
  useEffect(() => {
    if (selectedDeliveryDate) {
      onDeliveryDateChange?.(selectedDeliveryDate);
    } else {
      onDeliveryDateChange?.(undefined);
    }
  }, [selectedDeliveryDate]);

  // Fetch order book based on contract mode
  const futuresOrderBookQuery = useAggregateOrderBook(
    contractMode === "futures" ? selectedDeliveryDate : undefined,
    { refetch: true, interval: 15000 }
  );
  const perpsOrderBookQuery = usePerpsOrderBook(
    contractMode === "perpetual" ? { refetch: true, interval: 15000 } : undefined
  );

  const orderBookQuery = contractMode === "perpetual" ? perpsOrderBookQuery : futuresOrderBookQuery;

  // Both subgraphs expose the same `priceLevels` collection (one row per
  // {price, isBid} pair, plus `deliveryAt` on futures). Reduce either source
  // to the per-price shape the renderer expects.
  //
  // The only schema difference is how `totalQuantity` is denominated:
  //   - perps: scaled BigInt (divide by QUANTITY_SCALE_NUM to get units)
  //   - futures: raw integer count of OrderEntry units
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

  useEffect(() => {
    previousOrderBookStateRef.current = new Map();
    orderBookQuery.refetch();
  }, [selectedDateIndex]);

  // Helper function to normalize price
  const normalizePrice = (price: number, minimumPriceIncrement: number | null): number => {
    if (minimumPriceIncrement !== null) {
      return Math.round(price / minimumPriceIncrement) * minimumPriceIncrement;
    }
    return Math.round(price * 100) / 100;
  };

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

  // Create final order book data — a contiguous tick ladder (empty + live rows)
  // spanning +/-50% of the market price. Memoized because it can produce
  // thousands of rows for high-priced markets.
  const finalOrderBookData = useMemo(
    () => createFinalOrderBookData(orderBookData, marketPrice, minimumPriceIncrement),
    [orderBookData, marketPrice, minimumPriceIncrement],
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
  }, [currentBasePrice, finalOrderBookDataWithHighlights]);

  // Track order book changes and highlight changed prices
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

      if (previous && previous.askUnits == current.askUnits && previous.bidUnits == current.bidUnits) {
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
        (row) => row.price == newHighlights.keys().next().value,
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
    if (selectedDateIndex < deliveryDates.length - 1) {
      setSelectedDateIndex(selectedDateIndex + 1);
    }
  };

  const scrollToOrder = (orderIndex: number) => {
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
  };

  // Format delivery date for display
  const formatDeliveryDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const selectedDateDisplay = selectedDeliveryDate
    ? formatDeliveryDate(selectedDeliveryDate)
    : isLoading
      ? "Loading..."
      : "No dates available";

  // Show error state
  if (isError) {
    return (
      <OrderBookWidget>
        <Header>
          <button className="nav-arrow" disabled>
            ←
          </button>
          <h3>Error</h3>
          <button className="nav-arrow" disabled>
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
          <button className="nav-arrow" disabled>
            ←
          </button>
          <h3>Loading...</h3>
          <button className="nav-arrow" disabled>
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
        <Header>
          <button onClick={goToPreviousDate} className="nav-arrow" disabled={selectedDateIndex === 0 || isLoading}>
            ←
          </button>
          <h3>{selectedDateDisplay}</h3>
          <button
            onClick={goToNextDate}
            className="nav-arrow"
            disabled={selectedDateIndex === deliveryDates.length - 1 || isLoading}
          >
            →
          </button>
        </Header>
      )}

      <TableContainer ref={tableContainerRef}>
        {viewMode === "trades" ? (
          <TradesList contractMode={contractMode} />
        ) : viewMode === "volume" ? (
          <VolumeOrderBook
            rows={finalOrderBookDataWithHighlights}
            contractMode={contractMode}
            onRowClick={onRowClick}
            marketPrice={marketPriceNumber}
          />
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

const TableContainer = styled("div")`
  position: relative;
  overflow-y: auto;
  width: 100%;
  max-height: 510px; /* ~20 rows * 26px per row */
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
  align-self: flex-start;
  margin-bottom: 0.4rem;
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
`;

const PerpsInfoHeader = styled("div")`
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 0.75rem 1rem;
  background-color: ${tokens.overlay.white05};
  border-radius: 8px;
  gap: 1rem;
`;

const InfoLabel = styled("div")`
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
