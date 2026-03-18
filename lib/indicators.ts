import type { KlineData } from "@/lib/types/kline";

// ─── Helper ────────────────────────────────────────────────────
function closes(k: KlineData[]): number[] { return k.map(x => +x.close); }
function highs(k: KlineData[]): number[]  { return k.map(x => +x.high); }
function lows(k: KlineData[]): number[]   { return k.map(x => +x.low); }
function volumes(k: KlineData[]): number[] { return k.map(x => +x.volume); }

// ─── SMA ───────────────────────────────────────────────────────
export function sma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

// ─── EMA ───────────────────────────────────────────────────────
export function ema(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (prev === null) {
      // seed with SMA
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      prev = sum / period;
    } else {
      prev = data[i] * k + prev * (1 - k);
    }
    result.push(prev);
  }
  return result;
}

// ─── RSI ───────────────────────────────────────────────────────
export function rsi(data: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (data.length < period + 1) return data.map(() => null);

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = 0; i < period; i++) result.push(null);
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

// ─── MACD ──────────────────────────────────────────────────────
export interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}
export function macd(data: number[], fast = 12, slow = 26, sig = 9): MACDResult {
  const emaFast = ema(data, fast);
  const emaSlow = ema(data, slow);
  const macdLine: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdLine.push(emaFast[i]! - emaSlow[i]!);
    } else {
      macdLine.push(null);
    }
  }
  // signal line = EMA of MACD values
  const nonNull = macdLine.filter(v => v !== null) as number[];
  const sigLine = ema(nonNull, sig);
  // map back
  const signalFull: (number | null)[] = [];
  const histFull: (number | null)[] = [];
  let idx = 0;
  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] === null) {
      signalFull.push(null);
      histFull.push(null);
    } else {
      const s = sigLine[idx] ?? null;
      signalFull.push(s);
      histFull.push(s !== null ? macdLine[i]! - s : null);
      idx++;
    }
  }
  return { macd: macdLine, signal: signalFull, histogram: histFull };
}

// ─── Bollinger Bands ───────────────────────────────────────────
export interface BBResult {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
}
export function bollingerBands(data: number[], period = 20, mult = 2): BBResult {
  const mid = sma(data, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (mid[i] === null) { upper.push(null); lower.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (data[j] - mid[i]!) ** 2;
    const std = Math.sqrt(sum / period);
    upper.push(mid[i]! + mult * std);
    lower.push(mid[i]! - mult * std);
  }
  return { upper, middle: mid, lower };
}

// ─── ATR ───────────────────────────────────────────────────────
export function atr(klines: KlineData[], period = 14): (number | null)[] {
  const h = highs(klines), l = lows(klines), c = closes(klines);
  const tr: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    if (i === 0) { tr.push(h[i] - l[i]); continue; }
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  const result: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (prev === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += tr[j];
      prev = sum / period;
    } else {
      prev = (prev * (period - 1) + tr[i]) / period;
    }
    result.push(prev);
  }
  return result;
}

