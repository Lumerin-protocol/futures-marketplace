import { tokens } from "../../../styles/tokens";
import { useState, useMemo, useEffect } from "react";
import styled from "@mui/material/styles/styled";
import { SmallWidget } from "../../Cards/Cards.styled";
import { TabSwitch } from "../../TabSwitch";
import { OrdersListWidget } from "./OrdersListWidget";
import { PositionsListWidget } from "./PositionsListWidget";
import { HistoricalOrdersListWidget } from "./HistoricalOrdersListWidget";
import { HistoricalPositionsListWidget } from "./HistoricalPositionsListWidget";
import type { ParticipantOrder } from "../../../hooks/data/getUserFuturesOrders";
import type { PositionBookPosition } from "../../../hooks/data/getUserFuturesPositions";
import { useHistoricalOrders } from "../../../hooks/data/useHistoricalOrders";
import { useHistoricalPositions } from "../../../hooks/data/useHistoricalPositions";
import { useUserFuturesTrades, type UserFuturesTrade } from "../../../hooks/data/useUserFuturesTrades";
import { DateTimeCell } from "../../DateTimeCell";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
import { getTxUrl } from "../../../lib/indexer";

import type { AccountBalance, ContractMode } from "../../../types/types";

type TabType = "OPEN_ORDERS" | "POSITIONS" | "TRADES" | "POSITION_HISTORY" | "ORDER_HISTORY";

interface BalanceQueryResult {
  data: bigint | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: () => void;
}

interface OrdersPositionsTabWidgetProps {
  orders: ParticipantOrder[];
  positions: PositionBookPosition[];
  ordersLoading?: boolean;
  positionsLoading?: boolean;
  participantAddress?: `0x${string}`;
  onClosePosition?: (price: string, amount: number, isBuy: boolean) => void;
  participantData?: any;
  minMargin?: bigint | null;
  accountBalance?: AccountBalance;
  contractMode?: ContractMode;
  balanceQuery: BalanceQueryResult;
}

