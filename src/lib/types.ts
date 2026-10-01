/** One OHLCV bar. `time` is the bar's start as epoch seconds (UTC). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SessionDay {
  /** Trading date in IST, YYYY-MM-DD. */
  date: string;
  /** 1-minute candles for the whole session. */
  candles: Candle[];
}

/** Everything the replay needs for one subject on one trading day. */
export interface SessionData {
  symbol: string;
  date: string;
  /** 1-minute candles for the day being played. Revealed one by one during replay. */
  candles: Candle[];
  /** Earlier trading days, oldest first. Always visible; warms up indicators. */
  history: SessionDay[];
  prevClose: number;
  /** Annualised implied volatility used to price options (0.13 = 13%). */
  iv: number;
  source: 'market' | 'simulated';
  sourceLabel: string;
}

export type OptionSide = 'CE' | 'PE';

export type ExitReason = 'manual' | 'stoploss' | 'target' | 'squareoff';

/** Whether the profile's own system agreed with the entry when it was taken. */
export type SignalMatch = 'with' | 'against' | 'none';

export interface Trade {
  id: string;
  profileId: string;
  date: string;
  symbol: string;
  side: OptionSide;
  strike: number;
  /** Expiry as epoch seconds. */
  expiry: number;
  lots: number;
  qty: number;
  entryTime: number;
  entrySpot: number;
  entryPremium: number;
  entrySignal: SignalMatch;
  /** Premium levels that close the trade automatically; null when the system has none. */
  stopPremium: number | null;
  targetPremium: number | null;
  exitTime?: number;
  exitSpot?: number;
  exitPremium?: number;
  exitReason?: ExitReason;
  /** Best return (%) any single option trade of this side could have made that day. */
  bestRoiPct?: number;
}
