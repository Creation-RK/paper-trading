import { createRng } from '../rng';
import { istEpoch, nextTradingDay, previousTradingDay } from '../calendar';
import { Instrument, roundToTick, sessionMinutes } from '../instruments';
import type { Candle, SessionData, SessionDay } from '../types';

/**
 * Simulated sessions: used when no fetched market data exists for a day.
 * Every value is derived from a seed of (symbol, date), so the same day replays
 * identically on every device and consecutive days chain close-to-open.
 */

const ANCHOR_DATE = '2026-01-01';
const closeCache = new Map<string, number>();

function dailyReturn(inst: Instrument, date: string): number {
  const rng = createRng(`ret|${inst.id}|${date}`);
  const vol = inst.sim.dailyVol * (rng.next() < 0.1 ? 2 : 1);
  const r = rng.normal() * vol;
  const cap = inst.sim.dailyVol * 3;
  return Math.max(-cap, Math.min(cap, r));
}

/** Closing price of a simulated trading day. */
export function simulatedClose(inst: Instrument, date: string): number {
  const key = `${inst.id}|${date}`;
  const cached = closeCache.get(key);
  if (cached !== undefined) return cached;
  let price = inst.sim.anchorPrice;
  if (date >= ANCHOR_DATE) {
    let d = ANCHOR_DATE;
    while (d < date) {
      d = nextTradingDay(d);
      price *= 1 + dailyReturn(inst, d);
    }
  } else {
    let d = ANCHOR_DATE;
    while (d > date) {
      price /= 1 + dailyReturn(inst, d);
      d = previousTradingDay(d);
    }
  }
  closeCache.set(key, price);
  return price;
}

function bumpFactor(inst: Instrument, date: string, minuteStart: number): number {
  let f = 1;
  for (const b of inst.sim.bumps ?? []) {
    const at = istEpoch(date, b.at);
    const since = (minuteStart - at) / 60;
    if (since >= 0) f = Math.max(f, 1 + (b.factor - 1) * Math.exp(-since / 25));
  }
  return f;
}

export function simulateDay(inst: Instrument, date: string): SessionDay {
  const n = sessionMinutes(inst);
  const start = istEpoch(date, inst.session.open);
  const prevClose = simulatedClose(inst, previousTradingDay(date));
  const close = simulatedClose(inst, date);
  const rng = createRng(`day|${inst.id}|${date}`);
  const dv = inst.sim.dailyVol;
  const open = prevClose * (1 + rng.normal() * dv * 0.35);
  const baseSigma = (dv / Math.sqrt(n)) * 0.85;

  // Split the day into regimes: trends that run for a while, and choppy ranges.
  const regimeCount = 3 + Math.floor(rng.next() * 3);
  const cuts = Array.from({ length: regimeCount - 1 }, () => Math.floor(rng.range(0.1, 0.9) * n)).sort((a, b) => a - b);
  const bounds = [0, ...cuts, n];
  const drift = new Float64Array(n);
  const chop = new Uint8Array(n);
  for (let k = 0; k < bounds.length - 1; k++) {
    const len = Math.max(1, bounds[k + 1] - bounds[k]);
    const isChop = rng.next() < 0.4;
    const move = isChop ? 0 : rng.normal() * dv * 0.55;
    for (let i = bounds[k]; i < bounds[k + 1]; i++) {
      drift[i] = move / len;
      chop[i] = isChop ? 1 : 0;
    }
  }

  const sigma = new Float64Array(n);
  const x = new Float64Array(n + 1);
  x[0] = Math.log(open);
  let anchor = x[0];
  for (let i = 0; i < n; i++) {
    if (i > 0 && chop[i] && !chop[i - 1]) anchor = x[i];
    const uShape = 1 + 1.4 * Math.exp(-i / 18) + 0.6 * Math.exp(-(n - i) / 25);
    sigma[i] = baseSigma * uShape * bumpFactor(inst, date, start + i * 60);
    const shock = rng.next() < 0.015 ? 3 : 1;
    const pull = chop[i] ? (anchor - x[i]) * 0.04 : 0;
    x[i + 1] = x[i] + drift[i] + pull + sigma[i] * rng.normal() * shock;
  }
  // Bend the path so the session ends exactly at the day's close.
  const miss = Math.log(close) - x[n];
  for (let i = 1; i <= n; i++) x[i] += (miss * i) / n;

  const tick = inst.tickSize;
  const candles: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const o = roundToTick(Math.exp(x[i]), tick);
    const c = roundToTick(Math.exp(x[i + 1]), tick);
    const wick = () => Math.abs(rng.normal()) * sigma[i] * 0.7 * o;
    const h = roundToTick(Math.max(o, c) + wick(), tick);
    const l = roundToTick(Math.min(o, c) - wick(), tick);
    const move = Math.abs(x[i + 1] - x[i]) / sigma[i];
    const uShape = 1 + 1.6 * Math.exp(-i / 20) + 0.8 * Math.exp(-(n - i) / 30);
    const volume = Math.round(inst.sim.volumeBase * uShape * Math.exp(rng.normal() * 0.35) * (1 + 0.3 * move));
    candles.push({ time: start + i * 60, open: o, high: h, low: l, close: c, volume });
  }
  return { date, candles };
}

export function simulatedSession(inst: Instrument, date: string, historyDays = 2): SessionData {
  const history: SessionDay[] = [];
  let d = date;
  for (let k = 0; k < historyDays; k++) {
    d = previousTradingDay(d);
    history.unshift(simulateDay(inst, d));
  }
  const ivRng = createRng(`iv|${inst.id}|${date}`);
  const today = simulateDay(inst, date);
  const prevDay = history[history.length - 1];
  return {
    symbol: inst.id,
    date,
    candles: today.candles,
    history,
    prevClose: prevDay ? prevDay.candles[prevDay.candles.length - 1].close : today.candles[0].open,
    iv: inst.defaultIv * (0.85 + 0.3 * ivRng.next()),
    source: 'simulated',
    sourceLabel: 'Simulated session',
  };
}
