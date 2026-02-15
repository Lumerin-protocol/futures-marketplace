import { useState, useMemo } from "react";
import styled from "@mui/material/styles/styled";
import { SmallWidget } from "../../Cards/Cards.styled";
import { TabSwitch } from "../../TabSwitch";
import type { ParticipantOrder } from "../../../hooks/data/useParticipant";
import type { PositionBookPosition } from "../../../hooks/data/usePositionBook";
import { useHistoricalOrders } from "../../../hooks/data/useHistoricalOrders";
import type { AccountBalance } from "../../../types/types";

type TabType = "OPEN_ORDERS" | "POSITIONS" | "TRADES" | "ORDERS_HISTORY";

interface PerpsOrdersPositionsTabWidgetProps {
  orders: ParticipantOrder[];
  positions: PositionBookPosition[];
  ordersLoading?: boolean;
  positionsLoading?: boolean;
  participantAddress?: `0x${string}`;
  onClosePosition?: (price: string, amount: number, isBuy: boolean) => void;
  participantData?: any;
  minMargin?: bigint | null;
  accountBalance?: AccountBalance;
}

export const PerpsOrdersPositionsTabWidget = ({
  orders,
  positions,
  ordersLoading,
  positionsLoading,
  participantAddress,
  onClosePosition,
  participantData,
  minMargin,
  accountBalance,
}: PerpsOrdersPositionsTabWidgetProps) => {
  const [activeTab, setActiveTab] = useState<TabType>("OPEN_ORDERS");

  // Fetch historical orders for Orders History tab
  const historicalOrdersQuery = useHistoricalOrders(
    participantAddress,
    activeTab === "ORDERS_HISTORY"
  );

  // Count unique orders
  const ordersCount = useMemo(() => {
    const unique = new Set<string>();
    orders.forEach((order) => {
      unique.add(`${order.pricePerDay.toString()}`);
    });
    return unique.size;
  }, [orders]);

  // Count unique positions
  const positionsCount = useMemo(() => {
    return positions.filter((p) => p.isActive).length;
  }, [positions]);

  // Count trades (for now, showing 0 - needs implementation)
  const tradesCount = 0;

  // Count historical orders
  const ordersHistoryCount = useMemo(() => {
    if (activeTab !== "ORDERS_HISTORY") return 0;
    const historicalOrders = historicalOrdersQuery.data?.data || [];
    const unique = new Set<string>();
    historicalOrders.forEach((order) => {
      unique.add(`${order.pricePerDay.toString()}`);
    });
    return unique.size;
  }, [activeTab, historicalOrdersQuery.data?.data]);

  return (
    <TabContainer>
      <Header>
        <TabSwitch
          values={[
            { text: "Open Orders", value: "OPEN_ORDERS", count: ordersCount },
            { text: "Positions", value: "POSITIONS", count: positionsCount },
            { text: "Trades", value: "TRADES", count: tradesCount },
            { text: "Orders History", value: "ORDERS_HISTORY", count: ordersHistoryCount },
          ]}
          value={activeTab}
          setValue={setActiveTab}
        />
      </Header>

      <Content>
        {activeTab === "OPEN_ORDERS" && (
          <OrdersWrapper>
            {/* OrdersListWidget will be added here */}
            <PlaceholderText>Open Orders content</PlaceholderText>
          </OrdersWrapper>
        )}
        {activeTab === "POSITIONS" && (
          <PositionsWrapper>
            {/* PositionsListWidget will be added here */}
            <PlaceholderText>Positions content</PlaceholderText>
          </PositionsWrapper>
        )}
        {activeTab === "TRADES" && (
          <TradesWrapper>
            {/* Trades content will be added here */}
            <PlaceholderText>Trades content (coming soon)</PlaceholderText>
          </TradesWrapper>
        )}
        {activeTab === "ORDERS_HISTORY" && (
          <OrdersWrapper>
            {/* HistoricalOrdersListWidget will be added here */}
            <PlaceholderText>Orders History content</PlaceholderText>
          </OrdersWrapper>
        )}
      </Content>
    </TabContainer>
  );
};

const TabContainer = styled(SmallWidget)`
  width: 100%;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: start;
  
  h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: #fff;
  }
`;

const Header = styled("div")`
  padding: 1.5rem 1.5rem 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
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

const PlaceholderText = styled("div")`
  padding: 2rem;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.875rem;
`;
