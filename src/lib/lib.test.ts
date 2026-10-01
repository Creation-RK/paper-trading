import { describe, expect, it } from 'vitest';
import { istClock, istDateOf, istEpoch, isTradingDay, previousTradingDay } from './calendar';
import { getInstrument, sessionMinutes } from './instruments';
import { aggregate, heikinAshi } from './market/aggregate';
import { simulatedSession, simulateDay } from './market/synthetic';
import { parseSessionFile } from './market/provider';
import { computeIndicators, getIndicatorDef, newIndicator } from './indicators';
import { ema, rma, sma } from './indicators/math';
import { atmStrike, blackScholes, nearestExpiry, RISK_FREE_RATE } from './options';
import { defaultSystem, evaluateRule, evaluateSetup, newRule, pruneRules, ruleLabel, signalMatch } from './system';
import { bestPossibleRoi, profileStats, tradeResult } from './scoring';
import { checkExit, dayClock, planLevels } from './replay';
import type { Candle, Trade } from './types';

const nifty = getInstrument('NIFTY50');
const crude = getInstrument('CRUDEOIL');

const flat = (closes: number[], start = istEpoch('2026-09-30', '09:15')): Candle[] =>
  closes.map((c, i) => ({ time: start + i * 60, open: c, high: c + 1, low: c - 1, close: c, volume: 0 }));

describe('calendar', () => {
  it('converts IST wall-clock times', () => {
    const t = istEpoch('2026-09-30', '09:15');
    expect(new Date(t * 1000).toISOString()).toBe('2026-09-30T03:45:00.000Z');
    expect(istClock(t)).toBe('09:15');
    expect(istDateOf(istEpoch('2026-09-30', '23:30'))).toBe('2026-09-30');
  });

  it('skips weekends and fixed holidays', () => {
    expect(isTradingDay('2026-10-02')).toBe(false); // Gandhi Jayanti
    expect(previousTradingDay('2026-10-05')).toBe('2026-10-01');
    expect(previousTradingDay('2026-10-01')).toBe('2026-09-30');
    expect(previousTradingDay('2026-10-04', new Set(['2026-10-02']))).toBe('2026-10-02');
  });
});

describe('simulated sessions', () => {
  it('is deterministic and covers the full session', () => {
    const a = simulateDay(nifty, '2026-09-30');
    const b = simulateDay(nifty, '2026-09-30');
    expect(a.candles).toEqual(b.candles);
    expect(a.candles).toHaveLength(375);
    expect(simulateDay(crude, '2026-09-30').candles).toHaveLength(sessionMinutes(crude));
    for (const c of a.candles) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    }
  });

  it('chains days and carries history', () => {
    const s = simulatedSession(nifty, '2026-09-30');
    expect(s.history.map((d) => d.date)).toEqual(['2026-09-28', '2026-09-29']);
    const prev = s.history[1].candles;
    expect(s.prevClose).toBe(prev[prev.length - 1].close);
    expect(s.source).toBe('simulated');
    expect(Math.abs(s.candles[0].open / s.prevClose - 1)).toBeLessThan(0.05);
  });
});

describe('aggregation', () => {
  it('builds session-aligned buckets', () => {
    const day = simulateDay(nifty, '2026-09-30').candles;
    const h125 = aggregate(day, 125, nifty);
    expect(h125.map((c) => istClock(c.time))).toEqual(['09:15', '11:20', '13:25']);
    expect(h125[0].high).toBe(Math.max(...day.slice(0, 125).map((c) => c.high)));
    expect(h125[2].close).toBe(day[374].close);
    expect(aggregate(day, 15, nifty)).toHaveLength(25);
    expect(heikinAshi(h125)).toHaveLength(3);
  });
});

