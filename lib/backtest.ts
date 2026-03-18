import type { KlineData } from "@/lib/types/kline";
import { computeAll, type AllIndicators } from "@/lib/indicators";

// ─── Types ─────────────────────────────────────────────────────
export type SignalAction = "BUY" | "SELL" | "HOLD";

export interface Trade {
  entryIdx: number;
  entryTime: number;
  entryPrice: number;
  exitIdx: number;
  exitTime: number;
  exitPrice: number;
  pnl: number;       // absolute
  pnlPct: number;    // percentage
  bars: number;       // holding period
  reason: string;     // why entered / exited
}

export interface BacktestResult {
  trades: Trade[];
  totalPnlPct: number;
  winRate: number;
  wins: number;
  losses: number;
  totalTrades: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
  avgBarsHeld: number;
  bestTradePct: number;
  worstTradePct: number;
  equityCurve: number[];   // cumulative % at each bar
  signals: SignalAction[];  // signal at each bar
  buyAndHoldPct: number;
}

export type StrategyId =
  | "rsi"
  | "macd"
  | "ema_cross"
  | "bb"
  | "adx_di"
  | "ichimoku"
  | "mfi"
  | "combined"
  | "cdc_actionzone"
  | "smc";

export interface StrategyConfig {
  id: StrategyId;
  name: string;
  description: string;
  params: Record<string, number>;
}

export const STRATEGIES: StrategyConfig[] = [
  {
    id: "rsi",
    name: "RSI Overbought/Oversold",
    description: "Buy RSI < 30, Sell RSI > 70",
    params: { period: 14, buyThreshold: 30, sellThreshold: 70 },
  },
  {
    id: "macd",
    name: "MACD Crossover",
    description: "Buy MACD crosses above Signal, Sell crosses below",
    params: {},
  },
  {
    id: "ema_cross",
    name: "EMA Golden/Death Cross",
    description: "Buy EMA(50) > EMA(200), Sell EMA(50) < EMA(200)",
    params: {},
  },
  {
    id: "bb",
    name: "Bollinger Bands Bounce",
    description: "Buy near lower band, Sell near upper band",
    params: {},
  },
  {
    id: "adx_di",
    name: "ADX + DI Trend",
    description: "Buy +DI > -DI & ADX > 25, Sell +DI < -DI",
    params: { adxThreshold: 25 },
  },
  {
    id: "ichimoku",
    name: "Ichimoku Cloud",
    description: "Buy price above cloud + Tenkan > Kijun, Sell below",
    params: {},
  },
  {
    id: "mfi",
    name: "MFI Overbought/Oversold",
    description: "Buy MFI < 20, Sell MFI > 80",
    params: { buyThreshold: 20, sellThreshold: 80 },
  },
  {
    id: "combined",
    name: "Combined (RSI + MACD + EMA)",
    description: "Buy when 2/3 agree BUY, Sell when 2/3 agree SELL",
    params: {},
  },
  {
    id: "cdc_actionzone",
    name: "CDC ActionZone V3",
    description: "EMA crossover zones — Buy on first Green bar, Sell on first Red bar",
    params: { fastPeriod: 12, slowPeriod: 26 },
  },
  {
    id: "smc",
    name: "Smart Money Concepts (SMC)",
    description: "Buy on Bullish CHoCH/BOS (discount zone), Sell on Bearish CHoCH/BOS (premium zone)",
    params: { swingSize: 50, internalSize: 5 },
  },
];

// ─── Signal Generators ─────────────────────────────────────────
type SignalFn = (klines: KlineData[], ind: AllIndicators, params: Record<string, number>) => SignalAction[];

function rsiStrategy(klines: KlineData[], ind: AllIndicators, params: Record<string, number>): SignalAction[] {
  const buyTh = params.buyThreshold ?? 30;
  const sellTh = params.sellThreshold ?? 70;
  return ind.rsi.map((v) => {
    if (v === null) return "HOLD";
    if (v < buyTh) return "BUY";
    if (v > sellTh) return "SELL";
    return "HOLD";
  });
}

function macdStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  const { macd: m, signal: s } = ind.macd;
  const signals: SignalAction[] = [];
  for (let i = 0; i < m.length; i++) {
    if (i === 0 || m[i] === null || s[i] === null || m[i - 1] === null || s[i - 1] === null) {
      signals.push("HOLD"); continue;
    }
    const prevDiff = m[i - 1]! - s[i - 1]!;
    const currDiff = m[i]! - s[i]!;
    if (prevDiff <= 0 && currDiff > 0) signals.push("BUY");
    else if (prevDiff >= 0 && currDiff < 0) signals.push("SELL");
    else signals.push("HOLD");
  }
  return signals;
}

function emaCrossStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  const signals: SignalAction[] = [];
  for (let i = 0; i < ind.ema50.length; i++) {
    if (i === 0 || ind.ema50[i] === null || ind.ema200[i] === null || ind.ema50[i - 1] === null || ind.ema200[i - 1] === null) {
      signals.push("HOLD"); continue;
    }
    const prevAbove = ind.ema50[i - 1]! > ind.ema200[i - 1]!;
    const currAbove = ind.ema50[i]! > ind.ema200[i]!;
    if (!prevAbove && currAbove) signals.push("BUY");
    else if (prevAbove && !currAbove) signals.push("SELL");
    else signals.push("HOLD");
  }
  return signals;
}

function bbStrategy(klines: KlineData[], ind: AllIndicators): SignalAction[] {
  const c = klines.map(k => +k.close);
  return c.map((price, i) => {
    if (ind.bb.lower[i] === null || ind.bb.upper[i] === null) return "HOLD";
    if (price <= ind.bb.lower[i]!) return "BUY";
    if (price >= ind.bb.upper[i]!) return "SELL";
    return "HOLD";
  });
}

function adxDiStrategy(_k: KlineData[], ind: AllIndicators, params: Record<string, number>): SignalAction[] {
  const th = params.adxThreshold ?? 25;
  const signals: SignalAction[] = [];
  for (let i = 0; i < ind.adx.adx.length; i++) {
    const a = ind.adx.adx[i], pdi = ind.adx.plusDI[i], mdi = ind.adx.minusDI[i];
    if (a === null || pdi === null || mdi === null) { signals.push("HOLD"); continue; }
    if (i === 0) { signals.push("HOLD"); continue; }
    const prevPDI = ind.adx.plusDI[i - 1], prevMDI = ind.adx.minusDI[i - 1];
    if (prevPDI === null || prevMDI === null) { signals.push("HOLD"); continue; }
    const crossed_up = prevPDI <= prevMDI && pdi > mdi;
    const crossed_down = prevPDI >= prevMDI && pdi < mdi;
    if (crossed_up && a > th) signals.push("BUY");
    else if (crossed_down) signals.push("SELL");
    else signals.push("HOLD");
  }
  return signals;
}

function ichimokuStrategy(klines: KlineData[], ind: AllIndicators): SignalAction[] {
  const c = klines.map(k => +k.close);
  const { tenkan, kijun, senkouA, senkouB } = ind.ichimoku;
  const signals: SignalAction[] = [];
  for (let i = 0; i < klines.length; i++) {
    if (tenkan[i] === null || kijun[i] === null || senkouA[i] === null || senkouB[i] === null) {
      signals.push("HOLD"); continue;
    }
    const cloudTop = Math.max(senkouA[i]!, senkouB[i]!);
    const cloudBottom = Math.min(senkouA[i]!, senkouB[i]!);
    const aboveCloud = c[i] > cloudTop;
    const belowCloud = c[i] < cloudBottom;
    const tenkanAbove = tenkan[i]! > kijun[i]!;

    if (i === 0) { signals.push("HOLD"); continue; }
    const prevTenkanAbove = tenkan[i - 1] !== null && kijun[i - 1] !== null && tenkan[i - 1]! > kijun[i - 1]!;

    if (aboveCloud && !prevTenkanAbove && tenkanAbove) signals.push("BUY");
    else if (belowCloud && prevTenkanAbove && !tenkanAbove) signals.push("SELL");
    else signals.push("HOLD");
  }
  return signals;
}

function mfiStrategy(_k: KlineData[], ind: AllIndicators, params: Record<string, number>): SignalAction[] {
  const buyTh = params.buyThreshold ?? 20;
  const sellTh = params.sellThreshold ?? 80;
  return ind.mfi.map((v) => {
    if (v === null) return "HOLD";
    if (v < buyTh) return "BUY";
    if (v > sellTh) return "SELL";
    return "HOLD";
  });
}

function combinedStrategy(klines: KlineData[], ind: AllIndicators, params: Record<string, number>): SignalAction[] {
  const r = rsiStrategy(klines, ind, { buyThreshold: 30, sellThreshold: 70 });
  const m = macdStrategy(klines, ind);
  const e = emaCrossStrategy(klines, ind);
  return klines.map((_, i) => {
    let buyVotes = 0, sellVotes = 0;
    if (r[i] === "BUY") buyVotes++; if (r[i] === "SELL") sellVotes++;
    if (m[i] === "BUY") buyVotes++; if (m[i] === "SELL") sellVotes++;
    if (e[i] === "BUY") buyVotes++; if (e[i] === "SELL") sellVotes++;
    if (buyVotes >= 2) return "BUY";
    if (sellVotes >= 2) return "SELL";
    return "HOLD";
  });
}

function cdcActionZoneStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  const cdc = ind.cdcActionZone;
  return cdc.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function smcStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.smc.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

const STRATEGY_FNS: Record<StrategyId, SignalFn> = {
  rsi: rsiStrategy,
  macd: macdStrategy,
  ema_cross: emaCrossStrategy,
  bb: bbStrategy,
  adx_di: adxDiStrategy,
  ichimoku: ichimokuStrategy,
  mfi: mfiStrategy,
  combined: combinedStrategy,
  cdc_actionzone: cdcActionZoneStrategy,
  smc: smcStrategy,
};