// ─── ADX ───────────────────────────────────────────────────────
export interface ADXResult {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
}
export function adx(klines: KlineData[], period = 14): ADXResult {
  const h = highs(klines), l = lows(klines), c = closes(klines);
  const len = klines.length;
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trArr: number[] = [];

  for (let i = 0; i < len; i++) {
    if (i === 0) { plusDM.push(0); minusDM.push(0); trArr.push(h[i] - l[i]); continue; }
    const upMove = h[i] - h[i - 1];
    const downMove = l[i - 1] - l[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trArr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }

  // Smoothed
  const smooth = (arr: number[]) => {
    const out: number[] = [];
    let sum = 0;
    for (let i = 0; i < len; i++) {
      if (i < period) { sum += arr[i]; out.push(i === period - 1 ? sum : 0); continue; }
      sum = sum - sum / period + arr[i];
      out.push(sum);
    }
    return out;
  };

  const sTR = smooth(trArr);
  const sPlusDM = smooth(plusDM);
  const sMinusDM = smooth(minusDM);

  const plusDIArr: (number | null)[] = [];
  const minusDIArr: (number | null)[] = [];
  const dxArr: number[] = [];

  for (let i = 0; i < len; i++) {
    if (i < period - 1) { plusDIArr.push(null); minusDIArr.push(null); continue; }
    const pdi = sTR[i] === 0 ? 0 : (sPlusDM[i] / sTR[i]) * 100;
    const mdi = sTR[i] === 0 ? 0 : (sMinusDM[i] / sTR[i]) * 100;
    plusDIArr.push(pdi);
    minusDIArr.push(mdi);
    const diSum = pdi + mdi;
    dxArr.push(diSum === 0 ? 0 : (Math.abs(pdi - mdi) / diSum) * 100);
  }

  // ADX = SMA of DX
  const adxArr: (number | null)[] = [];
  let adxPrev: number | null = null;
  for (let i = 0; i < len; i++) {
    if (i < period * 2 - 2) { adxArr.push(null); continue; }
    const dxIdx = i - (period - 1);
    if (adxPrev === null) {
      let sum = 0;
      for (let j = dxIdx - period + 1; j <= dxIdx; j++) sum += dxArr[j];
      adxPrev = sum / period;
    } else {
      adxPrev = (adxPrev * (period - 1) + dxArr[dxIdx]) / period;
    }
    adxArr.push(adxPrev);
  }

  return { adx: adxArr, plusDI: plusDIArr, minusDI: minusDIArr };
}

// ─── OBV ───────────────────────────────────────────────────────
export function obv(klines: KlineData[]): number[] {
  const c = closes(klines), v = volumes(klines);
  const result: number[] = [0];
  for (let i = 1; i < klines.length; i++) {
    if (c[i] > c[i - 1]) result.push(result[i - 1] + v[i]);
    else if (c[i] < c[i - 1]) result.push(result[i - 1] - v[i]);
    else result.push(result[i - 1]);
  }
  return result;
}

// ─── MFI ───────────────────────────────────────────────────────
export function mfi(klines: KlineData[], period = 14): (number | null)[] {
  const h = highs(klines), l = lows(klines), c = closes(klines), v = volumes(klines);
  const tp: number[] = [];
  for (let i = 0; i < klines.length; i++) tp.push((h[i] + l[i] + c[i]) / 3);

  const result: (number | null)[] = [];
  for (let i = 0; i < klines.length; i++) {
    if (i < period) { result.push(null); continue; }
    let posFlow = 0, negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const rawMF = tp[j] * v[j];
      if (tp[j] > tp[j - 1]) posFlow += rawMF;
      else negFlow += rawMF;
    }
    result.push(negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow));
  }
  return result;
}

// ─── VWAP ──────────────────────────────────────────────────────
export function vwap(klines: KlineData[]): number[] {
  const result: number[] = [];
  let cumTPV = 0, cumVol = 0;
  for (let i = 0; i < klines.length; i++) {
    const tp = (+klines[i].high + +klines[i].low + +klines[i].close) / 3;
    const vol = +klines[i].volume;
    cumTPV += tp * vol;
    cumVol += vol;
    result.push(cumVol === 0 ? tp : cumTPV / cumVol);
  }
  return result;
}

// ─── Ichimoku ──────────────────────────────────────────────────
export interface IchimokuResult {
  tenkan: (number | null)[];   // Conversion Line (9)
  kijun: (number | null)[];    // Base Line (26)
  senkouA: (number | null)[];  // Leading Span A
  senkouB: (number | null)[];  // Leading Span B (52)
  chikou: (number | null)[];   // Lagging Span
}
function periodHL(h: number[], l: number[], end: number, period: number): number | null {
  if (end - period + 1 < 0) return null;
  let hi = -Infinity, lo = Infinity;
  for (let i = end - period + 1; i <= end; i++) { hi = Math.max(hi, h[i]); lo = Math.min(lo, l[i]); }
  return (hi + lo) / 2;
}
export function ichimoku(klines: KlineData[], tenkanP = 9, kijunP = 26, senkouBP = 52): IchimokuResult {
  const h = highs(klines), l = lows(klines), c = closes(klines);
  const len = klines.length;
  const tenkan: (number | null)[] = [];
  const kijun: (number | null)[] = [];
  const senkouA: (number | null)[] = [];
  const senkouB: (number | null)[] = [];
  const chikou: (number | null)[] = [];

  for (let i = 0; i < len; i++) {
    tenkan.push(periodHL(h, l, i, tenkanP));
    kijun.push(periodHL(h, l, i, kijunP));
    const t = tenkan[i], k = kijun[i];
    senkouA.push(t !== null && k !== null ? (t + k) / 2 : null);
    senkouB.push(periodHL(h, l, i, senkouBP));
    chikou.push(i + kijunP < len ? c[i] : null);
  }

  return { tenkan, kijun, senkouA, senkouB, chikou };
}

// ─── CDC ActionZone V3 2020 ──────────────────────────────────────
// Based on piriya33's PineScript indicator — EMA crossover zones
export type CDCZone = "green" | "blue" | "lightblue" | "red" | "orange" | "yellow" | null;