describe('indicator maths', () => {
  it('seeds EMA and RMA with an SMA', () => {
    const src = [1, 2, 3, 4, 5, 6];
    expect(sma(src, 3)).toEqual([null, null, 2, 3, 4, 5]);
    const e = ema(src, 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
    expect(rma(src, 3)[3]).toBeCloseTo(2 + (4 - 2) / 3);
  });

  it('computes RSI, Ultimate RSI, VWAP and ORB', () => {
    const rising = flat(Array.from({ length: 40 }, (_, i) => 100 + i));
    const ctx = { candles: rising, base: rising, tfSec: 60, inst: nifty };
    const rsi = getIndicatorDef('rsi').compute(ctx, { length: 14 }).value;
    expect(rsi[39]).toBe(100);
    const ursi = getIndicatorDef('ursi').compute(ctx, { length: 14, smooth: 14 });
    expect(ursi.value[39]).toBeCloseTo(100);
    const vwap = getIndicatorDef('vwap').compute(ctx, {}).value;
    expect(vwap[2]).toBeCloseTo((100 + 101 + 102) / 3);
    const orb = getIndicatorDef('orb').compute(ctx, { minutes: 15 });
    expect(orb.high[13]).toBeNull();
    expect(orb.high[14]).toBe(115);
    expect(orb.low[30]).toBe(99);
  });

  it('keeps every indicator in range on a real-looking day', () => {
    const s = simulatedSession(nifty, '2026-09-30');
    const base = [...s.history.flatMap((d) => d.candles), ...s.candles];
    const candles = aggregate(base, 5, nifty);
    const types = ['ema', 'sma', 'vwap', 'orb', 'supertrend', 'bb', 'ursi', 'rsi', 'macd'];
    const instances = types.map((t) => newIndicator(t));
    const values = computeIndicators(instances, { candles, base, tfSec: 300, inst: nifty });
    for (const inst of instances) {
      for (const [key, series] of Object.entries(values[inst.id])) {
        expect(series).toHaveLength(candles.length);
        // Supertrend draws only one of its up/down lines at a time.
        if (key !== 'up' && key !== 'down') expect(series[series.length - 1]).not.toBeNull();
      }
    }
    const ursi = values[instances[6].id].value.filter((v): v is number => v !== null);
    expect(Math.min(...ursi)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ursi)).toBeLessThanOrEqual(100);
  });
});

describe('options', () => {
  it('prices consistently with put-call parity', () => {
    const S = 25000;
    const K = 25050;
    const T = 3 / 365;
    const c = blackScholes('CE', S, K, T, 0.13);
    const p = blackScholes('PE', S, K, T, 0.13);
    expect(c - p).toBeCloseTo(S - K * Math.exp(-RISK_FREE_RATE * T), 6);
    expect(c).toBeGreaterThan(50);
    expect(atmStrike(25024, 50)).toBe(25000);
    expect(atmStrike(25026, 50)).toBe(25050);
  });

  it('finds the nearest weekly and monthly expiry', () => {
    expect(nearestExpiry(nifty, '2026-09-30')).toBe(istEpoch('2026-10-06', '15:30'));
    expect(nearestExpiry(nifty, '2026-10-06')).toBe(istEpoch('2026-10-06', '15:30'));
    expect(nearestExpiry(crude, '2026-09-30')).toBe(istEpoch('2026-10-16', '23:30'));
    expect(nearestExpiry(crude, '2026-09-10')).toBe(istEpoch('2026-09-17', '23:30'));
  });
});

describe('systems', () => {
  it('evaluates comparisons and crossings', () => {
    const candles = flat([10, 11, 12, 13]);
    const values = { x: { v: [11.5, 11.5, 11.5, 11.5] } };
    const above = newRule({ kind: 'price' }, '>', { kind: 'ind', ref: 'x', output: 'v' });
    const cross = newRule({ kind: 'price' }, 'crossesAbove', { kind: 'ind', ref: 'x', output: 'v' });
    expect(evaluateRule(above, candles, values)).toBe(true);
    expect(evaluateRule(cross, candles, values)).toBe(false);
    expect(evaluateRule(cross, candles, values, 2)).toBe(true);
    expect(evaluateRule(newRule({ kind: 'price' }, '<', { kind: 'num', value: 5 }), candles, values)).toBe(false);
  });

  it('ships a default system that reads like the screenshot set-up', () => {
    const sys = defaultSystem();
    expect(sys.indicators.map((i) => i.type)).toEqual(['ursi', 'vwap', 'ema', 'orb']);
    expect(ruleLabel(sys.callRules[0], sys.indicators)).toBe('Price is above ORB High');
    expect(ruleLabel(sys.callRules[2], sys.indicators)).toBe('Ultimate RSI URSI is above 50');
    const pruned = pruneRules({ ...sys, indicators: sys.indicators.filter((i) => i.type !== 'orb') });
    expect(pruned.callRules).toHaveLength(2);
  });

  it('classifies entries against the signal', () => {
    const on = { checks: [], passed: 1, active: true };
    const off = { checks: [], passed: 0, active: false };
    expect(signalMatch('CE', on, off)).toBe('with');
    expect(signalMatch('PE', on, off)).toBe('against');
    expect(signalMatch('PE', off, off)).toBe('none');
    expect(evaluateSetup([], [], {}).active).toBe(false);
  });
});

