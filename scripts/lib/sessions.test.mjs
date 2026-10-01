import { describe, expect, it } from 'vitest';
import { buildSessionFile, chartToCandles, chartToDailyCloses, convertCurrency, istEpoch, splitSessions, valueOnOrBefore } from './sessions.mjs';

const yahoo = (timestamps, rows) => ({
  chart: {
    result: [
      {
        timestamp: timestamps,
        indicators: {
          quote: [
            {
              open: rows.map((r) => r[0]),
              high: rows.map((r) => r[1]),
              low: rows.map((r) => r[2]),
              close: rows.map((r) => r[3]),
              volume: rows.map((r) => r[4]),
            },
          ],
        },
      },
    ],
  },
});

describe('fetch-session transforms', () => {
  it('parses Yahoo chart rows and skips empty ones', () => {
    const t = istEpoch('2026-09-30', '09:15');
    const c = chartToCandles(yahoo([t + 5, t + 60, t + 120], [[1, 2, 0.5, 1.5, 0], [null, null, null, null, null], [1.5, 1.6, 1.4, 1.55, 10]]));
    expect(c).toHaveLength(2);
    expect(c[0].time).toBe(t);
  });

  it('builds gap-filled sessions and drops thin days', () => {
    const start = istEpoch('2026-09-30', '09:15');
    const ts = [];
    const rows = [];
    for (let i = 0; i < 375; i++) {
      if (i === 10) continue; // a missing minute
      ts.push(start + i * 60);
      rows.push([100 + i, 101 + i, 99 + i, 100.5 + i, 0]);
    }
    ts.push(istEpoch('2026-09-29', '10:00'));
    rows.push([90, 91, 89, 90, 0]);
    const days = splitSessions(chartToCandles(yahoo(ts, rows)), { open: '09:15', close: '15:30', tick: 0.05 });
    expect([...days.keys()]).toEqual(['2026-09-30']);
    const day = days.get('2026-09-30');
    expect(day).toHaveLength(375);
    expect(day[10]).toEqual([start + 600, 109.5, 109.5, 109.5, 109.5, 0]);
    const file = buildSessionFile({ symbol: 'NIFTY50', date: '2026-09-30', days, source: 'test', iv: 0.1234 });
    expect(file.days).toHaveLength(1);
    expect(file.iv).toBe(0.1234);
    expect(buildSessionFile({ symbol: 'NIFTY50', date: '2026-10-01', days, source: 'test' })).toBeNull();
  });

  it('converts currency at the rate in force each minute', () => {
    const fx = [{ time: 0, close: 80 }, { time: 120, close: 90 }];
    const out = convertCurrency([{ time: 60, open: 1, high: 1, low: 1, close: 1, volume: 0 }, { time: 180, open: 2, high: 2, low: 2, close: 2, volume: 0 }], fx);
    expect(out.map((c) => c.close)).toEqual([80, 180]);
  });

  it('reads daily volatility closes', () => {
    const t = istEpoch('2026-09-29', '09:15');
    const closes = chartToDailyCloses(yahoo([t, t + 86400], [[0, 0, 0, 12.5, 0], [0, 0, 0, 13.1, 0]]));
    expect(valueOnOrBefore(closes, '2026-09-30')).toBe(13.1);
    expect(valueOnOrBefore(closes, '2026-09-28')).toBeNull();
  });
});
