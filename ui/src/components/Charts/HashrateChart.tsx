import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "@mui/material/styles/styled";
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { TimePeriod } from "../../hooks/data/useHashRateIndexData";
import { tokens } from "../../styles/tokens";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../lib/units";
import { Spinner } from "../Spinner.styled";

const CHART_HEIGHT = 400;

const HASHPRICE_LABEL = "Hashprice";
const BTC_LABEL = "BTC Price";

const PeriodSwitch = styled("div")`
  display: flex;
  gap: 0;
  border: 1px solid ${tokens.border.default};
  border-radius: 6px;
  overflow: hidden;
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
  padding-right: 12px;
  margin-top: 1rem;
  margin-bottom: 1rem;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
`;

const Legend = styled("div")`
  display: flex;
  align-items: center;
  gap: 1rem;
`;

const LegendItem = styled("div")`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: ${tokens.text.primary};
  font-size: 0.8125rem;
`;

const LegendButton = styled(LegendItem.withComponent("button"))`
  padding: 0;
  border: none;
  background: none;
  font-family: inherit;
  cursor: pointer;
`;

const LegendCheckbox = styled("span")<{ $color: string; $checked: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: 2px solid ${(props) => props.$color};
  border-radius: 3px;
  background: ${(props) => (props.$checked ? props.$color : "transparent")};
  color: ${tokens.text.onDark};
  font-size: 10px;
  font-weight: bold;
  line-height: 1;
`;

const ChartArea = styled("div")`
  position: relative;
  width: 100%;
`;

const ChartCanvas = styled("div")`
  width: 100%;
  height: ${CHART_HEIGHT}px;
`;

const TooltipBox = styled("div")`
  position: absolute;
  z-index: 6;
  padding: 6px 8px;
  border: 1px solid ${tokens.chart.tooltipBorder};
  border-radius: ${tokens.radius.sm};
  background: ${tokens.chart.tooltipBg};
  color: ${tokens.text.primary};
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
  pointer-events: none;
`;

const TooltipTime = styled("div")`
  color: ${tokens.chart.axisMuted};
  font-size: 10px;
`;

const StateOverlay = styled("div")`
  position: absolute;
  inset: 0;
  z-index: 7;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 0.25rem;
  color: ${tokens.text.primary};
  pointer-events: none;
`;

/**
 * Lightweight Charts renders every timestamp in UTC. Shifting each point by the
 * local UTC offset makes the axis and the crosshair read as local wall-clock
 * time, which is what the Highcharts version did via `useUTC: false`. The
 * offset is taken per point so daylight-saving transitions stay correct.
 */
const toWallClock = (epochMs: number): UTCTimestamp =>
  Math.floor((epochMs - new Date(epochMs).getTimezoneOffset() * 60_000) / 1000) as UTCTimestamp;

/** Reads a wall-clock timestamp back as the label the user expects to see. */
const formatWallClock = (time: UTCTimestamp): string =>
  new Date(time * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

/**
 * The library rejects series data that is not strictly ascending, and the
 * oracle can emit several ticks inside the same second; the latest one wins.
 */
const toLineData = (points: Array<{ date: Date; value: number }>): LineData<UTCTimestamp>[] => {
  const sorted = points
    .map(({ date, value }) => ({ time: toWallClock(date.getTime()), value }))
    .sort((a, b) => a.time - b.time);

  const deduped: LineData<UTCTimestamp>[] = [];
  for (const point of sorted) {
    if (deduped.length > 0 && deduped[deduped.length - 1].time === point.time) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }
  return deduped;
};

const readSeriesValue = (
  param: MouseEventParams<Time>,
  series: ISeriesApi<"Line"> | null,
): number | undefined => {
  if (!series) return undefined;
  const point = param.seriesData.get(series);
  return point && "value" in point ? point.value : undefined;
};

interface TooltipState {
  time: UTCTimestamp;
  hashprice?: number;
  btc?: number;
  top: number;
  offsetX: number;
  anchorRight: boolean;
}

interface HashrateChartProps {
  // The index hooks emit `updatedAt` as either a raw subgraph string or an
  // already-converted number depending on the branch, hence the widened type.
  data: Array<{
    updatedAtDate?: Date;
    updatedAt?: string | number;
    priceToken: number;
  }>;
  btcPriceData?: Array<{
    updatedAtDate?: Date;
    updatedAt?: string | number;
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
  const [isBtcPriceVisible, setIsBtcPriceVisible] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const hashSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const btcSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const fittedPeriodRef = useRef<TimePeriod | null>(null);

  const handleBtcPriceLegendClick = useCallback(() => {
    setIsBtcPriceVisible((prev) => !prev);
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

  const hashrateSeriesData = useMemo(() => {
    const points: Array<{ date: Date; value: number }> = [];
    for (const item of enhancedData) {
      if ((!item.updatedAtDate && !item.updatedAt) || item.priceToken <= 0.01) continue;
      points.push({
        date: item.updatedAtDate || new Date(Number(item.updatedAt) * 1000),
        value: item.priceToken,
      });
    }
    return toLineData(points);
  }, [enhancedData]);

  const btcSeriesData = useMemo(() => {
    if (!btcPriceData || btcPriceData.length === 0) return [];

    const points: Array<{ date: Date; value: number }> = [];
    for (const item of btcPriceData) {
      if ((!item.updatedAtDate && !item.updatedAt) || item.price <= 0) continue;
      points.push({
        date: item.updatedAtDate || new Date(Number(item.updatedAt) * 1000),
        value: item.price,
      });
    }
    return toLineData(points);
  }, [btcPriceData]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: tokens.text.primary,
        fontFamily: "inherit",
        // Satisfies the Apache-2.0 attribution link requirement of the library.
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: tokens.chart.grid },
        horzLines: { color: tokens.chart.grid },
      },
      rightPriceScale: {
        visible: true,
        borderColor: tokens.chart.grid,
      },
      leftPriceScale: {
        visible: false,
        borderColor: tokens.chart.grid,
      },
      timeScale: {
        borderColor: tokens.chart.grid,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: tokens.chart.axisMuted, labelBackgroundColor: tokens.chart.tooltipBg },
        horzLine: { color: tokens.chart.axisMuted, labelBackgroundColor: tokens.chart.tooltipBg },
      },
    });

    const hashSeries = chart.addSeries(LineSeries, {
      title: HASHPRICE_LABEL,
      color: tokens.trading.long,
      lineWidth: 2,
      priceScaleId: "right",
      priceLineVisible: false,
      pointMarkersVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    const btcSeries = chart.addSeries(LineSeries, {
      title: BTC_LABEL,
      color: tokens.chart.seriesBtc,
      lineWidth: 2,
      priceScaleId: "left",
      priceLineVisible: false,
      lastValueVisible: false,
      pointMarkersVisible: false,
      visible: false,
      priceFormat: {
        type: "custom",
        minMove: 1,
        formatter: (price: number) => Math.round(price).toLocaleString(),
      },
    });

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!param.point || param.time === undefined || typeof param.time !== "number") {
        setTooltip(null);
        return;
      }

      const hashprice = readSeriesValue(param, hashSeries);
      const btc = btcSeries.options().visible ? readSeriesValue(param, btcSeries) : undefined;

      if (hashprice === undefined && btc === undefined) {
        setTooltip(null);
        return;
      }

      // Anchoring to whichever edge the cursor is closest to keeps the tooltip
      // inside the pane without having to measure it first.
      const width = container.clientWidth;
      const anchorRight = param.point.x > width / 2;

      setTooltip({
        time: param.time as UTCTimestamp,
        hashprice,
        btc,
        top: Math.max(8, param.point.y - 12),
        offsetX: (anchorRight ? width - param.point.x : param.point.x) + 12,
        anchorRight,
      });
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    chartRef.current = chart;
    hashSeriesRef.current = hashSeries;
    btcSeriesRef.current = btcSeries;

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
      chartRef.current = null;
      hashSeriesRef.current = null;
      btcSeriesRef.current = null;
      priceLinesRef.current = [];
      fittedPeriodRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Both series are filled before the range is measured on purpose. The time
    // scale indexes the union of every series' timestamps regardless of
    // visibility, so measuring while one series still holds the previous
    // period's denser points sizes the viewport for far more slots than the new
    // data has, leaving the chart squeezed against the right edge.
    hashSeriesRef.current?.setData(hashrateSeriesData);
    btcSeriesRef.current?.setData(btcSeriesData);

    // Reframing only on a range switch is what stops background refetches from
    // throwing away a pan or zoom the user just made.
    if (hashrateSeriesData.length === 0 || fittedPeriodRef.current === timePeriod) return;

    chartRef.current?.timeScale().fitContent();

    // Both hooks keep serving the previous range while the new one loads, so this
    // frame is provisional. Leaving the period unrecorded until every query has
    // settled means whichever one lands last reframes against the real data.
    if (!isFetching && !isBtcPriceFetching) {
      fittedPeriodRef.current = timePeriod;
    }
  }, [hashrateSeriesData, btcSeriesData, timePeriod, isFetching, isBtcPriceFetching]);

  useEffect(() => {
    btcSeriesRef.current?.applyOptions({ visible: isBtcPriceVisible });
    chartRef.current?.applyOptions({ leftPriceScale: { visible: isBtcPriceVisible } });
  }, [isBtcPriceVisible]);

  useEffect(() => {
    const series = hashSeriesRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) {
      series.removePriceLine(line);
    }
    priceLinesRef.current = [];

    if (entryPrice) {
      priceLinesRef.current.push(
        series.createPriceLine({
          price: entryPrice,
          color: tokens.text.primary,
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: true,
          title: `Entry: ${entryPrice.toFixed(2)}`,
        }),
      );
    }

    if (liquidationPrice != null && hashrateSeriesData.length > 0) {
      const values = hashrateSeriesData.map((point) => point.value);
      const dataMin = Math.min(...values);
      const dataMax = Math.max(...values);
      const padding = (dataMax - dataMin) * 0.1;

      // Pin an off-range threshold to the edge of the axis. The title carries
      // the true price, and the arrow says which way spot has to move to reach it.
      const clampedValue = Math.min(Math.max(liquidationPrice, dataMin - padding), dataMax + padding);
      const arrow = liquidationDirection === "up" ? "↑" : "↓";

      priceLinesRef.current.push(
        series.createPriceLine({
          price: clampedValue,
          color: tokens.trading.short,
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: true,
          title: `Liq${arrow}: ${liquidationPrice.toFixed(2)}`,
        }),
      );
    }
  }, [entryPrice, liquidationPrice, liquidationDirection, hashrateSeriesData]);

  const hasData = hashrateSeriesData.length > 0;
  const isInitialLoad = (isLoading || isBtcPriceLoading) && !hasData;

  return (
    <>
      <ChartTitle>Hashprice Index</ChartTitle>
      <ChartControls>
        <Legend>
          <LegendItem>
            <LegendCheckbox $color={tokens.trading.long} $checked />
            <span>{HASHPRICE_LABEL}</span>
          </LegendItem>
          <LegendButton type="button" onClick={handleBtcPriceLegendClick} aria-pressed={isBtcPriceVisible}>
            <LegendCheckbox $color={tokens.chart.seriesBtc} $checked={isBtcPriceVisible}>
              {isBtcPriceVisible ? "✓" : null}
            </LegendCheckbox>
            <span>{BTC_LABEL}</span>
          </LegendButton>
        </Legend>
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
      <ChartArea>
        <ChartCanvas ref={containerRef} />

        {tooltip && (
          <TooltipBox
            style={
              tooltip.anchorRight
                ? { top: tooltip.top, right: tooltip.offsetX }
                : { top: tooltip.top, left: tooltip.offsetX }
            }
          >
            <TooltipTime>{formatWallClock(tooltip.time)}</TooltipTime>
            {tooltip.hashprice !== undefined && (
              <div>
                <span style={{ color: tokens.trading.long }}>{"\u25CF"}</span> <b>{HASHPRICE_LABEL}:</b>{" "}
                {tooltip.hashprice.toFixed(2)}
              </div>
            )}
            {tooltip.btc !== undefined && (
              <div>
                <span style={{ color: tokens.chart.seriesBtc }}>{"\u25CF"}</span> <b>{BTC_LABEL}:</b>{" "}
                {Math.round(tooltip.btc).toLocaleString()}
              </div>
            )}
          </TooltipBox>
        )}

        {isInitialLoad && (
          <StateOverlay style={{ background: tokens.app.bg, fontSize: "18px" }}>
            <Spinner fontSize="0.35em" />
            <div>Loading chart data...</div>
          </StateOverlay>
        )}

        {!isInitialLoad && !hasData && (
          <StateOverlay style={{ background: tokens.app.bg, fontSize: "18px" }}>No data available</StateOverlay>
        )}

        {hasData && (isFetching || isBtcPriceFetching) && (
          <StateOverlay
            style={{
              background: "rgba(15, 17, 23, 0.55)",
              backdropFilter: "blur(1px)",
              fontSize: "14px",
            }}
          >
            <Spinner fontSize="0.3em" />
            <div>Updating chart…</div>
          </StateOverlay>
        )}
      </ChartArea>
    </>
  );
};