export interface CDCActionZoneResult {
  fastMA: (number | null)[];
  slowMA: (number | null)[];
  zone: CDCZone[];
  bull: (boolean | null)[];    // FastMA > SlowMA
  signal: ("BUY" | "SELL" | null)[];  // first green / first red
  trend: ("bullish" | "bearish" | null)[];
}

export function cdcActionZone(
  data: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  smoothPeriod = 1,
): CDCActionZoneResult {
  // xPrice = EMA(close, smooth) — smooth=1 means just close
  const xPrice = smoothPeriod <= 1 ? data : ema(data, smoothPeriod).map((v, i) => v ?? data[i]);

  const fastMA = ema(xPrice as number[], fastPeriod);
  const slowMA = ema(xPrice as number[], slowPeriod);

  const len = data.length;
  const zone: CDCZone[] = [];
  const bullArr: (boolean | null)[] = [];
  const signalArr: ("BUY" | "SELL" | null)[] = [];
  const trendArr: ("bullish" | "bearish" | null)[] = [];

  // Track last buy/sell for trend determination
  let lastBuyBar = -Infinity;
  let lastSellBar = -Infinity;

  for (let i = 0; i < len; i++) {
    const f = fastMA[i];
    const s = slowMA[i];
    const p = xPrice[i];

    if (f === null || s === null || p === undefined) {
      zone.push(null);
      bullArr.push(null);
      signalArr.push(null);
      trendArr.push(null);
      continue;
    }

    const isBull = f > s;
    const isBear = f < s;
    bullArr.push(isBull);

    // Define zones
    let z: CDCZone;
    if (isBull && p > f) z = "green";          // Buy zone
    else if (isBear && p > f && p > s) z = "blue";    // Pre Buy 2
    else if (isBear && p > f && p < s) z = "lightblue"; // Pre Buy 1
    else if (isBear && p < f) z = "red";              // Sell zone
    else if (isBull && p < f && p < s) z = "orange";  // Pre Sell 2
    else if (isBull && p < f && p > s) z = "yellow";  // Pre Sell 1
    else z = null; // edge case (equal)
    zone.push(z);

    // Buy/Sell signals: first green after non-green, first red after non-red
    const prevZone = i > 0 ? zone[i - 1] : null;
    const isGreen = z === "green";
    const wasGreen = prevZone === "green";
    const isRed = z === "red";
    const wasRed = prevZone === "red";

    const buyCond = isGreen && !wasGreen;
    const sellCond = isRed && !wasRed;

    // Use prevTrend BEFORE updating lastBuyBar/lastSellBar (matches Pine: bearish[1])
    const prevTrend = trendArr[i - 1] ?? null;

    // Actual buy = bearish[1] and buyCond, sell = bullish[1] and sellCond
    // Pine Script requires strict bearish/bullish — no null fallback
    if (buyCond && prevTrend === "bearish") {
      signalArr.push("BUY");
    } else if (sellCond && prevTrend === "bullish") {
      signalArr.push("SELL");
    } else {
      signalArr.push(null);
    }

    // Update trend tracking AFTER signal check
    if (buyCond) lastBuyBar = i;
    if (sellCond) lastSellBar = i;

    const isBullish = lastBuyBar > lastSellBar;
    const isBearish = lastSellBar > lastBuyBar;
    trendArr.push(isBullish ? "bullish" : isBearish ? "bearish" : null);
  }

  return { fastMA, slowMA, zone, bull: bullArr, signal: signalArr, trend: trendArr };
}

// ─── CM MacD Ultimate MTF ────────────────────────────────────────
// Based on ChrisMoody's PineScript — Enhanced MACD with 4-color histogram
// showing momentum direction above/below zero line.

export type CMHistColor = "aqua" | "blue" | "red" | "maroon";

export interface CMMAcDResult {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
  histColor: (CMHistColor | null)[];     // 4-color histogram
  macdAboveSignal: (boolean | null)[];   // MACD >= Signal
  crossUp: boolean[];                    // MACD crosses above Signal
  crossDown: boolean[];                  // MACD crosses below Signal
  signal: ("BUY" | "SELL" | null)[];     // trading signals
}