export const OrdersPositionsTabWidget = ({
  orders,
  positions,
  ordersLoading,
  positionsLoading,
  participantAddress,
  onClosePosition,
  participantData,
  minMargin,
  accountBalance,
  contractMode = "futures",
  balanceQuery,
}: OrdersPositionsTabWidgetProps) => {
  const [activeTab, setActiveTab] = useState<TabType>("OPEN_ORDERS");

  // Fetch up-front so the tab badge counts (Order History / Position History /
  // Trades) are accurate on initial render. Each query is cached by react-query
  // and shared with other consumers (e.g. Futures.tsx already calls
  // useHistoricalPositions), so this doesn't duplicate work — only auto-refetch
  // is gated on the active tab.
  const historicalOrdersQuery = useHistoricalOrders(participantAddress, true);
  const historicalPositionsQuery = useHistoricalPositions(participantAddress, true);
  const tradesQuery = useUserFuturesTrades(participantAddress, { refetch: activeTab === "TRADES" });

  // Counts for the tab badges. For Open Orders / Positions / Order History /
  // Position History we use the same `(pricePerDay, deliveryAt[, side])`
  // grouping the underlying widgets render with, so the badge matches the row
  // count in the table. Trades is a flat list — same as perps.
  const ordersCount = useMemo(() => {
    const unique = new Set<string>();
    orders.forEach((order) => {
      unique.add(`${order.deliveryAt.toString()}_${order.pricePerDay.toString()}`);
    });
    return unique.size;
  }, [orders]);

  const positionsCount = useMemo(() => {
    const unique = new Set<string>();
    positions.forEach((p) => {
      const isLong = participantAddress && p.buyer.address.toLowerCase() === participantAddress.toLowerCase();
      const pricePerDay = isLong ? p.buyPricePerDay : p.sellPricePerDay;
      unique.add(`${p.deliveryAt.toString()}_${pricePerDay.toString()}`);
    });
    return unique.size;
  }, [positions, participantAddress]);

  const tradesCount = useMemo(() => {
    return tradesQuery.data?.trades.length ?? 0;
  }, [tradesQuery.data?.trades]);

  const orderHistoryCount = useMemo(() => {
    return historicalOrdersQuery.data?.data?.length ?? 0;
  }, [historicalOrdersQuery.data?.data]);

  const positionHistoryCount = useMemo(() => {
    return historicalPositionsQuery.data?.data?.length ?? 0;
  }, [historicalPositionsQuery.data?.data]);

  // Auto-switch to Positions tab when there are no open orders but there are open positions.
  useEffect(() => {
    if (ordersLoading || positionsLoading) return;
    if (ordersCount === 0 && positionsCount > 0) {
      setActiveTab("POSITIONS");
    }
  }, [ordersLoading, positionsLoading, ordersCount, positionsCount]);

  const [tradesVisibleCount, setTradesVisibleCount] = useState(10);

  return (
    <TabContainer>
      <Header>
        <TabSwitchWrapper>
          <TabSwitch
            values={[
              { text: "Open Orders", value: "OPEN_ORDERS", count: ordersCount },
              { text: "Positions", value: "POSITIONS", count: positionsCount },
              { text: "Trades", value: "TRADES", count: tradesCount },
              { text: "Position History", value: "POSITION_HISTORY", count: positionHistoryCount },
              { text: "Order History", value: "ORDER_HISTORY", count: orderHistoryCount },
            ]}
            value={activeTab}
            setValue={setActiveTab}
          />
        </TabSwitchWrapper>
      </Header>

      <Content>
        {activeTab === "OPEN_ORDERS" && (
          <OrdersWrapper>
            <OrdersListWidget
              orders={orders}
              isLoading={ordersLoading}
              participantData={participantData}
              minMargin={minMargin}
              accountBalance={accountBalance}
              contractMode={contractMode}
              balanceQuery={balanceQuery}
            />
          </OrdersWrapper>
        )}
        {activeTab === "POSITIONS" && (
          <PositionsWrapper>
            <PositionsListWidget
              positions={positions}
              isLoading={positionsLoading}
              participantAddress={participantAddress}
              onClosePosition={onClosePosition}
              contractMode={contractMode}
              balanceQuery={balanceQuery}
            />
          </PositionsWrapper>
        )}
        {activeTab === "TRADES" && (
          <TradesWrapper>
            <FuturesTradesTable
              trades={tradesQuery.data?.trades ?? []}
              isLoading={tradesQuery.isLoading}
              visibleCount={tradesVisibleCount}
              onLoadMore={() => setTradesVisibleCount((c) => c + 10)}
            />
          </TradesWrapper>
        )}
        {activeTab === "POSITION_HISTORY" && (
          <PositionsWrapper>
            <HistoricalPositionsListWidget
              positions={historicalPositionsQuery.data?.data ?? []}
              isLoading={historicalPositionsQuery.isLoading}
              participantAddress={participantAddress}
            />
          </PositionsWrapper>
        )}
        {activeTab === "ORDER_HISTORY" && (
          <OrdersWrapper>
            <HistoricalOrdersListWidget
              orders={historicalOrdersQuery.data?.data ?? []}
              isLoading={historicalOrdersQuery.isLoading}
            />
          </OrdersWrapper>
        )}
      </Content>
    </TabContainer>
  );
};

// Futures Trades Table Component
interface FuturesTradesTableProps {
  trades: UserFuturesTrade[];
  isLoading?: boolean;
  visibleCount: number;
  onLoadMore: () => void;
}

const FuturesTradesTable = ({ trades, isLoading, visibleCount, onLoadMore }: FuturesTradesTableProps) => {
  const formatPrice = (price: bigint) => {
    return (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  };

  const formatPnL = (pnl: bigint) => {
    const value = Number(pnl) / PAYMENT_TOKEN_SCALE_NUM;
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)} USDC`;
  };

  const sortedTrades = [...trades].sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
  const displayedTrades = sortedTrades.slice(0, visibleCount);

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", color: tokens.text.muted }}>
        <p>Loading trades...</p>
      </div>
    );
  }

  if (sortedTrades.length === 0) {
    return (
      <EmptyState>
        <p>No trades found</p>
      </EmptyState>
    );
  }

  return (
    <TableContainer>
      <Table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Side</th>
            <th>Contract Expiration</th>
            <th>Price (USDC)</th>
            <th>Quantity</th>
            <th>Trading Fee</th>
            <th>Realized PnL</th>
            <th>Tx Hash</th>
          </tr>
        </thead>
        <tbody>
          {displayedTrades.map((trade) => {
            const isLong = trade.tradeQuantity >= 0;
            return (
              <TableRow key={trade.id}>
                <td>
                  <DateTimeCell timestamp={trade.timestamp} />
                </td>
                <td>
                  <TypeBadge $type={isLong ? "Long" : "Short"}>{isLong ? "Long" : "Short"}</TypeBadge>
                </td>
                <td>
                  <DateTimeCell timestamp={trade.deliveryAt} />
                </td>
                <td>{formatPrice(trade.tradePrice)}</td>
                <td>{Math.abs(trade.tradeQuantity)}</td>
                <td>{formatPrice(trade.tradingFee)}</td>
                <td>
                  <PnLText
                    $isPositive={Number(trade.realizedPnl) >= 0}
                    $isZero={Number(trade.realizedPnl) === 0}
                  >
                    {formatPnL(trade.realizedPnl)}
                  </PnLText>
                </td>
                <td>
                  <TxLink
                    href={getTxUrl(trade.transactionHash as `0x${string}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {trade.transactionHash.slice(0, 6)}...{trade.transactionHash.slice(-4)}
                  </TxLink>
                </td>
              </TableRow>
            );
          })}
        </tbody>
      </Table>
      {visibleCount < sortedTrades.length && (
        <LoadMoreButton onClick={onLoadMore}>Load next 10 items</LoadMoreButton>
      )}
    </TableContainer>
  );
};

