/**
 * The subjects a player trades each day. V2 adds three more subjects and V3 five more:
 * each is one entry here plus a source in scripts/fetch-session.mjs.
 */

export type ExpiryRule =
  /** Weekly contracts expiring on a weekday (0 = Sunday). */
  | { kind: 'weekly'; weekday: number }
  /** Monthly contracts expiring on (or the last weekday before) a day of the month. */
  | { kind: 'monthly'; day: number };

export interface Instrument {
  id: string;
  name: string;
  exchange: string;
  segment: string;
  /** Exchange session in IST. */
  session: { open: string; close: string };
  /** Auto square-off this many minutes before the close, like an intraday broker. */
  squareOffBeforeCloseMin: number;
  lotSize: number;
  strikeStep: number;
  tickSize: number;
  expiry: ExpiryRule;
  /** Fallback implied volatility when the day's data does not carry one. */
  defaultIv: number;
  /** Shape of the simulated session used when no market data is available. */
  sim: {
    anchorPrice: number;
    dailyVol: number;
    volumeBase: number;
    /** IST times when volatility jumps (e.g. the US open for crude). */
    bumps?: { at: string; factor: number }[];
  };
  unit: string;
}

export const INSTRUMENTS: Instrument[] = [
  {
    id: 'NIFTY50',
    name: 'NIFTY 50',
    exchange: 'NSE',
    segment: 'Index options',
    session: { open: '09:15', close: '15:30' },
    squareOffBeforeCloseMin: 10,
    lotSize: 65,
    strikeStep: 50,
    tickSize: 0.05,
    expiry: { kind: 'weekly', weekday: 2 },
    defaultIv: 0.13,
    sim: { anchorPrice: 25850, dailyVol: 0.0085, volumeBase: 90000 },
    unit: 'pts',
  },
  {
    id: 'CRUDEOIL',
    name: 'CRUDE OIL',
    exchange: 'NSE',
    segment: 'Commodity options',
    session: { open: '09:00', close: '23:30' },
    squareOffBeforeCloseMin: 10,
    lotSize: 100,
    strikeStep: 50,
    tickSize: 1,
    expiry: { kind: 'monthly', day: 17 },
    defaultIv: 0.36,
    sim: {
      anchorPrice: 5480,
      dailyVol: 0.018,
      volumeBase: 4200,
      bumps: [
        { at: '18:30', factor: 1.7 },
        { at: '20:00', factor: 1.5 },
      ],
    },
    unit: '₹/bbl',
  },
];

export function getInstrument(id: string): Instrument {
  const inst = INSTRUMENTS.find((i) => i.id === id);
  if (!inst) throw new Error(`Unknown instrument ${id}`);
  return inst;
}

export function sessionMinutes(inst: Instrument): number {
  const [oh, om] = inst.session.open.split(':').map(Number);
  const [ch, cm] = inst.session.close.split(':').map(Number);
  return ch * 60 + cm - (oh * 60 + om);
}

export function roundToTick(price: number, tick: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(tick)) + 1);
  return Number((Math.round(price / tick) * tick).toFixed(decimals));
}
