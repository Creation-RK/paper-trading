import { getIndicatorDef, IndicatorInstance, IndicatorValues, indicatorLabel, newIndicator, Series } from './indicators';
import type { Candle, OptionSide, SignalMatch } from './types';

/**
 * A trading system: a chart timeframe, indicators, the conditions that define a
 * CALL or PUT setup, and the exit plan. Each profile owns one and can edit it.
 */

export type Operand =
  | { kind: 'price' }
  | { kind: 'ind'; ref: string; output: string }
  | { kind: 'num'; value: number };

export type Comparator = '>' | '<' | 'crossesAbove' | 'crossesBelow';

export interface Rule {
  id: string;
  left: Operand;
  op: Comparator;
  right: Operand;
}

export interface RiskPlan {
  lots: number;
  /** Exit when the premium falls this % below entry. 0 = no stop. */
  stopLossPct: number;
  /** Exit when the premium rises this % above entry. 0 = no target. */
  targetPct: number;
}

export interface SystemDef {
  name: string;
  timeframe: number;
  indicators: IndicatorInstance[];
  callRules: Rule[];
  putRules: Rule[];
  risk: RiskPlan;
  notes: string;
}

export const COMPARATORS: { value: Comparator; label: string }[] = [
  { value: '>', label: 'is above' },
  { value: '<', label: 'is below' },
  { value: 'crossesAbove', label: 'crosses above' },
  { value: 'crossesBelow', label: 'crosses below' },
];

let ruleCounter = 0;
export function newRule(left: Operand, op: Comparator, right: Operand): Rule {
  ruleCounter = (ruleCounter + 1) % 1e6;
  return { id: `r-${Date.now().toString(36)}${ruleCounter.toString(36)}`, left, op, right };
}

/** The starting system: the ORB + VWAP scalper set-up (Ultimate RSI, VWAP, EMA 7, ORB). */
export function defaultSystem(): SystemDef {
  const ursi = newIndicator('ursi');
  const vwap = newIndicator('vwap');
  const ema = newIndicator('ema', { length: 7 });
  const orb = newIndicator('orb', { minutes: 15 });
  const price: Operand = { kind: 'price' };
  return {
    name: 'ORB + VWAP Scalper',
    timeframe: 5,
    indicators: [ursi, vwap, ema, orb],
    callRules: [
      newRule(price, '>', { kind: 'ind', ref: orb.id, output: 'high' }),
      newRule(price, '>', { kind: 'ind', ref: vwap.id, output: 'value' }),
      newRule({ kind: 'ind', ref: ursi.id, output: 'value' }, '>', { kind: 'num', value: 50 }),
    ],
    putRules: [
      newRule(price, '<', { kind: 'ind', ref: orb.id, output: 'low' }),
      newRule(price, '<', { kind: 'ind', ref: vwap.id, output: 'value' }),
      newRule({ kind: 'ind', ref: ursi.id, output: 'value' }, '<', { kind: 'num', value: 50 }),
    ],
    risk: { lots: 1, stopLossPct: 25, targetPct: 50 },
    notes: 'Wait for the 15-minute opening range. Buy a CALL on a break above the range while price holds VWAP; buy a PUT on a break below. No trades in the last hour.',
  };
}

export function operandLabel(op: Operand, indicators: IndicatorInstance[]): string {
  if (op.kind === 'price') return 'Price';
  if (op.kind === 'num') return String(op.value);
  const inst = indicators.find((i) => i.id === op.ref);
  if (!inst) return 'Removed indicator';
  const def = getIndicatorDef(inst.type);
  const name = indicatorLabel(inst);
  if (def.outputs.length === 1) return name;
  const out = def.outputs.find((o) => o.key === op.output);
  return `${name} ${out ? out.label : op.output}`;
}

export function ruleLabel(rule: Rule, indicators: IndicatorInstance[]): string {
  const cmp = COMPARATORS.find((c) => c.value === rule.op)?.label ?? rule.op;
  return `${operandLabel(rule.left, indicators)} ${cmp} ${operandLabel(rule.right, indicators)}`;
}

/** Operands a rule may compare: price, every output of every indicator, or a number. */
export function operandChoices(indicators: IndicatorInstance[]): { operand: Operand; label: string }[] {
  const list: { operand: Operand; label: string }[] = [{ operand: { kind: 'price' }, label: 'Price' }];
  for (const inst of indicators) {
    const def = getIndicatorDef(inst.type);
    for (const out of def.outputs) {
      const operand: Operand = { kind: 'ind', ref: inst.id, output: out.key };
      list.push({ operand, label: operandLabel(operand, indicators) });
    }
  }
  return list;
}

export function ruleUsesIndicator(rule: Rule, id: string): boolean {
  return (rule.left.kind === 'ind' && rule.left.ref === id) || (rule.right.kind === 'ind' && rule.right.ref === id);
}

function operandSeries(op: Operand, candles: Candle[], values: IndicatorValues): Series | null {
  if (op.kind === 'price') return candles.map((c) => c.close);
  if (op.kind === 'num') return null;
  return values[op.ref]?.[op.output] ?? [];
}

function valueAt(op: Operand, series: Series | null, i: number): number | null {
  if (op.kind === 'num') return op.value;
  if (!series || i < 0 || i >= series.length) return null;
  return series[i];
}

/** `true`/`false` once there is enough data to decide, `null` while indicators are still warming up. */
export function evaluateRule(rule: Rule, candles: Candle[], values: IndicatorValues, index = candles.length - 1): boolean | null {
  const ls = operandSeries(rule.left, candles, values);
  const rs = operandSeries(rule.right, candles, values);
  const l = valueAt(rule.left, ls, index);
  const r = valueAt(rule.right, rs, index);
  if (l === null || r === null) return null;
  if (rule.op === '>') return l > r;
  if (rule.op === '<') return l < r;
  const pl = valueAt(rule.left, ls, index - 1);
  const pr = valueAt(rule.right, rs, index - 1);
  if (pl === null || pr === null) return null;
  return rule.op === 'crossesAbove' ? pl <= pr && l > r : pl >= pr && l < r;
}

export interface SetupStatus {
  checks: { rule: Rule; pass: boolean | null }[];
  passed: number;
  /** Every condition holds (and there is at least one). */
  active: boolean;
}

export function evaluateSetup(rules: Rule[], candles: Candle[], values: IndicatorValues): SetupStatus {
  const checks = rules.map((rule) => ({ rule, pass: evaluateRule(rule, candles, values) }));
  const passed = checks.filter((c) => c.pass === true).length;
  return { checks, passed, active: rules.length > 0 && passed === rules.length };
}

export function signalMatch(side: OptionSide, call: SetupStatus, put: SetupStatus): SignalMatch {
  const mine = side === 'CE' ? call : put;
  const other = side === 'CE' ? put : call;
  if (mine.active) return 'with';
  if (other.active) return 'against';
  return 'none';
}

/** Drop rules that point at indicators which no longer exist. */
export function pruneRules(system: SystemDef): SystemDef {
  const ids = new Set(system.indicators.map((i) => i.id));
  const ok = (r: Rule) => [r.left, r.right].every((o) => o.kind !== 'ind' || ids.has(o.ref));
  return { ...system, callRules: system.callRules.filter(ok), putRules: system.putRules.filter(ok) };
}
