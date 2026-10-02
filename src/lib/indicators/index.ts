import { istDateOf, istEpoch } from '../calendar';
import type { Instrument } from '../instruments';
import type { Candle } from '../types';
import { ema, highest, lowest, rma, Series, sma, stdev, zip } from './math';

export type { Series } from './math';

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface OutputSpec {
  key: string;
  label: string;
  color: string;
  /** `hidden` outputs are not drawn but can be used in system rules. */
  style: 'line' | 'dashed' | 'histogram' | 'hidden';
  /** The main line, named in rules by the indicator name alone. */
  primary?: boolean;
}

export interface IndicatorContext {
  /** Candles at the chart timeframe (last one may be forming). */
  candles: Candle[];
  /** The underlying 1-minute candles, used by session-anchored studies. */
  base: Candle[];
  tfSec: number;
  inst: Instrument;
}

export interface IndicatorDef {
  type: string;
  name: string;
  description: string;
  placement: 'overlay' | 'pane';
  params: ParamSpec[];
  outputs: OutputSpec[];
  levels?: number[];
  label(p: Record<string, number>): string;
  compute(ctx: IndicatorContext, p: Record<string, number>): Record<string, Series>;
}

/** An indicator added to a system, with the player's settings. */
export interface IndicatorInstance {
  id: string;
  type: string;
  params: Record<string, number>;
  colors: Record<string, string>;
  visible: boolean;
}

const closes = (c: Candle[]): Series => c.map((x) => x.close);

/** Map a per-1m-candle series onto chart candles by taking the value at each bucket's last minute. */
function sampleToChart(values: Series, base: Candle[], candles: Candle[], tfSec: number): Series {
  const out: Series = new Array(candles.length).fill(null);
  let j = 0;
  for (let i = 0; i < candles.length; i++) {
    const end = candles[i].time + tfSec;
    let last: number | null = null;
    while (j < base.length && base[j].time < end) {
      if (base[j].time >= candles[i].time) last = values[j];
      j++;
    }
    out[i] = last;
  }
  return out;
}

function trueRange(c: Candle[]): Series {
  return c.map((x, i) =>
    i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)),
  );
}

const EMA: IndicatorDef = {
  type: 'ema',
  name: 'EMA',
  description: 'Exponential moving average of the close.',
  placement: 'overlay',
  params: [{ key: 'length', label: 'Length', min: 1, max: 200, step: 1, default: 9 }],
  outputs: [{ key: 'value', label: 'EMA', color: '#e3a020', style: 'line' }],
  label: (p) => `EMA (${p.length})`,
  compute: (ctx, p) => ({ value: ema(closes(ctx.candles), p.length) }),
};

const SMA: IndicatorDef = {
  type: 'sma',
  name: 'SMA',
  description: 'Simple moving average of the close.',
  placement: 'overlay',
  params: [{ key: 'length', label: 'Length', min: 1, max: 200, step: 1, default: 20 }],
  outputs: [{ key: 'value', label: 'SMA', color: '#b46be0', style: 'line' }],
  label: (p) => `SMA (${p.length})`,
  compute: (ctx, p) => ({ value: sma(closes(ctx.candles), p.length) }),
};

const VWAP: IndicatorDef = {
  type: 'vwap',
  name: 'VWAP (Session)',
  description: 'Volume-weighted average price, reset at every session open. Index data has no volume, so each minute counts equally there.',
  placement: 'overlay',
  params: [],
  outputs: [{ key: 'value', label: 'VWAP', color: '#3d64e0', style: 'line' }],
  label: () => 'VWAP (Session)',
  compute: (ctx) => {
    const vals: Series = [];
    let day = '';
    let pv = 0;
    let vol = 0;
    for (const c of ctx.base) {
      const d = istDateOf(c.time);
      if (d !== day) {
        day = d;
        pv = 0;
        vol = 0;
      }
      const w = c.volume > 0 ? c.volume : 1;
      pv += ((c.high + c.low + c.close) / 3) * w;
      vol += w;
      vals.push(pv / vol);
    }
    return { value: sampleToChart(vals, ctx.base, ctx.candles, ctx.tfSec) };
  },
};

