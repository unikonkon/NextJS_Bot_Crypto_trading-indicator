"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  ArrowUpIcon,
  ArrowDownIcon,
  PlayIcon,
  StopIcon,
  WarningIcon,
  ArrowsClockwiseIcon,
  LightningIcon,
  ClockIcon,
  WifiHighIcon,
  WifiSlashIcon,
  ArrowLeftIcon,
  TrashIcon,
  WalletIcon,
  SpinnerIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import type { KlineData, BinanceKlineRaw, Interval } from "@/lib/types/kline";
import { parseKline } from "@/lib/types/kline";
import { computeAll, type AllIndicators } from "@/lib/indicators";
import { STRATEGIES, type StrategyId } from "@/lib/backtest";
import KlineGraph from "@/app/klines/ui/graph";

// ─── Constants ────────────────────────────────────────────────
const POPULAR_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
  "MATICUSDT", "LTCUSDT", "ATOMUSDT", "NEARUSDT", "APTUSDT",
  "ARBUSDT", "OPUSDT", "SUIUSDT", "INJUSDT", "FETUSDT",
];

const INTERVAL_GROUPS: Record<string, Interval[]> = {
  "นาที": ["1m", "3m", "5m", "15m", "30m"],
  "ชั่วโมง": ["1h", "2h", "4h"],
  "วัน+": ["1d"],
};

// Default polling intervals in seconds based on kline interval
const DEFAULT_POLL_SEC: Record<string, number> = {
  "1m": 10, "3m": 15, "5m": 20, "15m": 30, "30m": 45,
  "1h": 60, "2h": 60, "4h": 120, "1d": 300,
};

const POLL_OPTIONS = [
  5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300,
  600, 900, 1800, 3600, 7200, 14400, 86400,
];

// ─── Types ────────────────────────────────────────────────────
interface LiveTrade {
  id: string;
  time: number;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: string;
  usdtAmount: string;
  strategy: string;
  status: "SUCCESS" | "TEST_OK" | "FAILED";
  error?: string;
  orderId?: number;
}