const baseTrade = (patch: Partial<Trade> = {}): Trade => ({
  id: 't1',
  profileId: 'p1',
  date: '2026-09-30',
  symbol: 'NIFTY50',
  side: 'CE',
  strike: 25000,
  expiry: istEpoch('2026-10-06', '15:30'),
  lots: 1,
  qty: 65,
  entryTime: istEpoch('2026-09-30', '10:00'),
  entrySpot: 25000,
  entryPremium: 100,
  entrySignal: 'with',
  stopPremium: 75,
  targetPremium: 150,
  ...patch,
});

describe('scoring', () => {
  it('scores a target exit taken on signal', () => {
    const r = tradeResult(baseTrade({ exitPremium: 150, exitReason: 'target', exitTime: 1 }))!;
    expect(r.gross).toBe(3250);
    expect(r.net).toBe(3210);
    expect(r.roiPct).toBeCloseTo(49.38, 1);
    expect(r.points).toBe(49 + 10 + 5);
    expect(tradeResult(baseTrade())).toBeNull();
  });

  it('aggregates profile stats', () => {
    const s = profileStats([
      baseTrade({ id: 'a', exitPremium: 150, exitReason: 'target', exitTime: 2 }),
      baseTrade({ id: 'b', exitPremium: 80, exitReason: 'manual', exitTime: 3, entrySignal: 'none' }),
    ]);
    expect(s.trades).toBe(2);
    expect(s.wins).toBe(1);
    expect(s.net).toBe(3210 + (-1300 - 40));
    expect(s.discipline).toBe(0.5);
    expect(s.equity).toHaveLength(3);
    expect(s.winStreak).toBe(0);
  });

  it('finds the best possible move of the day', () => {
    const s = simulatedSession(nifty, '2026-09-30');
    const expiry = nearestExpiry(nifty, s.date);
    const clock = dayClock(nifty, s.date);
    const ce = bestPossibleRoi('NIFTY50', s.candles, 'CE', expiry, s.iv, clock.squareOff);
    const pe = bestPossibleRoi('NIFTY50', s.candles, 'PE', expiry, s.iv, clock.squareOff);
    expect(ce).toBeGreaterThan(0);
    expect(pe).toBeGreaterThan(0);
  });
});

describe('replay exits', () => {
  const s = simulatedSession(nifty, '2026-09-30');
  const clock = dayClock(nifty, s.date);
  const t = istEpoch('2026-09-30', '10:00');
  const candle = (o: number, h: number, l: number, c: number, time = t): Candle => ({ time, open: o, high: h, low: l, close: c, volume: 0 });

  it('hits stops, targets and the square-off', () => {
    const { stop, target } = planLevels(100, 25, 50);
    expect(stop).toBe(75);
    expect(target).toBe(150);
    const trade = baseTrade({ stopPremium: 1, targetPremium: 100000 });
    expect(checkExit(trade, candle(25000, 25010, 24990, 25005), s, clock)).toBeNull();
    const tight = baseTrade({ stopPremium: 120, targetPremium: null, entryPremium: 130 });
    const hit = checkExit(tight, candle(25000, 25300, 24400, 25100), s, clock)!;
    expect(hit.reason).toBe('stoploss');
    expect(hit.premium).toBeLessThanOrEqual(120);
    const late = checkExit(trade, candle(25000, 25010, 24990, 25005, clock.squareOff - 60), s, clock)!;
    expect(late.reason).toBe('squareoff');
  });
});

describe('market data files', () => {
  it('parses the fetched session format', () => {
    const t0 = istEpoch('2026-09-30', '09:15');
    const rows = Array.from({ length: 60 }, (_, i) => [t0 + i * 60, 1, 2, 0.5, 1.5, 0] as [number, number, number, number, number, number]);
    const parsed = parseSessionFile({
      symbol: 'NIFTY50',
      date: '2026-09-30',
      source: 'NSE · NIFTY 50 index',
      iv: 0.12,
      days: [
        { date: '2026-09-29', candles: rows.map((r) => [r[0] - 86400, ...r.slice(1)] as typeof r) },
        { date: '2026-09-30', candles: rows },
      ],
    })!;
    expect(parsed.source).toBe('market');
    expect(parsed.candles).toHaveLength(60);
    expect(parsed.history).toHaveLength(1);
    expect(parsed.prevClose).toBe(1.5);
  });
});
