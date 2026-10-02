import { istDateOf, istEpoch } from '../calendar';
import type { Instrument } from '../instruments';
import type { Candle } from '../types';

/** Chart timeframes in minutes. 15, 25, 75 and 125 split the NIFTY day (375 min) evenly. */
export const TIMEFRAMES = [1, 3, 5, 15, 25, 75, 125];

export function timeframeLabel(min: number): string {
  return min >= 60 && min % 60 === 0 ? `${min / 60}h` : `${min}m`;
}

/** Start of the bucket a timestamp falls in. Buckets are aligned to each day's session open. */
export function bucketStart(time: number, tfMin: number, inst: Instrument, openCache?: Map<string, number>): number {
  const date = istDateOf(time);
  let open = openCache?.get(date);
  if (open === undefined) {
    open = istEpoch(date, inst.session.open);
    openCache?.set(date, open);
  }
  const tf = tfMin * 60;
  return open + Math.floor((time - open) / tf) * tf;
}

/** Build N-minute candles from 1-minute candles. The last bucket may still be forming. */
export function aggregate(base: Candle[], tfMin: number, inst: Instrument): Candle[] {
  if (tfMin <= 1) return base;
  const opens = new Map<string, number>();
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of base) {
    const key = bucketStart(c.time, tfMin, inst, opens);
    if (!cur || cur.time !== key) {
      cur = { time: key, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
      out.push(cur);
    } else {
      if (c.high > cur.high) cur.high = c.high;
      if (c.low < cur.low) cur.low = c.low;
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  return out;
}

export function heikinAshi(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const close = (c.open + c.high + c.low + c.close) / 4;
    const open = i === 0 ? (c.open + c.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({
      time: c.time,
      open,
      close,
      high: Math.max(c.high, open, close),
      low: Math.min(c.low, open, close),
      volume: c.volume,
    });
  }
  return out;
}
