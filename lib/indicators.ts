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
}

export function computeAll(klines: KlineData[]): AllIndicators {
  const c = closes(klines);
  return {
    rsi: rsi(c, 14),
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
  };
}
