import { tokens } from "../../styles/tokens";
import { type FC, useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { useLocation, useNavigate } from "react-router";
import { FuturesBalanceWidget } from "../../components/Widgets/Futures/FuturesBalanceWidget";
import { TradingHeader } from "../../components/Widgets/Futures/TradingHeader";
import { OrderBookTable } from "../../components/Widgets/Futures/OrderBookTable";
import { HashrateChart } from "../../components/Charts/HashrateChart";
import { PlaceOrderWidget } from "../../components/Widgets/Futures/PlaceOrderWidget";
import { OrdersPositionsTabWidget } from "../../components/Widgets/Futures/OrdersPositionsTabWidget";
import { PerpsOrdersPositionsTabWidget } from "../../components/Widgets/Futures/PerpsOrdersPositionsTabWidget";
import { ClosePositionModal, useClosePositionModal } from "../../components/Widgets/Futures/ClosePositionModal";
import { useHashrateIndexData, type TimePeriod } from "../../hooks/data/useHashRateIndexData";
import { useBtcPriceIndexData } from "../../hooks/data/useBtcPriceIndexData";
import { getUserFuturesOrders } from "../../hooks/data/getUserFuturesOrders";
import { getUserFuturesPositions } from "../../hooks/data/getUserFuturesPositions";
import { useFuturesContractSpecs } from "../../hooks/data/useFuturesContractSpecs";
import { useGetMinMargin } from "../../hooks/data/useGetMinMargin";
import { useGetMarketPrice } from "../../hooks/data/useGetMarketPrice";
import { useHistoricalPositions } from "../../hooks/data/useHistoricalPositions";
import { useGetFutureBalance } from "../../hooks/data/useGetFutureBalance";
import { useGetPerpsRequiredMargin } from "../../hooks/data/perps/useGetPerpsRequiredMargin";
import { useFuturesPaymentTokenBalance } from "../../hooks/data/usePaymentTokenBalance";
import { useFundingRate } from "../../hooks/data/perps/useFundingRate";
import { usePerpsCollection } from "../../hooks/data/perps/usePerpsCollection";
import { useUserPositionSessions } from "../../hooks/data/perps/useUserPositionSessions";
import { useMaintenanceMarginPercent } from "../../hooks/data/perps/useMaintenanceMarginPercent";
import { computeLiquidationState } from "../../hooks/data/perps/positionHelper";
import { SmallWidget } from "../../components/Cards/Cards.styled";
import type { PositionBookPosition } from "../../hooks/data/getUserFuturesPositions";
import type { ContractMode } from "../../types/types";
import styled from "@mui/material/styles/styled";
import { PAYMENT_TOKEN_SCALE_NUM, QUANTITY_SCALE } from "../../lib/units";

interface TradingPageProps {
  defaultMode?: ContractMode;
}

export const Futures: FC<TradingPageProps> = ({ defaultMode = "futures" }) => {
  const { isConnected, address } = useAccount();
  const location = useLocation();
  const navigate = useNavigate();
  const previousAddressRef = useRef<string | undefined>(undefined);

  // Infer initial contract mode from URL or use defaultMode prop
  const getInitialMode = (): ContractMode => {
    if (location.pathname.includes("/trade/perpetual") || location.pathname.includes("/perpetual")) return "perpetual";
    if (location.pathname.includes("/trade/futures") || location.pathname.includes("/futures")) return "futures";
    return defaultMode;
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
    if (previousAddressRef.current === undefined) {
      previousAddressRef.current = address;
      return;
    }
    if (previousAddressRef.current !== address) {
      window.location.reload();
    }
  }, [address]);

  const [chartTimePeriod, setChartTimePeriod] = useState<TimePeriod>("week");
  const hashrateQuery = useHashrateIndexData({ timePeriod: chartTimePeriod });
  const btcPriceQuery = useBtcPriceIndexData({ timePeriod: chartTimePeriod });
  const contractSpecsQuery = useFuturesContractSpecs();
  const [hasOpenOrders, setHasOpenOrders] = useState(false);
  const { data: participantData, isLoading: isParticipantLoading } = getUserFuturesOrders(address, {
    refetch: hasOpenOrders,
  });
  const { data: positionBookData, isLoading: isPositionBookLoading } = getUserFuturesPositions(address, {
    refetch: hasOpenOrders,
  });
  useEffect(() => {
    setHasOpenOrders((participantData?.data?.orders?.length ?? 0) > 0);
  }, [participantData?.data?.orders?.length]);
  const { data: historicalPositionsData, isLoading: isHistoricalPositionsLoading } = useHistoricalPositions(
    address,
    true,
  );

  // Get min margin for address using hook (used for withdrawal form and locked balance)
  const futuresMinMarginQuery = useGetMinMargin(address);
  const perpsMinMarginQuery = useGetPerpsRequiredMargin(address);

  const minMarginQuery = useMemo(() => {
    const query = contractMode === "perpetual" ? perpsMinMarginQuery : futuresMinMarginQuery;
    return {
      data: query.data,
      isLoading: query.isLoading,
      refetch: query.refetch,
    };
  }, [contractMode, futuresMinMarginQuery, perpsMinMarginQuery]);

  const minMargin = useMemo(() => {
    if (!minMarginQuery.data) return null;
    return minMarginQuery.data as bigint;
  }, [minMarginQuery.data]);

  const isLoadingMinMargin = minMarginQuery.isLoading;

  // Single shared balance — both Futures and Perps engines settle against the same CollateralVault,
  // so we always read `vault.balanceOf(account)` regardless of contract mode.
  const vaultBalanceQuery = useGetFutureBalance(address);
  const balanceQuery = useMemo(() => ({
    data: vaultBalanceQuery.data,
    isLoading: vaultBalanceQuery.isLoading,
    isSuccess: vaultBalanceQuery.isSuccess,
    refetch: vaultBalanceQuery.refetch,
  }), [vaultBalanceQuery]);

  // Wallet (ERC20) balance of the shared collateral token.
  const walletPaymentTokenBalance = useFuturesPaymentTokenBalance(address);
  const accountBalanceQuery = useMemo(() => ({
    data: walletPaymentTokenBalance.data,
    isLoading: walletPaymentTokenBalance.isLoading,
  }), [walletPaymentTokenBalance]);

  // Get market price from contract - polls every 10 seconds
  const {
    data: marketPrice,
    dataFetchedAt: marketPriceFetchedAt,
  } = useGetMarketPrice();

  // Get funding rate for perpetual contracts
  const fundingRateQuery = useFundingRate();

  // Get perps collection data (fees, margin requirements, etc)
  const perpsCollectionQuery = usePerpsCollection();

  // Fetch user position sessions for perpetual contracts
  const positionSessionsQuery = useUserPositionSessions(address);

  // Active delivery date selected in the order book (used for futures entry price line)
  const [selectedDeliveryDate, setSelectedDeliveryDate] = useState<number | undefined>();

  // Read maintenanceMarginPercent from contract once (cached indefinitely)
  const { data: maintenanceMarginPercentRaw } = useMaintenanceMarginPercent();
  const maintenanceMarginPercent = maintenanceMarginPercentRaw !== undefined ? BigInt(maintenanceMarginPercentRaw) : undefined;

  const openPositionNetQuantity = useMemo(() => {
    if (contractMode !== "perpetual") return null;
    const sessions = positionSessionsQuery.data?.positionSessions || [];
    const openSessions = sessions.filter((s) => s.status === "OPEN");
    if (openSessions.length === 0) return null;
    let sum = 0n;
    for (const s of openSessions) {
      sum += s.user.netQuantity;
    }
    return sum;
  }, [contractMode, positionSessionsQuery.data?.positionSessions]);

  const openPositionEntryPrice = useMemo(() => {
    if (contractMode === "perpetual") {
      const sessions = positionSessionsQuery.data?.positionSessions || [];
      const openSession = sessions.find((s) => s.status === "OPEN");
      if (!openSession) return null;
      return Number(openSession.entryPrice) / PAYMENT_TOKEN_SCALE_NUM;
    } else {
      if (!address || !positionBookData?.data?.positions || !selectedDeliveryDate) return null;
      const activePositions = positionBookData.data.positions
        .filter((p) => p.isActive && !p.closedAt && p.deliveryAt === String(selectedDeliveryDate))
        .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
      if (activePositions.length === 0) return null;
      const position = activePositions[0];
      const isLong = position.buyer.address.toLowerCase() === address.toLowerCase();
      const entryPrice = isLong ? position.buyPricePerDay : position.sellPricePerDay;
      return Number(entryPrice) / PAYMENT_TOKEN_SCALE_NUM;
    }
  }, [contractMode, positionSessionsQuery.data?.positionSessions, positionBookData?.data?.positions, address, selectedDeliveryDate]);

  const openPositionLiquidationPrice = useMemo(() => {
    if (contractMode !== "perpetual") return null;
    if (maintenanceMarginPercent === undefined) return null;
    const sessions = positionSessionsQuery.data?.positionSessions || [];
    const openSession = sessions.find((s) => s.status === "OPEN");
    if (!openSession || !marketPrice || openSession.user.netQuantity === 0n) return null;
    const collateral = balanceQuery.data as bigint | undefined;
    if (!collateral) return null;
    const { liquidationPrice } = computeLiquidationState(
      openSession.user.netQuantity,
      openSession.entryPrice,
      collateral,
      minMargin ?? 0n,
      marketPrice,
      maintenanceMarginPercent,
      6n,
    );
    return liquidationPrice > 0n ? Number(liquidationPrice) / PAYMENT_TOKEN_SCALE_NUM : null;
  }, [contractMode, positionSessionsQuery.data?.positionSessions, marketPrice, balanceQuery.data, minMargin, maintenanceMarginPercent]);

  // Calculate total unrealized PnL based on contract mode
  const totalUnrealizedPnL = useMemo(() => {
    if (!marketPrice || !address) return null;

    if (contractMode === "perpetual") {
      const sessions = positionSessionsQuery.data?.positionSessions || [];
      const openSessions = sessions.filter((session) => session.status === "OPEN");

      let totalPnL = 0n;
      openSessions.forEach((session) => {
        const netQuantity = session.user.netQuantity;
        if (netQuantity === 0n) return;
        const priceDiff = marketPrice - session.entryPrice;
        const unrealizedPnL = (priceDiff * netQuantity) / QUANTITY_SCALE;
        totalPnL += unrealizedPnL;
      });

      return totalPnL;
    } else {
      if (!positionBookData?.data?.positions || !contractSpecsQuery?.data) return null;

      const activePositions = positionBookData.data.positions.filter((p) => p.isActive && !p.closedAt);
      let totalPnL = 0n;

      activePositions.forEach((position: PositionBookPosition) => {
        const isLong = position.buyer.address.toLowerCase() === address.toLowerCase();
        const entryPrice = isLong ? position.buyPricePerDay : position.sellPricePerDay;
        const priceDiff = marketPrice - entryPrice;
        const positionPnL = isLong ? priceDiff : -priceDiff;
        totalPnL += positionPnL;
      });

      totalPnL = totalPnL * BigInt(contractSpecsQuery?.data?.data?.deliveryDurationDays ?? 1);

      if (Math.abs(Number(totalPnL)) < 1000) {
        return 0n;
      }

      return totalPnL;
    }
  }, [marketPrice, positionBookData?.data?.positions, address, contractMode, positionSessionsQuery.data?.positionSessions, contractSpecsQuery?.data]);

  // Calculate total realized PnL (30D) based on contract mode
  const totalRealizedPnL30D = useMemo(() => {
    if (!address) return null;

    if (contractMode === "perpetual") {
      const sessions = positionSessionsQuery.data?.positionSessions || [];
      let totalPnL = 0n;
      sessions.forEach((session) => {
        totalPnL += session.realizedPnl;
      });
      return Number(totalPnL);
    } else {
      if (!historicalPositionsData?.data) return null;

      let totalPnL = 0;
      historicalPositionsData.data.forEach((position) => {
        totalPnL += position.pnl;
      });

      return totalPnL;
    }
  }, [historicalPositionsData?.data, address, contractMode, positionSessionsQuery.data?.positionSessions]);

  // State for order book selection
  const [selectedPrice, setSelectedPrice] = useState<string | undefined>();
  const [selectedAmount, setSelectedAmount] = useState<number | undefined>();
  const [selectedIsBuy, setSelectedIsBuy] = useState<boolean | undefined>();
  const [highlightMode, setHighlightMode] = useState<"inputs" | "buttons" | undefined>();
  const [highlightTrigger, setHighlightTrigger] = useState(0);

  // Reset state when contract mode changes
  useEffect(() => {
    setSelectedPrice(undefined);
    setSelectedAmount(undefined);
    setSelectedIsBuy(undefined);
    setHighlightMode(undefined);
    setHighlightTrigger(0);
  }, [contractMode]);

  const previousOrderBookStateRef = useRef<Map<number, { bidUnits: number | null; askUnits: number | null }>>(
    new Map(),
  );

  const proceedWithClosePosition = useCallback((price: string, amount: number, isBuy: boolean) => {
    setSelectedPrice(price);
    setSelectedAmount(amount);
    setSelectedIsBuy(isBuy);
    setHighlightMode("buttons");
    setHighlightTrigger((prev) => prev + 1);
  }, []);

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

  const currentPriceFormatted = marketPrice ? (Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2) : null;

  return (
    <FuturesContainer>
      {/* Row 1: Compact Trading Header — full width */}
      <TradingHeaderArea>
        <TradingHeader
          contractMode={contractMode}
          onContractModeChange={handleContractModeChange}
          contractSpecsQuery={contractSpecsQuery}
          currentPrice={currentPriceFormatted}
          fundingRate={fundingRateQuery.data?.formattedRate ?? "0%"}
          totalVolume={perpsCollectionQuery.data?.data?.totalVolume}
        />
      </TradingHeaderArea>

      {/* Row 2, Col 1: Chart */}
      <ChartArea>
        <SmallWidget
          className="w-full justify-start"
          style={{
            marginBottom: 0,
            paddingLeft: 5,
            paddingTop: "0.875rem",
            paddingRight: 10,
            height: "100%",
            justifyContent: "start",
            border: `1px solid ${tokens.border.muted04}`,
          }}
        >
          <HashrateChart
            data={hashrateQuery.data || []}
            btcPriceData={btcPriceQuery.data || []}
            isLoading={hashrateQuery.isLoading}
            isBtcPriceLoading={btcPriceQuery.isLoading}
            marketPrice={marketPrice}
            marketPriceFetchedAt={marketPriceFetchedAt}
            entryPrice={openPositionEntryPrice}
            liquidationPrice={openPositionLiquidationPrice}
            timePeriod={chartTimePeriod}
            onTimePeriodChange={setChartTimePeriod}
          />
        </SmallWidget>
      </ChartArea>

      {/* Row 2, Col 2: Order Book */}
      <OrderBookArea>
        <OrderBookTable
          onRowClick={handleOrderBookClick}
          onDeliveryDateChange={handleDeliveryDateChange}
          contractSpecsQuery={contractSpecsQuery}
          previousOrderBookStateRef={previousOrderBookStateRef}
          contractMode={contractMode}
        />
      </OrderBookArea>

      {/* Col 3 (full height): Account Balance + Place Order + Order Information */}
      <RightPanelArea>
        <FuturesBalanceWidget
          minMargin={minMargin}
          isLoadingMinMargin={isLoadingMinMargin}
          unrealizedPnL={totalUnrealizedPnL}
          realizedPnL30D={totalRealizedPnL30D}
          isLoadingRealizedPnL={isHistoricalPositionsLoading}
          balanceQuery={balanceQuery}
          accountBalance={accountBalanceQuery}
        />
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
          openPositionNetQuantity={openPositionNetQuantity}
          contractMode={contractMode}
          accountBalance={accountBalanceQuery}
          balanceQuery={balanceQuery}
          perpsCollection={perpsCollectionQuery.data?.data}
          onOrderPlaced={async () => {
            await minMarginQuery.refetch();
          }}
        />
        {/* <OrderInfoSection>
          <OrderInfoTitle>Order Information</OrderInfoTitle>
        </OrderInfoSection> */}
      </RightPanelArea>

      {/* Row 3, Col 1+2: Orders and Positions — does NOT span right panel column */}
      {isConnected && (
        <OrdersPositionsArea>
          {contractMode === "perpetual" ? (
            <PerpsOrdersPositionsTabWidget
              orders={participantData?.data?.orders || []}
              positions={positionBookData?.data?.positions || []}
              ordersLoading={isParticipantLoading}
              positionsLoading={isPositionBookLoading}
              participantAddress={address}
              onClosePosition={closePositionModal.handleClosePosition}
              participantData={participantData?.data}
              minMargin={minMargin}
              accountBalance={accountBalanceQuery}
              marketPrice={marketPrice}
              positionSessions={positionSessionsQuery.data?.positionSessions || []}
              positionSessionsLoading={positionSessionsQuery.isLoading}
              perpsBalance={balanceQuery.data as bigint | undefined}
              maintenanceMarginPercent={maintenanceMarginPercent}
              onPositionClosed={async () => {
                await minMarginQuery.refetch();
              }}
            />
          ) : (
            <OrdersPositionsTabWidget
              orders={participantData?.data?.orders || []}
              positions={positionBookData?.data?.positions || []}
              ordersLoading={isParticipantLoading}
              positionsLoading={isPositionBookLoading}
              participantAddress={address}
              onClosePosition={closePositionModal.handleClosePosition}
              participantData={participantData?.data}
              minMargin={minMargin}
              accountBalance={accountBalanceQuery}
              contractMode={contractMode}
              balanceQuery={balanceQuery}
            />
          )}
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

// 3-column grid: Chart (65%) | Order Book (35%) | Right Panel (fixed 300px)
const FuturesContainer = styled("div")`
  display: grid;
  grid-template-columns: minmax(0, 13fr) minmax(0, 7fr) 300px;
  grid-template-rows: auto auto auto;
  gap: 1rem;
  width: 100%;
  margin-top: 10px;
  align-items: start;

  @media (max-width: 1400px) {
    grid-template-columns: minmax(0, 13fr) minmax(0, 7fr) 280px;
  }

  @media (max-width: 1100px) {
    grid-template-columns: minmax(0, 13fr) minmax(0, 7fr) 260px;
  }

  /* Tablet: collapse to single column */
  @media (max-width: 1024px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }
`;

// Row 1, all 3 columns
const TradingHeaderArea = styled("div")`
  grid-column: 1 / -1;
  grid-row: 1;
`;

// Row 2, Col 1: Chart — sets the row height
const ChartArea = styled("div")`
  grid-column: 1;
  grid-row: 2;
  min-width: 0;
  min-height: 380px;
  height: 100%;

  > * {
    width: 100%;
    height: 100%;
  }

  @media (max-width: 1024px) {
    grid-column: 1;
    grid-row: auto;
    min-height: 300px;
  }
`;

// Row 2, Col 2: Order Book
const OrderBookArea = styled("div")`
  grid-column: 2;
  grid-row: 2;
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

// Col 3, spans rows 2 and 3 — stretches to fill full combined height
const RightPanelArea = styled("div")`
  grid-column: 3;
  grid-row: 2 / 4;
  align-self: stretch;
  margin-bottom: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  overflow-y: auto;
  border: 1px solid ${tokens.border.muted04};
  border-radius: 8px;

  /* All children: strip individual borders and blend into panel */
  > * {
    border: none !important;
    border-radius: 0 !important;
    border-bottom: 1px solid ${tokens.border.muted02} !important;

    &:last-child {
      border-bottom: none !important;
    }
  }

  /* Balance widget: fixed, does not grow */
  > *:first-child {
    flex-shrink: 0;
  }

  /* PlaceOrderWidget: grows to fill remaining space */
  > *:nth-child(2) {
    flex: 1;
    min-height: 0;
  }

  /* Order Information: fixed, does not grow */
  > *:last-child {
    flex-shrink: 0;
  }

  @media (max-width: 1024px) {
    grid-column: 1;
    grid-row: auto;
    overflow-y: visible;
    align-self: auto;

    > *:nth-child(2) {
      flex: none;
    }
  }
`;

// Order Information block — blank placeholder at bottom of right panel
const OrderInfoSection = styled("div")`
  padding: 0.875rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
`;

const OrderInfoTitle = styled("div")`
  font-size: 0.7rem;
  font-weight: 600;
  color: ${tokens.text.secondary};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

// Row 3, Col 1+2 only (right panel column continues alongside)
const OrdersPositionsArea = styled("div")`
  grid-column: 1 / 3;
  grid-row: 3;
  min-width: 0;

  > * {
    width: 100%;
  }

  @media (max-width: 1024px) {
    grid-column: 1;
    grid-row: auto;
  }
`;
