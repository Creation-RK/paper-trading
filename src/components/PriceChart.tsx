import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  LineSeries,
  LineStyle,
  SeriesMarker,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import { IST_OFFSET_SEC } from '../lib/calendar';
import { price as fmtPrice } from '../lib/format';
import type { Series } from '../lib/indicators';
import type { Candle } from '../lib/types';
import type { ChartType } from '../store/game';
import { useThemeTokens } from './ui';

export interface LineSpec {
  key: string;
  label: string;
  color: string;
  style: 'line' | 'dashed' | 'histogram';
  data: Series;
}

export interface StudySpec {
  id: string;
  label: string;
  placement: 'overlay' | 'pane';
  lines: LineSpec[];
  levels?: number[];
}

export interface MarkerSpec {
  time: number;
  position: 'aboveBar' | 'belowBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle';
  text: string;
}

export interface PriceLineSpec {
  price: number;
  color: string;
  title: string;
}

interface Props {
  candles: Candle[];
  chartType: ChartType;
  studies: StudySpec[];
  markers: MarkerSpec[];
  priceLines: PriceLineSpec[];
  pricePrecision: number;
  minMove: number;
  /** Changing this re-frames the chart on the latest bars (e.g. a new timeframe). */
  frameKey: string;
}

/** Chart times are shifted to IST so the axis reads exchange time. */
const toTime = (epoch: number) => (epoch + IST_OFFSET_SEC) as UTCTimestamp;

const lineData = (candles: Candle[], data: Series) => candles.map((c, i) => (data[i] === null || data[i] === undefined ? { time: toTime(c.time) } : { time: toTime(c.time), value: data[i] as number }));

function lastValue(data: Series): number | null {
  for (let i = data.length - 1; i >= 0; i--) if (data[i] !== null) return data[i];
  return null;
}

