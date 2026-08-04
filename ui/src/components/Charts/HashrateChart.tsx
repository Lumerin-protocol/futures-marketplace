import { type FC, useMemo, useEffect, useState, useCallback } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import styled from "@mui/material/styles/styled";
import type { TimePeriod } from "../../hooks/data/useHashRateIndexData";
import { tokens } from "../../styles/tokens";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../lib/units";
import { Spinner } from "../Spinner.styled";

const PeriodSwitch = styled("div")`
  display: flex;
  gap: 0;
  border: 1px solid ${tokens.border.default};
  border-radius: 6px;
  overflow: hidden;
  align-self: end;
  margin-top: 1rem;
  margin-bottom: 1rem;
  margin-right: 12px;
`;

const PeriodButton = styled("button")<{ $active: boolean }>`
  padding: 0.5rem 1rem;
  background: ${(props) => (props.$active ? tokens.surface.tabActive : "transparent")};
  color: ${tokens.text.onDark};
  border: none;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
  white-space: nowrap;

  &:hover {
    background: ${(props) => (props.$active ? tokens.surface.tabHover : tokens.surface.tabInactiveHover)};
  }

  &:not(:last-child) {
    border-right: 1px solid ${tokens.border.muted05};
  }
`;

const ChartTitle = styled("div")`
  font-size: 0.7rem;
  font-weight: 500;
  color: ${tokens.text.secondary};
  text-transform: uppercase;
  letter-spacing: 0.03em;
`;

const ChartControls = styled("div")`
  display: flex;
  align-items: center;
  width: 100%;
  padding-left: 18px;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 1rem;
`;

interface HashrateChartProps {
  data: Array<{
    updatedAtDate?: Date;
    updatedAt?: string;
    priceToken: number;
  }>;
  btcPriceData?: Array<{
    updatedAtDate?: Date;
    updatedAt?: string;
    price: number;
  }>;
  isLoading?: boolean;
  isBtcPriceLoading?: boolean;
  isFetching?: boolean;
  isBtcPriceFetching?: boolean;
  marketPrice?: bigint | null;
  marketPriceFetchedAt?: Date;
  entryPrice?: number | null;
  /** Account-wide, cross-product price at which the portfolio becomes liquidatable. */
  liquidationPrice?: number | null;
  /** Which way spot has to move to reach `liquidationPrice`. */
  liquidationDirection?: "down" | "up";
  timePeriod: TimePeriod;
  onTimePeriodChange: (period: TimePeriod) => void;
}

