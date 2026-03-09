"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  type KlineData,
  type BinanceKlineRaw,
  type Interval,
  INDICATOR_REQUIREMENTS,
  parseKline,
} from "@/lib/types/kline";
import { computeAll, type AllIndicators } from "@/lib/indicators";
import {
  runBacktest,
  STRATEGIES,
  type StrategyId,
  type BacktestResult,
  type Trade,
} from "@/lib/backtest";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

// ─── Constants ─────────────────────────────────────────────────
const POPULAR_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
  "MATICUSDT", "LTCUSDT", "ATOMUSDT", "NEARUSDT", "APTUSDT",
  "ARBUSDT", "OPUSDT", "SUIUSDT", "INJUSDT", "FETUSDT",
];

const INTERVAL_GROUPS: Record<string, Interval[]> = {
  "Seconds": ["1s"],
  "Minutes": ["1m", "3m", "5m", "15m", "30m"],
  "Hours": ["1h", "2h", "4h", "6h", "8h", "12h"],
  "Days+": ["1d", "3d", "1w", "1M"],
};

// ─── Formatting ────────────────────────────────────────────────
function fmtNum(val: string | number, dec = 2): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(dec);
}
function fmtPrice(val: string | number): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtFullDate(ts: number): string {
  return new Date(ts).toLocaleString("en-US", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
function pnlColor(v: number): string {
  return v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "text-muted-foreground";
}
function pnlBg(v: number): string {
  return v > 0 ? "bg-emerald-500/10" : v < 0 ? "bg-red-500/10" : "bg-muted";
}

// ─── Mini Candle ───────────────────────────────────────────────
function MiniCandle({ kline }: { kline: KlineData }) {
  const o = +kline.open, c = +kline.close, h = +kline.high, l = +kline.low;
  const isUp = c >= o;
  const range = h - l;
  if (range === 0) return <div className="h-6 w-2" />;
  const bodyTop = ((h - Math.max(o, c)) / range) * 100;
  const bodyHeight = (Math.abs(c - o) / range) * 100;
  const color = isUp ? "bg-emerald-500" : "bg-red-500";
  return (
    <div className="relative h-6 w-2 mx-auto">
      <div className={`absolute left-1/2 w-px -translate-x-1/2 ${color}`} style={{ top: 0, height: "100%" }} />
      <div className={`absolute left-0 w-full ${color}`} style={{ top: `${bodyTop}%`, height: `${Math.max(bodyHeight, 4)}%` }} />
    </div>
  );
}

// ─── Equity Chart (pure CSS bars) ──────────────────────────────
function EquityChart({ curve, trades }: { curve: number[]; trades: Trade[] }) {
  // Sample to max ~200 points
  const step = Math.max(1, Math.floor(curve.length / 200));
  const sampled = curve.filter((_, i) => i % step === 0 || i === curve.length - 1);
  const max = Math.max(...sampled, 0.01);
  const min = Math.min(...sampled, -0.01);
  const range = max - min || 1;
  const zeroY = ((max - 0) / range) * 100;

  return (
    <div className="relative h-32 w-full">
      {/* Zero line */}
      <div className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/30" style={{ top: `${zeroY}%` }} />
      <div className="absolute left-1 text-[9px] text-muted-foreground" style={{ top: `${Math.max(zeroY - 5, 0)}%` }}>0%</div>
      {/* Bars */}
      <div className="flex h-full items-end gap-px">
        {sampled.map((val, i) => {
          const h = Math.abs(val) / range * 100;
          const isPos = val >= 0;
          return (
            <div key={i} className="flex-1 flex flex-col justify-end h-full relative">
              {isPos ? (
                <div
                  className="w-full bg-emerald-500/60 absolute"
                  style={{ bottom: `${100 - zeroY}%`, height: `${Math.max(h, 0.5)}%` }}
                />
              ) : (
                <div
                  className="w-full bg-red-500/60 absolute"
                  style={{ top: `${zeroY}%`, height: `${Math.max(h, 0.5)}%` }}
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Labels */}
      <div className="absolute top-0 right-1 text-[9px] text-emerald-500 tabular-nums">+{max.toFixed(1)}%</div>
      <div className="absolute bottom-0 right-1 text-[9px] text-red-500 tabular-nums">{min.toFixed(1)}%</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════
export default function KlinesPage() {
  // Data state
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [customSymbol, setCustomSymbol] = useState("");
  const [interval, setInterval] = useState<Interval>("1h");
  const [limit, setLimit] = useState("200");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [backtestProgress, setBacktestProgress] = useState<{ current: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Indicator state
  const [indicators, setIndicators] = useState<AllIndicators | null>(null);

  // Backtest state
  const [strategyId, setStrategyId] = useState<StrategyId>("rsi");
  const [feesPct, setFeesPct] = useState("0.1");
  const [btResult, setBtResult] = useState<BacktestResult | null>(null);
  const [btRunning, setBtRunning] = useState(false);

  const activeSymbol = customSymbol.trim().toUpperCase() || symbol;

  // Compute indicators when klines change
  useEffect(() => {
    if (klines.length >= 15) {
      setIndicators(computeAll(klines));
    } else {
      setIndicators(null);
    }
  }, [klines]);

  // ─── Fetch Real-time ────────────────────────────────────────
  const fetchRealtime = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ symbol: activeSymbol, interval, limit });
      const res = await fetch(`/api/klines?${params}`);
      if (!res.ok) { const b = await res.json(); throw new Error(b.error || `HTTP ${res.status}`); }
      const raw: BinanceKlineRaw[] = await res.json();
      setKlines(raw.map(parseKline));
      setLastFetch(new Date());
      setBtResult(null);
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }, [activeSymbol, interval, limit]);

  // ─── Fetch Backtest Historical ──────────────────────────────
  const fetchBacktest = useCallback(async () => {
    if (!startTime) { setError("Start time is required"); return; }
    setLoading(true); setError(null); setKlines([]); setBtResult(null);
    setBacktestProgress({ current: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const st = new Date(startTime).getTime();
      const et = endTime ? new Date(endTime).getTime() : Date.now();
      let cur = st;
      const all: KlineData[] = [];
      while (cur < et) {
        if (controller.signal.aborted) break;
        setBacktestProgress({ current: all.length });
        const params = new URLSearchParams({
          symbol: activeSymbol, interval, limit: "1000",
          startTime: cur.toString(), endTime: et.toString(),
        });
        const res = await fetch(`/api/klines?${params}`, { signal: controller.signal });
        if (!res.ok) { const b = await res.json(); throw new Error(b.error || `HTTP ${res.status}`); }
        const raw: BinanceKlineRaw[] = await res.json();
        if (raw.length === 0) break;
        const parsed = raw.map(parseKline);
        all.push(...parsed);
        const last = parsed[parsed.length - 1].closeTime;
        if (last >= et || raw.length < 1000) break;
        cur = last + 1;
        await new Promise(r => setTimeout(r, 100));
      }
      setKlines(all);
      setLastFetch(new Date());
    } catch (err) {
      if (!controller.signal.aborted) setError(String(err));
    } finally {
      setLoading(false); setBacktestProgress(null); abortRef.current = null;
    }
  }, [activeSymbol, interval, startTime, endTime]);

  // ─── Run Backtest ───────────────────────────────────────────
  const runBt = useCallback(() => {
    if (klines.length < 50) { setError("Need at least 50 candles for backtest"); return; }
    setBtRunning(true);
    setError(null);
    // run in microtask to allow UI update
    setTimeout(() => {
      try {
        const result = runBacktest(klines, strategyId, {}, parseFloat(feesPct) || 0.1);
        setBtResult(result);
      } catch (err) { setError(String(err)); }
      finally { setBtRunning(false); }
    }, 10);
  }, [klines, strategyId, feesPct]);

  // Summary stats
  const summary = useMemo(() => {
    if (klines.length === 0) return null;
    const c = klines.map(k => +k.close);
    const h = klines.map(k => +k.high);
    const l = klines.map(k => +k.low);
    const v = klines.map(k => +k.volume);
    return {
      lastClose: c[c.length - 1],
      pctChange: ((c[c.length - 1] - c[0]) / c[0]) * 100,
      highest: Math.max(...h),
      lowest: Math.min(...l),
      totalVol: v.reduce((a, b) => a + b, 0),
      avgVol: v.reduce((a, b) => a + b, 0) / v.length,
    };
  }, [klines]);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1400px] px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Binance Klines & Backtest</h1>
            <p className="text-xs text-muted-foreground">Trading Indicators + Strategy Backtest with P&L</p>
          </div>
          <div className="flex items-center gap-2">
            {lastFetch && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Last: {lastFetch.toLocaleTimeString()}
              </Badge>
            )}
            {klines.length > 0 && (
              <Badge variant="secondary">{klines.length.toLocaleString()} candles</Badge>
            )}
          </div>
        </div>
        <Separator />

        {/* Tabs */}
        <Tabs defaultValue="realtime">
          <TabsList variant="line">
            <TabsTrigger value="realtime">Real-time Indicators</TabsTrigger>
            <TabsTrigger value="backtest">Backtest & P/L</TabsTrigger>
          </TabsList>

          {/* ═══ REAL-TIME TAB ═══ */}
          <TabsContent value="realtime">
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
                {/* Config */}
                <Card size="sm">
                  <CardHeader>
                    <CardTitle>Configuration</CardTitle>
                    <CardDescription>Fetch latest candles for indicator calculation</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-3">
                      <Field label="Symbol">
                        <Select value={symbol} onValueChange={(v) => { if (v) { setSymbol(v); setCustomSymbol(""); } }}>
                          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectGroup><SelectLabel>Popular</SelectLabel>
                              {POPULAR_SYMBOLS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Custom">
                        <Input placeholder="e.g. PEPEUSDT" value={customSymbol} onChange={e => setCustomSymbol(e.target.value)} className="w-32" />
                      </Field>
                      <Field label="Interval">
                        <Select value={interval} onValueChange={(v) => { if (v) setInterval(v as Interval); }}>
                          <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(INTERVAL_GROUPS).map(([g, ints]) => (
                              <SelectGroup key={g}><SelectLabel>{g}</SelectLabel>
                                {ints.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Limit">
                        <Select value={limit} onValueChange={(v) => { if (v) setLimit(v); }}>
                          <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["50","100","200","500","1000"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <Button onClick={fetchRealtime} disabled={loading}>
                      {loading ? "Fetching..." : "Fetch Klines"}
                    </Button>
                  </CardContent>
                </Card>

                {/* Indicator Requirements */}
                <Card size="sm">
                  <CardHeader><CardTitle>Indicator Status</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {Object.entries(INDICATOR_REQUIREMENTS).map(([name, { minBars }]) => {
                        const ok = klines.length >= minBars;
                        return (
                          <div key={name} className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground">{name}</span>
                            <div className="flex items-center gap-1.5">
                              <span className="tabular-nums">{minBars}</span>
                              {klines.length > 0 && <span className={`size-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`} />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {klines.length > 0 && (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        {Object.values(INDICATOR_REQUIREMENTS).filter(({ minBars }) => klines.length >= minBars).length}/{Object.keys(INDICATOR_REQUIREMENTS).length} ready
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Error */}
              {error && <ErrorCard message={error} />}

              {/* Summary */}
              {summary && <SummaryCards summary={summary} />}

              {/* Indicator Values */}
              {indicators && <IndicatorPanel indicators={indicators} klines={klines} />}

              {/* Kline Table */}
              <KlineTable klines={klines} loading={loading} />
            </div>
          </TabsContent>

          {/* ═══ BACKTEST TAB ═══ */}
          <TabsContent value="backtest">
            <div className="mt-4 space-y-4">
              {/* Backtest Config */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
                <Card size="sm">
                  <CardHeader>
                    <CardTitle>Historical Data</CardTitle>
                    <CardDescription>Fetch candles then run strategy backtest</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-3">
                      <Field label="Symbol">
                        <Select value={symbol} onValueChange={(v) => { if (v) { setSymbol(v); setCustomSymbol(""); } }}>
                          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectGroup><SelectLabel>Popular</SelectLabel>
                              {POPULAR_SYMBOLS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Custom">
                        <Input placeholder="e.g. PEPEUSDT" value={customSymbol} onChange={e => setCustomSymbol(e.target.value)} className="w-32" />
                      </Field>
                      <Field label="Interval">
                        <Select value={interval} onValueChange={(v) => { if (v) setInterval(v as Interval); }}>
                          <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(INTERVAL_GROUPS).map(([g, ints]) => (
                              <SelectGroup key={g}><SelectLabel>{g}</SelectLabel>
                                {ints.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Start Date">
                        <Input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-48" />
                      </Field>
                      <Field label="End Date">
                        <Input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-48" />
                      </Field>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button onClick={fetchBacktest} disabled={loading}>
                        {loading ? "Fetching..." : "Fetch Historical"}
                      </Button>
                      {loading && (
                        <Button variant="destructive" size="sm" onClick={() => abortRef.current?.abort()}>Cancel</Button>
                      )}
                      {backtestProgress && (
                        <span className="text-[10px] text-muted-foreground animate-pulse">
                          {backtestProgress.current.toLocaleString()} candles...
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Strategy Selection */}
                <Card size="sm">
                  <CardHeader><CardTitle>Strategy & Run</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <Field label="Strategy">
                      <Select value={strategyId} onValueChange={(v) => { if (v) setStrategyId(v as StrategyId); }}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STRATEGIES.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <p className="text-[10px] text-muted-foreground">
                      {STRATEGIES.find(s => s.id === strategyId)?.description}
                    </p>
                    <Field label="Fees per trade (%)">
                      <Input type="number" step="0.01" value={feesPct} onChange={e => setFeesPct(e.target.value)} className="w-24" />
                    </Field>
                    <Button onClick={runBt} disabled={btRunning || klines.length < 50} className="w-full">
                      {btRunning ? "Running..." : `Run Backtest (${klines.length} candles)`}
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {error && <ErrorCard message={error} />}
              {summary && <SummaryCards summary={summary} />}

              {/* Backtest Results */}
              {btResult && <BacktestResults result={btResult} klines={klines} />}

              {/* Kline Table */}
              <KlineTable klines={klines} loading={loading} signals={btResult?.signals} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card size="sm" className="border-destructive/30 bg-destructive/5">
      <CardContent className="py-2 text-xs text-destructive">{message}</CardContent>
    </Card>
  );
}

function SummaryCards({ summary }: { summary: { lastClose: number; pctChange: number; highest: number; lowest: number; totalVol: number; avgVol: number } }) {
  const items = [
    { label: "Last Close", value: fmtPrice(summary.lastClose), color: "" },
    { label: "Change", value: `${summary.pctChange >= 0 ? "+" : ""}${summary.pctChange.toFixed(2)}%`, color: pnlColor(summary.pctChange) },
    { label: "Highest", value: fmtPrice(summary.highest), color: "text-emerald-500" },
    { label: "Lowest", value: fmtPrice(summary.lowest), color: "text-red-500" },
    { label: "Total Vol", value: fmtNum(summary.totalVol), color: "" },
    { label: "Avg Vol", value: fmtNum(summary.avgVol), color: "" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(i => (
        <Card size="sm" key={i.label}>
          <CardContent className="pt-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{i.label}</p>
            <p className={`text-sm font-semibold tabular-nums ${i.color}`}>{i.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Indicator Panel ───────────────────────────────────────────
function IndicatorPanel({ indicators, klines }: { indicators: AllIndicators; klines: KlineData[] }) {
  const last = klines.length - 1;
  const c = +klines[last].close;

  const rows: { name: string; value: string; signal: string; color: string }[] = [];

  // RSI
  const rsiVal = indicators.rsi[last];
  if (rsiVal !== null) {
    const sig = rsiVal < 30 ? "Oversold (BUY)" : rsiVal > 70 ? "Overbought (SELL)" : "Neutral";
    rows.push({ name: "RSI(14)", value: rsiVal.toFixed(2), signal: sig, color: rsiVal < 30 ? "text-emerald-500" : rsiVal > 70 ? "text-red-500" : "text-muted-foreground" });
  }

  // MACD
  const m = indicators.macd.macd[last], s = indicators.macd.signal[last], h = indicators.macd.histogram[last];
  if (m !== null && s !== null) {
    const sig = m > s ? "Bullish" : "Bearish";
    rows.push({ name: "MACD", value: `${m.toFixed(2)} / ${s.toFixed(2)}`, signal: sig, color: m > s ? "text-emerald-500" : "text-red-500" });
  }

  // EMA 50/200
  const e50 = indicators.ema50[last], e200 = indicators.ema200[last];
  if (e50 !== null) rows.push({ name: "EMA(50)", value: fmtPrice(e50), signal: c > e50 ? "Above" : "Below", color: c > e50 ? "text-emerald-500" : "text-red-500" });
  if (e200 !== null) rows.push({ name: "EMA(200)", value: fmtPrice(e200), signal: c > e200 ? "Above" : "Below", color: c > e200 ? "text-emerald-500" : "text-red-500" });
  if (e50 !== null && e200 !== null) {
    rows.push({ name: "Golden Cross", value: e50 > e200 ? "Yes" : "No", signal: e50 > e200 ? "Bullish" : "Bearish", color: e50 > e200 ? "text-emerald-500" : "text-red-500" });
  }

  // BB
  const bbU = indicators.bb.upper[last], bbL = indicators.bb.lower[last], bbM = indicators.bb.middle[last];
  if (bbU !== null && bbL !== null) {
    const sig = c >= bbU ? "Near Upper (SELL)" : c <= bbL ? "Near Lower (BUY)" : "In Band";
    rows.push({ name: "BB(20)", value: `${fmtPrice(bbU)} / ${fmtPrice(bbL)}`, signal: sig, color: c >= bbU ? "text-red-500" : c <= bbL ? "text-emerald-500" : "text-muted-foreground" });
  }

  // ADX
  const adxVal = indicators.adx.adx[last], pdi = indicators.adx.plusDI[last], mdi = indicators.adx.minusDI[last];
  if (adxVal !== null && pdi !== null && mdi !== null) {
    const trend = adxVal > 25 ? (pdi > mdi ? "Strong Uptrend" : "Strong Downtrend") : "Weak/No Trend";
    rows.push({ name: "ADX(14)", value: `${adxVal.toFixed(1)} (+DI:${pdi.toFixed(1)} -DI:${mdi.toFixed(1)})`, signal: trend, color: adxVal > 25 && pdi > mdi ? "text-emerald-500" : adxVal > 25 ? "text-red-500" : "text-muted-foreground" });
  }

  // ATR
  const atrVal = indicators.atr[last];
  if (atrVal !== null) rows.push({ name: "ATR(14)", value: fmtPrice(atrVal), signal: `${((atrVal / c) * 100).toFixed(2)}% volatility`, color: "text-muted-foreground" });

  // OBV
  const obvVal = indicators.obv[last];
  const obvPrev = last > 0 ? indicators.obv[last - 1] : obvVal;
  rows.push({ name: "OBV", value: fmtNum(obvVal), signal: obvVal > obvPrev ? "Rising" : "Falling", color: obvVal > obvPrev ? "text-emerald-500" : "text-red-500" });

  // MFI
  const mfiVal = indicators.mfi[last];
  if (mfiVal !== null) {
    const sig = mfiVal < 20 ? "Oversold (BUY)" : mfiVal > 80 ? "Overbought (SELL)" : "Neutral";
    rows.push({ name: "MFI(14)", value: mfiVal.toFixed(2), signal: sig, color: mfiVal < 20 ? "text-emerald-500" : mfiVal > 80 ? "text-red-500" : "text-muted-foreground" });
  }

  // VWAP
  const vwapVal = indicators.vwap[last];
  rows.push({ name: "VWAP", value: fmtPrice(vwapVal), signal: c > vwapVal ? "Above (Bullish)" : "Below (Bearish)", color: c > vwapVal ? "text-emerald-500" : "text-red-500" });

  // Ichimoku
  const ich = indicators.ichimoku;
  if (ich.tenkan[last] !== null && ich.kijun[last] !== null) {
    const cloudTop = Math.max(ich.senkouA[last] ?? 0, ich.senkouB[last] ?? 0);
    const sig = c > cloudTop ? "Above Cloud (Bullish)" : "Below Cloud (Bearish)";
    rows.push({ name: "Ichimoku", value: `T:${fmtPrice(ich.tenkan[last]!)} K:${fmtPrice(ich.kijun[last]!)}`, signal: sig, color: c > cloudTop ? "text-emerald-500" : "text-red-500" });
  }

  return (
    <Card size="sm">
      <CardHeader className="border-b"><CardTitle>Live Indicator Values</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Indicator</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Signal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.name}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="tabular-nums">{r.value}</TableCell>
                <TableCell className={r.color}>{r.signal}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Backtest Results ──────────────────────────────────────────
function BacktestResults({ result, klines }: { result: BacktestResult; klines: KlineData[] }) {
  const [tradePage, setTradePage] = useState(0);
  const tradePageSize = 20;
  const totalTradePages = Math.ceil(result.trades.length / tradePageSize);
  const displayedTrades = result.trades.slice(tradePage * tradePageSize, (tradePage + 1) * tradePageSize);

  const strategyBetter = result.totalPnlPct > result.buyAndHoldPct;

  return (
    <div className="space-y-4">
      {/* P&L Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total P&L" value={`${result.totalPnlPct >= 0 ? "+" : ""}${result.totalPnlPct.toFixed(2)}%`} color={pnlColor(result.totalPnlPct)} bg={pnlBg(result.totalPnlPct)} />
        <StatCard label="Buy & Hold" value={`${result.buyAndHoldPct >= 0 ? "+" : ""}${result.buyAndHoldPct.toFixed(2)}%`} color={pnlColor(result.buyAndHoldPct)} bg={pnlBg(result.buyAndHoldPct)} />
        <StatCard label="Win Rate" value={`${result.winRate.toFixed(1)}%`} color={result.winRate >= 50 ? "text-emerald-500" : "text-red-500"} />
        <StatCard label="Trades" value={`${result.totalTrades} (W:${result.wins} L:${result.losses})`} />
        <StatCard label="Profit Factor" value={result.profitFactor === Infinity ? "INF" : result.profitFactor.toFixed(2)} color={result.profitFactor > 1 ? "text-emerald-500" : "text-red-500"} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Avg Win" value={`+${result.avgWinPct.toFixed(2)}%`} color="text-emerald-500" size="sm" />
        <StatCard label="Avg Loss" value={`${result.avgLossPct.toFixed(2)}%`} color="text-red-500" size="sm" />
        <StatCard label="Best Trade" value={`+${result.bestTradePct.toFixed(2)}%`} color="text-emerald-500" size="sm" />
        <StatCard label="Worst Trade" value={`${result.worstTradePct.toFixed(2)}%`} color="text-red-500" size="sm" />
        <StatCard label="Max Drawdown" value={`-${result.maxDrawdownPct.toFixed(2)}%`} color="text-red-500" size="sm" />
        <StatCard label="Sharpe" value={result.sharpeRatio.toFixed(3)} color={result.sharpeRatio > 0 ? "text-emerald-500" : "text-red-500"} size="sm" />
      </div>

      {/* Strategy vs Buy&Hold comparison */}
      <Card size="sm" className={strategyBetter ? "ring-emerald-500/30" : "ring-red-500/30"}>
        <CardContent className="py-3">
          <div className="flex items-center gap-3 text-xs">
            <span className={`text-sm font-semibold ${strategyBetter ? "text-emerald-500" : "text-red-500"}`}>
              {strategyBetter ? "Strategy BEATS Buy & Hold" : "Buy & Hold BEATS Strategy"}
            </span>
            <span className="text-muted-foreground">
              Strategy: {result.totalPnlPct >= 0 ? "+" : ""}{result.totalPnlPct.toFixed(2)}% vs B&H: {result.buyAndHoldPct >= 0 ? "+" : ""}{result.buyAndHoldPct.toFixed(2)}%
              ({strategyBetter ? "+" : ""}{(result.totalPnlPct - result.buyAndHoldPct).toFixed(2)}% diff)
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Equity Curve */}
      <Card size="sm">
        <CardHeader className="border-b"><CardTitle>Equity Curve (Cumulative P&L %)</CardTitle></CardHeader>
        <CardContent className="pt-3">
          <EquityChart curve={result.equityCurve} trades={result.trades} />
        </CardContent>
      </Card>

      {/* Trade History */}
      <Card size="sm">
        <CardHeader className="border-b">
          <CardTitle>Trade History</CardTitle>
          <CardDescription>{result.trades.length} trades total</CardDescription>
          {totalTradePages > 1 && (
            <CardAction>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="xs" onClick={() => setTradePage(p => Math.max(0, p - 1))} disabled={tradePage === 0}>Prev</Button>
                <span className="text-[10px] tabular-nums text-muted-foreground">{tradePage + 1}/{totalTradePages}</span>
                <Button variant="outline" size="xs" onClick={() => setTradePage(p => Math.min(totalTradePages - 1, p + 1))} disabled={tradePage >= totalTradePages - 1}>Next</Button>
              </div>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Entry Time</TableHead>
                <TableHead className="text-right">Entry Price</TableHead>
                <TableHead>Exit Time</TableHead>
                <TableHead className="text-right">Exit Price</TableHead>
                <TableHead className="text-right">P&L %</TableHead>
                <TableHead className="text-right">Bars</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedTrades.map((t, i) => (
                <TableRow key={i} className={t.pnlPct > 0 ? "bg-emerald-500/[0.03]" : t.pnlPct < 0 ? "bg-red-500/[0.03]" : ""}>
                  <TableCell className="text-muted-foreground tabular-nums">{tradePage * tradePageSize + i + 1}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(t.entryTime)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPrice(t.entryPrice)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(t.exitTime)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPrice(t.exitPrice)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${pnlColor(t.pnlPct)}`}>
                    {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{t.bars}</TableCell>
                  <TableCell className="text-[10px] text-muted-foreground max-w-40 truncate">{t.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, color = "", bg = "", size = "default" }: { label: string; value: string; color?: string; bg?: string; size?: string }) {
  return (
    <Card size="sm" className={bg}>
      <CardContent className={size === "sm" ? "pt-2 pb-2" : "pt-3"}>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`${size === "sm" ? "text-xs" : "text-sm"} font-semibold tabular-nums ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

// ─── Kline Table ───────────────────────────────────────────────
function KlineTable({ klines, loading, signals }: { klines: KlineData[]; loading: boolean; signals?: import("@/lib/backtest").SignalAction[] }) {
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const totalPages = Math.ceil(klines.length / pageSize);
  useEffect(() => { setPage(0); }, [klines]);

  const reversed = useMemo(() => klines.slice().reverse(), [klines]);
  const reversedSignals = useMemo(() => signals?.slice().reverse(), [signals]);
  const displayed = reversed.slice(page * pageSize, (page + 1) * pageSize);
  const displayedSigs = reversedSignals?.slice(page * pageSize, (page + 1) * pageSize);

  if (loading && klines.length === 0) {
    return (
      <Card size="sm">
        <CardContent className="space-y-2 py-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
        </CardContent>
      </Card>
    );
  }
  if (klines.length === 0) {
    return (
      <Card size="sm">
        <CardContent className="py-12 text-center text-xs text-muted-foreground">
          No data yet. Configure parameters and click Fetch.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader className="border-b">
        <CardTitle>Candlestick Data</CardTitle>
        <CardDescription>{klines.length.toLocaleString()} candles — {fmtFullDate(klines[0].openTime)} to {fmtFullDate(klines[klines.length - 1].closeTime)}</CardDescription>
        <CardAction>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="xs" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Prev</Button>
            <span className="text-[10px] tabular-nums text-muted-foreground">{page + 1}/{totalPages}</span>
            <Button variant="outline" size="xs" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Next</Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Open Time</TableHead>
              <TableHead className="w-6"></TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">High</TableHead>
              <TableHead className="text-right">Low</TableHead>
              <TableHead className="text-right">Close</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">Volume</TableHead>
              {signals && <TableHead className="text-center">Signal</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayed.map((k, i) => {
              const isUp = +k.close >= +k.open;
              const pct = ((+k.close - +k.open) / +k.open) * 100;
              const sig = displayedSigs?.[i];
              return (
                <TableRow key={k.openTime} className={sig === "BUY" ? "bg-emerald-500/[0.04]" : sig === "SELL" ? "bg-red-500/[0.04]" : ""}>
                  <TableCell className="text-muted-foreground tabular-nums">{klines.length - (page * pageSize + i)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(k.openTime)}</TableCell>
                  <TableCell><MiniCandle kline={k} /></TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPrice(k.open)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-500/80">{fmtPrice(k.high)}</TableCell>
                  <TableCell className="text-right tabular-nums text-red-500/80">{fmtPrice(k.low)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${isUp ? "text-emerald-500" : "text-red-500"}`}>{fmtPrice(k.close)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${pct >= 0 ? "text-emerald-500" : "text-red-500"}`}>{pct >= 0 ? "+" : ""}{pct.toFixed(2)}%</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmtNum(k.volume)}</TableCell>
                  {signals && (
                    <TableCell className="text-center">
                      {sig === "BUY" && <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/30">BUY</Badge>}
                      {sig === "SELL" && <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/30">SELL</Badge>}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-2">
          <span className="text-[10px] text-muted-foreground">
            {page * pageSize + 1}-{Math.min((page + 1) * pageSize, klines.length)} of {klines.length.toLocaleString()}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="xs" onClick={() => setPage(0)} disabled={page === 0}>First</Button>
            <Button variant="outline" size="xs" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Prev</Button>
            <Button variant="outline" size="xs" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Next</Button>
            <Button variant="outline" size="xs" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>Last</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
