import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PriceChart, MarkerSpec, PriceLineSpec } from '../components/PriceChart';
import {
  IconAlert,
  IconCandles,
  IconClose,
  IconLock,
  IconPause,
  IconPlay,
  IconSkip,
  IconSliders,
  IconStep,
  IconWave,
  IconEye,
  IconEyeOff,
} from '../components/Icons';
import { Avatar, Sheet, showToast } from '../components/ui';
import { istClock, istClock12, prettyDate } from '../lib/calendar';
import { price, rupees, signedPct, signedPts, signedRupees, tone } from '../lib/format';
import { indicatorLabel } from '../lib/indicators';
import { getInstrument, Instrument, INSTRUMENTS } from '../lib/instruments';
import { bucketStart, heikinAshi, TIMEFRAMES, timeframeLabel } from '../lib/market/aggregate';
import { loadSession } from '../lib/market/provider';
import { atmStrike, formatExpiry, nearestExpiry } from '../lib/options';
import { checkExit, dayClock, planLevels, premiumFor } from '../lib/replay';
import { bestPossibleRoi, livePnl, premiumPaid, profileStats, tradeResult } from '../lib/scoring';
import { buildFrame, toStudies } from '../lib/studies';
import { evaluateSetup, ruleLabel, SetupStatus, signalMatch } from '../lib/system';
import type { OptionSide, SessionData, Trade } from '../lib/types';
import { navigate } from '../router';
import { newTradeId, Profile, progressKey, useGame } from '../store/game';

const SPEEDS = [1, 2, 5, 10, 30, 60];