const TabContainer = styled(SmallWidget)`
  width: 100%;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: start;
  border: 1px solid ${tokens.border.muted04};

  h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: ${tokens.text.onDark};
  }
`;

const Header = styled("div")`
  padding: 1.5rem 1.5rem 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
`;

const TabSwitchWrapper = styled("div")`
  width: 100%;
  min-width: 0;

  button {
    font-size: 0.875rem;
    padding: 0.1em 0.5em;
  }
`;

const Content = styled("div")`
  width: 100%;
  padding: 0 1.5rem 1.5rem 1.5rem;
`;

const OrdersWrapper = styled("div")`
  width: 100%;

  /* Hide the widget's header since we have tabs */
  h3 {
    display: none;
  }
`;

const PositionsWrapper = styled("div")`
  width: 100%;

  /* Hide the widget's header since we have tabs */
  h3 {
    display: none;
  }
`;

const TradesWrapper = styled("div")`
  width: 100%;
`;

const TableContainer = styled("div")`
  width: 100%;
  overflow-x: auto;

  &::-webkit-scrollbar {
    height: 4px;
  }

  &::-webkit-scrollbar-track {
    background: ${tokens.overlay.white10};
    border-radius: 2px;
  }

  &::-webkit-scrollbar-thumb {
    background: ${tokens.overlay.white30};
    border-radius: 2px;
  }
`;

const Table = styled("table")`
  width: 100%;
  border-collapse: collapse;
  min-width: 600px;

  th {
    text-align: left;
    padding: 0.75rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: ${tokens.text.secondary};
    border-bottom: 1px solid ${tokens.overlay.white10};
    white-space: nowrap;
  }

  td {
    padding: 0.75rem 0.5rem;
    font-size: 0.875rem;
    color: ${tokens.text.onDark};
    border-bottom: 1px solid ${tokens.overlay.white05};
  }
`;

const TableRow = styled("tr")`
  &:hover {
    background-color: ${tokens.overlay.white02};
  }

  &:last-child td {
    border-bottom: none;
  }
`;

const TypeBadge = styled("span")<{ $type: string }>`
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background-color: ${(props) => (props.$type === "Long" ? tokens.trading.longRowBg : tokens.trading.shortRowBg)};
  color: ${(props) => (props.$type === "Long" ? tokens.trading.long : tokens.trading.short)};
`;

const EmptyState = styled("div")`
  text-align: center;
  padding: 2rem;
  color: ${tokens.text.muted};

  p {
    margin: 0;
    font-size: 0.875rem;
  }
`;

const PnLText = styled("span")<{ $isPositive: boolean; $isZero?: boolean }>`
  color: ${(props) =>
    props.$isZero
      ? tokens.text.primary
      : props.$isPositive
        ? tokens.trading.long
        : tokens.trading.short};
  font-weight: 600;
`;

const TxLink = styled("a")`
  color: ${tokens.trading.info};
  text-decoration: none;
  font-family: monospace;
  font-size: 0.8rem;

  &:hover {
    text-decoration: underline;
  }
`;

const LoadMoreButton = styled("button")`
  display: block;
  width: 100%;
  padding: 0.75rem;
  margin-top: 0.5rem;
  background: transparent;
  color: ${tokens.text.secondary};
  border: none;
  font-size: 0.875rem;
  cursor: pointer;
  text-align: center;
  transition: color 0.2s ease;

  &:hover {
    color: ${tokens.text.onDark};
  }
`;
