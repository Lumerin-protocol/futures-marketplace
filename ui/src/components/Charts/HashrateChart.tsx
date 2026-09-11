import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "@mui/material/styles/styled";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type AutoscaleInfo,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { TimePeriod } from "../../hooks/data/useHashRateIndexData";
import { CHART_RANGE_INTERVAL_LABELS, CHART_RANGE_LABELS, CHART_RANGES } from "../../lib/chartBars";
import { foldLivePriceIntoCandles, type HashpriceCandle } from "../../lib/chartCandles";
import { tokens } from "../../styles/tokens";
import { DATE_LOCALE } from "../../lib/dates";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../lib/units";
import { Spinner } from "../Spinner.styled";

const CHART_HEIGHT = 400;

const HASHPRICE_LABEL = "Hashprice";
const BTC_LABEL = "BTC Price";
const NETWORK_HASHRATE_LABEL = "Network Hashrate";

const CHART_MODE_KEY = "hashrateChart.mode";

export type ChartMode = "line" | "candles";

/**
 * Only `right` and `left` can be rendered as axes, and hashprice and BTC already
 * hold them. Any other id makes an overlay scale: autoscaled but without a
 * visible axis, so the hashrate is read off the crosshair tooltip.
 */
const HASHRATE_SCALE_ID = "network-hashrate";

/**
 * A 7-day trailing average barely moves inside the 1D range — often well under a
 * percent — and autoscaling a span that narrow magnifies it into a dramatic-looking
 * swing. The range is widened to at least this fraction of its own midpoint so a
 * quiet week draws quiet. Over the 1M range real movement exceeds the floor and
 * autoscaling takes over on its own.
 */
const MIN_HASHRATE_RANGE_RATIO = 0.02;

const withMinimumRange = (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
  const info = original();
  if (!info?.priceRange) return info;

  const { minValue, maxValue } = info.priceRange;
  const midpoint = (minValue + maxValue) / 2;
  const halfSpan = Math.max((maxValue - minValue) / 2, Math.abs(midpoint) * (MIN_HASHRATE_RANGE_RATIO / 2));

  return { ...info, priceRange: { minValue: midpoint - halfSpan, maxValue: midpoint + halfSpan } };
};

/** Values arrive already divided down to exahashes per second. */
const formatHashrate = (value: number): string => `${value.toFixed(2)} EH/s`;

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

const SwitchGroup = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
`;

const ChartTitle = styled("div")`
  font-size: 0.7rem;
  font-weight: 500;
  color: ${tokens.text.secondary};
  text-transform: uppercase;
  letter-spacing: 0.03em;
`;

const ChartIntervalHint = styled("span")`
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: ${tokens.text.muted};
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

/* Takes whatever height the widget has left after the title and controls. In a
   content-sized parent (tablet, mobile) that is the canvas's own basis below. */
const ChartArea = styled("div")`
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
`;

/* Grows and shrinks with the space above (the chart is `autoSize`d, so it
   follows); ${CHART_HEIGHT}px is what it asks for when nothing constrains it. */
