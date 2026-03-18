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
  "วินาที": ["1s"],
  "นาที": ["1m", "3m", "5m", "15m", "30m"],
  "ชั่วโมง": ["1h", "2h", "4h", "6h", "8h", "12h"],
  "วัน+": ["1d", "3d", "1w", "1M"],
};

const PARAM_LABELS: Record<string, string> = {
  period: "RSI Period",
  buyThreshold: "ซื้อเมื่อ RSI <",
  sellThreshold: "ขายเมื่อ RSI >",
  adxThreshold: "ADX Threshold",
  fastPeriod: "Fast EMA",
  slowPeriod: "Slow EMA",
  swingSize: "Swing Size",
  internalSize: "Internal Size",
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
  const step = Math.max(1, Math.floor(curve.length / 200));
  const sampled = curve.filter((_, i) => i % step === 0 || i === curve.length - 1);
  const max = Math.max(...sampled, 0.01);
  const min = Math.min(...sampled, -0.01);
  const range = max - min || 1;
  const zeroY = ((max - 0) / range) * 100;

  // Map trade exit indices to sampled bar indices
  const tradeMarkers: { barIdx: number; pnlPct: number }[] = [];
  for (const t of trades) {
    const sampledIdx = Math.round(t.exitIdx / step);
    const clampedIdx = Math.min(sampledIdx, sampled.length - 1);
    tradeMarkers.push({ barIdx: clampedIdx, pnlPct: t.pnlPct });
  }

  // Group markers by barIdx (multiple trades may map to same sampled bar)
  const markerMap = new Map<number, number[]>();
  for (const m of tradeMarkers) {
    const arr = markerMap.get(m.barIdx) || [];
    arr.push(m.pnlPct);
    markerMap.set(m.barIdx, arr);
  }

  return (
    <div className="relative h-40 w-full">
      <div className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/30" style={{ top: `${zeroY}%` }} />
      <div className="absolute left-1 text-[9px] text-muted-foreground" style={{ top: `${Math.max(zeroY - 5, 0)}%` }}>0%</div>
      <div className="flex h-full items-end gap-px">
        {sampled.map((val, i) => {
          const h = Math.abs(val) / range * 100;
          const isPos = val >= 0;
          const markers = markerMap.get(i);
          return (
            <div key={i} className="flex-1 flex flex-col justify-end h-full relative group">
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
              {markers && (
                <>
                  {/* Trade marker dot */}
                  <div
                    className={`absolute w-1.5 h-1.5 rounded-full left-1/2 -translate-x-1/2 z-10 ${markers[markers.length - 1] >= 0 ? "bg-emerald-400" : "bg-red-400"}`}
                    style={{
                      top: isPos
                        ? `${zeroY - (val / range) * 100 - 2}%`
                        : `${zeroY + (Math.abs(val) / range) * 100}%`,
                    }}
                  />
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-20 pointer-events-none">
                    <div className="bg-popover border border-border rounded px-1.5 py-0.5 shadow-md whitespace-nowrap">
                      {markers.map((pnl, mi) => (
                        <div key={mi} className={`text-[9px] font-medium tabular-nums ${pnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                        </div>
                      ))}
                      <div className="text-[8px] text-muted-foreground tabular-nums">สะสม: {val >= 0 ? "+" : ""}{val.toFixed(2)}%</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
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
  const [strategyParams, setStrategyParams] = useState<Record<string, number>>(
    () => ({ ...STRATEGIES.find(s => s.id === "rsi")!.params })
  );
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

  // ─── Fetch Historical ──────────────────────────────────────
  const fetchHistorical = useCallback(async () => {
    if (!startTime) { setError("กรุณาระบุเวลาเริ่มต้น"); return; }
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
    if (klines.length < 50) { setError("ต้องมีอย่างน้อย 50 แท่งเทียนเพื่อรัน Backtest"); return; }
    setBtRunning(true);
    setError(null);
    setTimeout(() => {
      try {
        const result = runBacktest(klines, strategyId, strategyParams, parseFloat(feesPct) || 0.1);
        setBtResult(result);
      } catch (err) { setError(String(err)); }
      finally { setBtRunning(false); }
    }, 10);
  }, [klines, strategyId, strategyParams, feesPct]);

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
            <p className="text-xs text-muted-foreground">ตัวชี้วัดการเทรด + ทดสอบกลยุทธ์ย้อนหลังพร้อมกำไร/ขาดทุน</p>
          </div>
          <div className="flex items-center gap-2">
            {lastFetch && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                ล่าสุด: {lastFetch.toLocaleTimeString()}
              </Badge>
            )}
            {klines.length > 0 && (
              <Badge variant="secondary">{klines.length.toLocaleString()} แท่งเทียน</Badge>
            )}
          </div>
        </div>
        <Separator />

        {/* ═══ CONFIG ═══ */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_350px]">
          <Card size="sm">
            <CardHeader>
              <CardTitle>ตั้งค่า</CardTitle>
              <CardDescription>เลือกคู่เหรียญและช่วงเวลา แล้วดึงข้อมูลแบบเรียลไทม์หรือย้อนหลัง</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Shared: Symbol / Custom / Interval */}
              <div className="flex flex-wrap gap-3 items-center">
                <Field label="คู่เหรียญ">
                  <Select value={symbol} onValueChange={(v) => { if (v) { setSymbol(v); setCustomSymbol(""); } }}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup><SelectLabel>ยอดนิยม</SelectLabel>
                        {POPULAR_SYMBOLS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="">
                  <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">กำหนดเอง</p>
                  <Input placeholder="เช่น PEPEUSDT" value={customSymbol} onChange={e => setCustomSymbol(e.target.value)} className="w-36" />
                </Field>
                <Field label="ช่วงเวลา">
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
              </div>

              <Separator />

              {/* Two fetch modes side by side */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Real-time fetch */}
                <div className="space-y-2">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">เรียลไทม์</p>
                  <div className="flex items-end gap-2">
                    <Field label="จำนวน">
                      <Select value={limit} onValueChange={(v) => { if (v) setLimit(v); }}>
                        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["50", "100", "200", "500", "1000"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Button onClick={fetchRealtime} disabled={loading} className="h-9">
                      {loading ? "กำลังดึง..." : "ดึงข้อมูลล่าสุด"}
                    </Button>
                  </div>
                </div>

                {/* Historical fetch */}
                <div className="space-y-2">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">ข้อมูลย้อนหลัง</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="เริ่มต้น">
                      <Input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-44" />
                    </Field>
                    <Field label="สิ้นสุด">
                      <Input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-44" />
                    </Field>
                    <Button onClick={fetchHistorical} disabled={loading} className="h-9">
                      {loading ? "กำลังดึง..." : "ดึงข้อมูลย้อนหลัง"}
                    </Button>
                    {loading && (
                      <Button variant="destructive" size="sm" onClick={() => abortRef.current?.abort()}>ยกเลิก</Button>
                    )}
                  </div>
                  {backtestProgress && (
                    <span className="text-[10px] text-muted-foreground animate-pulse">
                      {backtestProgress.current.toLocaleString()} แท่งเทียน...
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Indicator Status */}
          <Card size="sm">
            <CardHeader><CardTitle>สถานะตัวชี้วัด</CardTitle></CardHeader>
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
                  {Object.values(INDICATOR_REQUIREMENTS).filter(({ minBars }) => klines.length >= minBars).length}/{Object.keys(INDICATOR_REQUIREMENTS).length} พร้อมใช้งาน
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Error */}
        {error && <ErrorCard message={error} />}

        {/* Summary */}
        {summary && <SummaryCards summary={summary} />}

        {/* ═══ BACKTEST ═══ */}
        {klines.length > 0 && (
          <Card size="sm">
            <CardHeader className="border-b">
              <CardTitle>ทดสอบกลยุทธ์ย้อนหลัง กับ Indicator</CardTitle>
              <CardDescription>รันกลยุทธ์ทดสอบบนข้อมูล {klines.length.toLocaleString()} แท่งเทียนที่โหลดไว้</CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Field label="กลยุทธ์ Indicator">
                    <Select value={strategyId} onValueChange={(v) => {
                      if (v) {
                        const sid = v as StrategyId;
                        setStrategyId(sid);
                        const strat = STRATEGIES.find(s => s.id === sid);
                        setStrategyParams(strat ? { ...strat.params } : {});
                      }
                    }}>
                      <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STRATEGIES.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="ค่าธรรมเนียม (%)">
                    <Input type="number" step="0.01" value={feesPct} onChange={e => setFeesPct(e.target.value)} className="w-20" />
                  </Field>
                  <Button onClick={runBt} disabled={btRunning || klines.length < 50} className="h-9">
                    {btRunning ? "กำลังรัน..." : "รัน Backtest"}
                  </Button>
                </div>

                {/* Strategy description */}
                <p className="text-[10px] text-muted-foreground">
                  {STRATEGIES.find(s => s.id === strategyId)?.description}
                </p>

                {/* RSI explanation */}
                {strategyId === "rsi" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">RSI (Relative Strength Index) คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      RSI เป็นตัวชี้วัดโมเมนตัม (Momentum Oscillator) ที่วัดความเร็วและขนาดของการเปลี่ยนแปลงราคา
                      โดยคำนวณจากอัตราส่วนของ <span className="text-emerald-500/80">ค่าเฉลี่ยของราคาที่เพิ่มขึ้น (Average Gain)</span> กับ <span className="text-red-500/80">ค่าเฉลี่ยของราคาที่ลดลง (Average Loss)</span> ในช่วง Period ที่กำหนด
                      ค่า RSI อยู่ในช่วง 0-100
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                      <span className="text-emerald-500">RSI &lt; {strategyParams.buyThreshold ?? 30} = Oversold (ขายมากเกินไป) → สัญญาณซื้อ</span>
                      <span className="text-red-500">RSI &gt; {strategyParams.sellThreshold ?? 70} = Overbought (ซื้อมากเกินไป) → สัญญาณขาย</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      สูตร: RSI = 100 - 100 / (1 + AG/AL) โดย AG = ค่าเฉลี่ยกำไร, AL = ค่าเฉลี่ยขาดทุน ในช่วง Period แท่ง
                    </p>
                  </div>
                )}

                {/* SMC explanation */}
                {strategyId === "smc" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">Smart Money Concepts (SMC) คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      SMC เป็นแนวคิดการวิเคราะห์โครงสร้างตลาด (Market Structure) ตามทฤษฎี ICT/Smart Money
                      โดยตรวจจับจุดกลับตัวของราคา (Pivot Points) แล้ววิเคราะห์ว่าราคาทะลุจุดสำคัญอย่างไร
                    </p>

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">โครงสร้างตลาด (Market Structure):</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-emerald-500">BOS (Break of Structure) = ราคาทะลุ pivot ตามเทรนด์เดิม → ยืนยันเทรนด์</span>
                        <span className="text-amber-500">CHoCH (Change of Character) = ราคาทะลุ pivot สวนเทรนด์ → สัญญาณกลับตัว</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">องค์ประกอบอื่น:</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                        <span>Order Block (OB) = แท่งเทียนสุดท้ายก่อนราคาพุ่ง/ดิ่ง → โซนแนวรับ/ต้านที่แข็งแกร่ง</span>
                        <span>Fair Value Gap (FVG) = ช่องว่างราคาระหว่าง 3 แท่งเทียน → ราคามักย้อนกลับมาเติมช่องว่าง</span>
                        <span>Premium Zone = ราคาอยู่สูงกว่าจุดสมดุล → เหมาะขาย | Discount Zone = ราคาอยู่ต่ำกว่า → เหมาะซื้อ</span>
                      </div>
                    </div>

                    <Separator className="my-1.5" />

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">ความหมายของพารามิเตอร์:</p>
                      <div className="space-y-2">
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-blue-400">Swing Size (ค่าปัจจุบัน: {strategyParams.swingSize ?? 50})</p>
                          <p className="text-muted-foreground mt-0.5">
                            จำนวนแท่งเทียนที่ใช้หา Swing Point (จุดกลับตัวหลัก) — เป็นจำนวนแท่งซ้าย-ขวาที่ต้องต่ำ/สูงกว่าจุด pivot
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-emerald-500/80">ค่าน้อย (10-20) → เจอ swing points บ่อย → สัญญาณเยอะ → ไวต่อการเปลี่ยนแปลง แต่อาจเจอสัญญาณหลอก (false signals) มากขึ้น</p>
                            <p className="text-red-500/80">ค่ามาก (50-100) → เจอ swing points น้อย → สัญญาณน้อย → จับเทรนด์ใหญ่ได้ดี แต่ช้าในการเข้า/ออก</p>
                            <p className="text-muted-foreground/70">ค่าทั่วไป: 20-50 สำหรับ Day Trading, 50-100 สำหรับ Swing Trading</p>
                          </div>
                        </div>
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-purple-400">Internal Size (ค่าปัจจุบัน: {strategyParams.internalSize ?? 5})</p>
                          <p className="text-muted-foreground mt-0.5">
                            จำนวนแท่งเทียนที่ใช้หา Internal Structure (โครงสร้างย่อยภายในเทรนด์) — ใช้สร้างสัญญาณ BUY/SELL
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-emerald-500/80">ค่าน้อย (2-3) → จับการเคลื่อนไหวเล็กๆ → เทรดบ่อย → เหมาะ Scalping แต่ค่าธรรมเนียมสูง</p>
                            <p className="text-red-500/80">ค่ามาก (7-15) → กรอง noise ออก → เทรดน้อยลง → สัญญาณมีคุณภาพมากขึ้น แต่อาจพลาดจังหวะ</p>
                            <p className="text-muted-foreground/70">ค่าทั่วไป: 3-5 สำหรับ Intraday, 5-10 สำหรับ Swing</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <Separator className="my-1.5" />

                    <div className="space-y-1 text-[10px]">
                      <p className="font-medium text-foreground/80">สัญญาณ Backtest:</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-emerald-500">BUY → Bullish CHoCH (กลับตัวขึ้น) หรือ Bullish BOS ใน Discount/Equilibrium Zone</span>
                        <span className="text-red-500">SELL → Bearish CHoCH (กลับตัวลง) หรือ Bearish BOS ใน Premium/Equilibrium Zone</span>
                      </div>
                    </div>

                    <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[9px] text-amber-500/80">
                      <p className="font-medium">ผลกระทบเมื่อเปลี่ยนค่า:</p>
                      <p>Swing Size มีผลต่อ Premium/Discount Zone (โซนราคา) และ Swing Trend — ค่ามากจะทำให้โซนกว้างขึ้น เทรนด์เปลี่ยนช้าลง</p>
                      <p>Internal Size มีผลโดยตรงต่อจำนวนสัญญาณ BUY/SELL — ค่าน้อย = สัญญาณเยอะ, ค่ามาก = สัญญาณน้อยแต่แม่นยำกว่า</p>
                      <p>ทั้งสองค่ามีผลต่อ Order Blocks และ Fair Value Gaps ที่ตรวจพบ</p>
                    </div>
                  </div>
                )}

                {/* Strategy-specific parameter inputs */}
                {Object.keys(strategyParams).length > 0 && (
                  <div className="flex flex-wrap items-end gap-3">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground w-full">ปรับค่าพารามิเตอร์</p>
                    {Object.entries(strategyParams).map(([key, val]) => (
                      <Field key={key} label={PARAM_LABELS[key] ?? key}>
                        <div className="space-y-0.5">
                          <Input
                            type="number"
                            step={key === "period" ? 1 : 1}
                            min={1}
                            value={val}
                            onChange={e => setStrategyParams(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                            className="w-24"
                          />
                          {strategyId === "rsi" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "period" && "จำนวนแท่งเทียนที่ใช้คำนวณ (ค่าทั่วไป: 7, 14, 21)"}
                              {key === "buyThreshold" && "ค่า RSI ต่ำกว่านี้ = สัญญาณซื้อ"}
                              {key === "sellThreshold" && "ค่า RSI สูงกว่านี้ = สัญญาณขาย"}
                            </p>
                          )}
                          {strategyId === "smc" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "swingSize" && "แท่งเทียนหา pivot หลัก (10-100) — ค่าน้อย=ไว ค่ามาก=จับเทรนด์ใหญ่"}
                              {key === "internalSize" && "แท่งเทียนหาโครงสร้างย่อย (2-15) — ค่าน้อย=สัญญาณเยอะ ค่ามาก=กรอง noise"}
                            </p>
                          )}
                        </div>
                      </Field>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Backtest Results */}
        {btResult && <BacktestResults result={btResult} />}

        {/* Indicator Values */}
        {indicators && <IndicatorPanel indicators={indicators} klines={klines} />}

        {/* Kline Table */}
        <KlineTable klines={klines} loading={loading} signals={btResult?.signals} />
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
    { label: "ราคาปิดล่าสุด", value: fmtPrice(summary.lastClose), color: "" },
    { label: "เปลี่ยนแปลง", value: `${summary.pctChange >= 0 ? "+" : ""}${summary.pctChange.toFixed(2)}%`, color: pnlColor(summary.pctChange) },
    { label: "สูงสุด", value: fmtPrice(summary.highest), color: "text-emerald-500" },
    { label: "ต่ำสุด", value: fmtPrice(summary.lowest), color: "text-red-500" },
    { label: "ปริมาณรวม", value: fmtNum(summary.totalVol), color: "" },
    { label: "ปริมาณเฉลี่ย", value: fmtNum(summary.avgVol), color: "" },
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
    const sig = rsiVal < 30 ? "ขายมากเกินไป (ซื้อ)" : rsiVal > 70 ? "ซื้อมากเกินไป (ขาย)" : "ปกติ";
    rows.push({ name: "RSI(14)", value: rsiVal.toFixed(2), signal: sig, color: rsiVal < 30 ? "text-emerald-500" : rsiVal > 70 ? "text-red-500" : "text-muted-foreground" });
  }

  // MACD
  const m = indicators.macd.macd[last], s = indicators.macd.signal[last];
  if (m !== null && s !== null) {
    const sig = m > s ? "ขาขึ้น" : "ขาลง";
    rows.push({ name: "MACD", value: `${m.toFixed(2)} / ${s.toFixed(2)}`, signal: sig, color: m > s ? "text-emerald-500" : "text-red-500" });
  }

  // EMA 50/200
  const e50 = indicators.ema50[last], e200 = indicators.ema200[last];
  if (e50 !== null) rows.push({ name: "EMA(50)", value: fmtPrice(e50), signal: c > e50 ? "อยู่เหนือ" : "อยู่ใต้", color: c > e50 ? "text-emerald-500" : "text-red-500" });
  if (e200 !== null) rows.push({ name: "EMA(200)", value: fmtPrice(e200), signal: c > e200 ? "อยู่เหนือ" : "อยู่ใต้", color: c > e200 ? "text-emerald-500" : "text-red-500" });
  if (e50 !== null && e200 !== null) {
    rows.push({ name: "Golden Cross", value: e50 > e200 ? "ใช่" : "ไม่", signal: e50 > e200 ? "ขาขึ้น" : "ขาลง", color: e50 > e200 ? "text-emerald-500" : "text-red-500" });
  }

  // BB
  const bbU = indicators.bb.upper[last], bbL = indicators.bb.lower[last];
  if (bbU !== null && bbL !== null) {
    const sig = c >= bbU ? "ใกล้แถบบน (ขาย)" : c <= bbL ? "ใกล้แถบล่าง (ซื้อ)" : "อยู่ในแถบ";
    rows.push({ name: "BB(20)", value: `${fmtPrice(bbU)} / ${fmtPrice(bbL)}`, signal: sig, color: c >= bbU ? "text-red-500" : c <= bbL ? "text-emerald-500" : "text-muted-foreground" });
  }

  // ADX
  const adxVal = indicators.adx.adx[last], pdi = indicators.adx.plusDI[last], mdi = indicators.adx.minusDI[last];
  if (adxVal !== null && pdi !== null && mdi !== null) {
    const trend = adxVal > 25 ? (pdi > mdi ? "แนวโน้มขึ้นแรง" : "แนวโน้มลงแรง") : "ไม่มีแนวโน้มชัดเจน";
    rows.push({ name: "ADX(14)", value: `${adxVal.toFixed(1)} (+DI:${pdi.toFixed(1)} -DI:${mdi.toFixed(1)})`, signal: trend, color: adxVal > 25 && pdi > mdi ? "text-emerald-500" : adxVal > 25 ? "text-red-500" : "text-muted-foreground" });
  }

  // ATR
  const atrVal = indicators.atr[last];
  if (atrVal !== null) rows.push({ name: "ATR(14)", value: fmtPrice(atrVal), signal: `ความผันผวน ${((atrVal / c) * 100).toFixed(2)}%`, color: "text-muted-foreground" });

  // OBV
  const obvVal = indicators.obv[last];
  const obvPrev = last > 0 ? indicators.obv[last - 1] : obvVal;
  rows.push({ name: "OBV", value: fmtNum(obvVal), signal: obvVal > obvPrev ? "เพิ่มขึ้น" : "ลดลง", color: obvVal > obvPrev ? "text-emerald-500" : "text-red-500" });

  // MFI
  const mfiVal = indicators.mfi[last];
  if (mfiVal !== null) {
    const sig = mfiVal < 20 ? "ขายมากเกินไป (ซื้อ)" : mfiVal > 80 ? "ซื้อมากเกินไป (ขาย)" : "ปกติ";
    rows.push({ name: "MFI(14)", value: mfiVal.toFixed(2), signal: sig, color: mfiVal < 20 ? "text-emerald-500" : mfiVal > 80 ? "text-red-500" : "text-muted-foreground" });
  }

  // VWAP
  const vwapVal = indicators.vwap[last];
  rows.push({ name: "VWAP", value: fmtPrice(vwapVal), signal: c > vwapVal ? "อยู่เหนือ (ขาขึ้น)" : "อยู่ใต้ (ขาลง)", color: c > vwapVal ? "text-emerald-500" : "text-red-500" });

  // Ichimoku
  const ich = indicators.ichimoku;
  if (ich.tenkan[last] !== null && ich.kijun[last] !== null) {
    const cloudTop = Math.max(ich.senkouA[last] ?? 0, ich.senkouB[last] ?? 0);
    const sig = c > cloudTop ? "เหนือเมฆ (ขาขึ้น)" : "ใต้เมฆ (ขาลง)";
    rows.push({ name: "Ichimoku", value: `T:${fmtPrice(ich.tenkan[last]!)} K:${fmtPrice(ich.kijun[last]!)}`, signal: sig, color: c > cloudTop ? "text-emerald-500" : "text-red-500" });
  }

  // CDC ActionZone
  const cdc = indicators.cdcActionZone;
  const cdcZone = cdc.zone[last];
  const cdcTrend = cdc.trend[last];
  const cdcSignal = cdc.signal[last];
  if (cdcZone !== null) {
    const zoneLabels: Record<string, string> = {
      green: "เขียว (โซนซื้อ)",
      blue: "น้ำเงิน (เตรียมซื้อ 2)",
      lightblue: "ฟ้าอ่อน (เตรียมซื้อ 1)",
      red: "แดง (โซนขาย)",
      orange: "ส้ม (เตรียมขาย 2)",
      yellow: "เหลือง (เตรียมขาย 1)",
    };
    const zoneColors: Record<string, string> = {
      green: "text-emerald-500",
      blue: "text-blue-500",
      lightblue: "text-cyan-400",
      red: "text-red-500",
      orange: "text-orange-500",
      yellow: "text-yellow-500",
    };
    const zoneLabel = zoneLabels[cdcZone] ?? cdcZone;
    const zoneColor = zoneColors[cdcZone] ?? "text-muted-foreground";
    const trendLabel = cdcTrend ? `${cdcTrend.charAt(0).toUpperCase() + cdcTrend.slice(1)}` : "N/A";
    const sigLabel = cdcSignal ? cdcSignal : trendLabel;
    rows.push({
      name: "CDC ActionZone",
      value: `Fast:${cdc.fastMA[last] !== null ? fmtPrice(cdc.fastMA[last]!) : "-"} Slow:${cdc.slowMA[last] !== null ? fmtPrice(cdc.slowMA[last]!) : "-"}`,
      signal: `${zoneLabel} | ${sigLabel}`,
      color: zoneColor,
    });
  }

  // Smart Money Concepts (SMC)
  const smc = indicators.smc;
  const smcSwingTrend = smc.swingTrend[last];
  const smcInternalTrend = smc.internalTrend[last];
  const smcZone = smc.premiumDiscount[last];
  const lastSmcSignal = smc.signal[last];

  // Find most recent structure break
  const recentStructure = smc.internalStructures.length > 0
    ? smc.internalStructures[smc.internalStructures.length - 1]
    : null;

  // Count active (unmitigated) OBs
  const activeOBs = smc.internalOrderBlocks.filter(ob => !ob.mitigated).length;
  const activeFVGs = smc.fairValueGaps.filter(fvg => !fvg.filled).length;

  if (smcSwingTrend !== null) {
    rows.push({
      name: "SMC Swing Trend",
      value: smcSwingTrend === "bullish" ? "Bullish" : "Bearish",
      signal: smcSwingTrend === "bullish" ? "ขาขึ้น" : "ขาลง",
      color: smcSwingTrend === "bullish" ? "text-emerald-500" : "text-red-500",
    });
  }

  if (smcInternalTrend !== null) {
    rows.push({
      name: "SMC Internal Trend",
      value: smcInternalTrend === "bullish" ? "Bullish" : "Bearish",
      signal: recentStructure ? `${recentStructure.type} ${recentStructure.bias}` : "N/A",
      color: smcInternalTrend === "bullish" ? "text-emerald-500" : "text-red-500",
    });
  }

  if (smcZone !== null) {
    const zoneMap: Record<string, { label: string; color: string }> = {
      premium: { label: "Premium Zone (แพง)", color: "text-red-500" },
      discount: { label: "Discount Zone (ถูก)", color: "text-emerald-500" },
      equilibrium: { label: "Equilibrium (สมดุล)", color: "text-yellow-500" },
    };
    const z = zoneMap[smcZone] ?? { label: smcZone, color: "text-muted-foreground" };
    rows.push({
      name: "SMC Zone",
      value: z.label,
      signal: lastSmcSignal ?? "HOLD",
      color: z.color,
    });
  }

  rows.push({
    name: "SMC Order Blocks",
    value: `Active: ${activeOBs}`,
    signal: `OB: ${activeOBs} | FVG: ${activeFVGs}`,
    color: "text-muted-foreground",
  });

  return (
    <Card size="sm">
      <CardHeader className="border-b"><CardTitle>ค่าตัวชี้วัด</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ตัวชี้วัด</TableHead>
              <TableHead>ค่า</TableHead>
              <TableHead>สัญญาณ</TableHead>
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
function BacktestResults({ result }: { result: BacktestResult }) {
  const [tradePage, setTradePage] = useState(0);
  const tradePageSize = 20;
  const totalTradePages = Math.ceil(result.trades.length / tradePageSize);
  const displayedTrades = result.trades.slice(tradePage * tradePageSize, (tradePage + 1) * tradePageSize);

  const strategyBetter = result.totalPnlPct > result.buyAndHoldPct;

  return (
    <div className="space-y-4">
      {/* P&L Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="กำไร/ขาดทุนรวม" value={`${result.totalPnlPct >= 0 ? "+" : ""}${result.totalPnlPct.toFixed(2)}%`} color={pnlColor(result.totalPnlPct)} bg={pnlBg(result.totalPnlPct)} />
        <StatCard label="ซื้อแล้วถือ" value={`${result.buyAndHoldPct >= 0 ? "+" : ""}${result.buyAndHoldPct.toFixed(2)}%`} color={pnlColor(result.buyAndHoldPct)} bg={pnlBg(result.buyAndHoldPct)} />
        <StatCard label="อัตราชนะ" value={`${result.winRate.toFixed(1)}%`} color={result.winRate >= 50 ? "text-emerald-500" : "text-red-500"} />
        <StatCard label="จำนวนเทรด" value={`${result.totalTrades} (ชนะ:${result.wins} แพ้:${result.losses})`} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="กำไรเฉลี่ย" value={`+${result.avgWinPct.toFixed(2)}%`} color="text-emerald-500" size="sm" />
        <StatCard label="ขาดทุนเฉลี่ย" value={`${result.avgLossPct.toFixed(2)}%`} color="text-red-500" size="sm" />
        <StatCard label="เทรดที่ดีที่สุด" value={`+${result.bestTradePct.toFixed(2)}%`} color="text-emerald-500" size="sm" />
        <StatCard label="เทรดที่แย่ที่สุด" value={`${result.worstTradePct.toFixed(2)}%`} color="text-red-500" size="sm" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
        <StatCard label="Profit Factor" value={result.profitFactor === Infinity ? "INF" : result.profitFactor.toFixed(2)} color={result.profitFactor > 1 ? "text-emerald-500" : "text-red-500"} />
        <StatCard label="Drawdown สูงสุด" value={`-${result.maxDrawdownPct.toFixed(2)}%`} color="text-red-500" size="sm" />
        <StatCard label="Sharpe" value={result.sharpeRatio.toFixed(3)} color={result.sharpeRatio > 0 ? "text-emerald-500" : "text-red-500"} size="sm" />
      </div>

      {/* Strategy vs Buy&Hold comparison */}
      <Card size="sm" className={strategyBetter ? "ring-emerald-500/30" : "ring-red-500/30"}>
        <CardContent className="py-3">
          <div className="flex items-center gap-3 text-xs">
            <span className={`text-sm font-semibold ${strategyBetter ? "text-emerald-500" : "text-red-500"}`}>
              {strategyBetter ? "กลยุทธ์ชนะ ซื้อแล้วถือ" : "ซื้อแล้วถือ ชนะกลยุทธ์"}
            </span>
            <span className="text-muted-foreground">
              กลยุทธ์: {result.totalPnlPct >= 0 ? "+" : ""}{result.totalPnlPct.toFixed(2)}% vs ซื้อถือ: {result.buyAndHoldPct >= 0 ? "+" : ""}{result.buyAndHoldPct.toFixed(2)}%
              (ต่าง {strategyBetter ? "+" : ""}{(result.totalPnlPct - result.buyAndHoldPct).toFixed(2)}%)
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Equity Curve */}
      <Card size="sm">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <CardTitle>กราฟเงินทุน (กำไร/ขาดทุนสะสม %)</CardTitle>
            <span className={`text-lg font-bold tabular-nums ${pnlColor(result.totalPnlPct)}`}>
              กำไรรวม: {result.totalPnlPct >= 0 ? "+" : ""}{result.totalPnlPct.toFixed(2)}%
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          <EquityChart curve={result.equityCurve} trades={result.trades} />
          {/* Trade P&L legend */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {result.trades.map((t, i) => (
              <span
                key={i}
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium tabular-nums ${t.pnlPct >= 0
                    ? "bg-emerald-500/10 text-emerald-500"
                    : "bg-red-500/10 text-red-500"
                  }`}
              >
                #{i + 1} {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Trade History */}
      <Card size="sm">
        <CardHeader className="border-b">
          <CardTitle>ประวัติการเทรด</CardTitle>
          <CardDescription>ทั้งหมด {result.trades.length} รายการ</CardDescription>
          {totalTradePages > 1 && (
            <CardAction>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="xs" onClick={() => setTradePage(p => Math.max(0, p - 1))} disabled={tradePage === 0}>ก่อนหน้า</Button>
                <span className="text-[10px] tabular-nums text-muted-foreground">{tradePage + 1}/{totalTradePages}</span>
                <Button variant="outline" size="xs" onClick={() => setTradePage(p => Math.min(totalTradePages - 1, p + 1))} disabled={tradePage >= totalTradePages - 1}>ถัดไป</Button>
              </div>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>เวลาเข้า</TableHead>
                <TableHead className="text-right">ราคาเข้า</TableHead>
                <TableHead>เวลาออก</TableHead>
                <TableHead className="text-right">ราคาออก</TableHead>
                <TableHead className="text-right">กำไร/ขาดทุน %</TableHead>
                <TableHead className="text-right">แท่ง</TableHead>
                <TableHead>เหตุผล</TableHead>
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
          ยังไม่มีข้อมูล ตั้งค่าพารามิเตอร์แล้วกดดึงข้อมูล
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader className="border-b">
        <CardTitle>ข้อมูลแท่งเทียน</CardTitle>
        <CardDescription>{klines.length.toLocaleString()} แท่ง — {fmtFullDate(klines[0].openTime)} ถึง {fmtFullDate(klines[klines.length - 1].closeTime)}</CardDescription>
        <CardAction>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="xs" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>ก่อนหน้า</Button>
            <span className="text-[10px] tabular-nums text-muted-foreground">{page + 1}/{totalPages}</span>
            <Button variant="outline" size="xs" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>ถัดไป</Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>เวลาเปิด</TableHead>
              <TableHead className="w-6"></TableHead>
              <TableHead className="text-right">เปิด</TableHead>
              <TableHead className="text-right">สูงสุด</TableHead>
              <TableHead className="text-right">ต่ำสุด</TableHead>
              <TableHead className="text-right">ปิด</TableHead>
              <TableHead className="text-right">เปลี่ยนแปลง</TableHead>
              <TableHead className="text-right">ปริมาณ</TableHead>
              {signals && <TableHead className="text-center">สัญญาณ</TableHead>}
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
            <Button variant="outline" size="xs" onClick={() => setPage(0)} disabled={page === 0}>แรก</Button>
            <Button variant="outline" size="xs" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>ก่อนหน้า</Button>
            <Button variant="outline" size="xs" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>ถัดไป</Button>
            <Button variant="outline" size="xs" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>สุดท้าย</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