export function cmMacdUltMTF(
  data: number[],
  fastLength = 12,
  slowLength = 26,
  signalLength = 9,
): CMMAcDResult {
  const len = data.length;
  const fastMA = ema(data, fastLength);
  const slowMA = ema(data, slowLength);

  const macdLine: (number | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (fastMA[i] !== null && slowMA[i] !== null) {
      macdLine.push(fastMA[i]! - slowMA[i]!);
    } else {
      macdLine.push(null);
    }
  }

  // Signal line = SMA of MACD (like in the PineScript: sma(macd, signalLength))
  const nonNullMacd = macdLine.filter(v => v !== null) as number[];
  const sigSMA = sma(nonNullMacd, signalLength);

  const signalLine: (number | null)[] = [];
  const histogram: (number | null)[] = [];
  let idx = 0;
  for (let i = 0; i < len; i++) {
    if (macdLine[i] === null) {
      signalLine.push(null);
      histogram.push(null);
    } else {
      const s = sigSMA[idx] ?? null;
      signalLine.push(s);
      histogram.push(s !== null ? macdLine[i]! - s : null);
      idx++;
    }
  }

  // 4-color histogram logic
  // histA_IsUp   = hist > hist[1] and hist > 0   → aqua  (เพิ่มขึ้น เหนือศูนย์)
  // histA_IsDown = hist < hist[1] and hist > 0   → blue  (ลดลง แต่ยังเหนือศูนย์)
  // histB_IsDown = hist < hist[1] and hist <= 0  → red   (ลดลง ใต้ศูนย์)
  // histB_IsUp   = hist > hist[1] and hist <= 0  → maroon (เพิ่มขึ้น แต่ยังใต้ศูนย์)
  const histColor: (CMHistColor | null)[] = [];
  const macdAboveSignal: (boolean | null)[] = [];
  const crossUp: boolean[] = [];
  const crossDown: boolean[] = [];
  const signal: ("BUY" | "SELL" | null)[] = [];

  for (let i = 0; i < len; i++) {
    const h = histogram[i];
    const hPrev = i > 0 ? histogram[i - 1] : null;
    const m = macdLine[i];
    const s = signalLine[i];

    if (h === null || hPrev === null) {
      histColor.push(null);
      macdAboveSignal.push(null);
      crossUp.push(false);
      crossDown.push(false);
      signal.push(null);
      continue;
    }

    // 4-color
    if (h > hPrev && h > 0) histColor.push("aqua");
    else if (h < hPrev && h > 0) histColor.push("blue");
    else if (h < hPrev && h <= 0) histColor.push("red");
    else if (h > hPrev && h <= 0) histColor.push("maroon");
    else histColor.push("blue"); // equal case

    // MACD vs Signal
    const isAbove = m !== null && s !== null ? m >= s : null;
    macdAboveSignal.push(isAbove);

    // Cross detection
    const prevM = i > 0 ? macdLine[i - 1] : null;
    const prevS = i > 0 ? signalLine[i - 1] : null;
    const prevAbove = prevM !== null && prevS !== null ? prevM >= prevS : null;
    const currAbove = m !== null && s !== null ? m >= s : null;

    const isCrossUp = prevAbove === false && currAbove === true;
    const isCrossDown = prevAbove === true && currAbove === false;
    crossUp.push(isCrossUp);
    crossDown.push(isCrossDown);

    // Trading signals
    if (isCrossUp) signal.push("BUY");
    else if (isCrossDown) signal.push("SELL");
    else signal.push(null);
  }

  return { macdLine, signalLine, histogram, histColor, macdAboveSignal, crossUp, crossDown, signal };
}

// ─── Smart Money Concepts (SMC) ─────────────────────────────────
// Converted from LuxAlgo PineScript — detects market structure,
// order blocks, fair value gaps, and premium/discount zones.

export type SMCStructureType = "BOS" | "CHoCH";
export type SMCBias = "bullish" | "bearish";

export interface SMCStructureBreak {
  index: number;        // bar where break happened
  type: SMCStructureType;
  bias: SMCBias;
  level: number;        // price level that was broken
  pivotIndex: number;   // bar index of the pivot that was broken
}

export interface SMCOrderBlock {
  startIndex: number;
  high: number;
  low: number;
  bias: SMCBias;
  mitigated: boolean;
  mitigatedIndex: number | null;
}

export interface SMCFairValueGap {
  index: number;        // middle candle index
  top: number;
  bottom: number;
  bias: SMCBias;
  filled: boolean;
  filledIndex: number | null;
}

export interface SMCSwingPoint {
  index: number;
  price: number;
  type: "HH" | "HL" | "LH" | "LL" | "H" | "L";
}

export interface SMCResult {
  swingTrend: (SMCBias | null)[];
  internalTrend: (SMCBias | null)[];
  swingStructures: SMCStructureBreak[];
  internalStructures: SMCStructureBreak[];
  swingOrderBlocks: SMCOrderBlock[];
  internalOrderBlocks: SMCOrderBlock[];
  fairValueGaps: SMCFairValueGap[];
  swingPoints: SMCSwingPoint[];
  premiumDiscount: ("premium" | "discount" | "equilibrium" | null)[];
  signal: ("BUY" | "SELL" | null)[];
}

