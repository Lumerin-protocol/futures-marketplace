import type { ReactNode } from "react";
import { useState } from "react";
import styled from "@mui/material/styles/styled";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import { tokens } from "../../../../styles/tokens";

// MOBILE-ONLY trading layout (see MOBILE_TRADING_QUERY). The desktop grid in
// Futures.tsx is not mounted at these widths, so every style in this file is
// scoped to mobile and cannot affect the web version.
//
// Differences vs desktop:
//   - the chart is collapsed by default behind a toggle in the header's
//     contract-mode row
//   - the order book sits beside the place-order form instead of above it
//   - widget padding / font sizes are stepped down to fit two columns
// Header, balance widget and the orders/positions tables keep their normal
// full-width rendering.
interface FuturesMobileLayoutProps {
  // Called with the mobile-only header controls (the chart toggle) so the page
  // can hand them to TradingHeader without owning any mobile state itself.
  header: (mobileActions: ReactNode) => ReactNode;
  chart: ReactNode;
  balance: ReactNode;
  orderBook: ReactNode;
  placeOrder: ReactNode;
  tables: ReactNode;
}

export const FuturesMobileLayout = ({
  header,
  chart,
  balance,
  orderBook,
  placeOrder,
  tables,
}: FuturesMobileLayoutProps) => {
  const [showChart, setShowChart] = useState(false);

  return (
    <MobileContainer>
      {header(
        <ChartToggleButton
          type="button"
          $active={showChart}
          onClick={() => setShowChart((prev) => !prev)}
          aria-label={showChart ? "Hide chart" : "Show chart"}
          aria-pressed={showChart}
          title={showChart ? "Hide chart" : "Show chart"}
        >
          <ShowChartIcon style={{ fontSize: "1.1rem" }} />
        </ChartToggleButton>,
      )}

      {showChart && <MobileChartSlot>{chart}</MobileChartSlot>}

      <MobileBalanceSlot>{balance}</MobileBalanceSlot>

      <MobileSplitRow>
        <MobileBookSlot>{orderBook}</MobileBookSlot>
        <MobilePlaceOrderSlot>{placeOrder}</MobilePlaceOrderSlot>
      </MobileSplitRow>

      {tables}
    </MobileContainer>
  );
};

const MobileContainer = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  margin-top: 10px;

  /* Mirrors the desktop grid areas, which also let children shrink below their
     min-content width so wide tables scroll internally instead of widening the page. */
  > * {
    width: 100%;
    min-width: 0;
  }
`;

const ChartToggleButton = styled("button")<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.5rem;
  border: 1px solid ${tokens.border.default};
  border-radius: ${tokens.radius.sm};
  background: ${(props) => (props.$active ? tokens.surface.tabActive : "transparent")};
  color: ${(props) => (props.$active ? tokens.text.onDark : tokens.text.secondary)};
  cursor: pointer;
  line-height: 1;
`;

const MobileChartSlot = styled("div")`
  min-height: 260px;

  && > * {
    width: 100%;
    height: 100%;
    min-width: 0;
    margin-bottom: 0;
  }
`;

const MobileBalanceSlot = styled("div")`
  && > * {
    width: 100%;
    min-width: 0;
    margin-bottom: 0;
  }
`;

const MobileSplitRow = styled("div")`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.5rem;
  align-items: stretch;
`;

// Mirrors the desktop OrderBookArea trick: the widget is absolutely positioned
// inside this slot so the virtualized ladder (thousands of futures ticks) never
// inflates the row height. The slot keeps a floor of 420px and stretches when
// the place-order column is taller.
const MobileBookSlot = styled("div")`
  position: relative;
  min-width: 0;
  min-height: 420px;
  align-self: stretch;

  /* Doubled class (&&) so these win over the widget's own single-class rules
     regardless of emotion's style insertion order. */
  && > * {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    min-width: 0;
    padding: 0.5rem 0.4rem;
    margin-bottom: 0;
  }
`;

// SmallWidget carries min-width: 215px and the place-order form is padded for a
// 300px desktop column, so both are relaxed here to fit half a phone screen.
const MobilePlaceOrderSlot = styled("div")`
  min-width: 0;

  && > * {
    width: 100%;
    height: 100%;
    min-width: 0;
    padding: 0.75rem 0.5rem;
    margin-bottom: 0;
  }

  && label {
    font-size: 0.7rem;
  }

  && input,
  && select {
    font-size: 0.8rem;
    padding: 0.5rem;
  }

  /* Only the desktop min-widths are relaxed here; the toggles, price steppers,
     slider and Bid/Ask buttons carry their own mobile metrics in PlaceOrderWidget
     so they can match the order book column beside them. */
  && button {
    min-width: 0;
  }
`;
