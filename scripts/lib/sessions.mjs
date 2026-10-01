// Pure helpers that turn Yahoo Finance chart responses into the app's session files.
// Kept free of I/O so they can be unit-tested (scripts/lib/sessions.test.mjs).

export const IST_OFFSET_SEC = 19800;

export function istDate(epoch) {
  return new Date((epoch + IST_OFFSET_SEC) * 1000).toISOString().slice(0, 10);
}

export function istEpoch(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) / 1000 - IST_OFFSET_SEC;
}

/** Yahoo /v8/finance/chart JSON -> 1-minute candles, skipping empty rows. */
export function chartToCandles(json) {
  const result = json?.chart?.result?.[0];
  if (!result?.timestamp) return [];
  const q = result.indicators?.quote?.[0] ?? {};
  const out = [];
  result.timestamp.forEach((t, i) => {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if ([o, h, l, c].some((v) => v === null || v === undefined || !Number.isFinite(v))) return;
    out.push({ time: Math.floor(t / 60) * 60, open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
  });
  // Yahoo occasionally repeats the live minute; keep the last copy.
  const byTime = new Map(out.map((c) => [c.time, c]));
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Daily closes keyed by date (for India VIX / OVX). */
export function chartToDailyCloses(json) {
  const result = json?.chart?.result?.[0];
  const closes = new Map();
  if (!result?.timestamp) return closes;
  const c = result.indicators?.quote?.[0]?.close ?? [];
  result.timestamp.forEach((t, i) => {
    if (Number.isFinite(c[i])) closes.set(istDate(t), c[i]);
  });
  return closes;
}

/** Latest value on or before a date. */
export function valueOnOrBefore(map, date) {
  let best = null;
  for (const [d, v] of map) if (d <= date && (!best || d > best[0])) best = [d, v];
  return best ? best[1] : null;
}

/** Multiply prices by the FX rate in force at each minute (e.g. USD crude -> INR). */
export function convertCurrency(candles, fxCandles) {
  if (!fxCandles.length) return [];
  const out = [];
  let j = 0;
  let rate = null;
  for (const c of candles) {
    while (j < fxCandles.length && fxCandles[j].time <= c.time) rate = fxCandles[j++].close;
    const r = rate ?? fxCandles[0].close;
    out.push({ ...c, open: c.open * r, high: c.high * r, low: c.low * r, close: c.close * r });
  }
  return out;
}

const roundTo = (v, tick) => {
  const decimals = Math.max(0, -Math.floor(Math.log10(tick)) + 1);
  return Number((Math.round(v / tick) * tick).toFixed(decimals));
};

/**
 * Split candles into IST trading days, keep only the exchange session, and fill
 * missing minutes with flat candles. Days with less than `minCoverage` of the
 * session's minutes are dropped as incomplete.
 */
export function splitSessions(candles, { open, close, tick, minCoverage = 0.6 }) {
  const byDate = new Map();
  for (const c of candles) {
    const d = istDate(c.time);
    if (c.time < istEpoch(d, open) || c.time >= istEpoch(d, close)) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(c);
  }
  const days = new Map();
  for (const [date, list] of [...byDate.entries()].sort()) {
    const start = istEpoch(date, open);
    const minutes = (istEpoch(date, close) - start) / 60;
    if (list.length < minutes * minCoverage) continue;
    const byTime = new Map(list.map((c) => [c.time, c]));
    const filled = [];
    let prev = list[0].open;
    for (let i = 0; i < minutes; i++) {
      const t = start + i * 60;
      const c = byTime.get(t);
      if (c) {
        filled.push([t, roundTo(c.open, tick), roundTo(Math.max(c.high, c.open, c.close), tick), roundTo(Math.min(c.low, c.open, c.close), tick), roundTo(c.close, tick), Math.round(c.volume || 0)]);
        prev = c.close;
      } else {
        const p = roundTo(prev, tick);
        filled.push([t, p, p, p, p, 0]);
      }
    }
    days.set(date, filled);
  }
  return days;
}

/** The session file for `date`, carrying up to `historyDays` earlier days for indicator warm-up. */
export function buildSessionFile({ symbol, date, days, source, iv, historyDays = 2 }) {
  const dates = [...days.keys()].sort().filter((d) => d <= date);
  if (dates[dates.length - 1] !== date) return null;
  const picked = dates.slice(-(historyDays + 1));
  const prev = picked.length > 1 ? days.get(picked[picked.length - 2]) : null;
  return {
    symbol,
    date,
    source,
    ...(iv ? { iv: Number(iv.toFixed(4)) } : {}),
    ...(prev ? { prevClose: prev[prev.length - 1][4] } : {}),
    days: picked.map((d) => ({ date: d, candles: days.get(d) })),
  };
}