/**
 * Detect swing legs — a pivot high occurs when high[size] > highest(size bars after)
 * and pivot low when low[size] < lowest(size bars after).
 */
function detectPivots(
  h: number[], l: number[], size: number
): { pivotHighs: (number | null)[]; pivotLows: (number | null)[] } {
  const len = h.length;
  const pivotHighs: (number | null)[] = new Array(len).fill(null);
  const pivotLows: (number | null)[] = new Array(len).fill(null);

  for (let i = size; i < len - size; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= size; j++) {
      if (h[i] <= h[i - j] || h[i] <= h[i + j]) isHigh = false;
      if (l[i] >= l[i - j] || l[i] >= l[i + j]) isLow = false;
    }
    if (isHigh) pivotHighs[i] = h[i];
    if (isLow) pivotLows[i] = l[i];
  }
  return { pivotHighs, pivotLows };
}

/**
 * Detect market structure (BOS/CHoCH) from pivot points.
 * - BOS: price breaks above a pivot high in an uptrend (or below pivot low in downtrend)
 * - CHoCH: price breaks above a pivot high in a downtrend (trend reversal) or vice versa
 */
function detectStructure(
  c: number[], _h: number[], _l: number[],
  pivotHighs: (number | null)[], pivotLows: (number | null)[],
): { structures: SMCStructureBreak[]; trend: (SMCBias | null)[] } {
  const len = c.length;
  const structures: SMCStructureBreak[] = [];
  const trend: (SMCBias | null)[] = new Array(len).fill(null);

  let currentTrend: SMCBias | null = null;
  let lastPivotHigh: { price: number; index: number; crossed: boolean } | null = null;
  let lastPivotLow: { price: number; index: number; crossed: boolean } | null = null;

  for (let i = 0; i < len; i++) {
    // Update pivots
    if (pivotHighs[i] !== null) {
      lastPivotHigh = { price: pivotHighs[i]!, index: i, crossed: false };
    }
    if (pivotLows[i] !== null) {
      lastPivotLow = { price: pivotLows[i]!, index: i, crossed: false };
    }

    // Check bullish break (close crosses above pivot high)
    if (lastPivotHigh && !lastPivotHigh.crossed && c[i] > lastPivotHigh.price) {
      const type: SMCStructureType = currentTrend === "bearish" ? "CHoCH" : "BOS";
      structures.push({
        index: i,
        type,
        bias: "bullish",
        level: lastPivotHigh.price,
        pivotIndex: lastPivotHigh.index,
      });
      lastPivotHigh.crossed = true;
      currentTrend = "bullish";
    }

    // Check bearish break (close crosses below pivot low)
    if (lastPivotLow && !lastPivotLow.crossed && c[i] < lastPivotLow.price) {
      const type: SMCStructureType = currentTrend === "bullish" ? "CHoCH" : "BOS";
      structures.push({
        index: i,
        type,
        bias: "bearish",
        level: lastPivotLow.price,
        pivotIndex: lastPivotLow.index,
      });
      lastPivotLow.crossed = true;
      currentTrend = "bearish";
    }

    trend[i] = currentTrend;
  }

  return { structures, trend };
}

/**
 * Detect Order Blocks — the last opposite candle before a structure break.
 * Bullish OB: last bearish candle before a bullish break
 * Bearish OB: last bullish candle before a bearish break
 */
function detectOrderBlocks(
  c: number[], o: number[], h: number[], l: number[],
  structures: SMCStructureBreak[],
): SMCOrderBlock[] {
  const orderBlocks: SMCOrderBlock[] = [];
  const len = c.length;

  for (const s of structures) {
    // Search backward from the pivot for the last opposite candle
    const searchEnd = s.pivotIndex;
    const searchStart = Math.max(0, searchEnd - 20);

    if (s.bias === "bullish") {
      // Find last bearish candle before the bullish break
      for (let j = searchEnd; j >= searchStart; j--) {
        if (c[j] < o[j]) {
          orderBlocks.push({
            startIndex: j,
            high: h[j],
            low: l[j],
            bias: "bullish",
            mitigated: false,
            mitigatedIndex: null,
          });
          break;
        }
      }
    } else {
      // Find last bullish candle before the bearish break
      for (let j = searchEnd; j >= searchStart; j--) {
        if (c[j] > o[j]) {
          orderBlocks.push({
            startIndex: j,
            high: h[j],
            low: l[j],
            bias: "bearish",
            mitigated: false,
            mitigatedIndex: null,
          });
          break;
        }
      }
    }
  }

  // Check mitigation (price returns into the OB)
  for (const ob of orderBlocks) {
    for (let i = ob.startIndex + 1; i < len; i++) {
      if (ob.bias === "bullish" && l[i] <= ob.low) {
        ob.mitigated = true;
        ob.mitigatedIndex = i;
        break;
      }
      if (ob.bias === "bearish" && h[i] >= ob.high) {
        ob.mitigated = true;
        ob.mitigatedIndex = i;
        break;
      }
    }
  }

  return orderBlocks;
}