const ORB: IndicatorDef = {
  type: 'orb',
  name: 'ORB',
  description: 'Opening range breakout: the high and low of the first minutes of each session.',
  placement: 'overlay',
  params: [{ key: 'minutes', label: 'Opening range (min)', min: 5, max: 120, step: 5, default: 15 }],
  outputs: [
    { key: 'high', label: 'High', color: '#2f9e6e', style: 'line' },
    { key: 'low', label: 'Low', color: '#d64553', style: 'line' },
  ],
  label: (p) => (p.minutes === 15 ? 'ORB' : `ORB (${p.minutes}m)`),
  compute: (ctx, p) => {
    const ranges = new Map<string, { end: number; high: number; low: number; complete: boolean }>();
    for (const c of ctx.base) {
      const d = istDateOf(c.time);
      let r = ranges.get(d);
      if (!r) {
        r = { end: istEpoch(d, ctx.inst.session.open) + p.minutes * 60, high: -Infinity, low: Infinity, complete: false };
        ranges.set(d, r);
      }
      if (c.time < r.end) {
        r.high = Math.max(r.high, c.high);
        r.low = Math.min(r.low, c.low);
      }
      if (c.time + 60 >= r.end) r.complete = true;
    }
    const high: Series = [];
    const low: Series = [];
    for (const c of ctx.candles) {
      const r = ranges.get(istDateOf(c.time));
      const show = r && r.complete && c.time + ctx.tfSec >= r.end;
      high.push(show ? r.high : null);
      low.push(show ? r.low : null);
    }
    return { high, low };
  },
};

const URSI: IndicatorDef = {
  type: 'ursi',
  name: 'Ultimate RSI',
  description: 'RSI built on range expansion (LuxAlgo). Faster to turn than a classic RSI, with a smoothed signal line.',
  placement: 'pane',
  params: [
    { key: 'length', label: 'Length', min: 2, max: 100, step: 1, default: 14 },
    { key: 'smooth', label: 'Signal smoothing', min: 1, max: 100, step: 1, default: 14 },
  ],
  outputs: [
    { key: 'value', label: 'URSI', color: '#1fa392', style: 'line', primary: true },
    { key: 'signal', label: 'Signal', color: '#f26b1d', style: 'line' },
  ],
  levels: [80, 50, 20],
  label: () => 'Ultimate RSI',
  compute: (ctx, p) => {
    const src = closes(ctx.candles);
    const upper = highest(src, p.length);
    const lower = lowest(src, p.length);
    const diff: Series = src.map((s, i) => {
      if (i === 0 || upper[i] === null || lower[i] === null || s === null) return null;
      const u = upper[i] as number;
      const l = lower[i] as number;
      const r = u - l;
      if (upper[i - 1] !== null && u > (upper[i - 1] as number)) return r;
      if (lower[i - 1] !== null && l < (lower[i - 1] as number)) return -r;
      return s - (src[i - 1] as number);
    });
    const num = rma(diff, p.length);
    const den = rma(
      diff.map((d) => (d === null ? null : Math.abs(d))),
      p.length,
    );
    const value = zip(num, den, (n, d) => (d === 0 ? 50 : (n / d) * 50 + 50));
    return { value, signal: ema(value, p.smooth) };
  },
};

const RSI: IndicatorDef = {
  type: 'rsi',
  name: 'RSI',
  description: 'Classic Wilder relative strength index.',
  placement: 'pane',
  params: [{ key: 'length', label: 'Length', min: 2, max: 100, step: 1, default: 14 }],
  outputs: [{ key: 'value', label: 'RSI', color: '#8b6cf0', style: 'line' }],
  levels: [70, 50, 30],
  label: (p) => `RSI (${p.length})`,
  compute: (ctx, p) => {
    const src = closes(ctx.candles);
    const ch = src.map((v, i) => (i === 0 ? null : (v as number) - (src[i - 1] as number)));
    const up = rma(
      ch.map((d) => (d === null ? null : Math.max(d, 0))),
      p.length,
    );
    const down = rma(
      ch.map((d) => (d === null ? null : Math.max(-d, 0))),
      p.length,
    );
    return { value: zip(up, down, (u, d) => (d === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / d))) };
  },
};

const SUPERTREND: IndicatorDef = {
  type: 'supertrend',
  name: 'Supertrend',
  description: 'ATR trailing line that flips with the trend. Direction is +1 in an uptrend and -1 in a downtrend.',
  placement: 'overlay',
  params: [
    { key: 'period', label: 'ATR period', min: 1, max: 100, step: 1, default: 10 },
    { key: 'multiplier', label: 'Multiplier', min: 0.5, max: 10, step: 0.5, default: 3 },
  ],
  outputs: [
    { key: 'up', label: 'Up trend', color: '#2f9e6e', style: 'line' },
    { key: 'down', label: 'Down trend', color: '#d64553', style: 'line' },
    { key: 'value', label: 'Line', color: '#888888', style: 'hidden', primary: true },
    { key: 'direction', label: 'Direction', color: '#888888', style: 'hidden' },
  ],
  label: (p) => `Supertrend (${p.period}, ${p.multiplier})`,
  compute: (ctx, p) => {
    const c = ctx.candles;
    const atr = rma(trueRange(c), p.period);
    const up: Series = [];
    const down: Series = [];
    const value: Series = [];
    const direction: Series = [];
    let prevUpper = 0;
    let prevLower = 0;
    let prevSt: number | null = null;
    for (let i = 0; i < c.length; i++) {
      const a = atr[i];
      if (a === null) {
        up.push(null);
        down.push(null);
        value.push(null);
        direction.push(null);
        continue;
      }
      const hl2 = (c[i].high + c[i].low) / 2;
      let upper = hl2 + p.multiplier * a;
      let lower = hl2 - p.multiplier * a;
      const prevClose = i > 0 ? c[i - 1].close : c[i].close;
      if (prevSt !== null) {
        lower = lower > prevLower || prevClose < prevLower ? lower : prevLower;
        upper = upper < prevUpper || prevClose > prevUpper ? upper : prevUpper;
      }
      let dir: number;
      if (prevSt === null) dir = 1;
      else if (prevSt === prevUpper) dir = c[i].close > upper ? -1 : 1;
      else dir = c[i].close < lower ? 1 : -1;
      const st = dir === -1 ? lower : upper;
      up.push(dir === -1 ? st : null);
      down.push(dir === 1 ? st : null);
      value.push(st);
      direction.push(dir === -1 ? 1 : -1);
      prevUpper = upper;
      prevLower = lower;
      prevSt = st;
    }
    return { up, down, value, direction };
  },
};

