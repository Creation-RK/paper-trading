import { addDays, istEpoch, isTradingDay, parseDate, formatDate, weekday } from './calendar';
import { Instrument, roundToTick } from './instruments';
import type { OptionSide } from './types';

/**
 * Theoretical option prices. Historical option chains are not freely available,
 * so premiums come from Black-Scholes on the replayed underlying, using the day's
 * implied volatility (India VIX / OVX when fetched).
 */

export const RISK_FREE_RATE = 0.06;
const YEAR_SEC = 365 * 24 * 3600;
const MIN_T = 60 / YEAR_SEC;

/** Standard normal CDF (Zelen & Severo, |error| < 7.5e-8). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

export function blackScholes(side: OptionSide, spot: number, strike: number, years: number, vol: number, r = RISK_FREE_RATE): number {
  const T = Math.max(years, MIN_T);
  const sq = vol * Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r + (vol * vol) / 2) * T) / sq;
  const d2 = d1 - sq;
  const disc = strike * Math.exp(-r * T);
  return side === 'CE' ? spot * normCdf(d1) - disc * normCdf(d2) : disc * normCdf(-d2) - spot * normCdf(-d1);
}

export function atmStrike(spot: number, step: number): number {
  return Math.round(spot / step) * step;
}

/** Expiry (epoch seconds at the session close) of the nearest contract on or after `date`. */
export function nearestExpiry(inst: Instrument, date: string): number {
  if (inst.expiry.kind === 'weekly') {
    const target = inst.expiry.weekday;
    let d = date;
    while (weekday(d) !== target) d = addDays(d, 1);
    while (!isTradingDay(d)) d = addDays(d, -1);
    if (d < date) {
      d = addDays(d, 7);
      while (!isTradingDay(d)) d = addDays(d, -1);
    }
    return istEpoch(d, inst.session.close);
  }
  const { y, m } = parseDate(date);
  const day = inst.expiry.day;
  const candidate = (yy: number, mm: number) => {
    let d = formatDate(yy, mm, day);
    while (!isTradingDay(d)) d = addDays(d, -1);
    return d;
  };
  let exp = candidate(y, m);
  if (exp < date) exp = m === 12 ? candidate(y + 1, 1) : candidate(y, m + 1);
  return istEpoch(exp, inst.session.close);
}

export function optionPremium(
  side: OptionSide,
  strike: number,
  spot: number,
  now: number,
  expiry: number,
  iv: number,
): number {
  const raw = blackScholes(side, spot, strike, (expiry - now) / YEAR_SEC, iv);
  return Math.max(0.05, roundToTick(raw, 0.05));
}

export function formatExpiry(expiry: number): string {
  const d = new Date((expiry + 19800) * 1000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}