// ─── Backtest Engine ───────────────────────────────────────────
export function runBacktest(
  klines: KlineData[],
  strategyId: StrategyId,
  params: Record<string, number> = {},
  feesPct = 0.1, // 0.1% per trade (Binance default)
): BacktestResult {
  const indicators = computeAll(klines, {
    rsiPeriod: strategyId === "rsi" ? (params.period ?? 14) : undefined,
    smcSwingSize: strategyId === "smc" ? (params.swingSize ?? 50) : undefined,
    smcInternalSize: strategyId === "smc" ? (params.internalSize ?? 5) : undefined,
  });
  const signals = STRATEGY_FNS[strategyId](klines, indicators, params);

  const closes = klines.map(k => +k.close);
  const trades: Trade[] = [];
  let inPosition = false;
  let entryIdx = 0;
  let entryPrice = 0;
  let entryReason = "";

  // Generate trades
  for (let i = 0; i < klines.length; i++) {
    if (!inPosition && signals[i] === "BUY") {
      inPosition = true;
      entryIdx = i;
      entryPrice = closes[i];
      entryReason = "BUY signal";
    } else if (inPosition && signals[i] === "SELL") {
      const exitPrice = closes[i];
      const grossPnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
      const netPnlPct = grossPnlPct - feesPct * 2; // entry + exit fee
      trades.push({
        entryIdx,
        entryTime: klines[entryIdx].openTime,
        entryPrice,
        exitIdx: i,
        exitTime: klines[i].openTime,
        exitPrice,
        pnl: exitPrice - entryPrice,
        pnlPct: netPnlPct,
        bars: i - entryIdx,
        reason: `${entryReason} → SELL signal`,
      });
      inPosition = false;
    }
  }

  // Close any open position at last bar
  if (inPosition) {
    const exitPrice = closes[closes.length - 1];
    const grossPnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    const netPnlPct = grossPnlPct - feesPct * 2;
    trades.push({
      entryIdx,
      entryTime: klines[entryIdx].openTime,
      entryPrice,
      exitIdx: klines.length - 1,
      exitTime: klines[klines.length - 1].openTime,
      exitPrice,
      pnl: exitPrice - entryPrice,
      pnlPct: netPnlPct,
      bars: klines.length - 1 - entryIdx,
      reason: `${entryReason} → Force close (end)`,
    });
  }

  // Stats
  const wins = trades.filter(t => t.pnlPct > 0);
  const losses = trades.filter(t => t.pnlPct <= 0);
  const totalPnlPct = trades.reduce((sum, t) => sum + t.pnlPct, 0);
  const winRate = trades.length === 0 ? 0 : (wins.length / trades.length) * 100;
  const avgWinPct = wins.length === 0 ? 0 : wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length;
  const avgLossPct = losses.length === 0 ? 0 : losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length;
  const avgBarsHeld = trades.length === 0 ? 0 : trades.reduce((s, t) => s + t.bars, 0) / trades.length;
  const bestTradePct = trades.length === 0 ? 0 : Math.max(...trades.map(t => t.pnlPct));
  const worstTradePct = trades.length === 0 ? 0 : Math.min(...trades.map(t => t.pnlPct));

  const grossWins = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));
  const profitFactor = grossLosses === 0 ? (grossWins > 0 ? Infinity : 0) : grossWins / grossLosses;

  // Equity curve (cumulative %)
  const equityCurve: number[] = [];
  let cumPnl = 0;
  let tradeIdx = 0;
  for (let i = 0; i < klines.length; i++) {
    if (tradeIdx < trades.length && i === trades[tradeIdx].exitIdx) {
      cumPnl += trades[tradeIdx].pnlPct;
      tradeIdx++;
    }
    equityCurve.push(cumPnl);
  }

  // Max drawdown
  let peak = 0, maxDD = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe (simplified — using trade returns)
  const tradePnls = trades.map(t => t.pnlPct);
  const meanRet = tradePnls.length === 0 ? 0 : tradePnls.reduce((a, b) => a + b, 0) / tradePnls.length;
  const variance = tradePnls.length <= 1 ? 0 : tradePnls.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (tradePnls.length - 1);
  const sharpe = variance === 0 ? 0 : meanRet / Math.sqrt(variance);

  // Buy & hold
  const buyAndHoldPct = closes.length >= 2
    ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100
    : 0;

  return {
    trades,
    totalPnlPct,
    winRate,
    wins: wins.length,
    losses: losses.length,
    totalTrades: trades.length,
    maxDrawdownPct: maxDD,
    sharpeRatio: sharpe,
    profitFactor,
    avgWinPct,
    avgLossPct,
    avgBarsHeld,
    bestTradePct,
    worstTradePct,
    equityCurve,
    signals,
    buyAndHoldPct,
  };
}