/**
 * Detect Fair Value Gaps — a 3-candle pattern where there's a gap
 * between candle 1 and candle 3 (candle 2 doesn't fill the gap).
 */
function detectFairValueGaps(
  h: number[], l: number[], _c: number[], _o: number[],
  atrValues: (number | null)[],
): SMCFairValueGap[] {
  const fvgs: SMCFairValueGap[] = [];
  const len = h.length;

  for (let i = 2; i < len; i++) {
    const atrVal = atrValues[i];
    // Bullish FVG: candle3 low > candle1 high (gap up)
    if (l[i] > h[i - 2]) {
      const gapSize = l[i] - h[i - 2];
      // Filter by ATR threshold (gap must be meaningful)
      if (atrVal === null || gapSize > atrVal * 0.1) {
        const fvg: SMCFairValueGap = {
          index: i - 1,
          top: l[i],
          bottom: h[i - 2],
          bias: "bullish",
          filled: false,
          filledIndex: null,
        };
        // Check if FVG is filled later
        for (let j = i + 1; j < len; j++) {
          if (l[j] <= fvg.bottom) {
            fvg.filled = true;
            fvg.filledIndex = j;
            break;
          }
        }
        fvgs.push(fvg);
      }
    }

    // Bearish FVG: candle3 high < candle1 low (gap down)
    if (h[i] < l[i - 2]) {
      const gapSize = l[i - 2] - h[i];
      if (atrVal === null || gapSize > atrVal * 0.1) {
        const fvg: SMCFairValueGap = {
          index: i - 1,
          top: l[i - 2],
          bottom: h[i],
          bias: "bearish",
          filled: false,
          filledIndex: null,
        };
        for (let j = i + 1; j < len; j++) {
          if (h[j] >= fvg.top) {
            fvg.filled = true;
            fvg.filledIndex = j;
            break;
          }
        }
        fvgs.push(fvg);
      }
    }
  }

  return fvgs;
}

/**
 * Detect swing point labels (HH, HL, LH, LL)
 */
function detectSwingPoints(
  pivotHighs: (number | null)[], pivotLows: (number | null)[],
): SMCSwingPoint[] {
  const points: SMCSwingPoint[] = [];
  let lastHigh: number | null = null;
  let lastLow: number | null = null;

  for (let i = 0; i < pivotHighs.length; i++) {
    if (pivotHighs[i] !== null) {
      const price = pivotHighs[i]!;
      let type: SMCSwingPoint["type"];
      if (lastHigh === null) type = "H";
      else type = price > lastHigh ? "HH" : "LH";
      points.push({ index: i, price, type });
      lastHigh = price;
    }
    if (pivotLows[i] !== null) {
      const price = pivotLows[i]!;
      let type: SMCSwingPoint["type"];
      if (lastLow === null) type = "L";
      else type = price > lastLow ? "HL" : "LL";
      points.push({ index: i, price, type });
      lastLow = price;
    }
  }

  return points;
}

/**
 * Determine premium/discount zones based on trailing swing high/low
 */
function detectPremiumDiscount(
  c: number[], h: number[], l: number[],
  pivotHighs: (number | null)[], pivotLows: (number | null)[],
): ("premium" | "discount" | "equilibrium" | null)[] {
  const len = c.length;
  const result: ("premium" | "discount" | "equilibrium" | null)[] = new Array(len).fill(null);

  let trailingHigh = -Infinity;
  let trailingLow = Infinity;

  for (let i = 0; i < len; i++) {
    if (pivotHighs[i] !== null) trailingHigh = pivotHighs[i]!;
    if (pivotLows[i] !== null) trailingLow = pivotLows[i]!;

    // Also update with price action
    if (h[i] > trailingHigh) trailingHigh = h[i];
    if (l[i] < trailingLow) trailingLow = l[i];

    if (trailingHigh === -Infinity || trailingLow === Infinity) continue;

    const range = trailingHigh - trailingLow;
    if (range <= 0) continue;

    const equilibrium = (trailingHigh + trailingLow) / 2;
    const premiumThreshold = equilibrium + range * 0.25;
    const discountThreshold = equilibrium - range * 0.25;

    if (c[i] >= premiumThreshold) result[i] = "premium";
    else if (c[i] <= discountThreshold) result[i] = "discount";
    else result[i] = "equilibrium";
  }

  return result;
}

