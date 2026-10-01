import { useEffect, useMemo, useState } from 'react';
import { IconAlert, IconChevron, Wordmark } from '../components/Icons';
import { Avatar } from '../components/ui';
import { istClock, prettyDate } from '../lib/calendar';
import { price, signedRupees, tone } from '../lib/format';
import { INSTRUMENTS } from '../lib/instruments';
import { DataIndex, hasMarketData, loadIndex, loadSession, recentGameDays } from '../lib/market/provider';
import { tradeResult } from '../lib/scoring';
import type { SessionData } from '../lib/types';
import { navigate } from '../router';
import { MAX_PROFILES, progressKey, useGame } from '../store/game';

export function Home() {
  const [index, setIndex] = useState<DataIndex | null | undefined>(undefined);
  useEffect(() => {
    loadIndex().then(setIndex);
  }, []);
  const days = useMemo(() => recentGameDays(index ?? null), [index]);
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? days[0];

  const profiles = useGame((s) => s.profiles);
  const trades = useGame((s) => s.trades);
  const progress = useGame((s) => s.progress);

  const slotsTotal = INSTRUMENTS.length * Math.max(profiles.length, 1);
  const slotsUsed = trades.filter((t) => t.date === date && t.exitPremium !== undefined).length;
  const isYesterday = date === days[0];

  return (
    <main className="screen">
      <header className="topbar">
        <div className="wordmark">
          <Wordmark />
          <h1>Paper Scalper</h1>
        </div>
        <span className="pill accent">Daily game</span>
      </header>

      <section className="hero" aria-label="Today's game">
        <div className="section">
          <p className="eyebrow">{isYesterday ? "Replay yesterday's market" : 'Catch-up day'}</p>
          <p className="hero-date">{prettyDate(date, true)}</p>
          <p className="lede">
            Watch the session minute by minute and take one options trade per profile in each subject. The future candles stay hidden until you reach
            them.
          </p>
        </div>
        <div className="rules-strip">
          <div>
            <strong className="num">{INSTRUMENTS.length}</strong>
            <span>subjects</span>
          </div>
          <div>
            <strong className="num">{profiles.length}/{MAX_PROFILES}</strong>
            <span>profiles</span>
          </div>
          <div>
            <strong className="num">1</strong>
            <span>CALL or PUT each</span>
          </div>
        </div>
        <div className="section" style={{ gap: 6 }}>
          <div className="section-head">
            <span className="help">Trades scored</span>
            <span className="help num">
              {slotsUsed}/{slotsTotal}
            </span>
          </div>
          <div className="progress">
            <span style={{ width: `${Math.min(100, (slotsUsed / slotsTotal) * 100)}%` }} />
          </div>
        </div>
      </section>

      {profiles.length < MAX_PROFILES && (
        <button className="notice" style={{ border: 0, textAlign: 'left' }} onClick={() => navigate('/profiles')}>
          <IconAlert size={18} />
          <span>
            {profiles.length === 0
              ? 'Create your three trader profiles to start. Each one trades with its own system.'
              : `You have ${profiles.length} of ${MAX_PROFILES} profiles. Add the rest to fill every slot.`}{' '}
            <strong>Set up profiles</strong>
          </span>
        </button>
      )}

      <section className="section">
        <div className="section-head">
          <p className="eyebrow">Pick a day</p>
        </div>
        <div className="scroll-x" role="group" aria-label="Trading days">
          {days.map((d, i) => {
            const doneCount = INSTRUMENTS.filter((s) => progress[progressKey(d, s.id)]?.status === 'done').length;
            return (
              <button key={d} className="day-chip" aria-pressed={d === date} onClick={() => setPicked(d)}>
                <strong>{prettyDate(d)}</strong>
                <span>
                  {i === 0 ? 'Yesterday · ' : ''}
                  {doneCount === INSTRUMENTS.length ? 'Complete' : doneCount ? `${doneCount}/${INSTRUMENTS.length} done` : 'Not played'}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="section">
        <p className="eyebrow">Subjects</p>
        {INSTRUMENTS.map((inst) => (
          <SubjectCard key={`${date}-${inst.id}`} date={date} symbol={inst.id} market={index === undefined ? null : hasMarketData(index ?? null, date, inst.id)} />
        ))}
      </section>

      <section className="section">
        <p className="eyebrow">Coming next</p>
        <div className="card section" style={{ gap: 6 }}>
          <span className="help">
            <strong style={{ color: 'var(--fg)' }}>V2</strong> · pick from multiple ready-made systems, three more subjects.
          </span>
          <span className="help">
            <strong style={{ color: 'var(--fg)' }}>V3</strong> · system templates, five more subjects, levels, weekly feedback and monthly reports.
          </span>
        </div>
      </section>
    </main>
  );
}

function SubjectCard({ date, symbol, market }: { date: string; symbol: string; market: boolean | null }) {
  const inst = INSTRUMENTS.find((i) => i.id === symbol)!;
  const profiles = useGame((s) => s.profiles);
  const trades = useGame((s) => s.trades);
  const progress = useGame((s) => s.progress[progressKey(date, symbol)]);
  const [data, setData] = useState<SessionData | null>(null);
  useEffect(() => {
    let live = true;
    loadSession(symbol, date).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [symbol, date]);

  const status = progress?.status === 'done' ? 'done' : progress ? 'playing' : 'new';
  const replayTime = data && progress && status === 'playing' ? istClock(data.candles[Math.max(0, Math.min(data.candles.length, progress.cursor) - 1)].time + 60) : null;
  const disabled = profiles.length === 0;
  const cta = status === 'done' ? 'Review day' : status === 'playing' ? `Resume at ${replayTime ?? '…'}` : 'Start replay';

  return (
    <article className="card subject">
      <div className="subject-head">
        <div>
          <h3 className="subject-name">{inst.name}</h3>
          <div className="subject-meta">
            <span className="pill">
              {inst.exchange} · {inst.segment}
            </span>
            {market !== null && <span className={`pill ${market ? 'up' : 'warn'}`}>{market ? 'Market data' : 'Simulated'}</span>}
          </div>
        </div>
        <div className="subject-prev">
          Prev close
          <strong className="num">{data ? price(data.prevClose) : '—'}</strong>
          {inst.session.open}–{inst.session.close} IST
        </div>
      </div>

      {profiles.length > 0 && (
        <div className="slots">
          {profiles.map((p) => {
            const t = trades.find((x) => x.profileId === p.id && x.date === date && x.symbol === symbol);
            let text = status === 'done' ? 'No trade' : 'Open slot';
            let cls = 'slot-state';
            if (t && t.exitPremium !== undefined) {
              const r = tradeResult(t)!;
              text = `${t.side} ${signedRupees(r.net)}`;
              cls += ` ${tone(r.net)}`;
            } else if (t) {
              text = `${t.side} open`;
            }
            return (
              <div className="slot" key={p.id}>
                <Avatar name={p.name} color={p.color} size="sm" />
                <div>
                  <div className="slot-name">{p.name}</div>
                  <div className={`num ${cls}`}>{text}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button className={`btn ${status === 'done' ? 'btn-outline' : 'btn-primary'} btn-block`} disabled={disabled} onClick={() => navigate(`/play/${date}/${symbol}`)}>
        {cta} <IconChevron size={18} />
      </button>
    </article>
  );
}
