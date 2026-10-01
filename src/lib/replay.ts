import { istEpoch } from './calendar';
import { Instrument, roundToTick } from './instruments';
import { optionPremium } from './options';
import type { Candle, ExitReason, OptionSide, SessionData, Trade } from './types';

/** Fixed facts about one replayed day of one subject. */
export interface DayClock {
  open: number;
  close: number;
  /** Open positions are closed and new entries refused from this time. */
  squareOff: number;
}

export function dayClock(inst: Instrument, date: string): DayClock {
  const close = istEpoch(date, inst.session.close);
  return { open: istEpoch(date, inst.session.open), close, squareOff: close - inst.squareOffBeforeCloseMin * 60 };
}

export function premiumFor(data: SessionData, side: OptionSide, strike: number, spot: number, time: number, expiry: number): number {
  return optionPremium(side, strike, spot, time, expiry, data.iv);
}

export interface ExitFill {
  time: number;
  spot: number;
  premium: number;
  reason: ExitReason;
}

/**
 * Check an open trade against the next 1-minute candle. Stops and targets are
 * tested against the candle's whole range; when both are touched in the same
 * minute the stop is assumed to fill first.
 */
export function checkExit(trade: Trade, candle: Candle, data: SessionData, clock: DayClock): ExitFill | null {
  const time = candle.time + 60;
  const prem = (spot: number) => premiumFor(data, trade.side, trade.strike, spot, time, trade.expiry);
  const worstSpot = trade.side === 'CE' ? candle.low : candle.high;
  const bestSpot = trade.side === 'CE' ? candle.high : candle.low;
  const atOpen = prem(candle.open);
  const worst = prem(worstSpot);
  const best = prem(bestSpot);
  const stop = trade.stopPremium;
  const target = trade.targetPremium;

  if (stop !== null && atOpen <= stop) return { time, spot: candle.open, premium: atOpen, reason: 'stoploss' };
  if (target !== null && atOpen >= target) return { time, spot: candle.open, premium: atOpen, reason: 'target' };
  if (stop !== null && worst <= stop) return { time, spot: worstSpot, premium: stop, reason: 'stoploss' };
  if (target !== null && best >= target) return { time, spot: bestSpot, premium: target, reason: 'target' };
  if (time >= clock.squareOff) return { time, spot: candle.close, premium: prem(candle.close), reason: 'squareoff' };
  return null;
}

export function planLevels(premium: number, stopLossPct: number, targetPct: number): { stop: number | null; target: number | null } {
  return {
    stop: stopLossPct > 0 ? Math.max(0.05, roundToTick(premium * (1 - stopLossPct / 100), 0.05)) : null,
    target: targetPct > 0 ? roundToTick(premium * (1 + targetPct / 100), 0.05) : null,
  };
}
