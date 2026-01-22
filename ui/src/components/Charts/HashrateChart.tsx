import { type FC, useMemo, useEffect, useState } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import styled from "@mui/material/styles/styled";
import type { TimePeriod } from "../../hooks/data/useHashRateIndexData";

const PeriodSwitch = styled("div")`
  display: flex;
  gap: 0;
  border: 1px solid rgba(171, 171, 171, 1);
  border-radius: 6px;
  overflow: hidden;
  align-self: end;
  margin-top: 1rem;
  margin-bottom: 1rem;
  margin-right: 12px;
`;

const PeriodButton = styled("button")<{ $active: boolean }>`
  padding: 0.5rem 1rem;
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

const ChartControls = styled("div")`
  display: flex;
  align-items: center;
  width: 100%;
  padding-left: 18px;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
`;

const CheckboxLabel = styled("label")`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #fff;
  font-size: 0.9rem;
  cursor: pointer;
  user-select: none;

  input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: #f7931a;
    cursor: pointer;
  }
`;

interface HashrateChartProps {
  data: Array<{
    updatedAtDate?: Date;
    updatedAt?: string;
    priceToken: bigint;
  }>;
  btcPriceData?: Array<{
    updatedAtDate?: Date;
    updatedAt?: string;
    price: bigint;
  }>;
  isLoading?: boolean;
  isBtcPriceLoading?: boolean;
  marketPrice?: bigint | null;
  marketPriceFetchedAt?: Date;
  timePeriod: TimePeriod;
  onTimePeriodChange: (period: TimePeriod) => void;
}

export const HashrateChart: FC<HashrateChartProps> = ({
  data,
  btcPriceData,
  isLoading = false,
  isBtcPriceLoading = false,
  marketPrice,
  marketPriceFetchedAt,
  timePeriod,
  onTimePeriodChange,
}) => {
  // State for showing/hiding BTC price data
  const [showBtcPrice, setShowBtcPrice] = useState(true);

  // Track time period changes and log to console
  useEffect(() => {
    console.log("Time period changed to:", timePeriod);
  }, [timePeriod]);

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

    // Check if marketPrice is different from the first item's price
    if (firstItemPrice !== marketPrice) {
      // Add marketPrice as the latest value with the timestamp when it was fetched
      return [
        {
          updatedAtDate: marketPriceFetchedAt ?? new Date(),
          priceToken: marketPrice,
        },
        ...data,
      ];
    }

    return data;
  }, [data, marketPrice, marketPriceFetchedAt]);

  // Transform data for Highcharts
  const chartData = enhancedData
    .filter((item) => item.updatedAtDate || item.updatedAt) // Filter out items without date
    .filter((item) => item.priceToken > 10000n)
    .map((item) => {
      const date = item.updatedAtDate || new Date(Number(item.updatedAt) * 1000);
      return [
        date.getTime(), // X-axis: timestamp
        Number(Number(item.priceToken) / 10 ** 6), // Y-axis: priceToken divided by 10^6
      ];
    });

  // Transform BTC price data for Highcharts
  const btcPriceChartData = useMemo(() => {
    if (!btcPriceData || btcPriceData.length === 0) return [];

    return btcPriceData
      .filter((item) => item.updatedAtDate || item.updatedAt)
      .filter((item) => item.price > 0n)
      .map((item) => {
        const date = item.updatedAtDate || new Date(Number(item.updatedAt) * 1000);
        return [
          date.getTime(), // X-axis: timestamp
          Number(item.price) / 10 ** 8, // Y-axis: BTC price (assuming 8 decimals)
        ];
      });
  }, [btcPriceData]);

  const options: Highcharts.Options = {
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
          color: "#ffffff",
        },
      },
      labels: {
        style: {
          color: "#ffffff",
        },
      },
      gridLineColor: "#333333",
    },
    yAxis: [
      {
        // Primary Y-axis for Hashprice (USDC)
        title: {
          text: "Hashprice (USDC)",
          style: {
            color: "white",
          },
        },
        labels: {
          style: {
            color: "white",
          },
          formatter: function () {
            return Number(this.value).toFixed(2);
          },
        },
        gridLineColor: "#333333",
      },
      ...(showBtcPrice
        ? [
            {
              // Secondary Y-axis for BTC Price (USD)
              title: {
                text: "BTC Price (USD)",
                style: {
                  color: "white",
                },
              },
              labels: {
                style: {
                  color: "white",
                },
                formatter: function (this: Highcharts.AxisLabelsFormatterContextObject) {
                  return "$" + Number(this.value).toLocaleString();
                },
              },
              opposite: true,
              gridLineWidth: 0,
            } as Highcharts.YAxisOptions,
          ]
        : []),
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
        color: "#22c55e",
        lineWidth: 2,
        yAxis: 0,
        marker: {
          enabled: false,
          radius: 4,
        },
      },
      ...(showBtcPrice
        ? [
            {
              connectNulls: false,
              dataSorting: { enabled: false },
              dataGrouping: { enabled: false },
              type: "line" as const,
              name: "BTC Price",
              showInLegend: true,
              data: btcPriceChartData,
              color: "#f7931a",
              lineWidth: 2,
              yAxis: 1,
              marker: {
                enabled: false,
                radius: 4,
              },
            },
          ]
        : []),
    ],
    legend: {
      enabled: true,
      itemStyle: {
        color: "#ffffff",
      },
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
      backgroundColor: "#1a1a1a",
      borderColor: "#333333",
      style: {
        color: "#ffffff",
      },
      formatter: function () {
        const date = new Date(this.x as number).toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        let tooltipHtml = `<span style="color: grey; font-size: 10px;">${date}</span><br/>`;

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

  if (isLoading && isBtcPriceLoading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "400px",
          color: "#ffffff",
          fontSize: "18px",
        }}
      >
        Loading chart data...
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
          color: "#ffffff",
          fontSize: "18px",
        }}
      >
        No data available
      </div>
    );
  }

  return (
    <>
      <h3>Hashprice Index</h3>
      <ChartControls>
      <CheckboxLabel>
          <input
            type="checkbox"
            checked={showBtcPrice}
            onChange={(e) => setShowBtcPrice(e.target.checked)}
          />
          BTC Price
        </CheckboxLabel>
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
      <div style={{ width: "100%", height: "450px", paddingTop: "1rem" }}>
        <HighchartsReact highcharts={Highcharts} options={options} containerProps={{ style: { height: "100%" } }} />
      </div>
    </>
  );
};
