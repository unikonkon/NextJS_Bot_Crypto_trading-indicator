"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  WalletIcon,
  LinkSimpleIcon,
  LinkBreakIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  EyeIcon,
  EyeSlashIcon,
  SpinnerIcon,
  XCircleIcon,
  CheckCircleIcon,
  WarningIcon,
  ArrowsClockwiseIcon,
  TrashIcon,
  TestTubeIcon,
  GlobeIcon,
  CopyIcon,
  CaretDownIcon,
  CaretUpIcon,
  KeyIcon,
  ShieldCheckIcon,
  LockIcon,
  LightningIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import Image from "next/image";

// ─── Types ────────────────────────────────────────────────────
interface Balance {
  asset: string;
  free: string;
  locked: string;
}

interface OpenOrder {
  symbol: string;
  orderId: number;
  side: string;
  type: string;
  price: string;
  origQty: string;
  status: string;
  time: number;
}

interface OrderResult {
  symbol?: string;
  orderId?: number;
  status?: string;
  side?: string;
  type?: string;
  origQty?: string;
  executedQty?: string;
  cummulativeQuoteQty?: string;
  error?: string;
  details?: { msg: string; code: number };
}

type ConnectionSource = "env" | "manual" | null;

// ─── Component ────────────────────────────────────────────────
export default function BinanceTradingPage() {
  // Setup guide state
  const [showGuide, setShowGuide] = useState(false);

  // IP check state
  const [myIp, setMyIp] = useState("");
  const [loadingIp, setLoadingIp] = useState(false);
  const [ipCopied, setIpCopied] = useState(false);

  // Connection state
  const [connected, setConnected] = useState(false);
  const [connectionSource, setConnectionSource] =
    useState<ConnectionSource>(null);
  const [manualApiKey, setManualApiKey] = useState("");
  const [manualSecretKey, setManualSecretKey] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");

  // Wallet state
  const [balances, setBalances] = useState<Balance[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);

  // Order state
  const [orderSymbol, setOrderSymbol] = useState("BTCUSDT");
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [orderQuantity, setOrderQuantity] = useState("");
  const [orderPrice, setOrderPrice] = useState("");
  const [isTestOrder, setIsTestOrder] = useState(true);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);

  // Open orders state
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  // ─── Helpers ──────────────────────────────────────────────
  const getCredentials = useCallback(() => {
    if (connectionSource === "manual") {
      return {
        apiKey: manualApiKey,
        secretKey: manualSecretKey,
      };
    }
    return {};
  }, [connectionSource, manualApiKey, manualSecretKey]);

  // ─── Check IP ─────────────────────────────────────────────
  const checkIp = async () => {
    setLoadingIp(true);
    try {
      const res = await fetch("https://api.ipify.org?format=json");
      const data = await res.json();
      setMyIp(data.ip);
    } catch {
      setMyIp("ไม่สามารถดึง IP ได้");
    } finally {
      setLoadingIp(false);
    }
  };

  const copyIp = () => {
    navigator.clipboard.writeText(myIp);
    setIpCopied(true);
    setTimeout(() => setIpCopied(false), 2000);
  };

  // ─── Connect wallet ───────────────────────────────────────
  const connectWallet = async (source: "env" | "manual") => {
    setConnecting(true);
    setConnectionError("");

    const body: Record<string, string> = {};
    if (source === "manual") {
      if (!manualApiKey || !manualSecretKey) {
        setConnectionError("กรุณากรอก API Key และ Secret Key");
        setConnecting(false);
        return;
      }
      body.apiKey = manualApiKey;
      body.secretKey = manualSecretKey;
    }

    try {
      const res = await fetch("/api/binance/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setConnectionError(
          data.details?.msg || data.error || "เชื่อมต่อไม่สำเร็จ"
        );
        setConnecting(false);
        return;
      }

      setBalances(data.balances || []);
      setPermissions(data.permissions || []);
      setConnected(true);
      setConnectionSource(source);
    } catch {
      setConnectionError("ไม่สามารถเชื่อมต่อ Binance API ได้");
    } finally {
      setConnecting(false);
    }
  };

  // ─── Refresh balances ─────────────────────────────────────
  const refreshBalances = async () => {
    setLoadingBalances(true);
    try {
      const res = await fetch("/api/binance/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getCredentials()),
      });
      const data = await res.json();
      if (res.ok) {
        setBalances(data.balances || []);
      }
    } catch {
      // silent
    } finally {
      setLoadingBalances(false);
    }
  };

  // ─── Submit order ─────────────────────────────────────────
  const submitOrder = async () => {
    if (!orderQuantity) return;
    setSubmittingOrder(true);
    setOrderResult(null);

    try {
      const res = await fetch("/api/binance/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...getCredentials(),
          symbol: orderSymbol,
          side: orderSide,
          type: orderType,
          quantity: orderQuantity,
          price: orderType === "LIMIT" ? orderPrice : undefined,
          testOrder: isTestOrder,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setOrderResult({
          error: data.details?.msg || data.error || "Order failed",
          details: data.details,
        });
      } else {
        if (isTestOrder && Object.keys(data).length === 0) {
          setOrderResult({
            status: "TEST_OK",
            symbol: orderSymbol,
            side: orderSide,
            type: orderType,
            origQty: orderQuantity,
          });
        } else {
          setOrderResult(data);
        }
        refreshBalances();
      }
    } catch {
      setOrderResult({ error: "ไม่สามารถส่ง Order ได้" });
    } finally {
      setSubmittingOrder(false);
    }
  };

  // ─── Fetch open orders ────────────────────────────────────
  const fetchOpenOrders = async () => {
    setLoadingOrders(true);
    try {
      const res = await fetch("/api/binance/order/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getCredentials()),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setOpenOrders(data);
      }
    } catch {
      // silent
    } finally {
      setLoadingOrders(false);
    }
  };

  // ─── Cancel order ─────────────────────────────────────────
  const cancelOrder = async (symbol: string, orderId: number) => {
    setCancellingId(orderId);
    try {
      const res = await fetch("/api/binance/order/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...getCredentials(), symbol, orderId }),
      });
      if (res.ok) {
        setOpenOrders((prev) => prev.filter((o) => o.orderId !== orderId));
      }
    } catch {
      // silent
    } finally {
      setCancellingId(null);
    }
  };

  // ─── Disconnect ───────────────────────────────────────────
  const disconnect = () => {
    setConnected(false);
    setConnectionSource(null);
    setBalances([]);
    setPermissions([]);
    setOpenOrders([]);
    setOrderResult(null);
    setManualApiKey("");
    setManualSecretKey("");
  };

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WalletIcon className="size-5 text-primary" weight="duotone" />
            <h1 className="text-lg font-semibold">Binance Trading</h1>
            <Button variant="outline" size="sm">
              <Link href="/klines">Back Test</Link>
            </Button>
            {connected && (
              <Button variant="outline" size="sm">
                <Link
                  href={`/trading/LiveTrading?apiKey=${encodeURIComponent(
                    connectionSource === "manual" ? manualApiKey : "__env__"
                  )}&secretKey=${encodeURIComponent(
                    connectionSource === "manual" ? manualSecretKey : "__env__"
                  )}`}
                  className="flex items-center gap-1"
                >
                  <LightningIcon weight="duotone" className="size-3.5" />
                  Live Trading
                </Link>
              </Button>
            )}
          </div>
          {connected && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
                {connectionSource === "env" ? "ENV Key" : "Manual Key"}
              </Badge>
              <Button variant="ghost" size="icon-sm" onClick={disconnect}>
                <LinkBreakIcon weight="bold" />
              </Button>
            </div>
          )}
        </div>

        {/* ─── Not Connected ─────────────────────────────── */}
        {!connected && (
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <LinkSimpleIcon weight="duotone" className="size-4" />
                เชื่อมต่อกระเป๋า Binance
              </CardTitle>
              <CardDescription>
                เลือกวิธีเชื่อมต่อ: ใช้ API Key จาก env หรือกรอก Key เอง (Update เชื่อมต่อ: 2026-04-02)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Setup Guide */}
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5">
                <button
                  type="button"
                  onClick={() => setShowGuide(!showGuide)}
                  className="flex w-full items-center justify-between p-3 text-left"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-yellow-500">
                    <KeyIcon weight="duotone" className="size-4" />
                    ขั้นตอนการสร้าง API Key จาก Binance
                  </div>
                  {showGuide ? (
                    <CaretUpIcon className="size-4 text-yellow-500" />
                  ) : (
                    <CaretDownIcon className="size-4 text-yellow-500" />
                  )}
                </button>

                {showGuide && (
                  <div className="space-y-4 border-t border-yellow-500/20 p-4">
                    {/* Link to Binance API Management */}
                    <a
                      href="https://www.binance.com/en/my/settings/api-management"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs font-medium text-yellow-500 hover:bg-yellow-500/20 transition-colors w-fit"
                    >
                      <KeyIcon weight="bold" className="size-3.5" />
                      ไปหน้าสร้าง API Key ที่ Binance
                      <LinkSimpleIcon weight="bold" className="size-3.5" />
                    </a>

                    {/* Step 1: Choose API Key type */}
                    <div className="space-y-2">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold">
                        <Badge variant="outline" className="size-5 justify-center rounded-full text-[10px]">1</Badge>
                        Choose API Key type — เลือก System generated
                      </h3>
                      <p className="text-xs text-muted-foreground pl-7">
                        ใช้ HMAC symmetric encryption — Binance จะสร้าง API Key และ Secret Key ให้อัตโนมัติ
                        เก็บ Key เหล่านี้ให้ปลอดภัยเหมือนรหัสผ่าน อย่าแชร์ให้บุคคลที่สาม
                      </p>
                      <div className="pl-7">
                        <Image
                          src="/trading/Binance/set.png"
                          alt="Choose API Key type - System generated"
                          width={480}
                          height={480}
                          className="rounded-md border"
                        />
                      </div>
                    </div>

                    {/* Step 2: API restrictions */}
                    <div className="space-y-2">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold">
                        <Badge variant="outline" className="size-5 justify-center rounded-full text-[10px]">2</Badge>
                        ตั้งค่า API restrictions
                      </h3>
                      <div className="pl-7 space-y-2">
                        <div className="grid gap-1.5 text-xs">
                          <div className="flex items-start gap-2">
                            <ShieldCheckIcon weight="duotone" className="size-4 text-green-500 shrink-0 mt-0.5" />
                            <div>
                              <span className="font-medium">Enable Reading</span>
                              <Badge variant="secondary" className="text-[10px] ml-1.5">แนะนำ</Badge>
                              <p className="text-muted-foreground mt-0.5">ดูข้อมูลบัญชี ยอดคงเหลือ และประวัติการเทรด</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <ShieldCheckIcon weight="duotone" className="size-4 text-green-500 shrink-0 mt-0.5" />
                            <div>
                              <span className="font-medium">Enable Spot & Margin Trading</span>
                              <Badge variant="secondary" className="text-[10px] ml-1.5">สำหรับเทรด</Badge>
                              <p className="text-muted-foreground mt-0.5">ส่งคำสั่งซื้อ/ขาย Spot และ Margin ได้</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Enable Margin Loan, Repay & Transfer</span>
                              <p className="mt-0.5">กู้ยืม ชำระคืน และโอนเงิน Margin</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Enable Futures</span>
                              <p className="mt-0.5">เทรดสัญญา Futures (USDⓈ-M / COIN-M)</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Enable Internal Transfer</span>
                              <p className="mt-0.5">โอนสินทรัพย์ระหว่างบัญชีภายใน เช่น Spot ↔ Futures</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Permits Universal Transfer</span>
                              <p className="mt-0.5">โอนสินทรัพย์ข้ามบัญชีทุกประเภท (Spot, Margin, Futures, Funding ฯลฯ)</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Enable Withdrawals</span>
                              <p className="mt-0.5">ถอนสินทรัพย์ออกจาก Binance ไปยังกระเป๋าภายนอก</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Enable European Options</span>
                              <p className="mt-0.5">เทรดออปชัน (European-style Options)</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Enable Symbol Whitelist</span>
                              <p className="mt-0.5">จำกัดให้ API เทรดได้เฉพาะคู่เหรียญที่กำหนดเท่านั้น</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Step 3: IP access restrictions */}
                    <div className="space-y-2">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold">
                        <Badge variant="outline" className="size-5 justify-center rounded-full text-[10px]">3</Badge>
                        ตั้งค่า IP access restrictions
                      </h3>
                      <div className="pl-7 space-y-2">
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
                          <div className="flex items-center gap-2 font-medium text-destructive">
                            <WarningIcon weight="bold" className="size-3.5 shrink-0" />
                            Unrestricted (Less Secure)
                          </div>
                          <p className="mt-1 text-muted-foreground pl-5.5">
                            API Key สามารถเข้าถึงจาก IP ใดก็ได้ — ไม่แนะนำ
                            หากไม่จำกัด IP และเปิดสิทธิ์อื่นนอกจาก Reading API Key จะถูกลบอัตโนมัติ
                          </p>
                        </div>
                        <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 text-xs">
                          <div className="flex items-center gap-2 font-medium text-green-500">
                            <LockIcon weight="bold" className="size-3.5 shrink-0" />
                            Restrict access to trusted IPs only (Recommended)
                            <Badge variant="secondary" className="text-[10px]">แนะนำ</Badge>
                          </div>
                          <p className="mt-1 text-muted-foreground pl-5.5">
                            จำกัดเฉพาะ IP ที่เชื่อถือได้เท่านั้น — ใช้ปุ่ม &quot;ดู IP ของฉัน&quot; ด้านล่างเพื่อดู IP ของคุณ
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* IP Check */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkIp}
                  disabled={loadingIp}
                >
                  {loadingIp ? (
                    <SpinnerIcon className="size-3.5 animate-spin" />
                  ) : (
                    <GlobeIcon weight="duotone" className="size-3.5" />
                  )}
                  ดู IP ของฉัน
                </Button>
                {myIp && (
                  <div className="flex items-center gap-1.5">
                    <code className="rounded bg-muted px-2 py-0.5 text-xs font-mono">
                      {myIp}
                    </code>
                    <button
                      type="button"
                      onClick={copyIp}
                      className="text-muted-foreground hover:text-foreground"
                      title="คัดลอก IP"
                    >
                      {ipCopied ? (
                        <CheckCircleIcon weight="bold" className="size-3.5 text-green-500" />
                      ) : (
                        <CopyIcon weight="bold" className="size-3.5" />
                      )}
                    </button>
                  </div>
                )}
              </div>

              <Tabs defaultValue="env">
                <TabsList>
                  <TabsTrigger value="env">ใช้ env จากการ build</TabsTrigger>
                  <TabsTrigger value="manual">กรอก Key เอง</TabsTrigger>
                </TabsList>

                {/* ENV connect */}
                <TabsContent value="env">
                  <div className="space-y-3 pt-3">
                    <p className="text-xs text-muted-foreground">
                      ใช้ BINANCE_API_KEY และ BINANCE_SECRET_KEY ที่ตั้งค่าไว้ใน
                      env
                    </p>
                    <Button
                      onClick={() => connectWallet("env")}
                      disabled={connecting}
                      className="w-full"
                    >
                      {connecting ? (
                        <SpinnerIcon className="size-4 animate-spin" />
                      ) : (
                        <LinkSimpleIcon weight="bold" className="size-4" />
                      )}
                      เชื่อมต่อจาก ENV
                    </Button>
                  </div>
                </TabsContent>

                {/* Manual connect */}
                <TabsContent value="manual">
                  <div className="space-y-3 pt-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">API Key</label>
                      <Input
                        placeholder="กรอก Binance API Key"
                        value={manualApiKey}
                        onChange={(e) => setManualApiKey(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Secret Key</label>
                      <div className="relative">
                        <Input
                          type={showSecret ? "text" : "password"}
                          placeholder="กรอก Binance Secret Key"
                          value={manualSecretKey}
                          onChange={(e) => setManualSecretKey(e.target.value)}
                          className="pr-8"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecret(!showSecret)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showSecret ? (
                            <EyeSlashIcon className="size-4" />
                          ) : (
                            <EyeIcon className="size-4" />
                          )}
                        </button>
                      </div>
                    </div>
                    <Button
                      onClick={() => connectWallet("manual")}
                      disabled={connecting}
                      className="w-full"
                    >
                      {connecting ? (
                        <SpinnerIcon className="size-4 animate-spin" />
                      ) : (
                        <LinkSimpleIcon weight="bold" className="size-4" />
                      )}
                      เชื่อมต่อ
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>

              {connectionError && (
                <div className="flex items-center gap-2 rounded-none border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  <XCircleIcon weight="bold" className="size-4 shrink-0" />
                  {connectionError}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ─── Connected Dashboard ───────────────────────── */}
        {connected && (
          <>
            {/* Balances */}
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2">
                  <WalletIcon weight="duotone" className="size-4" />
                  ยอดคงเหลือ
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  {permissions.map((p) => (
                    <Badge key={p} variant="outline" className="text-[10px]">
                      {p}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                {balances.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    ไม่พบยอดคงเหลือ
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset</TableHead>
                        <TableHead className="text-right">Free</TableHead>
                        <TableHead className="text-right">Locked</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {balances.map((b) => (
                        <TableRow key={b.asset}>
                          <TableCell className="font-medium">
                            {b.asset}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(b.free).toFixed(8)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(b.locked) > 0 ? (
                              <span className="text-yellow-500">
                                {parseFloat(b.locked).toFixed(8)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
              <CardFooter>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={refreshBalances}
                  disabled={loadingBalances}
                >
                  {loadingBalances ? (
                    <SpinnerIcon className="size-3.5 animate-spin" />
                  ) : (
                    <ArrowsClockwiseIcon className="size-3.5" />
                  )}
                  Refresh
                </Button>
              </CardFooter>
            </Card>

            {/* Order Form + Open Orders in tabs */}
            <Tabs defaultValue="order">
              <TabsList>
                <TabsTrigger value="order">ส่ง Order</TabsTrigger>
                <TabsTrigger value="open">Open Orders</TabsTrigger>
              </TabsList>

              {/* ─── Order Form ─────────────────────────── */}
              <TabsContent value="order">
                <Card>
                  <CardContent className="space-y-4 pt-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {/* Symbol */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Symbol</label>
                        <Input
                          placeholder="BTCUSDT"
                          value={orderSymbol}
                          onChange={(e) =>
                            setOrderSymbol(e.target.value.toUpperCase())
                          }
                        />
                      </div>

                      {/* Side */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Side</label>
                        <div className="flex gap-1">
                          <Button
                            variant={
                              orderSide === "BUY" ? "default" : "outline"
                            }
                            size="sm"
                            className={
                              orderSide === "BUY"
                                ? "flex-1 bg-green-600 hover:bg-green-700 text-white"
                                : "flex-1"
                            }
                            onClick={() => setOrderSide("BUY")}
                          >
                            <ArrowUpIcon weight="bold" className="size-3" />
                            BUY
                          </Button>
                          <Button
                            variant={
                              orderSide === "SELL" ? "default" : "outline"
                            }
                            size="sm"
                            className={
                              orderSide === "SELL"
                                ? "flex-1 bg-red-600 hover:bg-red-700 text-white"
                                : "flex-1"
                            }
                            onClick={() => setOrderSide("SELL")}
                          >
                            <ArrowDownIcon weight="bold" className="size-3" />
                            SELL
                          </Button>
                        </div>
                      </div>

                      {/* Type */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Type</label>
                        <Select
                          value={orderType}
                          onValueChange={(v) =>
                            setOrderType(v as "MARKET" | "LIMIT")
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MARKET">MARKET</SelectItem>
                            <SelectItem value="LIMIT">LIMIT</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Quantity */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Quantity</label>
                        <Input
                          type="number"
                          placeholder="0.001"
                          value={orderQuantity}
                          onChange={(e) => setOrderQuantity(e.target.value)}
                          step="any"
                        />
                      </div>
                    </div>

                    {/* Limit price */}
                    {orderType === "LIMIT" && (
                      <div className="space-y-1.5 max-w-xs">
                        <label className="text-xs font-medium">
                          Price (LIMIT)
                        </label>
                        <Input
                          type="number"
                          placeholder="65000"
                          value={orderPrice}
                          onChange={(e) => setOrderPrice(e.target.value)}
                          step="any"
                        />
                      </div>
                    )}

                    {/* Test order toggle */}
                    <div className="flex items-center gap-3">
                      <Button
                        variant={isTestOrder ? "default" : "outline"}
                        size="xs"
                        onClick={() => setIsTestOrder(true)}
                      >
                        <TestTubeIcon weight="bold" className="size-3" />
                        Test Order
                      </Button>
                      <Button
                        variant={!isTestOrder ? "default" : "outline"}
                        size="xs"
                        onClick={() => setIsTestOrder(false)}
                      >
                        Live Order
                      </Button>
                      {isTestOrder && (
                        <span className="text-xs text-muted-foreground">
                          Validate เท่านั้น ไม่ส่ง Order จริง
                        </span>
                      )}
                      {!isTestOrder && (
                        <span className="text-xs text-destructive flex items-center gap-1">
                          <WarningIcon weight="bold" className="size-3" />
                          ส่ง Order จริง ใช้เงินจริง!
                        </span>
                      )}
                    </div>

                    {/* Submit */}
                    <Button
                      onClick={submitOrder}
                      disabled={submittingOrder || !orderQuantity}
                      className={`w-full ${orderSide === "BUY"
                          ? "bg-green-600 hover:bg-green-700"
                          : "bg-red-600 hover:bg-red-700"
                        } text-white`}
                    >
                      {submittingOrder ? (
                        <SpinnerIcon className="size-4 animate-spin" />
                      ) : orderSide === "BUY" ? (
                        <ArrowUpIcon weight="bold" className="size-4" />
                      ) : (
                        <ArrowDownIcon weight="bold" className="size-4" />
                      )}
                      {isTestOrder ? "Test" : ""} {orderSide} {orderSymbol}
                    </Button>

                    {/* Order result */}
                    {orderResult && (
                      <div
                        className={`rounded-none border p-3 text-xs space-y-1 ${orderResult.error
                            ? "border-destructive/30 bg-destructive/5 text-destructive"
                            : "border-green-500/30 bg-green-500/5 text-green-400"
                          }`}
                      >
                        {orderResult.error ? (
                          <div className="flex items-center gap-2">
                            <XCircleIcon
                              weight="bold"
                              className="size-4 shrink-0"
                            />
                            <span>{orderResult.error}</span>
                            {orderResult.details && (
                              <span className="text-muted-foreground">
                                (code: {orderResult.details.code})
                              </span>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <CheckCircleIcon
                                weight="bold"
                                className="size-4 shrink-0"
                              />
                              <span className="font-medium">
                                {orderResult.status === "TEST_OK"
                                  ? "Test Order สำเร็จ (ไม่ได้ส่งจริง)"
                                  : `Order ${orderResult.status}`}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground pl-6">
                              <span>Symbol: {orderResult.symbol}</span>
                              <span>Side: {orderResult.side}</span>
                              <span>Type: {orderResult.type}</span>
                              <span>Qty: {orderResult.origQty}</span>
                              {orderResult.executedQty && (
                                <span>
                                  Executed: {orderResult.executedQty}
                                </span>
                              )}
                              {orderResult.orderId && (
                                <span>Order ID: {orderResult.orderId}</span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ─── Open Orders ────────────────────────── */}
              <TabsContent value="open">
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-muted-foreground">
                        {openOrders.length} open order(s)
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={fetchOpenOrders}
                        disabled={loadingOrders}
                      >
                        {loadingOrders ? (
                          <SpinnerIcon className="size-3.5 animate-spin" />
                        ) : (
                          <ArrowsClockwiseIcon className="size-3.5" />
                        )}
                        Refresh
                      </Button>
                    </div>

                    {openOrders.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-8 text-center">
                        ไม่มี Open Orders —{" "}
                        <button
                          onClick={fetchOpenOrders}
                          className="underline hover:text-foreground"
                        >
                          กดโหลด
                        </button>
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Symbol</TableHead>
                            <TableHead>Side</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {openOrders.map((order) => (
                            <TableRow key={order.orderId}>
                              <TableCell className="font-medium">
                                {order.symbol}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    order.side === "BUY"
                                      ? "default"
                                      : "destructive"
                                  }
                                  className={
                                    order.side === "BUY"
                                      ? "bg-green-600/20 text-green-400"
                                      : ""
                                  }
                                >
                                  {order.side}
                                </Badge>
                              </TableCell>
                              <TableCell>{order.type}</TableCell>
                              <TableCell className="text-right font-mono">
                                {order.price}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {order.origQty}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{order.status}</Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="destructive"
                                  size="icon-xs"
                                  onClick={() =>
                                    cancelOrder(order.symbol, order.orderId)
                                  }
                                  disabled={cancellingId === order.orderId}
                                >
                                  {cancellingId === order.orderId ? (
                                    <SpinnerIcon className="size-3 animate-spin" />
                                  ) : (
                                    <TrashIcon
                                      weight="bold"
                                      className="size-3"
                                    />
                                  )}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}
