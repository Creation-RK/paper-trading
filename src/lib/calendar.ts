/** Indian market calendar helpers. All exchange times are IST (UTC+05:30, no DST). */

export const IST_OFFSET_SEC = 19800;

/**
 * Fixed-date exchange holidays. Festival holidays (Holi, Diwali, Eid, ...) move every
 * year; add them here from the NSE holiday circular. Days with fetched market data
 * are always treated as trading days.
 */
const FIXED_HOLIDAYS = ['01-26', '05-01', '08-15', '10-02', '12-25'];
const EXTRA_HOLIDAYS = new Set<string>([]);

export function parseDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

export function formatDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Day of week for a calendar date, 0 = Sunday. */
export function weekday(date: string): number {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return formatDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function isTradingDay(date: string, knownSessions?: Set<string>): boolean {
  if (knownSessions?.has(date)) return true;
  const wd = weekday(date);
  if (wd === 0 || wd === 6) return false;
  if (FIXED_HOLIDAYS.includes(date.slice(5))) return false;
  return !EXTRA_HOLIDAYS.has(date);
}

export function previousTradingDay(date: string, knownSessions?: Set<string>): string {
  let d = addDays(date, -1);
  while (!isTradingDay(d, knownSessions)) d = addDays(d, -1);
  return d;
}

export function nextTradingDay(date: string, knownSessions?: Set<string>): string {
  let d = addDays(date, 1);
  while (!isTradingDay(d, knownSessions)) d = addDays(d, 1);
  return d;
}

/** Today's date in IST. */
export function istToday(now: Date = new Date()): string {
  const t = new Date(now.getTime() + IST_OFFSET_SEC * 1000);
  return formatDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Epoch seconds for an IST wall-clock time ("HH:MM") on a date. */
export function istEpoch(date: string, hhmm: string): number {
  const { y, m, d } = parseDate(date);
  const [hh, mm] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) / 1000 - IST_OFFSET_SEC;
}

/** IST calendar date of an epoch timestamp. */
export function istDateOf(epochSec: number): string {
  const t = new Date((epochSec + IST_OFFSET_SEC) * 1000);
  return formatDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** "14:05" style IST clock for an epoch timestamp. */
export function istClock(epochSec: number): string {
  const t = new Date((epochSec + IST_OFFSET_SEC) * 1000);
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}

/** "2:05 PM" style IST clock. */
export function istClock12(epochSec: number): string {
  const t = new Date((epochSec + IST_OFFSET_SEC) * 1000);
  const h = t.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(t.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed, 30 Sep" */
export function prettyDate(date: string, withYear = false): string {
  const { y, m, d } = parseDate(date);
  return `${WEEKDAYS[weekday(date)]}, ${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
}
