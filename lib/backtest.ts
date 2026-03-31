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
  | "cdc_actionzone"
  | "smc"
  | "cm_macd"
  | "supertrend"
  | "squeeze_momentum";

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
  {
    id: "cm_macd",
    name: "CM MacD Ultimate MTF",
    description: "Enhanced MACD 4-Color — Buy เมื่อ MACD ตัดขึ้น Signal, Sell เมื่อ MACD ตัดลง Signal",
    params: { fastLength: 12, slowLength: 26, signalLength: 9 },
  },
  {
    id: "supertrend",
    name: "Supertrend",
    description: "ATR-based trend follower — Buy เมื่อเทรนด์เปลี่ยนเป็นขาขึ้น, Sell เมื่อเปลี่ยนเป็นขาลง",
    params: { atrPeriod: 10, multiplier: 3.0 },
  },
  {
    id: "squeeze_momentum",
    name: "Squeeze Momentum [LazyBear]",
    description: "BB Squeeze + Momentum — Buy เมื่อ momentum ข้ามเหนือ 0, Sell เมื่อข้ามใต้ 0",
    params: { bbLength: 20, bbMult: 2.0, kcLength: 20, kcMult: 1.5 },
  },
];

// ─── Signal Generators ─────────────────────────────────────────
type SignalFn = (klines: KlineData[], ind: AllIndicators, params: Record<string, number>) => SignalAction[];

function rsiStrategy(_klines: KlineData[], ind: AllIndicators, params: Record<string, number>): SignalAction[] {
  const buyTh = params.buyThreshold ?? 30;
  const sellTh = params.sellThreshold ?? 70;
  return ind.rsi.map((v) => {
    if (v === null) return "HOLD";
    if (v < buyTh) return "BUY";
    if (v > sellTh) return "SELL";
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

function cmMacdStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.cmMacd.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function supertrendStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.supertrend.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function squeezeMomentumStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.squeezeMomentum.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

const STRATEGY_FNS: Record<StrategyId, SignalFn> = {
  rsi: rsiStrategy,
  cdc_actionzone: cdcActionZoneStrategy,
  smc: smcStrategy,
  cm_macd: cmMacdStrategy,
  supertrend: supertrendStrategy,
  squeeze_momentum: squeezeMomentumStrategy,
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
    cmMacdFast: strategyId === "cm_macd" ? (params.fastLength ?? 12) : undefined,
    cmMacdSlow: strategyId === "cm_macd" ? (params.slowLength ?? 26) : undefined,
    cmMacdSignal: strategyId === "cm_macd" ? (params.signalLength ?? 9) : undefined,
    supertrendPeriod: strategyId === "supertrend" ? (params.atrPeriod ?? 10) : undefined,
    supertrendMultiplier: strategyId === "supertrend" ? (params.multiplier ?? 3.0) : undefined,
    sqzMomBBLength: strategyId === "squeeze_momentum" ? (params.bbLength ?? 20) : undefined,
    sqzMomBBMult: strategyId === "squeeze_momentum" ? (params.bbMult ?? 2.0) : undefined,
    sqzMomKCLength: strategyId === "squeeze_momentum" ? (params.kcLength ?? 20) : undefined,
    sqzMomKCMult: strategyId === "squeeze_momentum" ? (params.kcMult ?? 1.5) : undefined,
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
