import { tokens } from "../../styles/tokens";
import { type FC, type ReactNode, useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { useNavigate, useParams } from "react-router";
import { FuturesBalanceWidget } from "../../components/Widgets/Futures/FuturesBalanceWidget";
import { TradingHeader } from "../../components/Widgets/Futures/TradingHeader";
import { OrderBookTable } from "../../components/Widgets/Futures/OrderBookTable";
import { HashrateChart } from "../../components/Charts/HashrateChart";
import { PlaceOrderWidget } from "../../components/Widgets/Futures/PlaceOrderWidget";
import { OrdersPositionsTabWidget } from "../../components/Widgets/Futures/OrdersPositionsTabWidget";
import { PerpsOrdersPositionsTabWidget } from "../../components/Widgets/Futures/PerpsOrdersPositionsTabWidget";
import { LiquidationToast } from "../../components/Widgets/Futures/LiquidationToast";
import { FuturesMobileLayout } from "../../components/Widgets/Futures/mobile/FuturesMobileLayout";
import { useIsMobileTradingLayout } from "../../components/Widgets/Futures/mobile/mobileTradingLayout";
import { useLiquidationNotifications } from "../../hooks/data/useLiquidationNotifications";
import { ClosePositionModal, useClosePositionModal } from "../../components/Widgets/Futures/ClosePositionModal";
import { useHashrateIndexData, type TimePeriod } from "../../hooks/data/useHashRateIndexData";
import { useBtcPriceIndexData } from "../../hooks/data/useBtcPriceIndexData";
import { getUserFuturesOrders } from "../../hooks/data/getUserFuturesOrders";
import { getUserFuturesPositions } from "../../hooks/data/getUserFuturesPositions";
import { useFuturesContractSpecs } from "../../hooks/data/useFuturesContractSpecs";
import { useGetPortfolioIM } from "../../hooks/data/useGetPortfolioIM";
import { useGetMarketPrice } from "../../hooks/data/useGetMarketPrice";
import { useHistoricalPositions } from "../../hooks/data/useHistoricalPositions";
import { useGetFutureBalance } from "../../hooks/data/useGetFutureBalance";
import { useFuturesPaymentTokenBalance } from "../../hooks/data/usePaymentTokenBalance";
import { useFundingRate } from "../../hooks/data/perps/useFundingRate";
import { usePerpsCollection } from "../../hooks/data/perps/usePerpsCollection";
import { useUserPositionSessions } from "../../hooks/data/perps/useUserPositionSessions";
import { useUserPerpsOrders } from "../../hooks/data/perps/useUserPerpsOrders";
import { useLiquidationThresholds } from "../../hooks/data/useLiquidationThresholds";
import { usePointsHookWeights } from "../../hooks/data/usePointsHookWeights";
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
  const { mode: modeParam } = useParams<{ mode: string }>();
  const navigate = useNavigate();
  const previousAddressRef = useRef<string | undefined>(undefined);
  // Below 768px the page renders the mobile-only compound layout (order book
  // beside the place-order form, chart collapsed) instead of the desktop grid.
  const isMobileTradingLayout = useIsMobileTradingLayout();

  // Mode is owned by the URL (/trade/:mode). Same route element stays mounted
  // across futures↔perps, so wagmi Hydrate is not recreated mid-tree.
  const contractMode: ContractMode =
    modeParam === "perpetual" || modeParam === "futures" ? modeParam : defaultMode;

  useEffect(() => {
    if (modeParam !== "perpetual" && modeParam !== "futures") {
      navigate(`/trade/${defaultMode}`, { replace: true });
    }
  }, [modeParam, defaultMode, navigate]);

  const handleContractModeChange = useCallback(
    (mode: ContractMode) => {
      navigate(mode === "perpetual" ? "/trade/perpetual" : "/trade/futures", { replace: true });
    },
    [navigate],
  );

  // Reload the page only when the user genuinely switches to a different wallet
  // account. `address` from useAccount() flickers undefined <-> 0x... while
  // WalletConnect is connecting/reconnecting, so we ignore falsy values and
  // only react to a transition between two distinct defined addresses.
  useEffect(() => {
    if (!address) return;
    const normalized = address.toLowerCase();
    if (previousAddressRef.current === undefined) {
      previousAddressRef.current = normalized;
      return;
    }
    if (previousAddressRef.current !== normalized) {
      previousAddressRef.current = normalized;
      window.location.reload();
    }
  }, [address]);

  const [chartTimePeriod, setChartTimePeriod] = useState<TimePeriod>("week");
  const hashrateQuery = useHashrateIndexData({ timePeriod: chartTimePeriod });
  const btcPriceQuery = useBtcPriceIndexData({ timePeriod: chartTimePeriod });
  const contractSpecsQuery = useFuturesContractSpecs();
  const [hasOpenOrders, setHasOpenOrders] = useState(false);
  const [hasOpenPerpsOrders, setHasOpenPerpsOrders] = useState(false);
  const { data: participantData, isLoading: isParticipantLoading } = getUserFuturesOrders(address, {
    refetch: hasOpenOrders,
  });
  const { data: positionBookData, isLoading: isPositionBookLoading } = getUserFuturesPositions(address, {
    refetch: hasOpenOrders,
  });
  // Lifted from PerpsOrdersPositionsTabWidget so we can derive `hasOpenPerpsOrders`
  // here and gate the perps positions/orders polling cadence (15s while open, 60s
  // baseline for positions otherwise).
  const perpsOpenOrdersQuery = useUserPerpsOrders(address, {
    statuses: ["ACTIVE", "PARTIALLY_FILLED"],
    refetch: hasOpenPerpsOrders,
  });
  useEffect(() => {
    setHasOpenOrders((participantData?.data?.orders?.length ?? 0) > 0);
  }, [participantData?.data?.orders?.length]);
  useEffect(() => {
    const orders = perpsOpenOrdersQuery.data?.data?.orders ?? [];
    const openCount = orders.filter(
      (order) =>
        (order.status === "ACTIVE" || order.status === "PARTIALLY_FILLED") &&
        order.filledQuantity !== order.originalQuantity,
    ).length;
    setHasOpenPerpsOrders(openCount > 0);
  }, [perpsOpenOrdersQuery.data?.data?.orders]);
  const {
    data: historicalPositionsData,
    isLoading: isHistoricalPositionsLoading,
    isFetching: isHistoricalPositionsFetching,
  } = useHistoricalPositions(
    address,
    true,
  );

  // Single source of truth for the user's locked collateral: portfolio IM read
  // from the IPortfolioMarginEngine resolved via the Futures contract. This
  // replaces the previous mode-toggle aggregation between futures `getMinMargin`
  // and perps `getMaintenanceMargin`/`getInitialMargin`.
  const minMarginQuery = useGetPortfolioIM(address);

  const minMargin = useMemo(() => {
    if (minMarginQuery.data === undefined) return null;
    return minMarginQuery.data as bigint;
  }, [minMarginQuery.data]);

  // Spinner only before the first IM value; background polls should not replace
  // Locked with a spinner (see RefreshableValue in the balance widget).
  const isLoadingMinMargin = minMargin === null && minMarginQuery.isFetching;
  const isRefreshingMinMargin = minMargin !== null && minMarginQuery.isFetching;

  // Single shared balance — both Futures and Perps engines settle against the same CollateralVault,
  // so we always read `vault.balanceOf(account)` regardless of contract mode.
  const vaultBalanceQuery = useGetFutureBalance(address);
  const balanceQuery = useMemo(() => ({
    data: vaultBalanceQuery.data,
    isLoading: vaultBalanceQuery.isLoading,
    isFetching: vaultBalanceQuery.isFetching,
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
    previousData: previousMarketPrice,
    dataFetchedAt: marketPriceFetchedAt,
  } = useGetMarketPrice();

  // Get funding rate for perpetual contracts
  const fundingRateQuery = useFundingRate();

  // Get perps collection data (fees, margin requirements, etc)
  const perpsCollectionQuery = usePerpsCollection();

  // Fetch user position sessions for perpetual contracts
  const positionSessionsQuery = useUserPositionSessions(address, { refetch: hasOpenPerpsOrders });

  // Poll both products' trade feeds for new liquidations and surface a toast.
  const { notifications: liquidationNotifications, dismiss: dismissLiquidation } =
    useLiquidationNotifications(address);

  // Active expiration date selected in the order book (used for futures entry price line)
  const [selectedExpirationAt, setSelectedExpirationAt] = useState<number | undefined>();

  // Resolve the points hook address and its weighting params (WEIGHT_SCALE,
  // wTaker, wMaker) on initial load so they're warm in cache for the place-order
  // modal's reward estimate.
  usePointsHookWeights();

  // Account-wide liquidation prices, solved off the same portfolio margin model
  // the Futures contract liquidates on. Cross-product, so there is one pair per
  // account (not per position) and a hedged book can have thresholds on both sides.
  const { liqPrice, liqDirection, alreadyUnderwater } = useLiquidationThresholds(address);

  const openPositionNetQuantity = useMemo(() => {
    if (contractMode !== "perpetual") return null;
    const sessions = positionSessionsQuery.data?.positionSessions || [];
    const openSessions = sessions.filter((s) => s.status === "OPEN");
    if (openSessions.length === 0) return null;
    let sum = 0n;
    for (const s of openSessions) {
      sum += s.netQuantity;
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
      if (!address || !positionBookData?.data?.positions || !selectedExpirationAt) return null;
      const activePositions = positionBookData.data.positions
        .filter((p) => p.isActive && !p.closedAt && p.expirationAt === String(selectedExpirationAt))
        .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
      if (activePositions.length === 0) return null;
      const position = activePositions[0];
      const isLong = position.buyer.address.toLowerCase() === address.toLowerCase();
      const entryPrice = isLong ? position.buyPricePerDay : position.sellPricePerDay;
      return Number(entryPrice) / PAYMENT_TOKEN_SCALE_NUM;
    }
  }, [contractMode, positionSessionsQuery.data?.positionSessions, positionBookData?.data?.positions, address, selectedExpirationAt]);

  const liquidationPrice = useMemo(
    () => (liqPrice !== undefined ? Number(liqPrice) / PAYMENT_TOKEN_SCALE_NUM : null),
    [liqPrice],
  );

  // Calculate total unrealized PnL based on contract mode
  const totalUnrealizedPnL = useMemo(() => {
    if (!marketPrice || !address) return null;

    if (contractMode === "perpetual") {
      const sessions = positionSessionsQuery.data?.positionSessions || [];
      const openSessions = sessions.filter((session) => session.status === "OPEN");

      let totalPnL = 0n;
      openSessions.forEach((session) => {
        const netQuantity = session.netQuantity;
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

      // PnL = (mark - entry) * signedQty, summed across active positions.
      // `netQuantity` is the session's signed contract count (positive long /
      // negative short), so the sign of each position's PnL falls out naturally
      // — matches `getMinMarginForPositionManual` and the perps branch above.
      // `isLong` is only used to pick the correct entry price column from the
      // buy/sell split kept by the legacy row shape.
      activePositions.forEach((position: PositionBookPosition) => {
        if (position.netQuantity === 0) return;
        const isLong = position.buyer.address.toLowerCase() === address.toLowerCase();
        const entryPrice = isLong ? position.buyPricePerDay : position.sellPricePerDay;
        const priceDiff = marketPrice - entryPrice;
        totalPnL += priceDiff * BigInt(position.netQuantity);
      });

      return totalPnL;
    }
  }, [marketPrice, positionBookData?.data?.positions, address, contractMode, positionSessionsQuery.data?.positionSessions]);

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

  const proceedWithClosePosition = useCallback(
    (price: string, amount: number, isBuy: boolean, expirationAt?: number) => {
      setSelectedPrice(price);
      setSelectedAmount(amount);
      setSelectedIsBuy(isBuy);
      // Snap the order book (and PlaceOrderWidget's externalExpirationAt) to the
      // closing position's expiry so the prefilled order targets the correct book.
      if (expirationAt && contractMode === "futures") {
        setSelectedExpirationAt(expirationAt);
      }
      setHighlightMode("buttons");
      setHighlightTrigger((prev) => prev + 1);
    },
    [contractMode],
  );

  const closePositionModal = useClosePositionModal(proceedWithClosePosition);

  const handleOrderBookClick = (price: string, amount: number | null) => {
    setSelectedPrice(price);
    setSelectedAmount(1);
    setHighlightMode("inputs");
    setHighlightTrigger((prev) => prev + 1);
  };

  const handleExpirationAtChange = (expirationAt: number | undefined) => {
    setSelectedExpirationAt(expirationAt);
  };

  const currentPriceFormatted = marketPrice ? (Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2) : null;

  // Change of the current market price vs the previous distinct polled value.
  const priceChange = useMemo(() => {
    if (marketPrice == null || previousMarketPrice == null || marketPrice === previousMarketPrice) {
      return null;
    }
    const delta = Number(marketPrice - previousMarketPrice) / PAYMENT_TOKEN_SCALE_NUM;
    const prev = Number(previousMarketPrice) / PAYMENT_TOKEN_SCALE_NUM;
    const pct = prev !== 0 ? (delta / prev) * 100 : null;
    return { delta, pct };
  }, [marketPrice, previousMarketPrice]);

  // Surface the change indicator only briefly after each price move, then hide
  // it so the header settles back to just the current price.
  const [visiblePriceChange, setVisiblePriceChange] = useState<{ delta: number; pct: number | null } | null>(null);
  useEffect(() => {
    if (!priceChange) return;
    setVisiblePriceChange(priceChange);
    const timer = setTimeout(() => setVisiblePriceChange(null), 5000);
    return () => clearTimeout(timer);
  }, [priceChange]);

  // Each block is built once here and then placed by either the desktop grid
  // below or the mobile-only layout, so the two layouts share one set of props,
  // handlers and hook wiring.
  // `mobileActions` is only supplied by FuturesMobileLayout (the chart toggle);
  // the desktop branch calls this with nothing and renders the header unchanged.
  const renderHeader = (mobileActions?: ReactNode) => (
    <TradingHeader
      contractMode={contractMode}
      onContractModeChange={handleContractModeChange}
      contractSpecsQuery={contractSpecsQuery}
      currentPrice={currentPriceFormatted}
      priceChange={visiblePriceChange}
      fundingRate={fundingRateQuery.data?.formattedRate ?? "0%"}
      totalVolume={perpsCollectionQuery.data?.data?.totalVolume}
      selectedExpirationAt={selectedExpirationAt}
      liqPrice={liqPrice}
      liqDirection={liqDirection}
      isUnderwater={alreadyUnderwater}
      mobileActions={mobileActions}
    />
  );

  const chartNode = (
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
        isFetching={hashrateQuery.isFetching}
        isBtcPriceFetching={btcPriceQuery.isFetching}
        marketPrice={marketPrice}
        marketPriceFetchedAt={marketPriceFetchedAt}
        entryPrice={openPositionEntryPrice}
        liquidationPrice={liquidationPrice}
        liquidationDirection={liqDirection}
        timePeriod={chartTimePeriod}
        onTimePeriodChange={setChartTimePeriod}
      />
    </SmallWidget>
  );

  const orderBookNode = (
    <OrderBookTable
      onRowClick={handleOrderBookClick}
      onExpirationAtChange={handleExpirationAtChange}
      contractSpecsQuery={contractSpecsQuery}
      previousOrderBookStateRef={previousOrderBookStateRef}
      contractMode={contractMode}
      targetExpirationAt={selectedExpirationAt}
    />
  );

  const balanceNode = (
    <FuturesBalanceWidget
      minMargin={minMargin}
      isLoadingMinMargin={isLoadingMinMargin}
      isRefreshingMinMargin={isRefreshingMinMargin}
      unrealizedPnL={totalUnrealizedPnL}
      realizedPnL30D={totalRealizedPnL30D}
      isLoadingRealizedPnL={isHistoricalPositionsLoading}
      isRefreshingRealizedPnL={
        !isHistoricalPositionsLoading && isHistoricalPositionsFetching
      }
      balanceQuery={balanceQuery}
      accountBalance={accountBalanceQuery}
    />
  );

  const placeOrderNode = (
    <PlaceOrderWidget
      externalPrice={selectedPrice}
      externalAmount={selectedAmount}
      externalExpirationAt={selectedExpirationAt}
      externalIsBuy={selectedIsBuy}
      highlightTrigger={highlightTrigger}
      contractSpecsQuery={contractSpecsQuery}
      participantData={participantData?.data}
      highlightMode={highlightMode}
      latestPrice={marketPrice ?? null}
      minMargin={minMargin}
      contractMode={contractMode}
      accountBalance={accountBalanceQuery}
      balanceQuery={balanceQuery}
      perpsCollection={perpsCollectionQuery.data?.data}
      onOrderPlaced={async () => {
        await minMarginQuery.refetch();
      }}
    />
  );

  const tablesNode = isConnected ? (
    contractMode === "perpetual" ? (
      <PerpsOrdersPositionsTabWidget
        orders={participantData?.data?.orders || []}
        positions={positionBookData?.data?.positions || []}
        ordersLoading={isParticipantLoading}
        positionsLoading={isPositionBookLoading}
        participantAddress={address}
        onClosePosition={closePositionModal.handleClosePosition}
        participantData={participantData?.data}
        accountBalance={accountBalanceQuery}
        marketPrice={marketPrice}
        positionSessions={positionSessionsQuery.data?.positionSessions || []}
        positionSessionsLoading={positionSessionsQuery.isLoading}
        liqPrice={liqPrice}
        liqDirection={liqDirection}
        isUnderwater={alreadyUnderwater}
        perpsOpenOrders={perpsOpenOrdersQuery.data?.data?.orders || []}
        perpsOpenOrdersLoading={perpsOpenOrdersQuery.isLoading}
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
    )
  ) : null;

  return (
    <>
      <LiquidationToast notifications={liquidationNotifications} onDismiss={dismissLiquidation} />

      {isMobileTradingLayout ? (
        <FuturesMobileLayout
          header={renderHeader}
          chart={chartNode}
          balance={balanceNode}
          orderBook={orderBookNode}
          placeOrder={placeOrderNode}
          tables={tablesNode}
        />
      ) : (
        <FuturesContainer>
          {/* Row 1: Compact Trading Header — full width */}
          <TradingHeaderArea>{renderHeader()}</TradingHeaderArea>

          {/* Row 2, Col 1: Chart */}
          <ChartArea>{chartNode}</ChartArea>

          {/* Row 2, Col 2: Order Book */}
          <OrderBookArea>{orderBookNode}</OrderBookArea>

          {/* Col 3 (full height): Account Balance + Place Order + Order Information */}
          <RightPanelArea>
            {balanceNode}
            {placeOrderNode}
            {/* <OrderInfoSection>
              <OrderInfoTitle>Order Information</OrderInfoTitle>
            </OrderInfoSection> */}
          </RightPanelArea>

          {/* Row 3, Col 1+2: Orders and Positions — does NOT span right panel column */}
          {tablesNode && <OrdersPositionsArea>{tablesNode}</OrdersPositionsArea>}
        </FuturesContainer>
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
    </>
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
// Stretches to match the chart column's height so the two blocks line up, but
// is clamped between a 437px floor (so it never collapses to a few records) and
// a 540px cap (so a very tall chart doesn't drag it oversized).
//
// The child is absolutely positioned to fill this area so its own content never
// contributes to the (content-sized `auto`) grid row. Without this the tall
// Trades list would inflate the row to the 540px cap while the internally
// scrolled order book left it at the chart's height — giving two different
// heights per tab. With it, only the chart drives the row and the order book
// fills that height identically across tabs, modes, and data density.
const OrderBookArea = styled("div")`
  grid-column: 2;
  grid-row: 2;
  min-width: 0;
  position: relative;
  align-self: stretch;
  min-height: 437px;
  max-height: 540px;

  > * {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  @media (max-width: 1024px) {
    grid-column: 1;
    grid-row: auto;
    position: static;
    max-height: none;

    > * {
      position: static;
    }
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
  > *:first-of-type {
    flex-shrink: 0;
  }

  /* PlaceOrderWidget: grows to fill remaining space */
  > *:nth-of-type(2) {
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

    > *:nth-of-type(2) {
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
