import { istToday, previousTradingDay } from '../calendar';
import { getInstrument, INSTRUMENTS } from '../instruments';
import type { Candle, SessionData, SessionDay } from '../types';
import { simulatedSession } from './synthetic';

/**
 * Loads a subject's session for a date. Market data fetched by
 * scripts/fetch-session.mjs lives in public/data; any day without it falls back
 * to a simulated session, which the UI labels as such.
 */

/** public/data/index.json */
export interface DataIndex {
  updatedAt: string;
  sessions: Record<string, string[]>;
}

/** public/data/sessions/<date>/<SYMBOL>.json */
export interface SessionFile {
  symbol: string;
  date: string;
  source: string;
  iv?: number;
  prevClose?: number;
  /** Oldest first; the last day is `date`. Candles are [time, open, high, low, close, volume]. */
  days: { date: string; candles: [number, number, number, number, number, number][] }[];
}

let indexPromise: Promise<DataIndex | null> | null = null;

async function fetchJson<T>(url: string, timeoutMs = 5000): Promise<T | null> {
  if (typeof fetch === 'undefined') return null;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { signal: ctrl?.signal, cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function loadIndex(): Promise<DataIndex | null> {
  if (!indexPromise) indexPromise = fetchJson<DataIndex>('data/index.json');
  return indexPromise;
}

export function knownSessionDates(index: DataIndex | null): Set<string> {
  return new Set(Object.keys(index?.sessions ?? {}));
}

const toCandles = (rows: SessionFile['days'][number]['candles']): Candle[] =>
  rows.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));

export function parseSessionFile(file: SessionFile): SessionData | null {
  if (!file?.days?.length) return null;
  const inst = getInstrument(file.symbol);
  const days: SessionDay[] = file.days.map((d) => ({ date: d.date, candles: toCandles(d.candles) }));
  const today = days[days.length - 1];
  if (today.date !== file.date || today.candles.length < 30) return null;
  const history = days.slice(0, -1).filter((d) => d.candles.length > 0);
  const prev = history[history.length - 1];
  return {
    symbol: file.symbol,
    date: file.date,
    candles: today.candles,
    history,
    prevClose: file.prevClose ?? (prev ? prev.candles[prev.candles.length - 1].close : today.candles[0].open),
    iv: file.iv && file.iv > 0.01 ? file.iv : inst.defaultIv,
    source: 'market',
    sourceLabel: file.source,
  };
}

const sessionCache = new Map<string, Promise<SessionData>>();

export function loadSession(symbol: string, date: string): Promise<SessionData> {
  const key = `${date}|${symbol}`;
  let p = sessionCache.get(key);
  if (!p) {
    p = (async () => {
      const index = await loadIndex();
      if (index?.sessions[date]?.includes(symbol)) {
        const file = await fetchJson<SessionFile>(`data/sessions/${date}/${symbol}.json`);
        const parsed = file ? parseSessionFile(file) : null;
        if (parsed) return parsed;
      }
      return simulatedSession(getInstrument(symbol), date);
    })();
    sessionCache.set(key, p);
  }
  return p;
}

/** Whether a day/subject will replay real market data. */
export function hasMarketData(index: DataIndex | null, date: string, symbol: string): boolean {
  return !!index?.sessions[date]?.includes(symbol);
}

/** The game day is the previous trading day, plus a few earlier days to catch up on. */
export function recentGameDays(index: DataIndex | null, count = 5, now = new Date()): string[] {
  const known = knownSessionDates(index);
  const days: string[] = [];
  let d = istToday(now);
  for (let i = 0; i < count; i++) {
    d = previousTradingDay(d, known);
    days.push(d);
  }
  return days;
}

export const SUBJECTS = INSTRUMENTS.map((i) => i.id);