// ─── Component ────────────────────────────────────────────────
export default function LiveTradingPage() {
  const searchParams = useSearchParams();

  // Credentials จาก searchParams (ไม่เก็บลง localStorage)
  // "__env__" = ใช้ key จาก env variables บนเซิร์ฟเวอร์
  const [apiKey] = useState(() => searchParams?.get("apiKey") ?? "");
  const [secretKey] = useState(() => searchParams?.get("secretKey") ?? "");
  const isEnvKey = apiKey === "__env__" && secretKey === "__env__";
  const hasCredentials = isEnvKey || !!(apiKey && secretKey);

  // Control state
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval_] = useState<Interval>("15m");
  const [strategyId, setStrategyId] = useState<StrategyId>("supertrend");
  const [usdtAmount, setUsdtAmount] = useState("");
  const [pollSec, setPollSec] = useState(() => DEFAULT_POLL_SEC["15m"]);
  const [isTestMode, setIsTestMode] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  // USDT balance state
  const [usdtBalance, setUsdtBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const hasUsdt = usdtBalance !== null && usdtBalance > 0;

  // Data state
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [indicators, setIndicators] = useState<AllIndicators | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Trade history (in-memory only — lost on refresh)
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [lastSignal, setLastSignal] = useState<"BUY" | "SELL" | "HOLD" | null>(null);

  // Position tracking
  const [inPosition, setInPosition] = useState(false);
  const [entryPrice, setEntryPrice] = useState<number | null>(null);

  // Network status
  const [isOnline, setIsOnline] = useState(true);

  // Refs
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastProcessedTime = useRef<number>(0);

  // ─── Network listener ───────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      stopTrading();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Fetch USDT balance ─────────────────────────────────────
  const fetchUsdtBalance = useCallback(async () => {
    if (!hasCredentials) return;
    setLoadingBalance(true);
    try {
      const body: Record<string, string> = {};
      if (!isEnvKey) {
        body.apiKey = apiKey;
        body.secretKey = secretKey;
      }
      const res = await fetch("/api/binance/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.balances)) {
        const usdt = data.balances.find(
          (b: { asset: string; free: string }) => b.asset === "USDT"
        );
        setUsdtBalance(usdt ? parseFloat(usdt.free) : 0);
      } else {
        setUsdtBalance(null);
      }
    } catch {
      setUsdtBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  }, [hasCredentials, isEnvKey, apiKey, secretKey]);

  // Fetch balance on mount
  useEffect(() => {
    if (hasCredentials) fetchUsdtBalance();
  }, [hasCredentials, fetchUsdtBalance]);

  // ─── Warn before unload ────────────────────────────────────
  useEffect(() => {
    if (!isRunning) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isRunning]);

  // ─── Fetch klines ──────────────────────────────────────────
  const fetchKlines = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/klines?symbol=${symbol}&interval=${interval}&limit=500`
      );
      if (!res.ok) throw new Error(`Klines API error: ${res.status}`);
      const raw: BinanceKlineRaw[] = await res.json();
      const parsed = raw.map(parseKline);
      setKlines(parsed);
      setError("");
      return parsed;
    } catch (err) {
      setError(err instanceof Error ? err.message : "ดึงข้อมูลไม่สำเร็จ");
      return null;
    }
  }, [symbol, interval]);

  // ─── Get signal from strategy ──────────────────────────────
  const getLatestSignal = useCallback(
    (klinesData: KlineData[]): "BUY" | "SELL" | "HOLD" => {
      if (klinesData.length < 50) return "HOLD";

      const ind = computeAll(klinesData);
      setIndicators(ind);

      // ดึง signal จาก indicator ที่เลือก
      const strategyMap: Record<StrategyId, ("BUY" | "SELL" | null)[]> = {
        rsi: ind.rsi.map(v => {
          if (v === null) return null;
          if (v < 30) return "BUY";
          if (v > 70) return "SELL";
          return null;
        }),
        cdc_actionzone: ind.cdcActionZone.signal,
        smc: ind.smc.signal,
        cm_macd: ind.cmMacd.signal,
        supertrend: ind.supertrend.signal,
        squeeze_momentum: ind.squeezeMomentum.signal,
        msb_ob: ind.msbOb.signal,
        support_resistance: ind.supportResistance.signal,
        trendlines: ind.trendlines.signal,
        ut_bot: ind.utBot.signal,
      };

      const signals = strategyMap[strategyId];
      // ตรวจสัญญาณแท่งล่าสุด (index -2 เพราะแท่งสุดท้ายยังไม่ปิด)
      const checkIdx = klinesData.length - 2;
      if (checkIdx < 0) return "HOLD";

      const sig = signals[checkIdx];
      return sig ?? "HOLD";
    },
    [strategyId]
  );

  // ─── Execute order ─────────────────────────────────────────
  const executeOrder = useCallback(
    async (side: "BUY" | "SELL", price: number) => {
      if (!usdtAmount || !hasCredentials) return;

      // คำนวณจำนวนเหรียญโดยประมาณ (USDT / ราคา) สำหรับแสดงใน history
      const estimatedQty = price > 0 ? (parseFloat(usdtAmount) / price).toFixed(8) : "0";

      const trade: LiveTrade = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time: Date.now(),
        symbol,
        side,
        price,
        quantity: estimatedQty,
        usdtAmount,
        strategy: STRATEGIES.find(s => s.id === strategyId)?.name || strategyId,
        status: "FAILED",
      };

      try {
        const orderBody: Record<string, string | boolean> = {
          symbol,
          side,
          type: "MARKET",
          quoteOrderQty: usdtAmount, // ส่งเป็นจำนวน USDT
          testOrder: isTestMode,
        };
        // ถ้าไม่ใช่ env key ให้ส่ง credentials ไปด้วย
        if (!isEnvKey) {
          orderBody.apiKey = apiKey;
          orderBody.secretKey = secretKey;
        }
        const res = await fetch("/api/binance/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orderBody),
        });
        const data = await res.json();

        if (!res.ok) {
          trade.status = "FAILED";
          trade.error = data.details?.msg || data.error || "Order failed";
        } else {
          trade.status = isTestMode ? "TEST_OK" : "SUCCESS";
          trade.orderId = data.orderId;
          // ใช้ executedQty จริงจาก Binance ถ้ามี
          if (data.executedQty) trade.quantity = data.executedQty;

          // Track position
          if (side === "BUY") {
            setInPosition(true);
            setEntryPrice(price);
          } else {
            setInPosition(false);
            setEntryPrice(null);
          }

          // อัพเดท balance หลังส่ง order สำเร็จ
          fetchUsdtBalance();
        }
      } catch (err) {
        trade.status = "FAILED";
        trade.error = err instanceof Error ? err.message : "Network error";
      }

      setTrades(prev => [trade, ...prev]);
    },
    [apiKey, secretKey, isEnvKey, symbol, usdtAmount, strategyId, isTestMode, hasCredentials, fetchUsdtBalance]
  );

  // ─── Live polling cycle ────────────────────────────────────
  const runCycle = useCallback(async () => {
    const data = await fetchKlines();
    if (!data || data.length === 0) return;

    const latestTime = data[data.length - 2]?.openTime || 0;
    // ข้ามถ้าแท่งเดิม (ป้องกันส่ง order ซ้ำ)
    if (latestTime <= lastProcessedTime.current) return;
    lastProcessedTime.current = latestTime;

    const signal = getLatestSignal(data);
    setLastSignal(signal);

    const currentPrice = +data[data.length - 1].close;

    // ส่งคำสั่งซื้อขายตามสัญญาณ
    if (signal === "BUY" && !inPosition) {
      await executeOrder("BUY", currentPrice);
    } else if (signal === "SELL" && inPosition) {
      await executeOrder("SELL", currentPrice);
    }
  }, [fetchKlines, getLatestSignal, executeOrder, inPosition]);

  // ─── Start / Stop ──────────────────────────────────────────
  const startTrading = useCallback(async () => {
    if (!hasCredentials || !usdtAmount) return;
    setIsRunning(true);
    setError("");
    lastProcessedTime.current = 0;

    // รอบแรก
    setLoading(true);
    await runCycle();
    setLoading(false);

    // ตั้ง interval polling
    intervalRef.current = setInterval(runCycle, pollSec * 1000);
  }, [hasCredentials, usdtAmount, pollSec, runCycle]);

  const stopTrading = useCallback(() => {
    setIsRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // ─── Manual fetch (preview only) ──────────────────────────
  const previewChart = async () => {
    setLoading(true);
    const data = await fetchKlines();
    if (data) {
      const ind = computeAll(data);
      setIndicators(ind);
    }
    setLoading(false);
  };

  // ─── Stats ─────────────────────────────────────────────────
  const stats = useMemo(() => {
    const buys = trades.filter(t => t.side === "BUY" && t.status !== "FAILED");
    const sells = trades.filter(t => t.side === "SELL" && t.status !== "FAILED");
    const failed = trades.filter(t => t.status === "FAILED");
    let unrealizedPnl: number | null = null;
    if (inPosition && entryPrice && klines.length > 0) {
      const currentPrice = +klines[klines.length - 1].close;
      unrealizedPnl = ((currentPrice - entryPrice) / entryPrice) * 100;
    }
    return { buys: buys.length, sells: sells.length, failed: failed.length, unrealizedPnl };
  }, [trades, inPosition, entryPrice, klines]);

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LightningIcon className="size-5 text-primary" weight="duotone" />
            <h1 className="text-lg font-semibold">Live Trading</h1>
            {isRunning && (
              <Badge variant="default" className="gap-1 animate-pulse bg-green-600">
                <span className="size-1.5 rounded-full bg-white" />
                กำลังทำงาน
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Badge variant="outline" className="gap-1 text-green-600">
                <WifiHighIcon weight="bold" className="size-3" />
                Online
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <WifiSlashIcon weight="bold" className="size-3" />
                Offline
              </Badge>
            )}
            <Button variant="outline" size="sm">
              <Link href="/trading/Binance" className="flex items-center gap-1">
                <ArrowLeftIcon weight="bold" className="size-3.5" />
                Binance Trading
              </Link>
            </Button>
          </div>
        </div>

        {/* คำอธิบาย + คำเตือน */}
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start gap-2">
              <LightningIcon weight="duotone" className="size-5 text-blue-500 mt-0.5 shrink-0" />
              <div className="text-sm space-y-1">
                <p className="font-semibold text-blue-500">
                  Live Trading คืออะไร?
                </p>
                <p className="text-muted-foreground">
                  &quot;Live Trading&quot; คือการ<strong>ส่งคำสั่งซื้อและขายจริง</strong>ไปยัง Binance โดยอัตโนมัติ
                  ระบบจะดึงข้อมูลราคาเหรียญตามช่วงเวลาที่เลือก วิเคราะห์สัญญาณจาก Indicator ที่เลือก
                  และเมื่อได้สัญญาณ BUY หรือ SELL จะส่งคำสั่งซื้อขายไปยัง Binance ให้โดยอัตโนมัติ
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start gap-2">
              <WarningIcon weight="duotone" className="size-5 text-yellow-500 mt-0.5 shrink-0" />
              <div className="text-sm space-y-1">
                <p className="font-semibold text-yellow-500">
                  คำเตือนสำคัญ
                </p>
                <ul className="text-muted-foreground list-disc list-inside space-y-0.5">
                  <li>
                    API Key และ Secret Key <strong>ไม่ได้ถูกบันทึก</strong>ไว้ในเครื่อง
                    — ส่งผ่าน URL เท่านั้น
                  </li>
                  <li>
                    หาก<strong>รีเฟรชหน้าจอ (Refresh)</strong> API Key/Secret Key จะหายไป
                    ต้องกลับไปหน้า Binance Trading เพื่อเชื่อมต่อใหม่
                  </li>
                  <li>
                    หาก<strong>เน็ตหลุด (Offline)</strong> ระบบจะ<strong>หยุดการทำงานทันที</strong>
                    และไม่ส่งคำสั่งซื้อขายจนกว่าจะกลับมาออนไลน์และกด Start ใหม่
                  </li>
                  <li>
                    ประวัติการเทรดจะ<strong>หายไป</strong>เมื่อรีเฟรชหน้าจอ (เก็บใน Memory เท่านั้น)
                  </li>
                  <li>
                    แนะนำให้เริ่มด้วย <strong>Test Mode</strong> ก่อนเสมอ เพื่อทดสอบระบบโดยไม่เสียเงินจริง
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ไม่มี Credentials */}
        {!hasCredentials && (
          <Card className="border-red-500/30">
            <CardContent className="p-6 text-center space-y-3">
              <WarningIcon weight="duotone" className="size-10 text-red-500 mx-auto" />
              <p className="font-semibold text-red-500">ไม่พบ API Key</p>
              <p className="text-sm text-muted-foreground">
                กรุณากลับไปหน้า Binance Trading เพื่อเชื่อมต่อ API Key ก่อน
                แล้วกดปุ่ม &quot;Live Trading&quot; เพื่อเข้าหน้านี้พร้อม Key
              </p>
              <Button>
                <Link href="/trading/Binance">ไปหน้า Binance Trading</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Control Panel */}
        {hasCredentials && (
          <Card>
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-sm">ตั้งค่า Live Trading</CardTitle>
              <CardDescription>เลือกเหรียญ, ช่วงเวลา, Strategy และจำนวนที่ต้องการเทรด</CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {/* Row 1: Symbol + Interval + Polling + Strategy */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                {/* Symbol */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">เหรียญ</label>
                  <Select value={symbol} onValueChange={v => { if (v) setSymbol(v); if (isRunning) stopTrading(); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {POPULAR_SYMBOLS.map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Interval */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">ช่วงเวลา</label>
                  <Select value={interval} onValueChange={v => { if (v) { setInterval_(v as Interval); setPollSec(DEFAULT_POLL_SEC[v] || 30); } if (isRunning) stopTrading(); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(INTERVAL_GROUPS).map(([group, intervals]) => (
                        <div key={group}>
                          <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground">{group}</div>
                          {intervals.map(iv => (
                            <SelectItem key={iv} value={iv}>{iv}</SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Polling Interval */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Polling ดึงข้อมูลราคาอัพเดท (วินาที)
                  </label>
                  <Select
                    value={String(pollSec)}
                    onValueChange={v => { if (v) { setPollSec(Number(v)); if (isRunning) stopTrading(); } }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {POLL_OPTIONS.map(sec => {
                        let label: string;
                        if (sec < 60) label = `${sec} วินาที`;
                        else if (sec < 3600) label = `${sec / 60} นาที`;
                        else if (sec < 86400) label = `${sec / 3600} ชั่วโมง`;
                        else label = `${sec / 86400} วัน`;
                        return (
                          <SelectItem key={sec} value={String(sec)}>
                            {label}
                            {sec === DEFAULT_POLL_SEC[interval] ? " (แนะนำ)" : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Strategy */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Strategy</label>
                  <Select value={strategyId} onValueChange={v => { if (v) setStrategyId(v as StrategyId); if (isRunning) stopTrading(); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="w-[270px]">
                      {STRATEGIES.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* USDT Balance */}
              <div className="flex items-center gap-3 rounded-md border p-3">
                <WalletIcon weight="duotone" className="size-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground">ยอด USDT ที่ใช้ได้</p>
                  {loadingBalance ? (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <SpinnerIcon weight="bold" className="size-3.5 animate-spin" />
                      กำลังโหลด...
                    </div>
                  ) : usdtBalance !== null ? (
                    <p className={`text-sm font-bold font-mono ${hasUsdt ? "text-green-600" : "text-red-500"}`}>
                      {usdtBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                    </p>
                  ) : (
                    <p className="text-sm text-red-500">ไม่สามารถดึงยอดได้</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={fetchUsdtBalance}
                  disabled={loadingBalance}
                >
                  <ArrowsClockwiseIcon weight="bold" className={`size-3.5 ${loadingBalance ? "animate-spin" : ""}`} />
                </Button>
              </div>

              {/* ไม่มี USDT */}
              {usdtBalance !== null && !hasUsdt && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 flex items-start gap-2">
                  <WarningIcon weight="fill" className="size-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-500 font-medium">
                    ไม่มียอด USDT ในบัญชี — ไม่สามารถซื้อขายได้ กรุณาฝาก USDT เข้าบัญชี Binance ก่อน
                  </p>
                </div>
              )}

              {/* Row 2: USDT Amount + Mode + Actions */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                {/* USDT Amount */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">จำนวน (USDT)</label>
                    {hasUsdt && (
                      <button
                        type="button"
                        className="text-[10px] text-primary hover:underline"
                        onClick={() => setUsdtAmount(usdtBalance!.toFixed(2))}
                        disabled={isRunning}
                      >
                        ใช้ทั้งหมด
                      </button>
                    )}
                  </div>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="เช่น 10, 50, 100"
                    value={usdtAmount}
                    onChange={e => setUsdtAmount(e.target.value)}
                    disabled={isRunning || !hasUsdt}
                  />
                  {usdtAmount && parseFloat(usdtAmount) > 0 && usdtBalance !== null && parseFloat(usdtAmount) > usdtBalance && (
                    <p className="text-[10px] text-red-500">จำนวนเกินยอด USDT ที่มี</p>
                  )}
                </div>

                {/* Test Mode Toggle */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">โหมด</label>
                  <Select
                    value={isTestMode ? "test" : "real"}
                    onValueChange={v => { if (v) setIsTestMode(v === "test"); if (isRunning) stopTrading(); }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="w-[230px]">
                      <SelectItem value="test">
                        Test Mode (ไม่ส่ง Order จริง)
                      </SelectItem>
                      <SelectItem value="real">
                        Real Mode (ส่ง Order จริง!)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    {isTestMode
                      ? "ส่งสัญญาณอย่างเดียว — Binance ตรวจสอบคำสั่งแต่ไม่ส่ง Order จริง ไม่มีการซื้อขายเกิดขึ้น"
                      : "ส่งคำสั่งซื้อขายจริงไปยัง Binance — มีการใช้เงินจริง!"}
                  </p>
                </div>

                {/* Preview */}
                <Button
                  variant="outline"
                  onClick={previewChart}
                  disabled={loading || isRunning}
                >
                  <ArrowsClockwiseIcon weight="bold" className={`size-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
                  ดูกราฟ
                </Button>

                {/* Start / Stop */}
                {!isRunning ? (
                  <Button
                    onClick={startTrading}
                    disabled={!usdtAmount || !hasUsdt || !isOnline || loading || (usdtBalance !== null && parseFloat(usdtAmount) > usdtBalance)}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <PlayIcon weight="fill" className="size-3.5 mr-1" />
                    Start Trading
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    onClick={stopTrading}
                  >
                    <StopIcon weight="fill" className="size-3.5 mr-1" />
                    Stop Trading
                  </Button>
                )}
              </div>

              {/* Real mode warning */}
              {!isTestMode && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 flex items-start gap-2">
                  <WarningIcon weight="fill" className="size-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-500 font-medium">
                    Real Mode — ระบบจะส่งคำสั่งซื้อขายจริงไปยัง Binance! กรุณาตรวจสอบจำนวนและ Strategy ให้ถูกต้องก่อนกด Start
                  </p>
                </div>
              )}

              {/* Strategy description */}
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2.5">
                <span className="font-medium">
                  {STRATEGIES.find(s => s.id === strategyId)?.name}:
                </span>{" "}
                {STRATEGIES.find(s => s.id === strategyId)?.descriptionTh}
              </div>

              {error && (
                <div className="text-xs text-red-500 bg-red-500/5 rounded-md p-2">
                  {error}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Status Bar */}
        {isRunning && (
          <div className="flex items-center gap-4 text-xs bg-muted/50 rounded-md p-3">
            <div className="flex items-center gap-1.5">
              <ClockIcon weight="bold" className="size-3.5" />
              <span>Polling ทุก {pollSec < 60 ? `${pollSec}s` : pollSec < 3600 ? `${pollSec / 60}m` : pollSec < 86400 ? `${pollSec / 3600}h` : `${pollSec / 86400}d`}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>สัญญาณล่าสุด:</span>
              {lastSignal === "BUY" && (
                <Badge className="bg-green-600 text-[10px] px-1.5 py-0">
                  <ArrowUpIcon weight="bold" className="size-2.5 mr-0.5" /> BUY
                </Badge>
              )}
              {lastSignal === "SELL" && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                  <ArrowDownIcon weight="bold" className="size-2.5 mr-0.5" /> SELL
                </Badge>
              )}
              {lastSignal === "HOLD" && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">HOLD</Badge>
              )}
              {lastSignal === null && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">รอข้อมูล...</Badge>
              )}
            </div>
            {inPosition && entryPrice && (
              <div className="flex items-center gap-1.5">
                <span>เข้า Position ที่:</span>
                <span className="font-mono font-medium">{entryPrice.toLocaleString()}</span>
                {stats.unrealizedPnl !== null && (
                  <Badge
                    variant={stats.unrealizedPnl >= 0 ? "default" : "destructive"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {stats.unrealizedPnl >= 0 ? "+" : ""}{stats.unrealizedPnl.toFixed(2)}%
                  </Badge>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chart */}
        {klines.length > 0 && (
          <Card>
            <CardContent className="p-2">
              <KlineGraph
                klines={klines}
                indicators={indicators}
                btResult={null}
                strategyId={strategyId}
              />
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        {trades.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground">Orders ทั้งหมด</p>
                <p className="text-lg font-bold">{trades.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground">BUY สำเร็จ</p>
                <p className="text-lg font-bold text-green-600">{stats.buys}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground">SELL สำเร็จ</p>
                <p className="text-lg font-bold text-red-500">{stats.sells}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground">ล้มเหลว</p>
                <p className="text-lg font-bold text-yellow-500">{stats.failed}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Trade History */}
        {hasCredentials && (
          <Card>
            <CardHeader className="border-b pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">ประวัติคำสั่งซื้อขาย</CardTitle>
                {trades.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground"
                    onClick={() => setTrades([])}
                  >
                    <TrashIcon weight="bold" className="size-3 mr-1" />
                    ล้างประวัติ
                  </Button>
                )}
              </div>
              <CardDescription>
                ประวัติจะหายไปเมื่อรีเฟรชหน้าจอ (เก็บใน Memory เท่านั้น)
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {trades.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  ยังไม่มีประวัติ — กด Start Trading เพื่อเริ่ม
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">เวลา</TableHead>
                        <TableHead className="text-xs">เหรียญ</TableHead>
                        <TableHead className="text-xs">Side</TableHead>
                        <TableHead className="text-xs">ราคา</TableHead>
                        <TableHead className="text-xs">USDT</TableHead>
                        <TableHead className="text-xs">จำนวนเหรียญ</TableHead>
                        <TableHead className="text-xs">Strategy</TableHead>
                        <TableHead className="text-xs">สถานะ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trades.map(trade => (
                        <TableRow key={trade.id}>
                          <TableCell className="text-xs font-mono">
                            {new Date(trade.time).toLocaleString("th-TH", {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </TableCell>
                          <TableCell className="text-xs font-medium">{trade.symbol}</TableCell>
                          <TableCell className="text-xs">
                            <Badge
                              variant={trade.side === "BUY" ? "default" : "destructive"}
                              className="text-[10px] px-1.5 py-0"
                            >
                              {trade.side === "BUY" ? (
                                <ArrowUpIcon weight="bold" className="size-2.5 mr-0.5" />
                              ) : (
                                <ArrowDownIcon weight="bold" className="size-2.5 mr-0.5" />
                              )}
                              {trade.side}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {trade.price.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs font-mono">{trade.usdtAmount} USDT</TableCell>
                          <TableCell className="text-xs font-mono">{trade.quantity}</TableCell>
                          <TableCell className="text-xs">{trade.strategy}</TableCell>
                          <TableCell className="text-xs">
                            {trade.status === "SUCCESS" && (
                              <Badge className="bg-green-600 text-[10px] px-1.5 py-0">สำเร็จ</Badge>
                            )}
                            {trade.status === "TEST_OK" && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Test OK</Badge>
                            )}
                            {trade.status === "FAILED" && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0" title={trade.error}>
                                ล้มเหลว
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