export function Session({ date, symbol }: { date: string; symbol: string }) {
  const [data, setData] = useState<SessionData | null>(null);
  const inst = useMemo(() => {
    try {
      return getInstrument(symbol);
    } catch {
      return null;
    }
  }, [symbol]);
  useEffect(() => {
    if (!inst) return;
    let live = true;
    loadSession(inst.id, date).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [inst, date]);
  if (!inst) {
    return (
      <div className="session">
        <div className="empty">
          Unknown subject. <button className="btn btn-sm" onClick={() => navigate('/')}>Back to today's game</button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="session"><div className="empty">Loading {inst.name} for {prettyDate(date)}…</div></div>;
  return <ScalperGame key={`${date}|${symbol}`} data={data} inst={inst} />;
}

type SheetName = 'tf' | 'indicators' | 'positions' | 'signals' | 'chain' | 'results' | null;

function ScalperGame({ data, inst }: { data: SessionData; inst: Instrument }) {
  const profiles = useGame((s) => s.profiles);
  const allTrades = useGame((s) => s.trades);
  const settings = useGame((s) => s.settings);
  const activeProfileId = useGame((s) => s.activeProfileId);
  const progress = useGame((s) => s.progress[progressKey(data.date, inst.id)]);
  const { setProgress, openTrade, closeTrade, patchTrade, setActiveProfile, setSettings, setSystem } = useGame.getState();

  const n = data.candles.length;
  const [cursor, setCursor] = useState(() => Math.min(n, Math.max(1, progress?.cursor ?? 1)));
  const cursorRef = useRef(cursor);
  const [playing, setPlaying] = useState(false);
  const [viewTf, setViewTf] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [strikeOffset, setStrikeOffset] = useState(0);
  const done = progress?.status === 'done';

  const clock = useMemo(() => dayClock(inst, data.date), [inst, data.date]);
  const expiry = useMemo(() => nearestExpiry(inst, data.date), [inst, data.date]);
  const history = useMemo(() => data.history.flatMap((d) => d.candles), [data]);
  const base = useMemo(() => history.concat(data.candles.slice(0, cursor)), [history, data, cursor]);
  const last = data.candles[cursor - 1];
  const now = last.time + 60;
  const spot = last.close;
  const change = spot - data.prevClose;

  const active: Profile | undefined = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const system = active?.system;
  const tf = viewTf ?? system?.timeframe ?? 5;

  const frames = useMemo(() => {
    const indicators = system?.indicators ?? [];
    const view = buildFrame(base, tf, inst, indicators);
    const sys = system && system.timeframe !== tf ? buildFrame(base, system.timeframe, inst, indicators) : view;
    return { view, sys };
  }, [base, tf, inst, system]);

  const callStatus = useMemo(() => evaluateSetup(system?.callRules ?? [], frames.sys.candles, frames.sys.values), [system, frames]);
  const putStatus = useMemo(() => evaluateSetup(system?.putRules ?? [], frames.sys.candles, frames.sys.values), [system, frames]);
  const studies = useMemo(() => toStudies(system?.indicators ?? [], frames.view.values), [system, frames]);
  const chartCandles = useMemo(
    () => (settings.chartType === 'heikin' ? heikinAshi(frames.view.candles) : frames.view.candles),
    [settings.chartType, frames],
  );

  const sessionTrades = useMemo(() => allTrades.filter((t) => t.date === data.date && t.symbol === inst.id), [allTrades, data.date, inst.id]);
  const tradeOf = (profileId: string) => sessionTrades.find((t) => t.profileId === profileId);
  const activeTrade = active ? tradeOf(active.id) : undefined;
  const openCount = sessionTrades.filter((t) => t.exitPremium === undefined).length;

  const premiumNow = useCallback((t: Pick<Trade, 'side' | 'strike' | 'expiry'>) => premiumFor(data, t.side, t.strike, spot, now, t.expiry), [data, spot, now]);

  // ---- Replay engine -------------------------------------------------------

  const finish = useCallback(() => {
    setPlaying(false);
    const state = useGame.getState();
    const lastCandle = data.candles[n - 1];
    for (const t of state.trades) {
      if (t.date !== data.date || t.symbol !== inst.id || t.exitPremium !== undefined) continue;
      const p = premiumFor(data, t.side, t.strike, lastCandle.close, lastCandle.time + 60, t.expiry);
      state.closeTrade(t.id, { time: lastCandle.time + 60, spot: lastCandle.close, premium: p, reason: 'squareoff' });
    }
    const best = {
      CE: bestPossibleRoi(inst.id, data.candles, 'CE', expiry, data.iv, clock.squareOff),
      PE: bestPossibleRoi(inst.id, data.candles, 'PE', expiry, data.iv, clock.squareOff),
    };
    for (const t of useGame.getState().trades) {
      if (t.date === data.date && t.symbol === inst.id && t.bestRoiPct === undefined) patchTrade(t.id, { bestRoiPct: best[t.side] });
    }
    setProgress(data.date, inst.id, { cursor: n, status: 'done', best });
    setSheet('results');
  }, [data, inst, n, expiry, clock, patchTrade, setProgress]);

  const advance = useCallback(
    (steps: number) => {
      const from = cursorRef.current;
      const to = Math.min(n, from + steps);
      for (let i = from; i < to; i++) {
        const candle = data.candles[i];
        for (const t of useGame.getState().trades) {
          if (t.date !== data.date || t.symbol !== inst.id || t.exitPremium !== undefined) continue;
          const fill = checkExit(t, candle, data, clock);
          if (fill) {
            closeTrade(t.id, fill);
            const who = useGame.getState().profiles.find((p) => p.id === t.profileId)?.name ?? 'Profile';
            if (fill.reason !== 'squareoff') showToast(`${who}: ${t.side} ${fill.reason === 'target' ? 'target hit' : 'stop-loss hit'} at ₹${price(fill.premium)}`);
          }
        }
      }
      cursorRef.current = to;
      setCursor(to);
      if (Math.floor(to / 15) !== Math.floor(from / 15)) setProgress(data.date, inst.id, { cursor: to, status: 'playing' });
      if (to >= n) finish();
    },
    [n, data, inst, clock, closeTrade, setProgress, finish],
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    let acc = 0;
    const loop = (ts: number) => {
      acc += ((ts - prev) / 1000) * settings.speed;
      prev = ts;
      const steps = Math.floor(acc);
      if (steps > 0) {
        acc -= steps;
        advance(steps);
      }
      if (cursorRef.current < n) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, settings.speed, advance, n]);

  // Save the replay position when leaving or pausing.
  useEffect(() => {
    if (!playing && !done) setProgress(data.date, inst.id, { cursor: cursorRef.current, status: 'playing' });
  }, [playing, done, data.date, inst.id, setProgress]);
  useEffect(
    () => () => {
      const p = useGame.getState().progress[progressKey(data.date, inst.id)];
      if (p?.status !== 'done') useGame.getState().setProgress(data.date, inst.id, { cursor: cursorRef.current, status: 'playing' });
    },
    [data.date, inst.id],
  );

  // ---- Orders ---------------------------------------------------------------

  const atm = atmStrike(spot, inst.strikeStep);
  const strike = atm + strikeOffset * inst.strikeStep;
  const quote = (side: OptionSide) => premiumFor(data, side, strike, spot, now, expiry);
  const entriesClosed = now >= clock.squareOff;

  const cashFor = (profileId: string) => {
    const mine = allTrades.filter((t) => t.profileId === profileId);
    const balance = profileStats(mine).balance;
    const locked = mine.filter((t) => t.exitPremium === undefined).reduce((s, t) => s + premiumPaid(t), 0);
    return balance - locked;
  };

  const enter = (side: OptionSide) => {
    if (!active || !system || activeTrade || entriesClosed || done) return;
    const premium = quote(side);
    const qty = system.risk.lots * inst.lotSize;
    if (premium * qty > cashFor(active.id)) {
      showToast(`Not enough virtual cash for ${system.risk.lots} lot${system.risk.lots > 1 ? 's' : ''}. Lower the lots in ${active.name}'s system.`);
      return;
    }
    const { stop, target } = planLevels(premium, system.risk.stopLossPct, system.risk.targetPct);
    openTrade({
      id: newTradeId(),
      profileId: active.id,
      date: data.date,
      symbol: inst.id,
      side,
      strike,
      expiry,
      lots: system.risk.lots,
      qty,
      entryTime: now,
      entrySpot: spot,
      entryPremium: premium,
      entrySignal: signalMatch(side, callStatus, putStatus),
      stopPremium: stop,
      targetPremium: target,
    });
    setProgress(data.date, inst.id, { cursor: cursorRef.current, status: 'playing' });
    showToast(`${active.name} bought ${strike} ${side} at ₹${price(premium)}`);
  };

  const exit = (t: Trade) => {
    closeTrade(t.id, { time: now, spot, premium: premiumNow(t), reason: 'manual' });
    setProgress(data.date, inst.id, { cursor: cursorRef.current, status: 'playing' });
  };

  // ---- Chart decorations ------------------------------------------------------

  const markers = useMemo(() => {
    const list: MarkerSpec[] = [];
    for (const t of sessionTrades) {
      const p = profiles.find((x) => x.id === t.profileId);
      if (!p) continue;
      const tag = p.name.slice(0, 1).toUpperCase();
      list.push({
        time: bucketStart(t.entryTime - 60, tf, inst),
        position: t.side === 'CE' ? 'belowBar' : 'aboveBar',
        color: p.color,
        shape: t.side === 'CE' ? 'arrowUp' : 'arrowDown',
        text: `${tag} ${t.side}`,
      });
      if (t.exitTime !== undefined && t.exitTime <= now) {
        list.push({ time: bucketStart(t.exitTime - 60, tf, inst), position: t.side === 'CE' ? 'aboveBar' : 'belowBar', color: p.color, shape: 'circle', text: `${tag} exit` });
      }
    }
    return list.sort((a, b) => a.time - b.time);
  }, [sessionTrades, profiles, tf, inst, now]);

  const priceLines = useMemo<PriceLineSpec[]>(
    () => (activeTrade && activeTrade.exitPremium === undefined ? [{ price: activeTrade.entrySpot, color: active?.color ?? '#888', title: `${activeTrade.side} entry` }] : []),
    [activeTrade, active],
  );

  // ---- Derived display ---------------------------------------------------------

  const activePnl = activeTrade
    ? activeTrade.exitPremium === undefined
      ? livePnl(activeTrade, premiumNow(activeTrade)).net
      : (tradeResult(activeTrade)?.net ?? 0)
    : 0;
  const pct = (cursor / n) * 100;
  const allSlotsUsed = profiles.length > 0 && profiles.every((p) => tradeOf(p.id) && tradeOf(p.id)!.exitPremium !== undefined);

  if (!active || !system) {
    return (
      <div className="session">
        <div className="empty">
          <p>Create your trader profiles before you play.</p>
          <button className="btn btn-primary" onClick={() => navigate('/profiles')}>
            Create profiles
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="session">
      <header className="s-top">
        <button className="icon-btn bare" aria-label="Leave replay" onClick={() => navigate('/')}>
          <IconClose size={26} />
        </button>
        <div className="s-box num" aria-label="Replay time">
          <span className="s-clock">{istClock12(now).replace(/ (AM|PM)/, '')}</span>
          <small>{istClock12(now).slice(-2)} IST</small>
        </div>
        <span className="spacer" />
        <div className="s-box num" aria-label={`${active.name} P&L`}>
          <small>P&amp;L</small>
          <span className={tone(activePnl)}>{signedRupees(activePnl)}</span>
        </div>
        <div className="badge-wrap">
          <button className="s-box" onClick={() => setSheet('positions')}>
            Positions
          </button>
          <span className="count-badge num">{openCount}</span>
        </div>
      </header>

      <div className="s-inst">
        <div className="s-inst-main">
          <div className="s-inst-name">
            {inst.name} <span className="muted">Spot</span>
          </div>
          <div className="s-inst-price num">
            {price(spot)}
            <span className={`chg ${tone(change)}`}>
              {change >= 0 ? '+' : '−'}
              {price(Math.abs(change))} ({Math.abs((change / data.prevClose) * 100).toFixed(2)}%)
            </span>
          </div>
        </div>
        <div className="s-tools">
          <button className="link-btn" onClick={() => setSheet('chain')}>
            Option chain
          </button>
          <button className="btn btn-sm" onClick={() => setSheet('tf')} aria-label={`Timeframe ${timeframeLabel(tf)}, ${settings.chartType} chart`}>
            {settings.chartType === 'wave' ? <IconWave size={16} /> : <IconCandles size={16} />}
            {timeframeLabel(tf)}
          </button>
          <button className="icon-btn" aria-label="Indicators" onClick={() => setSheet('indicators')}>
            <IconSliders />
          </button>
        </div>
      </div>

      <div className="s-chart-wrap">
        <PriceChart
          candles={chartCandles}
          chartType={settings.chartType}
          studies={studies}
          markers={markers}
          priceLines={priceLines}
          pricePrecision={inst.tickSize < 1 ? 2 : 0}
          minMove={inst.tickSize}
          frameKey={`${tf}|${settings.chartType}`}
        />
        <span className="sim-tag pill" title={data.sourceLabel}>
          {settings.chartType === 'heikin' ? 'Heikin Ashi · ' : ''}
          {data.source === 'simulated' ? 'Simulated' : 'Market data'}
        </span>
      </div>

      <div className="s-replay">
        <button className="play-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} disabled={done}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <div className="track">
          <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="track-labels num">
            <span>{inst.session.open}</span>
            <span>{istClock(now)}</span>
            <span>{inst.session.close}</span>
          </div>
        </div>
        <button className="icon-btn" aria-label="Next minute" onClick={() => advance(1)} disabled={done}>
          <IconStep size={20} />
        </button>
        <button className="icon-btn" aria-label="Skip 15 minutes" onClick={() => advance(15)} disabled={done}>
          <IconSkip size={20} />
        </button>
        <button
          className="chip num"
          aria-label="Replay speed"
          onClick={() => setSettings({ speed: SPEEDS[(SPEEDS.indexOf(settings.speed) + 1) % SPEEDS.length] })}
        >
          {settings.speed}x
        </button>
      </div>

      <div className="s-panel">
        <div className="signals">
          <SignalChip side="CE" status={callStatus} onOpen={() => setSheet('signals')} />
          <SignalChip side="PE" status={putStatus} onOpen={() => setSheet('signals')} />
        </div>

        <div className="s-profiles" role="group" aria-label="Choose profile">
          {profiles.map((p) => {
            const t = tradeOf(p.id);
            let state = 'Ready';
            let cls = 'muted';
            if (t && t.exitPremium === undefined) {
              const live = livePnl(t, premiumNow(t)).net;
              state = `${t.side} ${signedRupees(live)}`;
              cls = tone(live);
            } else if (t) {
              const r = tradeResult(t)!;
              state = `Done ${signedRupees(r.net)}`;
              cls = tone(r.net);
            } else if (done) state = 'No trade';
            return (
              <button key={p.id} className="s-profile" aria-pressed={p.id === active.id} onClick={() => setActiveProfile(p.id)}>
                <Avatar name={p.name} color={p.color} size="sm" />
                <div>
                  <strong>{p.name}</strong>
                  <span className={`num ${cls}`}>{state}</span>
                </div>
              </button>
            );
          })}
        </div>

        <OrderPanel
          inst={inst}
          done={done}
          trade={activeTrade}
          entriesClosed={entriesClosed}
          squareOffLabel={istClock(clock.squareOff)}
          strike={strike}
          atm={atm}
          expiry={expiry}
          lots={system.risk.lots}
          stopPct={system.risk.stopLossPct}
          targetPct={system.risk.targetPct}
          quote={quote}
          premiumNow={premiumNow}
          onEnter={enter}
          onExit={exit}
          onResults={() => setSheet('results')}
          allSlotsUsed={allSlotsUsed}
          onFinish={() => {
            setPlaying(false);
            advance(n);
          }}
        />
      </div>

      {sheet === 'tf' && (
        <Sheet title="Chart" onClose={() => setSheet(null)}>
          <p className="help">Your system reads signals on {timeframeLabel(system.timeframe)} candles, whatever you view.</p>
          <div className="tags">
            {TIMEFRAMES.map((m) => (
              <button
                key={m}
                className="chip"
                aria-pressed={m === tf}
                onClick={() => {
                  setViewTf(m === system.timeframe ? null : m);
                  setSheet(null);
                }}
              >
                {timeframeLabel(m)}
                {m === system.timeframe ? ' · system' : ''}
              </button>
            ))}
          </div>
          <div className="tags">
            {(['candles', 'heikin', 'wave'] as const).map((t) => (
              <button key={t} className="chip" aria-pressed={settings.chartType === t} onClick={() => setSettings({ chartType: t })}>
                {t === 'candles' ? 'Candlesticks' : t === 'heikin' ? 'Heikin Ashi' : 'Wave (line)'}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {sheet === 'indicators' && (
        <Sheet
          title={`Added indicators (${system.indicators.length})`}
          onClose={() => setSheet(null)}
          footerSingle
          footer={
            <button className="btn btn-primary" onClick={() => navigate(`/profiles/${active.id}/system`)}>
              Edit {active.name}'s system
            </button>
          }
        >
          <div>
            {system.indicators.map((ind) => (
              <div className="ind-row" key={ind.id}>
                <span className="label">{indicatorLabel(ind)}</span>
                <button
                  className="icon-btn bare"
                  aria-label={ind.visible ? `Hide ${indicatorLabel(ind)}` : `Show ${indicatorLabel(ind)}`}
                  onClick={() =>
                    setSystem(active.id, { ...system, indicators: system.indicators.map((x) => (x.id === ind.id ? { ...x, visible: !x.visible } : x)) })
                  }
                >
                  {ind.visible ? <IconEye /> : <IconEyeOff />}
                </button>
              </div>
            ))}
          </div>
          <p className="help">Hidden indicators still count in your system rules.</p>
        </Sheet>
      )}

      {sheet === 'signals' && (
        <Sheet title={`${system.name}`} onClose={() => setSheet(null)}>
          <p className="help">
            {active.name} · signals on {timeframeLabel(system.timeframe)} candles. Entering while a setup is live earns discipline points.
          </p>
          <RuleChecks title="CALL setup" status={callStatus} indicators={system.indicators} />
          <RuleChecks title="PUT setup" status={putStatus} indicators={system.indicators} />
          {system.notes && (
            <div className="section">
              <p className="eyebrow">Trading plan</p>
              <p className="lede">{system.notes}</p>
            </div>
          )}
        </Sheet>
      )}

      {sheet === 'chain' && (
        <Sheet title={`Option chain · ${formatExpiry(expiry)} expiry`} onClose={() => setSheet(null)}>
          <p className="help">Theoretical premiums (Black-Scholes, IV {(data.iv * 100).toFixed(1)}%). Tap a strike to trade it.</p>
          <div>
            {[-3, -2, -1, 0, 1, 2, 3].map((off) => {
              const k = atm + off * inst.strikeStep;
              const ce = premiumFor(data, 'CE', k, spot, now, expiry);
              const pe = premiumFor(data, 'PE', k, spot, now, expiry);
              return (
                <button
                  key={off}
                  className="ind-row"
                  style={{ width: '100%', background: off === strikeOffset ? 'var(--accent-soft)' : 'none', border: 0, borderRadius: 10, padding: '0 8px' }}
                  onClick={() => {
                    setStrikeOffset(off);
                    setSheet(null);
                  }}
                >
                  <span className="num up" style={{ flex: 1, textAlign: 'left' }}>
                    CE {price(ce)}
                  </span>
                  <strong className="num" style={{ flex: 1, textAlign: 'center' }}>
                    {k}
                    {off === 0 ? ' ATM' : ''}
                  </strong>
                  <span className="num down" style={{ flex: 1, textAlign: 'right' }}>
                    PE {price(pe)}
                  </span>
                </button>
              );
            })}
          </div>
        </Sheet>
      )}

      {sheet === 'positions' && (
        <Sheet title={`Positions · ${inst.name}`} onClose={() => setSheet(null)}>
          {sessionTrades.length === 0 && <p className="empty">No trades yet today.</p>}
          {sessionTrades.map((t) => {
            const p = profiles.find((x) => x.id === t.profileId);
            const open = t.exitPremium === undefined;
            const net = open ? livePnl(t, premiumNow(t)).net : tradeResult(t)!.net;
            return (
              <div className="result-row" key={t.id}>
                {p && <Avatar name={p.name} color={p.color} />}
                <div className="what">
                  <strong>
                    {t.strike} {t.side} · {t.qty} qty
                  </strong>
                  <span className="muted num">
                    {istClock(t.entryTime)} @ ₹{price(t.entryPremium)}
                    {open ? ` · LTP ₹${price(premiumNow(t))}` : ` → ${istClock(t.exitTime!)} @ ₹${price(t.exitPremium!)}`}
                  </span>
                </div>
                <div className="score num">
                  <span className={tone(net)}>{signedRupees(net)}</span>
                  <small className="muted">{open ? 'Open' : exitLabel(t)}</small>
                </div>
              </div>
            );
          })}
        </Sheet>
      )}

      {sheet === 'results' && done && (
        <ResultsSheet
          inst={inst}
          date={data.date}
          profiles={profiles}
          trades={sessionTrades}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function exitLabel(t: Trade): string {
  switch (t.exitReason) {
    case 'target':
      return 'Target hit';
    case 'stoploss':
      return 'Stop-loss hit';
    case 'squareoff':
      return 'Auto square-off';
    default:
      return 'Exited';
  }
}

function SignalChip({ side, status, onOpen }: { side: OptionSide; status: SetupStatus; onOpen: () => void }) {
  const live = status.active;
  return (
    <button className={`signal${live ? (side === 'CE' ? ' live-ce' : ' live-pe') : ''}`} onClick={onOpen} aria-label={`${side === 'CE' ? 'Call' : 'Put'} setup ${status.passed} of ${status.checks.length} conditions`}>
      <span className={live ? (side === 'CE' ? 'up' : 'down') : undefined}>{side === 'CE' ? 'CALL' : 'PUT'} setup{live ? ' live' : ''}</span>
      <span className={`dots ${side === 'CE' ? 'up' : 'down'}`}>
        {status.checks.map((c) => (
          <i key={c.rule.id} className={c.pass ? 'on' : ''} />
        ))}
      </span>
    </button>
  );
}

function RuleChecks({ title, status, indicators }: { title: string; status: SetupStatus; indicators: Parameters<typeof ruleLabel>[1] }) {
  return (
    <div className="section">
      <div className="section-head">
        <p className="eyebrow">{title}</p>
        <span className={`pill ${status.active ? 'accent' : ''}`}>
          {status.passed}/{status.checks.length} {status.active ? 'live' : ''}
        </span>
      </div>
      {status.checks.length === 0 && <p className="help">No conditions. Add some in the system editor.</p>}
      <ul className="check-list">
        {status.checks.map((c) => (
          <li key={c.rule.id}>
            <span className={`mark ${c.pass === true ? 'up' : c.pass === false ? 'down' : 'muted'}`}>{c.pass === true ? '✓' : c.pass === false ? '✕' : '…'}</span>
            <span>
              {ruleLabel(c.rule, indicators)}
              {c.pass === null && <span className="muted"> (warming up)</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface OrderPanelProps {
  inst: Instrument;
  done: boolean;
  trade: Trade | undefined;
  entriesClosed: boolean;
  squareOffLabel: string;
  strike: number;
  atm: number;
  expiry: number;
  lots: number;
  stopPct: number;
  targetPct: number;
  quote: (side: OptionSide) => number;
  premiumNow: (t: Trade) => number;
  onEnter: (side: OptionSide) => void;
  onExit: (t: Trade) => void;
  onResults: () => void;
  onFinish: () => void;
  allSlotsUsed: boolean;
}

function OrderPanel(p: OrderPanelProps) {
  if (p.done) {
    return (
      <div className="locked">
        <span>Day complete. Every slot is scored.</span>
        <button className="btn btn-primary btn-sm" onClick={p.onResults}>
          See results
        </button>
      </div>
    );
  }
  if (p.trade && p.trade.exitPremium === undefined) {
    const t = p.trade;
    const ltp = p.premiumNow(t);
    const { net, pct } = livePnl(t, ltp);
    return (
      <div className="section">
        <div className="position">
          <span className="pos-title">
            {t.strike} {t.side} <span className="pill">{formatExpiry(t.expiry)}</span>
          </span>
          <span className={`pos-pnl num ${tone(net)}`}>{signedRupees(net)}</span>
          <span className="pos-meta num">
            {t.qty} qty · Avg ₹{price(t.entryPremium)} · LTP ₹{price(ltp)}
          </span>
          <span className={`pos-meta num ${tone(pct)}`} style={{ textAlign: 'right' }}>
            {signedPct(pct)}
          </span>
          <span className="pos-meta num" style={{ gridColumn: '1 / -1' }}>
            {t.stopPremium !== null ? `SL ₹${price(t.stopPremium)}` : 'No stop'} · {t.targetPremium !== null ? `Target ₹${price(t.targetPremium)}` : 'No target'} · Auto square-off{' '}
            {p.squareOffLabel}
          </span>
        </div>
        <button className="btn btn-primary btn-block" onClick={() => p.onExit(t)}>
          Exit {t.side} at ₹{price(ltp)}
        </button>
      </div>
    );
  }
  if (p.trade) {
    const r = tradeResult(p.trade)!;
    return (
      <div className="section">
        <div className="locked">
          <span>
            <IconLock size={16} /> Slot used: {p.trade.side} {exitLabel(p.trade).toLowerCase()}
          </span>
          <span className={`num ${tone(r.net)}`}>
            {signedRupees(r.net)} · {signedPts(r.points)} pts
          </span>
        </div>
        {p.allSlotsUsed && (
          <button className="btn btn-outline btn-block" onClick={p.onFinish}>
            All profiles traded · finish the day
          </button>
        )}
      </div>
    );
  }
  const qty = p.lots * p.inst.lotSize;
  const ce = p.quote('CE');
  const pe = p.quote('PE');
  return (
    <div className="section">
      {p.entriesClosed && (
        <div className="notice">
          <IconAlert size={18} /> Entries closed at the {p.squareOffLabel} square-off. Play on to finish the day.
        </div>
      )}
      <div className="order-legs">
        <div className="order-leg">
          <button className="btn btn-call" disabled={p.entriesClosed} onClick={() => p.onEnter('CE')}>
            BUY CALL
            <small className="num">
              {p.strike} CE · ₹{price(ce)}
            </small>
          </button>
        </div>
        <div className="order-leg">
          <button className="btn btn-put" disabled={p.entriesClosed} onClick={() => p.onEnter('PE')}>
            BUY PUT
            <small className="num">
              {p.strike} PE · ₹{price(pe)}
            </small>
          </button>
        </div>
      </div>
      <div className="order-meta num">
        <span>
          {p.lots} lot · {qty} qty · {p.strike === p.atm ? 'ATM' : `${p.strike > p.atm ? '+' : '−'}${Math.abs(p.strike - p.atm)}`}
        </span>
        <span>
          SL {p.stopPct || '–'}% · TGT {p.targetPct || '–'}% · {rupees(Math.max(ce, pe) * qty)} max
        </span>
      </div>
    </div>
  );
}

function ResultsSheet({ inst, date, profiles, trades, onClose }: { inst: Instrument; date: string; profiles: Profile[]; trades: Trade[]; onClose: () => void }) {
  const progress = useGame((s) => s.progress);
  const other = INSTRUMENTS.map((i) => i.id).find((s) => s !== inst.id && progress[progressKey(date, s)]?.status !== 'done');
  const best = progress[progressKey(date, inst.id)]?.best;
  return (
    <Sheet
      title={`${inst.name} · ${prettyDate(date)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={() => navigate('/scorecard')}>
            Scorecard
          </button>
          {other ? (
            <button className="btn btn-primary" onClick={() => navigate(`/play/${date}/${other}`)}>
              Play {getInstrument(other).name}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => navigate('/')}>
              Done
            </button>
          )}
        </>
      }
    >
      <p className="help">One entry and one exit per profile. Points = return on premium, +10 for entering on your system's signal, +5 for exiting by your plan.</p>
      <div>
        {profiles.map((p) => {
          const t = trades.find((x) => x.profileId === p.id);
          const r = t ? tradeResult(t) : null;
          return (
            <div className="result-row" key={p.id}>
              <Avatar name={p.name} color={p.color} />
              <div className="what">
                <strong>{p.name}</strong>
                {t && r ? (
                  <span className="muted num">
                    {t.strike} {t.side} ₹{price(t.entryPremium)} → ₹{price(t.exitPremium!)} · {exitLabel(t)}
                    {r.capture !== null && ` · caught ${Math.round(r.capture * 100)}% of the best move`}
                  </span>
                ) : (
                  <span className="muted">No trade · 0 pts</span>
                )}
                {r && (
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {r.parts.map((x) => `${x.label} ${signedPts(x.points)}`).join(' · ')}
                  </span>
                )}
              </div>
              <div className="score num">
                <span className={tone(r?.points ?? 0)}>{signedPts(r?.points ?? 0)} pts</span>
                {r && <small className={tone(r.net)}>{signedRupees(r.net)}</small>}
              </div>
            </div>
          );
        })}
      </div>
      {best && (
        <p className="help">
          Best possible ATM trade today: CALL {signedPct(best.CE, 0)} · PUT {signedPct(best.PE, 0)} on the premium.
        </p>
      )}
    </Sheet>
  );
}