export const HashrateChart: FC<HashrateChartProps> = ({
  data,
  btcPriceData,
  isLoading = false,
  isBtcPriceLoading = false,
  isFetching = false,
  isBtcPriceFetching = false,
  marketPrice,
  marketPriceFetchedAt,
  entryPrice,
  liquidationPrice,
  liquidationDirection,
  timePeriod,
  onTimePeriodChange,
}) => {
  // State to track BTC Price visibility
  const [isBtcPriceVisible, setIsBtcPriceVisible] = useState(false);

  // Track time period changes and log to console
  useEffect(() => {
    console.log("Time period changed to:", timePeriod);
  }, [timePeriod]);

  // Handler for BTC Price legend click
  const handleBtcPriceLegendClick = useCallback(() => {
    setIsBtcPriceVisible((prev) => !prev);
    return false; // We handle visibility via state
  }, []);

  // Merge market price with historical data if it differs from the first item
  const enhancedData = useMemo(() => {
    if (!marketPrice || !data || data.length === 0) {
      return data;
    }

    const firstItem = data[0];
    const firstItemPrice = firstItem?.priceToken;

    if (!firstItemPrice) {
      return data;
    }

    const marketPriceUsd = Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM;

    // Check if marketPrice is different from the first item's price
    if (firstItemPrice !== marketPriceUsd) {
      // Add marketPrice as the latest value with the timestamp when it was fetched
      return [
        {
          updatedAtDate: marketPriceFetchedAt ?? new Date(),
          priceToken: marketPriceUsd,
        },
        ...data,
      ];
    }

    return data;
  }, [data, marketPrice, marketPriceFetchedAt]);

  // Transform data for Highcharts
  const chartData = enhancedData
    .filter((item) => item.updatedAtDate || item.updatedAt) // Filter out items without date
    .filter((item) => item.priceToken > 0.01)
    .map((item) => {
      const date = item.updatedAtDate || new Date(Number(item.updatedAt) * 1000);
      return [
        date.getTime(), // X-axis: timestamp
        item.priceToken, // Y-axis: hashprice in USD
      ];
    });

  // Transform BTC price data for Highcharts
  const btcPriceChartData = useMemo(() => {
    if (!btcPriceData || btcPriceData.length === 0) return [];

    return btcPriceData
      .filter((item) => item.updatedAtDate || item.updatedAt)
      .filter((item) => item.price > 0)
      .map((item) => {
        const date = item.updatedAtDate || new Date(Number(item.updatedAt) * 1000);
        return [
          date.getTime(), // X-axis: timestamp
          item.price, // Y-axis: BTC price (USD)
        ];
      });
  }, [btcPriceData]);

  const options: Highcharts.Options = {
    time: {
      useUTC: false, // Display dates in local timezone
    } as Highcharts.TimeOptions,
    chart: {
      type: "spline",
      backgroundColor: "transparent",
      style: {
        fontFamily: "inherit",
      },
    },
    title: { text: undefined },
    xAxis: {
      type: "datetime",
      title: {
        text: null,
        style: {
          color: tokens.text.primary,
        },
      },
      labels: {
        style: {
          color: tokens.text.primary,
        },
      },
      gridLineColor: tokens.chart.grid,
    },
    yAxis: [
      {
        // Primary Y-axis for Hashprice (USDC)
        title: {
          text: "Hashprice (USDC)",
          style: {
            color: tokens.text.primary,
          },
        },
        labels: {
          style: {
            color: tokens.text.primary,
          },
          formatter: function () {
            return Number(this.value).toFixed(2);
          },
        },
        gridLineColor: tokens.chart.grid,
        plotLines: (() => {
          const lines: Highcharts.YAxisPlotLinesOptions[] = [];

          if (entryPrice) {
            lines.push({
              value: entryPrice,
              color: tokens.text.primary,
              dashStyle: "Dash",
              width: 1,
              zIndex: 5,
              label: {
                text: `Entry: ${entryPrice.toFixed(2)}`,
                align: "right",
                style: { color: tokens.text.primary },
              },
            });
          }

          if (liquidationPrice != null && chartData.length > 0) {
            const yValues = chartData.map((p) => (p as [number, number])[1]);
            const dataMin = Math.min(...yValues);
            const dataMax = Math.max(...yValues);
            const padding = (dataMax - dataMin) * 0.1;
            const visibleMin = dataMin - padding;
            const visibleMax = dataMax + padding;

            // Pin an off-range threshold to the edge of the axis. The label
            // carries the true price, and the arrow says which way spot has to
            // move to reach it.
            const clampedValue = Math.min(Math.max(liquidationPrice, visibleMin), visibleMax);
            const arrow = liquidationDirection === "up" ? "↑" : "↓";

            lines.push({
              value: clampedValue,
              color: tokens.trading.short,
              dashStyle: "Dash",
              width: 1,
              zIndex: 5,
              label: {
                text: `Liq${arrow}: ${liquidationPrice.toFixed(2)}`,
                align: "right",
                style: { color: tokens.trading.short },
              },
            });
          }

          return lines;
        })(),
      },
      {
        // Secondary Y-axis for BTC Price (USD)
        title: {
          text: isBtcPriceVisible ? "BTC Price (USD)" : "",
          style: {
            color: tokens.text.primary,
          },
        },
        labels: {
          enabled: isBtcPriceVisible,
          style: {
            color: tokens.text.primary,
          },
          formatter: function () {
            return Number(this.value).toLocaleString();
          },
        },
        opposite: true,
        gridLineWidth: 0,
      },
    ],
    series: [
      {
        connectNulls: false,
        dataSorting: { enabled: false },
        dataGrouping: { enabled: false },
        type: "line",
        name: "Hashprice",
        showInLegend: true,
        data: chartData,
        color: tokens.trading.long,
        lineWidth: 2,
        yAxis: 0,
        marker: {
          enabled: false,
          radius: 4,
        },
        events: {
          legendItemClick: function () {
            const series = this;
            if (!series.visible) {
              series.show();
            }
            return false; // Prevent unchecking Hashprice
          },
        },
      },
      {
        connectNulls: false,
        dataSorting: { enabled: false },
        dataGrouping: { enabled: false },
        type: "line",
        name: "BTC Price",
        showInLegend: true,
        visible: isBtcPriceVisible,
        data: btcPriceChartData,
        color: tokens.chart.seriesBtc,
        lineWidth: 2,
        yAxis: 1,
        marker: {
          enabled: false,
          radius: 4,
        },
        events: {
          legendItemClick: handleBtcPriceLegendClick,
        },
      },
    ],
    legend: {
      enabled: true,
      useHTML: true,
      itemStyle: {
        color: tokens.text.primary,
        cursor: "pointer",
      },
      itemHoverStyle: {
        color: tokens.text.primary,
      },
      itemHiddenStyle: {
        color: tokens.chart.axisMuted,
        textDecoration: "none",
      },
      labelFormatter: function () {
        const series = this as Highcharts.Series;
        const checked = series.visible;
        const checkboxStyle = `
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid ${series.color};
          border-radius: 3px;
          margin-right: 6px;
          vertical-align: middle;
          background: ${checked ? series.color : "transparent"};
          position: relative;
        `;
        const checkmark = checked && series.name !== "Hashprice"
          ? `<span style="position: absolute; top: -1px; left: 0px; color: ${tokens.text.onDark}; font-size: 11px; font-weight: bold;">✓</span>`
          : "";
        return `<span style="${checkboxStyle}">${checkmark}</span><span style="vertical-align: middle;">${series.name}</span>`;
      },
      symbolWidth: 0,
      symbolHeight: 0,
      symbolRadius: 0,
    },
    plotOptions: {
      line: {
        marker: {
          enabled: true,
        },
      },
    },
    tooltip: {
      shared: true,
      backgroundColor: tokens.chart.tooltipBg,
      borderColor: tokens.chart.tooltipBorder,
      style: {
        color: tokens.text.primary,
      },
      formatter: function () {
        const date = new Date(this.x as number).toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        let tooltipHtml = `<span style="color: ${tokens.chart.axisMuted}; font-size: 10px;">${date}</span><br/>`;

        this.points?.forEach((point) => {
          const color = point.series.color;
          const name = point.series.name;
          const value =
            name === "BTC Price"
              ? (point.y as number).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
              : (point.y as number).toFixed(2);
          tooltipHtml += `<span style="color:${color}">\u25CF</span> <b>${name}:</b> ${value}<br/>`;
        });

        return tooltipHtml;
      },
    },
    credits: {
      enabled: false,
    },
  };

  if ((isLoading || isBtcPriceLoading) && (!data || data.length === 0)) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          height: "400px",
          color: tokens.text.primary,
          fontSize: "18px",
        }}
      >
        <Spinner fontSize="0.35em" />
        <div>Loading chart data...</div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "400px",
          color: tokens.text.primary,
          fontSize: "18px",
        }}
      >
        No data available
      </div>
    );
  }

  return (
    <>
      <ChartTitle>Hashprice Index</ChartTitle>
      <ChartControls>
        <PeriodSwitch>
          <PeriodButton $active={timePeriod === "day"} onClick={() => onTimePeriodChange("day")}>
            1D
          </PeriodButton>
          <PeriodButton $active={timePeriod === "week"} onClick={() => onTimePeriodChange("week")}>
            7D
          </PeriodButton>
          <PeriodButton $active={timePeriod === "month"} onClick={() => onTimePeriodChange("month")}>
            30D
          </PeriodButton>
        </PeriodSwitch>
      </ChartControls>
      <div style={{ position: "relative", width: "100%", paddingTop: "1rem" }}>
        <HighchartsReact highcharts={Highcharts} options={options} containerProps={{ style: { height: "100%" } }} />
        {(isFetching || isBtcPriceFetching) && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              gap: "0.25rem",
              background: "rgba(15, 17, 23, 0.55)",
              backdropFilter: "blur(1px)",
              color: tokens.text.primary,
              fontSize: "14px",
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            <Spinner fontSize="0.3em" />
            <div>Updating chart…</div>
          </div>
        )}
      </div>
    </>
  );
};
