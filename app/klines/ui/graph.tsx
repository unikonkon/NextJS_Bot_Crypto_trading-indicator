"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
  type IChartApi,
  type UTCTimestamp,
  type SeriesMarker,
} from "lightweight-charts";
import type { KlineData } from "@/lib/types/kline";
import type { AllIndicators } from "@/lib/indicators";
import type { BacktestResult, StrategyId } from "@/lib/backtest";

// ─── Props ──────────────────────────────────────────────────────
export interface KlineGraphProps {
  klines: KlineData[];
  indicators: AllIndicators | null;
  btResult: BacktestResult | null;
  strategyId: StrategyId;
}

// ─── Helpers ────────────────────────────────────────────────────
function toUTC(ms: number): UTCTimestamp {
  return (ms / 1000) as UTCTimestamp;
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

// ─── Toggle Button ─────────────────────────────────────────────
function OverlayToggle({ label, color, secondColor, active, onToggle }: {
  label: string;
  color: string;
  secondColor?: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium transition-all cursor-pointer select-none ${
        active
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground/40 hover:text-muted-foreground/70"
      }`}
    >
      <span
        className="inline-block w-2 h-0.5 rounded-full"
        style={{ backgroundColor: active ? color : "currentColor" }}
      />
      {secondColor && (
        <span
          className="inline-block w-2 h-0.5 rounded-full -ml-0.5"
          style={{ backgroundColor: active ? secondColor : "currentColor" }}
        />
      )}
      {label}
    </button>
  );
}

// ─── Component ──────────────────────────────────────────────────
export default function KlineGraph({ klines, indicators, btResult, strategyId }: KlineGraphProps) {
  const mainRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const sqzRef = useRef<HTMLDivElement>(null);

  const chartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const sqzChartRef = useRef<IChartApi | null>(null);

  // Prevent sync loops
  const syncingRef = useRef(false);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Prepare candlestick data
  const candleData = useMemo(() => {
    return klines.map((k) => ({
      time: toUTC(k.openTime),
      open: +k.open,
      high: +k.high,
      low: +k.low,
      close: +k.close,
    }));
  }, [klines]);

  // Prepare volume data
  const volumeData = useMemo(() => {
    return klines.map((k) => ({
      time: toUTC(k.openTime),
      value: +k.volume,
      color: +k.close >= +k.open ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)",
    }));
  }, [klines]);

  // ─── Overlay & sub-chart toggles ────────────────────────────
  const [showVwap, setShowVwap] = useState(true);
  const [showCdcEma, setShowCdcEma] = useState(false);
  const [showSupertrendLine, setShowSupertrendLine] = useState(false);
  const [showSmcOb, setShowSmcOb] = useState(false);
  const [showRsiToggle, setShowRsiToggle] = useState(true);
  const [showMacdToggle, setShowMacdToggle] = useState(true);
  const [showSqzToggle, setShowSqzToggle] = useState(true);

  // Auto-enable matching overlay when strategy changes
  useEffect(() => {
    if (strategyId === "cdc_actionzone") setShowCdcEma(true);
    if (strategyId === "supertrend") setShowSupertrendLine(true);
    if (strategyId === "smc") setShowSmcOb(true);
  }, [strategyId]);

  // Determine which sub-panels to show
  const showRsi = !!indicators && showRsiToggle;
  const showMacd = !!indicators && showMacdToggle;
  const showSqz = !!indicators && showSqzToggle;

  // ─── Main chart + sub-charts ────────────────────────────────
  useEffect(() => {
    if (!mainRef.current || klines.length === 0) return;

    // Cleanup previous
    chartRef.current?.remove();
    rsiChartRef.current?.remove();
    macdChartRef.current?.remove();
    sqzChartRef.current?.remove();
    chartRef.current = null;
    rsiChartRef.current = null;
    macdChartRef.current = null;
    sqzChartRef.current = null;

    const gridColor = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";
    const crossColor = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
    const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)";
    const textColor = isDark ? "#9ca3af" : "#6b7280";

    const chartOptions = {
      layout: {
        background: { color: "transparent" },
        textColor,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        vertLine: { color: crossColor, width: 1 as const, style: 3 as const },
        horzLine: { color: crossColor, width: 1 as const, style: 3 as const },
      },
      rightPriceScale: {
        borderColor,
      },
      timeScale: {
        borderColor,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
    };

    const hasSubCharts = (showRsi && rsiRef.current) || (showMacd && macdRef.current) || (showSqz && sqzRef.current);

    // ═══ MAIN CHART (Candlestick + Volume + Overlays) ═══
    const chart = createChart(mainRef.current, {
      ...chartOptions,
      width: mainRef.current.clientWidth,
      height: 420,
      timeScale: { ...chartOptions.timeScale, visible: !hasSubCharts },
    });
    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });
    candleSeries.setData(candleData);

    // Volume (overlay on main chart)
    const volSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
    });
    volSeries.setData(volumeData);
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    // ─── Indicator overlays on main chart ────────────────────
    if (indicators) {
      const times = klines.map((k) => toUTC(k.openTime));

      // VWAP line
      if (showVwap) {
        const vwapData = indicators.vwap.map((v, i) => ({ time: times[i], value: v }));
        chart.addSeries(LineSeries, {
          color: "rgba(168,85,247,0.6)",
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        }).setData(vwapData);
      }

      // CDC ActionZone: Fast & Slow MA + colored candles
      if (showCdcEma) {
        const fastData = indicators.cdcActionZone.fastMA
          .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
          .filter(Boolean) as { time: UTCTimestamp; value: number }[];
        const slowData = indicators.cdcActionZone.slowMA
          .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
          .filter(Boolean) as { time: UTCTimestamp; value: number }[];

        chart.addSeries(LineSeries, {
          color: "#3b82f6",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        }).setData(fastData);

        chart.addSeries(LineSeries, {
          color: "#f59e0b",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        }).setData(slowData);

        // Color candles by CDC zone when it's the active strategy
        if (strategyId === "cdc_actionzone") {
          const zoneColorMap: Record<string, string> = {
            green: "#10b981",
            red: "#ef4444",
            blue: "#3b82f6",
            lightblue: "#67e8f9",
            orange: "#f97316",
            yellow: "#eab308",
          };
          const coloredCandles = klines.map((k, i) => {
            const zone = indicators.cdcActionZone.zone[i];
            const c = zone ? zoneColorMap[zone] : undefined;
            return {
              time: toUTC(k.openTime),
              open: +k.open,
              high: +k.high,
              low: +k.low,
              close: +k.close,
              ...(c ? { color: c, wickColor: c, borderColor: c } : {}),
            };
          });
          candleSeries.setData(coloredCandles);
        }
      }

      // Supertrend overlay
      if (showSupertrendLine) {
        const st = indicators.supertrend;
        const upData: ({ time: UTCTimestamp; value: number } | { time: UTCTimestamp })[] = [];
        const dnData: ({ time: UTCTimestamp; value: number } | { time: UTCTimestamp })[] = [];

        for (let i = 0; i < klines.length; i++) {
          const t = times[i];
          const val = st.supertrend[i];
          const trend = st.trend[i];
          if (val === null || trend === null) {
            upData.push({ time: t });
            dnData.push({ time: t });
            continue;
          }
          if (trend === 1) {
            upData.push({ time: t, value: val });
            dnData.push({ time: t });
          } else {
            dnData.push({ time: t, value: val });
            upData.push({ time: t });
          }
        }

        chart.addSeries(LineSeries, {
          color: "#10b981",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        }).setData(upData as any);

        chart.addSeries(LineSeries, {
          color: "#ef4444",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        }).setData(dnData as any);
      }

      // SMC: Active Order Block levels
      if (showSmcOb) {
        const activeOBs = indicators.smc.internalOrderBlocks.filter((ob) => !ob.mitigated);
        for (const ob of activeOBs.slice(-10)) {
          const midPrice = (ob.high + ob.low) / 2;
          const startTime = times[ob.startIndex];
          const endTime = times[klines.length - 1];
          if (startTime && endTime) {
            chart.addSeries(LineSeries, {
              color: ob.bias === "bullish" ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.4)",
              lineWidth: 1,
              lineStyle: 2,
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
            }).setData([
              { time: startTime, value: midPrice },
              { time: endTime, value: midPrice },
            ]);
          }
        }
      }
    }

    // ─── Backtest markers on main chart ──────────────────────
    if (btResult) {
      const markers: SeriesMarker<UTCTimestamp>[] = [];

      for (const trade of btResult.trades) {
        const entryK = klines[trade.entryIdx];
        const exitK = klines[trade.exitIdx];
        if (entryK) {
          markers.push({
            time: toUTC(entryK.openTime),
            position: "belowBar",
            color: "#10b981",
            shape: "arrowUp",
            text: `BUY ${fmtPrice(trade.entryPrice)}`,
          });
        }
        if (exitK) {
          markers.push({
            time: toUTC(exitK.openTime),
            position: "aboveBar",
            color: "#ef4444",
            shape: "arrowDown",
            text: `SELL ${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%`,
          });
        }
      }

      markers.sort((a, b) => (a.time as number) - (b.time as number));
      if (markers.length > 0) {
        createSeriesMarkers(candleSeries, markers);
      }
    }

    chart.timeScale().fitContent();

    // ═══ RSI CHART (separate sub-chart) ═══
    if (showRsi && indicators && rsiRef.current) {
      const rsiChart = createChart(rsiRef.current, {
        ...chartOptions,
        width: rsiRef.current.clientWidth,
        height: 120,
        timeScale: {
          ...chartOptions.timeScale,
          visible: !showMacd && !showSqz,
        },
      });
      rsiChartRef.current = rsiChart;

      const times = klines.map((k) => toUTC(k.openTime));

      // RSI line
      const rsiData = indicators.rsi
        .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
        .filter(Boolean) as { time: UTCTimestamp; value: number }[];

      rsiChart.addSeries(LineSeries, {
        color: "#a78bfa",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
      }).setData(rsiData);

      // Overbought line (70)
      rsiChart.addSeries(LineSeries, {
        color: "rgba(239,68,68,0.3)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }).setData([
        { time: times[0], value: 70 },
        { time: times[times.length - 1], value: 70 },
      ]);

      // Oversold line (30)
      rsiChart.addSeries(LineSeries, {
        color: "rgba(16,185,129,0.3)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }).setData([
        { time: times[0], value: 30 },
        { time: times[times.length - 1], value: 30 },
      ]);

      // Mid line (50)
      rsiChart.addSeries(LineSeries, {
        color: "rgba(255,255,255,0.08)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }).setData([
        { time: times[0], value: 50 },
        { time: times[times.length - 1], value: 50 },
      ]);

      rsiChart.timeScale().fitContent();

      // Sync timescale
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncingRef.current || !range) return;
        syncingRef.current = true;
        rsiChart.timeScale().setVisibleLogicalRange(range);
        syncingRef.current = false;
      });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncingRef.current || !range) return;
        syncingRef.current = true;
        chart.timeScale().setVisibleLogicalRange(range);
        syncingRef.current = false;
      });
    }

    // ═══ MACD CHART (separate sub-chart) ═══
    if (showMacd && indicators && macdRef.current) {
      const macdChart = createChart(macdRef.current, {
        ...chartOptions,
        width: macdRef.current.clientWidth,
        height: 140,
        timeScale: {
          ...chartOptions.timeScale,
          visible: !showSqz,
        },
      });
      macdChartRef.current = macdChart;

      const times = klines.map((k) => toUTC(k.openTime));
      const cm = indicators.cmMacd;

      // 4-color histogram
      const histColorMap: Record<string, string> = {
        aqua: "#22d3ee",
        blue: "#3b82f6",
        red: "#ef4444",
        maroon: "#7f1d1d",
      };
      const histData = cm.histogram
        .map((v, i) => {
          if (v === null) return null;
          const c = cm.histColor[i];
          return {
            time: times[i],
            value: v,
            color: c ? histColorMap[c] ?? "#6b7280" : "#6b7280",
          };
        })
        .filter(Boolean) as { time: UTCTimestamp; value: number; color: string }[];

      macdChart.addSeries(HistogramSeries, {
        priceLineVisible: false,
        lastValueVisible: false,
      }).setData(histData);

      // MACD line
      const macdData = cm.macdLine
        .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
        .filter(Boolean) as { time: UTCTimestamp; value: number }[];

      macdChart.addSeries(LineSeries, {
        color: "#3b82f6",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      }).setData(macdData);

      // Signal line
      const sigData = cm.signalLine
        .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
        .filter(Boolean) as { time: UTCTimestamp; value: number }[];

      macdChart.addSeries(LineSeries, {
        color: "#f97316",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      }).setData(sigData);

      // Zero line
      macdChart.addSeries(LineSeries, {
        color: "rgba(255,255,255,0.08)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }).setData([
        { time: times[0], value: 0 },
        { time: times[times.length - 1], value: 0 },
      ]);

      macdChart.timeScale().fitContent();

      // Sync timescale
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncingRef.current || !range) return;
        syncingRef.current = true;
        macdChart.timeScale().setVisibleLogicalRange(range);
        syncingRef.current = false;
      });
      macdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncingRef.current || !range) return;
        syncingRef.current = true;
        chart.timeScale().setVisibleLogicalRange(range);
        syncingRef.current = false;
      });

      // Also sync RSI ↔ MACD if both visible
      if (rsiChartRef.current) {
        const rsiChart = rsiChartRef.current;
        rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (syncingRef.current || !range) return;
          syncingRef.current = true;
          macdChart.timeScale().setVisibleLogicalRange(range);
          syncingRef.current = false;
        });
        macdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (syncingRef.current || !range) return;
          syncingRef.current = true;
          rsiChart.timeScale().setVisibleLogicalRange(range);
          syncingRef.current = false;
        });
      }
    }

    // ═══ SQUEEZE MOMENTUM CHART (separate sub-chart) ═══
    if (showSqz && indicators && sqzRef.current) {
      const sqzChart = createChart(sqzRef.current, {
        ...chartOptions,
        width: sqzRef.current.clientWidth,
        height: 120,
      });
      sqzChartRef.current = sqzChart;

      const times = klines.map((k) => toUTC(k.openTime));
      const sqz = indicators.squeezeMomentum;

      // 4-color histogram
      const sqzColorMap: Record<string, string> = {
        lime: "#84cc16",
        green: "#166534",
        red: "#ef4444",
        maroon: "#7f1d1d",
      };
      const sqzHistData = sqz.value
        .map((v, i) => {
          if (v === null) return null;
          const c = sqz.histColor[i];
          return {
            time: times[i],
            value: v,
            color: c ? sqzColorMap[c] ?? "#6b7280" : "#6b7280",
          };
        })
        .filter(Boolean) as { time: UTCTimestamp; value: number; color: string }[];

      sqzChart.addSeries(HistogramSeries, {
        priceLineVisible: false,
        lastValueVisible: true,
      }).setData(sqzHistData);

      // Zero line
      sqzChart.addSeries(LineSeries, {
        color: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }).setData([
        { time: times[0], value: 0 },
        { time: times[times.length - 1], value: 0 },
      ]);

      sqzChart.timeScale().fitContent();

      // Sync timescale with main chart
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncingRef.current || !range) return;
        syncingRef.current = true;
        sqzChart.timeScale().setVisibleLogicalRange(range);
        syncingRef.current = false;
      });
      sqzChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncingRef.current || !range) return;
        syncingRef.current = true;
        chart.timeScale().setVisibleLogicalRange(range);
        syncingRef.current = false;
      });

      // Sync with RSI if visible
      if (rsiChartRef.current) {
        const rsiChart = rsiChartRef.current;
        rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (syncingRef.current || !range) return;
          syncingRef.current = true;
          sqzChart.timeScale().setVisibleLogicalRange(range);
          syncingRef.current = false;
        });
        sqzChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (syncingRef.current || !range) return;
          syncingRef.current = true;
          rsiChart.timeScale().setVisibleLogicalRange(range);
          syncingRef.current = false;
        });
      }

      // Sync with MACD if visible
      if (macdChartRef.current) {
        const macdChart = macdChartRef.current;
        macdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (syncingRef.current || !range) return;
          syncingRef.current = true;
          sqzChart.timeScale().setVisibleLogicalRange(range);
          syncingRef.current = false;
        });
        sqzChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (syncingRef.current || !range) return;
          syncingRef.current = true;
          macdChart.timeScale().setVisibleLogicalRange(range);
          syncingRef.current = false;
        });
      }
    }

    // ─── Resize handler ──────────────────────────────────────
    const handleResize = () => {
      if (mainRef.current && chartRef.current) chartRef.current.applyOptions({ width: mainRef.current.clientWidth });
      if (rsiRef.current && rsiChartRef.current) rsiChartRef.current.applyOptions({ width: rsiRef.current.clientWidth });
      if (macdRef.current && macdChartRef.current) macdChartRef.current.applyOptions({ width: macdRef.current.clientWidth });
      if (sqzRef.current && sqzChartRef.current) sqzChartRef.current.applyOptions({ width: sqzRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chartRef.current?.remove();
      rsiChartRef.current?.remove();
      macdChartRef.current?.remove();
      sqzChartRef.current?.remove();
      chartRef.current = null;
      rsiChartRef.current = null;
      macdChartRef.current = null;
      sqzChartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klines, indicators, btResult, strategyId, isDark, showVwap, showCdcEma, showSupertrendLine, showSmcOb, showRsi, showMacd, showSqz]);

  if (klines.length === 0) return null;

  return (
    <div className="space-y-0 rounded-lg border border-border/50 bg-card overflow-hidden">
      {/* Legend bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 bg-muted/20">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground text-xs">
            {klines.length.toLocaleString()} แท่งเทียน
          </span>
          {btResult && (
            <>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                BUY
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                SELL
              </span>
              <span>
                เทรด: {btResult.totalTrades} |{" "}
                <span className={btResult.totalPnlPct >= 0 ? "text-emerald-500" : "text-red-500"}>
                  {btResult.totalPnlPct >= 0 ? "+" : ""}
                  {btResult.totalPnlPct.toFixed(2)}%
                </span>
              </span>
            </>
          )}
          {indicators && !btResult && (
            <span className="text-muted-foreground/60">กดรัน Backtest เพื่อแสดงสัญญาณซื้อ/ขาย</span>
          )}
        </div>
      </div>

      {/* Indicator toggles */}
      {indicators && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 border-b border-border/20 bg-muted/10">
          <span className="text-[9px] font-medium text-muted-foreground/60 uppercase tracking-wider mr-1">Overlay:</span>
          <OverlayToggle label="VWAP" color="#a855f7" active={showVwap} onToggle={() => setShowVwap(v => !v)} />
          <OverlayToggle label="CDC EMA" color="#3b82f6" secondColor="#f59e0b" active={showCdcEma} onToggle={() => setShowCdcEma(v => !v)} />
          <OverlayToggle label="Supertrend" color="#10b981" secondColor="#ef4444" active={showSupertrendLine} onToggle={() => setShowSupertrendLine(v => !v)} />
          <OverlayToggle label="SMC OB" color="#6b7280" active={showSmcOb} onToggle={() => setShowSmcOb(v => !v)} />
          <span className="text-[9px] text-muted-foreground/30 mx-0.5">|</span>
          <span className="text-[9px] font-medium text-muted-foreground/60 uppercase tracking-wider mr-1">Panel:</span>
          <OverlayToggle label="RSI" color="#a78bfa" active={showRsiToggle} onToggle={() => setShowRsiToggle(v => !v)} />
          <OverlayToggle label="MACD" color="#22d3ee" active={showMacdToggle} onToggle={() => setShowMacdToggle(v => !v)} />
          <OverlayToggle label="SQZ Mom" color="#84cc16" active={showSqzToggle} onToggle={() => setShowSqzToggle(v => !v)} />
        </div>
      )}

      {/* Main candlestick chart */}
      <div ref={mainRef} className="w-full" />

      {/* RSI sub-chart */}
      {showRsi && (
        <div className="border-t border-border/30">
          <div className="flex items-center gap-2 px-3 py-0.5 bg-muted/10">
            <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">RSI(14)</span>
            <span className="text-[9px] text-red-500/50">70</span>
            <span className="text-[9px] text-emerald-500/50">30</span>
          </div>
          <div ref={rsiRef} className="w-full" />
        </div>
      )}

      {/* MACD sub-chart */}
      {showMacd && (
        <div className="border-t border-border/30">
          <div className="flex items-center gap-2 px-3 py-0.5 bg-muted/10">
            <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">CM MacD</span>
            <span className="text-[9px] text-blue-500/50">MACD</span>
            <span className="text-[9px] text-orange-500/50">Signal</span>
            <span className="text-[9px] text-cyan-400/50">Hist</span>
          </div>
          <div ref={macdRef} className="w-full" />
        </div>
      )}

      {/* Squeeze Momentum sub-chart */}
      {showSqz && (
        <div className="border-t border-border/30">
          <div className="flex items-center gap-2 px-3 py-0.5 bg-muted/10">
            <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">Squeeze Mom</span>
            <span className="text-[9px] text-lime-400/50">Lime</span>
            <span className="text-[9px] text-green-600/50">Green</span>
            <span className="text-[9px] text-red-500/50">Red</span>
            <span className="text-[9px] text-red-800/50">Maroon</span>
          </div>
          <div ref={sqzRef} className="w-full" />
        </div>
      )}
    </div>
  );
}