export function PriceChart({ candles, chartType, studies, markers, priceLines, pricePrecision, minMove, frameKey }: Props) {
  const tokens = useThemeTokens();
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const linesRef = useRef(new Map<string, ISeriesApi<SeriesType>>());
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const followRef = useRef(true);
  const [paneTops, setPaneTops] = useState<number[]>([]);

  const panes = studies.filter((s) => s.placement === 'pane');
  const structure = useMemo(
    () =>
      JSON.stringify([
        chartType,
        pricePrecision,
        tokens,
        studies.map((s) => [s.id, s.placement, s.levels, s.lines.map((l) => [l.key, l.color, l.style])]),
      ]),
    [chartType, pricePrecision, tokens, studies],
  );

  // Build (or rebuild) the chart and its series when the set of studies or the theme changes.
  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: tokens.bg },
        textColor: tokens.text,
        fontFamily: 'Lato, system-ui, sans-serif',
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: tokens.line, separatorHoverColor: tokens.line, enableResize: true },
      },
      grid: { vertLines: { color: tokens.grid }, horzLines: { color: tokens.grid } },
      rightPriceScale: { borderColor: tokens.line, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: tokens.line, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7 },
      crosshair: { horzLine: { labelBackgroundColor: tokens.accent }, vertLine: { labelBackgroundColor: tokens.accent } },
      localization: { locale: 'en-IN' },
    });
    chartRef.current = chart;
    const priceFormat = { type: 'price' as const, precision: pricePrecision, minMove };
    const main =
      chartType === 'wave'
        ? chart.addSeries(AreaSeries, {
            lineColor: tokens.accent,
            lineWidth: 2,
            topColor: `${tokens.accent}55`,
            bottomColor: `${tokens.accent}05`,
            priceFormat,
          })
        : chart.addSeries(CandlestickSeries, {
            upColor: tokens.up,
            downColor: tokens.down,
            borderVisible: false,
            wickUpColor: tokens.up,
            wickDownColor: tokens.down,
            priceFormat,
          });
    mainRef.current = main;
    markersRef.current = createSeriesMarkers(main, []);

    const lines = new Map<string, ISeriesApi<SeriesType>>();
    let paneIndex = 0;
    for (const study of studies) {
      const pane = study.placement === 'pane' ? ++paneIndex : 0;
      study.lines.forEach((l, idx) => {
        const s =
          l.style === 'histogram'
            ? chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } }, pane)
            : chart.addSeries(
                LineSeries,
                {
                  color: l.color,
                  lineWidth: 2,
                  lineStyle: l.style === 'dashed' ? LineStyle.Dashed : LineStyle.Solid,
                  priceLineVisible: false,
                  lastValueVisible: true,
                  crosshairMarkerVisible: false,
                  priceFormat: pane === 0 ? priceFormat : { type: 'price', precision: 2, minMove: 0.01 },
                },
                pane,
              );
        if (idx === 0) {
          for (const level of study.levels ?? []) {
            s.createPriceLine({ price: level, color: tokens.muted, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
          }
        }
        lines.set(`${study.id}:${l.key}`, s);
      });
    }
    linesRef.current = lines;
    const allPanes = chart.panes();
    allPanes[0]?.setStretchFactor(3);
    for (let i = 1; i < allPanes.length; i++) allPanes[i].setStretchFactor(1);

    const onRange = () => {
      const range = chart.timeScale().getVisibleLogicalRange();
      const bars = mainRef.current?.data().length ?? 0;
      if (range) followRef.current = range.to >= bars - 2;
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    followRef.current = true;

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      markersRef.current = null;
      priceLinesRef.current = [];
      linesRef.current = new Map();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure]);

  // Push data on every replay step.
  useEffect(() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    if (!chart || !main) return;
    const follow = followRef.current;
    const saved = chart.timeScale().getVisibleLogicalRange();
    if (chartType === 'wave') main.setData(candles.map((c) => ({ time: toTime(c.time), value: c.close })));
    else main.setData(candles.map((c) => ({ time: toTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    for (const study of studies) {
      for (const l of study.lines) {
        const s = linesRef.current.get(`${study.id}:${l.key}`);
        if (!s) continue;
        if (l.style === 'histogram') {
          s.setData(
            candles.map((c, i) => {
              const v = l.data[i];
              return v === null || v === undefined ? { time: toTime(c.time) } : { time: toTime(c.time), value: v, color: v >= 0 ? `${tokens.up}aa` : `${tokens.down}aa` };
            }),
          );
        } else s.setData(lineData(candles, l.data));
      }
    }
    markersRef.current?.setMarkers(
      markers.map(
        (m): SeriesMarker<Time> => ({ time: toTime(m.time), position: m.position, color: m.color, shape: m.shape, text: m.text, size: 1.2 }),
      ),
    );
    for (const pl of priceLinesRef.current) main.removePriceLine(pl);
    priceLinesRef.current = priceLines.map((p) =>
      main.createPriceLine({ price: p.price, color: p.color, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: p.title }),
    );
    if (follow) chart.timeScale().scrollToRealTime();
    else if (saved) chart.timeScale().setVisibleLogicalRange(saved);

    requestAnimationFrame(measurePanes);
  }, [candles, studies, markers, priceLines, chartType, structure, tokens]);

  // Pane legends sit at the top of each lower pane; re-measure whenever the chart resizes.
  function measurePanes() {
    const chart = chartRef.current;
    const box = host.current?.getBoundingClientRect();
    if (!chart || !box) return;
    const tops = chart.panes().map((p) => {
      const el = p.getHTMLElement();
      return el ? Math.round(el.getBoundingClientRect().top - box.top) : 0;
    });
    setPaneTops((prev) => (prev.length === tops.length && prev.every((t, i) => t === tops[i]) ? prev : tops));
  }
  useEffect(() => {
    if (!host.current || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => requestAnimationFrame(measurePanes));
    });
    ro.observe(host.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new timeframe or day re-frames the view on the latest bars.
  useEffect(() => {
    followRef.current = true;
    chartRef.current?.timeScale().scrollToRealTime();
  }, [frameKey]);

  const overlays = studies.filter((s) => s.placement === 'overlay');
  return (
    <>
      <div ref={host} className="s-chart" />
      {overlays.length > 0 && (
        <div className="legend" style={{ top: 8 }}>
          {overlays.map((s) => (
            <div key={s.id}>
              {s.label}{' '}
              {s.lines.map((l) => {
                const v = lastValue(l.data);
                return v === null ? null : (
                  <b key={l.key} style={{ color: l.color }} className="num">
                    {fmtPrice(v)}{' '}
                  </b>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {panes.map((s, i) =>
        paneTops[i + 1] !== undefined ? (
          <div key={s.id} className="legend" style={{ top: paneTops[i + 1] + 4 }}>
            <div>
              {s.label}{' '}
              {s.lines.map((l) => {
                const v = lastValue(l.data);
                return v === null ? null : (
                  <b key={l.key} style={{ color: l.style === 'histogram' ? undefined : l.color }} className="num">
                    {v.toFixed(2)}{' '}
                  </b>
                );
              })}
              {s.levels?.map((lv) => (
                <span key={lv} className="num">
                  {lv.toFixed(2)}{' '}
                </span>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </>
  );
}
