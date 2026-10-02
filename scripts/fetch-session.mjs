#!/usr/bin/env node
// Downloads the latest completed sessions for every subject and writes them where
// the app looks for market data:
//   public/data/sessions/<YYYY-MM-DD>/<SYMBOL>.json
//   public/data/index.json
//
// Source: Yahoo Finance's public chart API (1-minute bars for the last 7 days).
//   NIFTY50  <- ^NSEI (NSE NIFTY 50 index); option IV from ^INDIAVIX
//   CRUDEOIL <- CL=F (NYMEX WTI) x INR=X (USD/INR), a proxy for NSE/MCX crude in rupees; IV from ^OVX
//
// Usage: node scripts/fetch-session.mjs [--keep 30]
// Runs daily from .github/workflows/fetch-market-data.yml.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSessionFile, chartToCandles, chartToDailyCloses, convertCurrency, istDate, splitSessions, valueOnOrBefore } from './lib/sessions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');

const SUBJECTS = [
  {
    id: 'NIFTY50',
    yahoo: '^NSEI',
    session: { open: '09:15', close: '15:30', tick: 0.05 },
    vol: '^INDIAVIX',
    source: 'NSE NIFTY 50 index, 1-minute bars (Yahoo Finance)',
  },
  {
    id: 'CRUDEOIL',
    yahoo: 'CL=F',
    fx: 'INR=X',
    session: { open: '09:00', close: '23:30', tick: 1 },
    vol: '^OVX',
    source: 'WTI crude futures × USD/INR, 1-minute bars (Yahoo Finance), in ₹ per barrel',
  },
];

const args = process.argv.slice(2);
const keepDays = Number(args[args.indexOf('--keep') + 1]) || 30;

async function chart(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (paper-scalper data fetch)' } });
      if (res.ok) return await res.json();
      console.warn(`${symbol}: HTTP ${res.status} (attempt ${attempt})`);
    } catch (err) {
      console.warn(`${symbol}: ${err.message} (attempt ${attempt})`);
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
  }
  throw new Error(`Could not download ${symbol}`);
}

async function readIndex() {
  try {
    return JSON.parse(await readFile(join(ROOT, 'index.json'), 'utf8'));
  } catch {
    return { updatedAt: null, sessions: {} };
  }
}

async function main() {
  const today = istDate(Math.floor(Date.now() / 1000));
  const index = await readIndex();
  index.sessions ??= {};
  let written = 0;

  for (const s of SUBJECTS) {
    try {
      let candles = chartToCandles(await chart(s.yahoo, '1m', '7d'));
      if (s.fx) candles = convertCurrency(candles, chartToCandles(await chart(s.fx, '1m', '7d')));
      const days = splitSessions(candles, s.session);
      const vol = s.vol ? chartToDailyCloses(await chart(s.vol, '1d', '1mo')) : new Map();
      for (const date of days.keys()) {
        if (date >= today) continue; // only finished sessions
        const v = valueOnOrBefore(vol, date);
        const file = buildSessionFile({ symbol: s.id, date, days, source: s.source, iv: v ? v / 100 : null });
        if (!file) continue;
        await mkdir(join(ROOT, 'sessions', date), { recursive: true });
        await writeFile(join(ROOT, 'sessions', date, `${s.id}.json`), JSON.stringify(file));
        index.sessions[date] = [...new Set([...(index.sessions[date] ?? []), s.id])].sort();
        written++;
        console.log(`${s.id} ${date}: ${file.days.at(-1).candles.length} bars, ${file.days.length - 1} history days, IV ${file.iv ?? 'default'}`);
      }
    } catch (err) {
      console.error(`${s.id}: ${err.message}`);
    }
  }

  // Keep the repository small: drop sessions older than --keep days.
  const dates = Object.keys(index.sessions).sort();
  for (const d of dates.slice(0, Math.max(0, dates.length - keepDays))) {
    delete index.sessions[d];
    await rm(join(ROOT, 'sessions', d), { recursive: true, force: true });
  }

  index.updatedAt = new Date().toISOString();
  index.sessions = Object.fromEntries(Object.entries(index.sessions).sort());
  await writeFile(join(ROOT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Wrote ${written} session files.`);
  if (!written) process.exitCode = 1;
}

main();