/**
 * Generate SMC trading signals
 * BUY: Bullish CHoCH or BOS in discount zone, or bullish OB retest
 * SELL: Bearish CHoCH or BOS in premium zone, or bearish OB retest
 */
function generateSMCSignals(
  len: number,
  structures: SMCStructureBreak[],
  premiumDiscount: ("premium" | "discount" | "equilibrium" | null)[],
  _trend: (SMCBias | null)[],
): ("BUY" | "SELL" | null)[] {
  const signals: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  // Structure-based signals
  for (const s of structures) {
    if (s.type === "CHoCH") {
      // CHoCH is a stronger signal (trend reversal)
      if (s.bias === "bullish") {
        signals[s.index] = "BUY";
      } else {
        signals[s.index] = "SELL";
      }
    } else if (s.type === "BOS") {
      // BOS in favorable zone
      const zone = premiumDiscount[s.index];
      if (s.bias === "bullish" && (zone === "discount" || zone === "equilibrium")) {
        signals[s.index] = "BUY";
      } else if (s.bias === "bearish" && (zone === "premium" || zone === "equilibrium")) {
        signals[s.index] = "SELL";
      }
    }
  }

  return signals;
}

export function smartMoneyConcepts(
  klines: KlineData[],
  swingSize = 50,
  internalSize = 5,
): SMCResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const o = klines.map(x => +x.open);
  const len = klines.length;

  // ATR for filtering
  const atrValues = atr(klines, 200);

  // Detect pivots at both swing and internal levels
  const swingPivots = detectPivots(h, l, swingSize);
  const internalPivots = detectPivots(h, l, internalSize);

  // Detect structure
  const swingResult = detectStructure(c, h, l, swingPivots.pivotHighs, swingPivots.pivotLows);
  const internalResult = detectStructure(c, h, l, internalPivots.pivotHighs, internalPivots.pivotLows);

  // Order Blocks
  const swingOBs = detectOrderBlocks(c, o, h, l, swingResult.structures);
  const internalOBs = detectOrderBlocks(c, o, h, l, internalResult.structures);

  // Fair Value Gaps
  const fvgs = detectFairValueGaps(h, l, c, o, atrValues);

  // Swing Points
  const swingPoints = detectSwingPoints(swingPivots.pivotHighs, swingPivots.pivotLows);

  // Premium/Discount
  const premiumDiscount = detectPremiumDiscount(c, h, l, swingPivots.pivotHighs, swingPivots.pivotLows);

  // Signals
  const signal = generateSMCSignals(len, internalResult.structures, premiumDiscount, internalResult.trend);

  return {
    swingTrend: swingResult.trend,
    internalTrend: internalResult.trend,
    swingStructures: swingResult.structures,
    internalStructures: internalResult.structures,
    swingOrderBlocks: swingOBs,
    internalOrderBlocks: internalOBs,
    fairValueGaps: fvgs,
    swingPoints,
    premiumDiscount,
    signal,
  };
}

// ─── Supertrend ──────────────────────────────────────────────────
// Based on PineScript v4 Supertrend indicator — trend-following
// overlay using ATR bands that flip on trend change.

export interface SupertrendResult {
  supertrend: (number | null)[];  // supertrend line value
  trend: (1 | -1 | null)[];      // 1 = uptrend, -1 = downtrend
  upperBand: (number | null)[];   // upper ATR band (dn line)
  lowerBand: (number | null)[];   // lower ATR band (up line)
  signal: ("BUY" | "SELL" | null)[];
}

