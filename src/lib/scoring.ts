import { getInstrument } from './instruments';
import { atmStrike, optionPremium } from './options';
import type { Candle, OptionSide, Trade } from './types';

/** Flat brokerage per executed order, like a discount broker. A round trip pays it twice. */
export const BROKERAGE_PER_ORDER = 20;
export const STARTING_CAPITAL = 100000;

export interface ScorePart {
  label: string;
  points: number;
}

export interface TradeResult {
  gross: number;
  charges: number;
  net: number;
  /** Net return on the premium paid, in %. */
  roiPct: number;
  points: number;
  parts: ScorePart[];
  /** Share of the day's best possible option move this trade captured (0-1), when known. */
  capture: number | null;
}

export function premiumPaid(t: Trade): number {
  return t.entryPremium * t.qty;
}

export function tradeResult(t: Trade): TradeResult | null {
  if (t.exitPremium === undefined) return null;
  const gross = (t.exitPremium - t.entryPremium) * t.qty;
  const charges = 2 * BROKERAGE_PER_ORDER;
  const net = gross - charges;
  const roiPct = (net / premiumPaid(t)) * 100;
  const parts: ScorePart[] = [{ label: 'Return on premium', points: Math.max(-100, Math.min(300, Math.round(roiPct))) }];
  if (t.entrySignal === 'with') parts.push({ label: 'Entered on your system signal', points: 10 });
  if (t.entrySignal === 'against') parts.push({ label: 'Entered against your system', points: -5 });
  if (t.exitReason === 'stoploss' || t.exitReason === 'target') parts.push({ label: 'Exited by your plan', points: 5 });
  const moveRoi = ((t.exitPremium - t.entryPremium) / t.entryPremium) * 100;
  const capture = t.bestRoiPct && t.bestRoiPct > 0 ? Math.max(0, Math.min(1, moveRoi / t.bestRoiPct)) : null;
  return { gross, charges, net, roiPct, points: parts.reduce((s, p) => s + p.points, 0), parts, capture };
}

export function livePnl(t: Trade, premiumNow: number): { net: number; pct: number } {
  const net = (premiumNow - t.entryPremium) * t.qty - BROKERAGE_PER_ORDER;
  return { net, pct: ((premiumNow - t.entryPremium) / t.entryPremium) * 100 };
}

/**
 * The best gross return (%) a single ATM option of `side` could have made that day:
 * buy the at-the-money strike at some minute's close, sell it at a later close
 * before square-off. Used to show how much of the day's move a trade captured.
 */
export function bestPossibleRoi(
  symbol: string,
  candles: Candle[],
  side: OptionSide,
  expiry: number,
  iv: number,
  lastTime: number,
): number {
  const inst = getInstrument(symbol);
  const usable = candles.filter((c) => c.time + 60 <= lastTime);
  const n = usable.length;
  if (n < 2) return 0;
  const strikes = new Map<number, number[]>();
  usable.forEach((c, i) => {
    const k = atmStrike(c.close, inst.strikeStep);
    const list = strikes.get(k);
    if (list) list.push(i);
    else strikes.set(k, [i]);
  });
  let best = 0;
  for (const [k, entries] of strikes) {
    const prem = usable.map((c) => optionPremium(side, k, c.close, c.time + 60, expiry, iv));
    const sufMax = new Array<number>(n + 1).fill(-Infinity);
    for (let j = n - 1; j >= 0; j--) sufMax[j] = Math.max(prem[j], sufMax[j + 1]);
    for (const i of entries) {
      if (i + 1 >= n) continue;
      best = Math.max(best, ((sufMax[i + 1] - prem[i]) / prem[i]) * 100);
    }
  }
  return best;
}

export function dayGrade(points: number): string {
  if (points >= 120) return 'S';
  if (points >= 60) return 'A';
  if (points >= 20) return 'B';
  if (points >= 0) return 'C';
  if (points >= -30) return 'D';
  return 'F';
}

export interface ProfileStats {
  trades: number;
  wins: number;
  winRate: number;
  net: number;
  points: number;
  avgRoi: number;
  /** Share of trades entered on the profile's own system signal. */
  discipline: number;
  balance: number;
  winStreak: number;
  best: { trade: Trade; result: TradeResult } | null;
  worst: { trade: Trade; result: TradeResult } | null;
  bySymbol: Record<string, { trades: number; net: number; points: number }>;
  /** Balance after each closed trade, oldest first, starting with the opening balance. */
  equity: number[];
}

export function profileStats(trades: Trade[]): ProfileStats {
  const closed = trades
    .map((trade) => ({ trade, result: tradeResult(trade) }))
    .filter((x): x is { trade: Trade; result: TradeResult } => x.result !== null)
    .sort((a, b) => (a.trade.date === b.trade.date ? (a.trade.exitTime ?? 0) - (b.trade.exitTime ?? 0) : a.trade.date < b.trade.date ? -1 : 1));
  const stats: ProfileStats = {
    trades: closed.length,
    wins: 0,
    winRate: 0,
    net: 0,
    points: 0,
    avgRoi: 0,
    discipline: 0,
    balance: STARTING_CAPITAL,
    winStreak: 0,
    best: null,
    worst: null,
    bySymbol: {},
    equity: [STARTING_CAPITAL],
  };
  let roiSum = 0;
  let onSignal = 0;
  for (const x of closed) {
    const { trade, result } = x;
    if (result.net > 0) stats.wins++;
    stats.net += result.net;
    stats.points += result.points;
    roiSum += result.roiPct;
    if (trade.entrySignal === 'with') onSignal++;
    if (!stats.best || result.net > stats.best.result.net) stats.best = x;
    if (!stats.worst || result.net < stats.worst.result.net) stats.worst = x;
    const s = (stats.bySymbol[trade.symbol] ??= { trades: 0, net: 0, points: 0 });
    s.trades++;
    s.net += result.net;
    s.points += result.points;
    stats.equity.push(STARTING_CAPITAL + stats.net);
  }
  for (let i = closed.length - 1; i >= 0 && closed[i].result.net > 0; i--) stats.winStreak++;
  if (closed.length) {
    stats.winRate = stats.wins / closed.length;
    stats.avgRoi = roiSum / closed.length;
    stats.discipline = onSignal / closed.length;
  }
  stats.balance = STARTING_CAPITAL + stats.net;
  return stats;
}