const ChartCanvas = styled("div")`
  width: 100%;
  flex: 1 1 ${CHART_HEIGHT}px;
  min-height: 0;
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

type HashpriceSeries = ISeriesApi<"Line"> | ISeriesApi<"Candlestick">;

const readStoredChartMode = (): ChartMode => {
  try {
    return localStorage.getItem(CHART_MODE_KEY) === "candles" ? "candles" : "line";
  } catch {
    return "line";
  }
};

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
  new Date(time * 1000).toLocaleString(DATE_LOCALE, {
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

const toCandleData = (candles: HashpriceCandle[]): CandlestickData<UTCTimestamp>[] => {
  const sorted = candles
    .map((candle) => ({
      time: toWallClock(candle.timeMs),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }))
    .sort((a, b) => a.time - b.time);

  const deduped: CandlestickData<UTCTimestamp>[] = [];
  for (const point of sorted) {
    if (deduped.length > 0 && deduped[deduped.length - 1].time === point.time) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }
  return deduped;
};

interface TooltipState {
  time: UTCTimestamp;
  hashprice?: number;
  ohlc?: { open: number; high: number; low: number; close: number };
  btc?: number;
  networkHashrate?: number;
  top: number;
  offsetX: number;
  anchorRight: boolean;
}

const readSeriesValue = (
  param: MouseEventParams<Time>,
  series: ISeriesApi<"Line"> | null,
): number | undefined => {
  if (!series) return undefined;
  const point = param.seriesData.get(series);
  return point && "value" in point ? point.value : undefined;
};

const readCandleOhlc = (
  param: MouseEventParams<Time>,
  series: ISeriesApi<"Candlestick"> | null,
): TooltipState["ohlc"] => {
  if (!series) return undefined;
  const point = param.seriesData.get(series);
  if (!point || !("open" in point)) return undefined;
  return { open: point.open, high: point.high, low: point.low, close: point.close };
};

interface HashrateChartProps {
  // The index hooks emit `updatedAt` as either a raw subgraph string or an
  // already-converted number depending on the branch, hence the widened type.
  data: Array<{
    updatedAtDate?: Date;
    updatedAt?: string | number;
    priceToken: number;
  }>;
  candles?: HashpriceCandle[];
  btcPriceData?: Array<{
    updatedAtDate?: Date;
    updatedAt?: string | number;
    price: number;
  }>;
  /**
   * Bitcoin network hashrate in EH/s, measured over a trailing 1008-block (~7 day)
   * window as work done divided by the median-time-past elapsed over it.
   */
  networkHashrateData?: Array<{
    updatedAtDate?: Date;
    updatedAt?: string | number;
    hashrateEhS: number;
  }>;
  isLoading?: boolean;
  isCandlesLoading?: boolean;
  isBtcPriceLoading?: boolean;
  isNetworkHashrateLoading?: boolean;
  isFetching?: boolean;
  isCandlesFetching?: boolean;
  isBtcPriceFetching?: boolean;
  isNetworkHashrateFetching?: boolean;
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
  candles = [],
  btcPriceData,
  networkHashrateData,
  isLoading = false,
  isCandlesLoading = false,
  isBtcPriceLoading = false,
  isNetworkHashrateLoading = false,
  isFetching = false,
  isCandlesFetching = false,
  isBtcPriceFetching = false,
  isNetworkHashrateFetching = false,
  marketPrice,
  marketPriceFetchedAt,
  entryPrice,
  liquidationPrice,
  liquidationDirection,
  timePeriod,
  onTimePeriodChange,
}) => {
  const [chartMode, setChartMode] = useState<ChartMode>(readStoredChartMode);
  const [isBtcPriceVisible, setIsBtcPriceVisible] = useState(false);
  const [isNetworkHashrateVisible, setIsNetworkHashrateVisible] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const hashSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const btcSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const networkHashrateSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const priceLinesOwnerRef = useRef<HashpriceSeries | null>(null);

  const handleBtcPriceLegendClick = useCallback(() => {
    setIsBtcPriceVisible((prev) => !prev);
  }, []);

  const handleNetworkHashrateLegendClick = useCallback(() => {
    setIsNetworkHashrateVisible((prev) => !prev);
  }, []);

  const handleChartModeChange = useCallback((mode: ChartMode) => {
    setChartMode(mode);
    try {
      localStorage.setItem(CHART_MODE_KEY, mode);
    } catch {
      // Persistence is best-effort; the toggle still works for this session.
    }
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

  const livePriceUsd = marketPrice != null ? Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM : undefined;
  const enhancedCandles = useMemo(
    () => foldLivePriceIntoCandles(candles, livePriceUsd),
    [candles, livePriceUsd],
  );

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

  const candleSeriesData = useMemo(() => toCandleData(enhancedCandles), [enhancedCandles]);

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

  const networkHashrateSeriesData = useMemo(() => {
    if (!networkHashrateData || networkHashrateData.length === 0) return [];

    const points: Array<{ date: Date; value: number }> = [];
    for (const item of networkHashrateData) {
      if ((!item.updatedAtDate && !item.updatedAt) || item.hashrateEhS <= 0) continue;
      points.push({
        date: item.updatedAtDate || new Date(Number(item.updatedAt) * 1000),
        value: item.hashrateEhS,
      });
    }
    return toLineData(points);
  }, [networkHashrateData]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isCandles = readStoredChartMode() === "candles";

    const chart = createChart(container, {
      autoSize: true,
      // The visible range belongs to the 1D/5D/1M switch, so both zooming
      // (wheel / pinch) and panning are off; a stray drag or wheel over the pane
      // would otherwise slide the viewport off the data with no way back.
      handleScale: false,
      handleScroll: false,
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
      visible: !isCandles,
      lastValueVisible: !isCandles,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      title: HASHPRICE_LABEL,
      upColor: tokens.trading.long,
      downColor: tokens.trading.short,
      wickUpColor: tokens.trading.long,
      wickDownColor: tokens.trading.short,
      borderVisible: false,
      priceScaleId: "right",
      priceLineVisible: false,
      visible: isCandles,
      lastValueVisible: isCandles,
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

    const networkHashrateSeries = chart.addSeries(LineSeries, {
      title: NETWORK_HASHRATE_LABEL,
      color: tokens.chart.seriesHashrate,
      lineWidth: 2,
      priceScaleId: HASHRATE_SCALE_ID,
      priceLineVisible: false,
      lastValueVisible: false,
      pointMarkersVisible: false,
      visible: false,
      autoscaleInfoProvider: withMinimumRange,
      priceFormat: {
        type: "custom",
        minMove: 0.01,
        formatter: formatHashrate,
      },
    });

    chart.priceScale(HASHRATE_SCALE_ID).applyOptions({
      scaleMargins: { top: 0.1, bottom: 0.1 },
    });

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!param.point || param.time === undefined || typeof param.time !== "number") {
        setTooltip(null);
        return;
      }

      const candlesVisible = candleSeries.options().visible;
      const ohlc = candlesVisible ? readCandleOhlc(param, candleSeries) : undefined;
      const hashprice = candlesVisible ? undefined : readSeriesValue(param, hashSeries);
      const btc = btcSeries.options().visible ? readSeriesValue(param, btcSeries) : undefined;
      const networkHashrate = networkHashrateSeries.options().visible
        ? readSeriesValue(param, networkHashrateSeries)
        : undefined;

      if (hashprice === undefined && ohlc === undefined && btc === undefined && networkHashrate === undefined) {
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
        ohlc,
        btc,
        networkHashrate,
        top: Math.max(8, param.point.y - 12),
        offsetX: (anchorRight ? width - param.point.x : param.point.x) + 12,
        anchorRight,
      });
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    chartRef.current = chart;
    hashSeriesRef.current = hashSeries;
    candleSeriesRef.current = candleSeries;
    btcSeriesRef.current = btcSeries;
    networkHashrateSeriesRef.current = networkHashrateSeries;

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
      chartRef.current = null;
      hashSeriesRef.current = null;
      candleSeriesRef.current = null;
      btcSeriesRef.current = null;
      networkHashrateSeriesRef.current = null;
      priceLinesRef.current = [];
      priceLinesOwnerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const isCandles = chartMode === "candles";
    hashSeriesRef.current?.applyOptions({ visible: !isCandles, lastValueVisible: !isCandles });
    candleSeriesRef.current?.applyOptions({ visible: isCandles, lastValueVisible: isCandles });
  }, [chartMode]);

  useEffect(() => {
    // Both series are filled before the range is measured on purpose. The time
    // scale indexes the union of every series' timestamps regardless of
    // visibility, so measuring while one series still holds the previous
    // period's denser points sizes the viewport for far more slots than the new
    // data has, leaving the chart squeezed against the right edge.
    // The hidden hashprice series is cleared for the same reason: 1D ticks would
    // otherwise dominate the scale while hourly candles are on screen.
    if (chartMode === "candles") {
      hashSeriesRef.current?.setData([]);
      candleSeriesRef.current?.setData(candleSeriesData);
    } else {
      candleSeriesRef.current?.setData([]);
      hashSeriesRef.current?.setData(hashrateSeriesData);
    }
    btcSeriesRef.current?.setData(btcSeriesData);
    networkHashrateSeriesRef.current?.setData(networkHashrateSeriesData);

    const primaryLength = chartMode === "candles" ? candleSeriesData.length : hashrateSeriesData.length;
    if (primaryLength === 0) return;

    // The viewport is fixed, so every update has to reframe: points appended by a
    // background refetch would otherwise land past the right edge with no pan left
    // to reach them.
    chartRef.current?.timeScale().fitContent();
  }, [chartMode, hashrateSeriesData, candleSeriesData, btcSeriesData, networkHashrateSeriesData]);

  useEffect(() => {
    btcSeriesRef.current?.applyOptions({ visible: isBtcPriceVisible });
    chartRef.current?.applyOptions({ leftPriceScale: { visible: isBtcPriceVisible } });
  }, [isBtcPriceVisible]);

  useEffect(() => {
    networkHashrateSeriesRef.current?.applyOptions({ visible: isNetworkHashrateVisible });
  }, [isNetworkHashrateVisible]);

  useEffect(() => {
    const owner = priceLinesOwnerRef.current;
    if (owner) {
      for (const line of priceLinesRef.current) {
        owner.removePriceLine(line);
      }
    }
    priceLinesRef.current = [];

    const series = chartMode === "candles" ? candleSeriesRef.current : hashSeriesRef.current;
    if (!series) return;
    priceLinesOwnerRef.current = series;

    const rangeValues =
      chartMode === "candles"
        ? candleSeriesData.flatMap((candle) => [candle.high, candle.low])
        : hashrateSeriesData.map((point) => point.value);

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

    if (liquidationPrice != null && rangeValues.length > 0) {
      const dataMin = Math.min(...rangeValues);
      const dataMax = Math.max(...rangeValues);
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
  }, [chartMode, entryPrice, liquidationPrice, liquidationDirection, hashrateSeriesData, candleSeriesData]);

  const hasData = chartMode === "candles" ? candleSeriesData.length > 0 : hashrateSeriesData.length > 0;
  const isInitialLoad =
    chartMode === "candles"
      ? isCandlesLoading && !hasData
      : (isLoading || isBtcPriceLoading || isNetworkHashrateLoading) && !hasData;
  const isUpdating =
    hasData &&
    (chartMode === "candles" ? isCandlesFetching : isFetching || isBtcPriceFetching || isNetworkHashrateFetching);

  return (
    <>
      <ChartTitle>
        Hashprice Index
        <ChartIntervalHint> · {CHART_RANGE_INTERVAL_LABELS[timePeriod]}</ChartIntervalHint>
      </ChartTitle>
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
          <LegendButton
            type="button"
            onClick={handleNetworkHashrateLegendClick}
            aria-pressed={isNetworkHashrateVisible}
          >
            <LegendCheckbox $color={tokens.chart.seriesHashrate} $checked={isNetworkHashrateVisible}>
              {isNetworkHashrateVisible ? "✓" : null}
            </LegendCheckbox>
            <span>{NETWORK_HASHRATE_LABEL}</span>
          </LegendButton>
        </Legend>
        <SwitchGroup>
          <PeriodSwitch>
            <PeriodButton
              type="button"
              $active={chartMode === "line"}
              aria-pressed={chartMode === "line"}
              onClick={() => handleChartModeChange("line")}
            >
              Line
            </PeriodButton>
            <PeriodButton
              type="button"
              $active={chartMode === "candles"}
              aria-pressed={chartMode === "candles"}
              onClick={() => handleChartModeChange("candles")}
            >
              Candles
            </PeriodButton>
          </PeriodSwitch>
          <PeriodSwitch>
            {CHART_RANGES.map((range) => (
              <PeriodButton
                key={range}
                type="button"
                $active={timePeriod === range}
                onClick={() => onTimePeriodChange(range)}
              >
                {CHART_RANGE_LABELS[range]}
              </PeriodButton>
            ))}
          </PeriodSwitch>
        </SwitchGroup>
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
            {tooltip.ohlc !== undefined && (
              <div>
                <span
                  style={{
                    color: tooltip.ohlc.close >= tooltip.ohlc.open ? tokens.trading.long : tokens.trading.short,
                  }}
                >
                  {"\u25CF"}
                </span>{" "}
                <b>{HASHPRICE_LABEL}:</b> O {tooltip.ohlc.open.toFixed(2)} H {tooltip.ohlc.high.toFixed(2)} L{" "}
                {tooltip.ohlc.low.toFixed(2)} C {tooltip.ohlc.close.toFixed(2)}
              </div>
            )}
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
            {tooltip.networkHashrate !== undefined && (
              <div>
                <span style={{ color: tokens.chart.seriesHashrate }}>{"\u25CF"}</span>{" "}
                <b>{NETWORK_HASHRATE_LABEL}:</b> {formatHashrate(tooltip.networkHashrate)}
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

        {isUpdating && (
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
