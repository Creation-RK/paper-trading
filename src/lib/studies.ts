import type { LineSpec, StudySpec } from '../components/PriceChart';
import { computeIndicators, getIndicatorDef, IndicatorInstance, IndicatorValues, indicatorLabel } from './indicators';
import type { Instrument } from './instruments';
import { aggregate } from './market/aggregate';
import type { Candle } from './types';

export interface Frame {
  candles: Candle[];
  values: IndicatorValues;
}

/** Candles at a timeframe plus every indicator of a system computed on them. */
export function buildFrame(base: Candle[], tfMin: number, inst: Instrument, indicators: IndicatorInstance[]): Frame {
  const candles = aggregate(base, tfMin, inst);
  return { candles, values: computeIndicators(indicators, { candles, base, tfSec: tfMin * 60, inst }) };
}

/** Turn computed indicator values into what the chart draws. */
export function toStudies(indicators: IndicatorInstance[], values: IndicatorValues): StudySpec[] {
  return indicators
    .filter((i) => i.visible)
    .map((inst) => {
      const def = getIndicatorDef(inst.type);
      const lines: LineSpec[] = def.outputs
        .filter((o) => o.style !== 'hidden')
        .map((o) => ({
          key: o.key,
          label: o.label,
          color: inst.colors[o.key] ?? o.color,
          style: o.style as LineSpec['style'],
          data: values[inst.id]?.[o.key] ?? [],
        }));
      return { id: inst.id, label: indicatorLabel(inst), placement: def.placement, lines, levels: def.levels };
    });
}