export function supertrend(
  klines: KlineData[],
  atrPeriod = 10,
  multiplier = 3.0,
): SupertrendResult {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const len = klines.length;

  // ATR calculation (true ATR with EMA-style smoothing)
  const tr: number[] = [];
  for (let i = 0; i < len; i++) {
    if (i === 0) { tr.push(h[i] - l[i]); continue; }
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }

  const atrArr: (number | null)[] = [];
  let atrPrev: number | null = null;
  for (let i = 0; i < len; i++) {
    if (i < atrPeriod - 1) { atrArr.push(null); continue; }
    if (atrPrev === null) {
      let sum = 0;
      for (let j = i - atrPeriod + 1; j <= i; j++) sum += tr[j];
      atrPrev = sum / atrPeriod;
    } else {
      atrPrev = (atrPrev * (atrPeriod - 1) + tr[i]) / atrPeriod;
    }
    atrArr.push(atrPrev);
  }

  // Supertrend calculation
  // src = hl2 = (high + low) / 2
  // up = src - (Multiplier * atr)    → lower band (support in uptrend)
  // dn = src + (Multiplier * atr)    → upper band (resistance in downtrend)
  const supertrendArr: (number | null)[] = new Array(len).fill(null);
  const trendArr: (1 | -1 | null)[] = new Array(len).fill(null);
  const upperBand: (number | null)[] = new Array(len).fill(null);
  const lowerBand: (number | null)[] = new Array(len).fill(null);
  const signalArr: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let prevUp = 0;
  let prevDn = Infinity;
  let prevTrend: 1 | -1 = 1;

  for (let i = 0; i < len; i++) {
    const a = atrArr[i];
    if (a === null) continue;

    const src = (h[i] + l[i]) / 2;
    let up = src - multiplier * a;
    let dn = src + multiplier * a;

    // Adjust bands: up can only go up, dn can only go down (like PineScript)
    // up := close[1] > up1 ? max(up, up1) : up
    if (i > 0 && c[i - 1] > prevUp) {
      up = Math.max(up, prevUp);
    }
    // dn := close[1] < dn1 ? min(dn, dn1) : dn
    if (i > 0 && c[i - 1] < prevDn) {
      dn = Math.min(dn, prevDn);
    }

    // Trend determination
    // trend := trend == -1 and close > dn1 ? 1 : trend == 1 and close < up1 ? -1 : trend
    let trend: 1 | -1 = prevTrend;
    if (prevTrend === -1 && c[i] > prevDn) {
      trend = 1;
    } else if (prevTrend === 1 && c[i] < prevUp) {
      trend = -1;
    }

    lowerBand[i] = up;
    upperBand[i] = dn;
    trendArr[i] = trend;
    supertrendArr[i] = trend === 1 ? up : dn;

    // Buy/Sell signals: trend change
    if (trend === 1 && prevTrend === -1) {
      signalArr[i] = "BUY";
    } else if (trend === -1 && prevTrend === 1) {
      signalArr[i] = "SELL";
    }

    prevUp = up;
    prevDn = dn;
    prevTrend = trend;
  }

  return {
    supertrend: supertrendArr,
    trend: trendArr,
    upperBand,
    lowerBand,
    signal: signalArr,
  };
}

// ─── Compute all indicators for klines ─────────────────────────
export interface AllIndicators {
  rsi: (number | null)[];
  macd: MACDResult;
  ema50: (number | null)[];
  ema200: (number | null)[];
  sma50: (number | null)[];
  bb: BBResult;
  atr: (number | null)[];
  adx: ADXResult;
  obv: number[];
  mfi: (number | null)[];
  vwap: number[];
  ichimoku: IchimokuResult;
  cdcActionZone: CDCActionZoneResult;
  smc: SMCResult;
  cmMacd: CMMAcDResult;
  supertrend: SupertrendResult;
}

export function computeAll(klines: KlineData[], overrides?: {
  rsiPeriod?: number;
  smcSwingSize?: number;
  smcInternalSize?: number;
  cmMacdFast?: number;
  cmMacdSlow?: number;
  cmMacdSignal?: number;
  supertrendPeriod?: number;
  supertrendMultiplier?: number;
}): AllIndicators {
  const c = closes(klines);
  return {
    rsi: rsi(c, overrides?.rsiPeriod ?? 14),
    macd: macd(c, 12, 26, 9),
    ema50: ema(c, 50),
    ema200: ema(c, 200),
    sma50: sma(c, 50),
    bb: bollingerBands(c, 20, 2),
    atr: atr(klines, 14),
    adx: adx(klines, 14),
    obv: obv(klines),
    mfi: mfi(klines, 14),
    vwap: vwap(klines),
    ichimoku: ichimoku(klines),
    cdcActionZone: cdcActionZone(c, 12, 26, 1),
    smc: smartMoneyConcepts(klines, overrides?.smcSwingSize ?? 50, overrides?.smcInternalSize ?? 5),
    cmMacd: cmMacdUltMTF(c, overrides?.cmMacdFast ?? 12, overrides?.cmMacdSlow ?? 26, overrides?.cmMacdSignal ?? 9),
    supertrend: supertrend(klines, overrides?.supertrendPeriod ?? 10, overrides?.supertrendMultiplier ?? 3.0),
  };
}
