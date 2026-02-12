import { type FC, useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { useLocation, useNavigate } from "react-router";
import { FuturesBalanceWidget } from "../../components/Widgets/Futures/FuturesBalanceWidget";
import { FuturesMarketWidget } from "../../components/Widgets/Futures/FuturesMarketWidget";
import { OrderBookTable } from "../../components/Widgets/Futures/OrderBookTable";
import { HashrateChart } from "../../components/Charts/HashrateChart";
import { PlaceOrderWidget } from "../../components/Widgets/Futures/PlaceOrderWidget";
import { OrdersPositionsTabWidget } from "../../components/Widgets/Futures/OrdersPositionsTabWidget";
import { ClosePositionModal, useClosePositionModal } from "../../components/Widgets/Futures/ClosePositionModal";
import { useHashrateIndexData, type TimePeriod } from "../../hooks/data/useHashRateIndexData";
import { useBtcPriceIndexData } from "../../hooks/data/useBtcPriceIndexData";
import { useParticipant } from "../../hooks/data/useParticipant";
import { usePositionBook } from "../../hooks/data/usePositionBook";
import { useFuturesContractSpecs } from "../../hooks/data/useFuturesContractSpecs";
import { useGetMinMargin } from "../../hooks/data/useGetMinMargin";
import { useGetMarketPrice } from "../../hooks/data/useGetMarketPrice";
import { useHistoricalPositions } from "../../hooks/data/useHistoricalPositions";
import { SmallWidget } from "../../components/Cards/Cards.styled";
import type { PositionBookPosition } from "../../hooks/data/usePositionBook";
import type { ContractMode } from "../../types/types";
import styled from "@mui/material/styles/styled";

export const Futures: FC = () => {
  const { isConnected, address } = useAccount();
  const location = useLocation();
  const navigate = useNavigate();
  const previousAddressRef = useRef<string | undefined>(undefined);

  // Infer initial contract mode from URL
  const getInitialMode = (): ContractMode => {
    if (location.pathname.includes("/trade/perpetual")) return "perpetual";
    if (location.pathname.includes("/trade/futures")) return "futures";
    return "futures"; // Default to futures
  };

  // Contract mode state - controls Perpetual vs Expiring Futures
  const [contractMode, setContractMode] = useState<ContractMode>(getInitialMode);

  // Update URL when contract mode changes
  const handleContractModeChange = useCallback((mode: ContractMode) => {
    setContractMode(mode);
    const newPath = mode === "perpetual" ? "/trade/perpetual" : "/trade/futures";
    navigate(newPath, { replace: true });
  }, [navigate]);

  // Track account changes and reload page when account switches
  useEffect(() => {
    // On first render, just store the current address
    if (previousAddressRef.current === undefined) {
      previousAddressRef.current = address;
      return;
    }

    // If address changed (including connecting/disconnecting), reload the page
    if (previousAddressRef.current !== address) {
      window.location.reload();
    }
  }, [address]);
  const [chartTimePeriod, setChartTimePeriod] = useState<TimePeriod>("week");
  const hashrateQuery = useHashrateIndexData({ timePeriod: chartTimePeriod });
  const btcPriceQuery = useBtcPriceIndexData({ timePeriod: chartTimePeriod });
  const contractSpecsQuery = useFuturesContractSpecs();
  const { data: participantData, isLoading: isParticipantLoading } = useParticipant(address);
  const { data: positionBookData, isLoading: isPositionBookLoading } = usePositionBook(address);
  const { data: historicalPositionsData, isLoading: isHistoricalPositionsLoading } = useHistoricalPositions(
    address,
    true,
  );

  // Get min margin for address using hook (used for withdrawal form)
  const minMarginQuery = useGetMinMargin(address);
  const minMargin = minMarginQuery.data ?? null;
  const isLoadingMinMargin = minMarginQuery.isLoading;

  // Get market price from contract - polls every 10 seconds
  const {
    data: marketPrice,
    isLoading: isMarketPriceLoading,
    dataFetchedAt: marketPriceFetchedAt,
  } = useGetMarketPrice();

  // Calculate total unrealized PnL from all active positions
  const totalUnrealizedPnL = useMemo(() => {
    if (!marketPrice || !positionBookData?.data?.positions || !address || !contractSpecsQuery?.data) return null;

    const activePositions = positionBookData.data.positions.filter((p) => p.isActive && !p.closedAt);
    let totalPnL = 0n;

    activePositions.forEach((position: PositionBookPosition) => {
      const isLong = position.buyer.address.toLowerCase() === address.toLowerCase();
      const entryPrice = isLong ? position.buyPricePerDay : position.sellPricePerDay;
      const entryPriceNum = entryPrice;
      const priceDiff = marketPrice - entryPriceNum;

      const positionPnL = isLong ? priceDiff : -priceDiff;
      totalPnL += positionPnL;
    });

    totalPnL = totalPnL * BigInt(contractSpecsQuery?.data?.data?.deliveryDurationDays ?? 1);

    if (Math.abs(Number(totalPnL)) < 1000) {
      return 0n;
    }

    return totalPnL;
  }, [marketPrice, positionBookData?.data?.positions, address]);

  // Calculate total realized PnL (30D) from historical positions
  const totalRealizedPnL30D = useMemo(() => {
    if (!historicalPositionsData?.data || !address) return null;

    let totalPnL = 0;
    historicalPositionsData.data.forEach((position) => {
      const isLong = position.buyer.address.toLowerCase() === address.toLowerCase();
      const pnl = isLong ? position.buyerPnl : position.sellerPnl;
      totalPnL += pnl;
    });

    return totalPnL;
  }, [historicalPositionsData?.data, address]);

  // State for order book selection
  const [selectedPrice, setSelectedPrice] = useState<string | undefined>();
  const [selectedAmount, setSelectedAmount] = useState<number | undefined>();
  const [selectedDeliveryDate, setSelectedDeliveryDate] = useState<number | undefined>();
  const [selectedIsBuy, setSelectedIsBuy] = useState<boolean | undefined>();
  const [highlightMode, setHighlightMode] = useState<"inputs" | "buttons" | undefined>();
  const [highlightTrigger, setHighlightTrigger] = useState(0);

  // Reset state when contract mode changes
  useEffect(() => {
    setSelectedPrice(undefined);
    setSelectedAmount(undefined);
    setSelectedDeliveryDate(undefined);
    setSelectedIsBuy(undefined);
    setHighlightMode(undefined);
    setHighlightTrigger(0);
  }, [contractMode]);

  // Track previous order book state for change detection
  const previousOrderBookStateRef = useRef<Map<number, { bidUnits: number | null; askUnits: number | null }>>(
    new Map(),
  );

  // Function to proceed with close position (highlighting)
  const proceedWithClosePosition = useCallback((price: string, amount: number, isBuy: boolean) => {
    setSelectedPrice(price);
    setSelectedAmount(amount);
    setSelectedIsBuy(isBuy);
    setHighlightMode("buttons");
    // Increment trigger to force highlight update
    setHighlightTrigger((prev) => prev + 1);
  }, []);

  // Close position modal hook
  const closePositionModal = useClosePositionModal(proceedWithClosePosition);

  const handleOrderBookClick = (price: string, amount: number | null) => {
    setSelectedPrice(price);
    setSelectedAmount(1);
    setHighlightMode("inputs");
    setHighlightTrigger((prev) => prev + 1);
  };

  const handleDeliveryDateChange = (deliveryDate: number | undefined) => {
    setSelectedDeliveryDate(deliveryDate);
  };

  return (
    <FuturesContainer>
      {/* Contract Mode Toggle */}
      <ContractModeToggleArea>
        <ContractModeToggle>
          <ModeButton
            $active={contractMode === "perpetual"}
            onClick={() => handleContractModeChange("perpetual")}
          >
            Perpetuals
          </ModeButton>
          <ModeButton
            $active={contractMode === "futures"}
            onClick={() => handleContractModeChange("futures")}
          >
            Futures
          </ModeButton>
        </ContractModeToggle>
      </ContractModeToggleArea>

      {/* Row 1: Balance Widget (60%) and Stats Widget (40%) */}
      <BalanceWidgetArea>
        <FuturesBalanceWidget
          minMargin={minMargin}
          isLoadingMinMargin={isLoadingMinMargin}
          unrealizedPnL={totalUnrealizedPnL}
          realizedPnL30D={totalRealizedPnL30D}
          isLoadingRealizedPnL={isHistoricalPositionsLoading}
        />
      </BalanceWidgetArea>

      <StatsWidgetArea>
        <FuturesMarketWidget contractSpecsQuery={contractSpecsQuery} contractMode={contractMode} />
      </StatsWidgetArea>

      {/* Row 2: Chart (60%) */}
      <ChartArea>
        <SmallWidget className="w-full" style={{ marginBottom: 0, paddingLeft: 5, paddingRight: 10 }}>
          <HashrateChart
            data={hashrateQuery.data || []}
            btcPriceData={btcPriceQuery.data || []}
            isLoading={hashrateQuery.isLoading}
            isBtcPriceLoading={btcPriceQuery.isLoading}
            marketPrice={marketPrice}
            marketPriceFetchedAt={marketPriceFetchedAt}
            timePeriod={chartTimePeriod}
            onTimePeriodChange={setChartTimePeriod}
          />
        </SmallWidget>
      </ChartArea>

      {/* Row 3: Place Order (60%) - only shown when connected */}
      {isConnected && (
        <PlaceOrderArea>
          <PlaceOrderWidget
            externalPrice={selectedPrice}
            externalAmount={selectedAmount}
            externalDeliveryDate={selectedDeliveryDate}
            externalIsBuy={selectedIsBuy}
            highlightTrigger={highlightTrigger}
            contractSpecsQuery={contractSpecsQuery}
            participantData={participantData?.data}
            highlightMode={highlightMode}
            latestPrice={marketPrice ?? null}
            minMargin={minMargin}
            contractMode={contractMode}
            onOrderPlaced={async () => {
              await minMarginQuery.refetch();
            }}
          />
        </PlaceOrderArea>
      )}

      {/* Order Book (40%) - spans rows 2 and 3 */}
      <OrderBookArea $isConnected={isConnected}>
        <OrderBookTable
          onRowClick={handleOrderBookClick}
          onDeliveryDateChange={handleDeliveryDateChange}
          contractSpecsQuery={contractSpecsQuery}
          previousOrderBookStateRef={previousOrderBookStateRef}
          contractMode={contractMode}
        />
      </OrderBookArea>

      {/* Row 4: Orders and Positions List - Full width */}
      {isConnected && (
        <OrdersPositionsArea>
          <OrdersPositionsTabWidget
            orders={participantData?.data?.orders || []}
            positions={positionBookData?.data?.positions || []}
            ordersLoading={isParticipantLoading}
            positionsLoading={isPositionBookLoading}
            participantAddress={address}
            onClosePosition={closePositionModal.handleClosePosition}
            participantData={participantData?.data}
            minMargin={minMargin}
          />
        </OrdersPositionsArea>
      )}

      {/* Close Position Info Modal */}
      <ClosePositionModal
        isOpen={closePositionModal.showModal}
        pendingClosePosition={closePositionModal.pendingClosePosition}
        onConfirm={closePositionModal.handleConfirm}
        onCancel={closePositionModal.handleCancel}
        doNotShowAgain={closePositionModal.doNotShowAgain}
        onDoNotShowAgainChange={closePositionModal.setDoNotShowAgain}
      />
    </FuturesContainer>
  );
};

// Grid Container with explicit grid structure
const FuturesContainer = styled("div")`
  display: grid;
  grid-template-columns: 3fr 2fr;
  grid-auto-rows: auto;
  gap: 1.5rem;
  width: 100%;
  margin-top: 10px;

  /* Medium screens: Adjust column ratio for better fit */
  @media (max-width: 1400px) {
    grid-template-columns: 3fr 2fr;
  }

  /* Tablet: Stack in single column */
  @media (max-width: 1024px) {
    grid-template-columns: 1fr;
  }
`;

// Contract Mode Toggle Area - Full width at the top
const ContractModeToggleArea = styled("div")`
  grid-column: 1 / -1;
  grid-row: 1;
  display: flex;
  justify-content: flex-start;
  margin-bottom: 0.5rem;

  @media (max-width: 1024px) {
    justify-content: center;
  }
`;

const ContractModeToggle = styled("div")`
  display: flex;
  gap: 0;
  border: 1px solid rgba(171, 171, 171, 1);
  border-radius: 6px;
  overflow: hidden;
`;

const ModeButton = styled("button")<{ $active: boolean }>`
  padding: 0.625rem 1.25rem;
  background: ${(props) => (props.$active ? "#4c5a5f" : "transparent")};
  color: #fff;
  border: none;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
  white-space: nowrap;

  &:hover {
    background: ${(props) => (props.$active ? "#4c5a5f" : "rgba(76, 90, 95, 0.5)")};
  }

  &:not(:last-child) {
    border-right: 1px solid rgba(171, 171, 171, 0.5);
  }
`;

// Balance Widget - Row 2, Column 1 (60% width)
const BalanceWidgetArea = styled("div")`
  grid-column: 1;
  grid-row: 2;
  width: 100%;
  min-width: 0;

  > * {
    width: 100%;
    height: 100%;
  }

  @media (max-width: 1024px) {
    grid-column: 1;
    grid-row: auto;
  }
`;

// Stats Widget - Row 2, Column 2 (40% width)
const StatsWidgetArea = styled("div")`
  grid-column: 2;
  grid-row: 2;
  width: 100%;
  min-width: 0;

  > * {
    width: 100%;
    height: 100%;
  }

  @media (max-width: 1024px) {
    grid-column: 1;
    grid-row: auto;
  }
`;

// Chart Area - Row 3, Column 1 (60% width)
const ChartArea = styled("div")`
  grid-column: 1;
  grid-row: 3;
  width: 100%;
  min-width: 0;

  > * {
    width: 100%;
  }

  @media (max-width: 1024px) {
    grid-column: 1;
    grid-row: auto;
  }
`;

// Place Order Area - Row 4, Column 1 (60% width)
const PlaceOrderArea = styled("div")`
  grid-column: 1;
  grid-row: 4;
  width: 100%;
  min-width: 0;

  > * {
    width: 100%;
  }

  @media (max-width: 1024px) {
    grid-column: 1;
    grid-row: auto;
  }
`;

// Order Book Area - Rows 3-4, Column 2 (40% width, spans 2 rows)
const OrderBookArea = styled("div")<{ $isConnected: boolean }>`
  grid-column: 2;
  grid-row: ${(props) => (props.$isConnected ? "3 / 5" : "3 / 4")};
  width: 100%;
  min-width: 0;
  height: 100%;

  > * {
    width: 100%;
    height: 100%;
  }

  @media (max-width: 1024px) {
    grid-column: 1;
    grid-row: auto;
    height: auto;
  }
`;

// Orders and Positions Area - Row 5, Full width
const OrdersPositionsArea = styled("div")`
  grid-column: 1 / -1;
  grid-row: 5;
  width: 100%;
  min-width: 0;

  > * {
    width: 100%;
  }

  @media (max-width: 1024px) {
    grid-column: 1;
    grid-row: auto;
  }
`;