const BOLLINGER: IndicatorDef = {
  type: 'bb',
  name: 'Bollinger Bands',
  description: 'Moving average with bands a number of standard deviations away.',
  placement: 'overlay',
  params: [
    { key: 'length', label: 'Length', min: 2, max: 200, step: 1, default: 20 },
    { key: 'mult', label: 'Std dev', min: 0.5, max: 5, step: 0.5, default: 2 },
  ],
  outputs: [
    { key: 'upper', label: 'Upper', color: '#4f7fe8', style: 'line' },
    { key: 'basis', label: 'Basis', color: '#d9822b', style: 'dashed' },
    { key: 'lower', label: 'Lower', color: '#4f7fe8', style: 'line' },
  ],
  label: (p) => `BB (${p.length}, ${p.mult})`,
  compute: (ctx, p) => {
    const src = closes(ctx.candles);
    const basis = sma(src, p.length);
    const dev = stdev(src, p.length);
    return {
      upper: zip(basis, dev, (b, d) => b + p.mult * d),
      basis,
      lower: zip(basis, dev, (b, d) => b - p.mult * d),
    };
  },
};

const MACD: IndicatorDef = {
  type: 'macd',
  name: 'MACD',
  description: 'Difference of two EMAs with a signal line and histogram.',
  placement: 'pane',
  params: [
    { key: 'fast', label: 'Fast', min: 1, max: 100, step: 1, default: 12 },
    { key: 'slow', label: 'Slow', min: 2, max: 200, step: 1, default: 26 },
    { key: 'signal', label: 'Signal', min: 1, max: 100, step: 1, default: 9 },
  ],
  outputs: [
    { key: 'macd', label: 'MACD', color: '#3d64e0', style: 'line', primary: true },
    { key: 'signal', label: 'Signal', color: '#f26b1d', style: 'line' },
    { key: 'hist', label: 'Histogram', color: '#8a93a6', style: 'histogram' },
  ],
  levels: [0],
  label: (p) => `MACD (${p.fast}, ${p.slow}, ${p.signal})`,
  compute: (ctx, p) => {
    const src = closes(ctx.candles);
    const macd = zip(ema(src, p.fast), ema(src, p.slow), (a, b) => a - b);
    const signal = ema(macd, p.signal);
    return { macd, signal, hist: zip(macd, signal, (a, b) => a - b) };
  },
};

export const INDICATORS: IndicatorDef[] = [EMA, SMA, VWAP, ORB, SUPERTREND, BOLLINGER, URSI, RSI, MACD];

export function getIndicatorDef(type: string): IndicatorDef {
  const def = INDICATORS.find((d) => d.type === type);
  if (!def) throw new Error(`Unknown indicator ${type}`);
  return def;
}

let counter = 0;
export function newIndicator(type: string, params: Partial<Record<string, number>> = {}): IndicatorInstance {
  const def = getIndicatorDef(type);
  const full: Record<string, number> = {};
  for (const ps of def.params) full[ps.key] = params[ps.key] ?? ps.default;
  const colors: Record<string, string> = {};
  for (const o of def.outputs) colors[o.key] = o.color;
  counter = (counter + 1) % 1e6;
  return { id: `${type}-${Date.now().toString(36)}${counter.toString(36)}`, type, params: full, colors, visible: true };
}

export function indicatorLabel(inst: IndicatorInstance): string {
  return getIndicatorDef(inst.type).label(inst.params);
}

export type IndicatorValues = Record<string, Record<string, Series>>;

/** Run every indicator of a system against the same candles. Keyed by instance id, then output. */
export function computeIndicators(instances: IndicatorInstance[], ctx: IndicatorContext): IndicatorValues {
  const out: IndicatorValues = {};
  for (const inst of instances) out[inst.id] = getIndicatorDef(inst.type).compute(ctx, inst.params);
  return out;
}
