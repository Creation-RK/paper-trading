import { useMemo, useState } from 'react';
import { Avatar } from '../components/ui';
import { istClock, prettyDate } from '../lib/calendar';
import { price, rupees, signedPct, signedPts, signedRupees, tone } from '../lib/format';
import { getInstrument, INSTRUMENTS } from '../lib/instruments';
import { dayGrade, profileStats, ProfileStats, STARTING_CAPITAL, tradeResult } from '../lib/scoring';
import type { Trade } from '../lib/types';
import { navigate } from '../router';
import { Profile, progressKey, useGame } from '../store/game';

export function Scorecard() {
  const profiles = useGame((s) => s.profiles);
  const trades = useGame((s) => s.trades);
  const progress = useGame((s) => s.progress);

  const ranked = useMemo(
    () =>
      profiles
        .map((p) => ({ profile: p, stats: profileStats(trades.filter((t) => t.profileId === p.id)) }))
        .sort((a, b) => b.stats.points - a.stats.points || b.stats.net - a.stats.net),
    [profiles, trades],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const focus = ranked.find((r) => r.profile.id === selected) ?? ranked[0];

  const days = useMemo(() => {
    const dates = new Set<string>();
    for (const key of Object.keys(progress)) if (progress[key].status === 'done') dates.add(key.split('|')[0]);
    for (const t of trades) dates.add(t.date);
    return [...dates].sort().reverse();
  }, [progress, trades]);

  if (profiles.length === 0) {
    return (
      <main className="screen">
        <header className="topbar">
          <h1>Scorecard</h1>
        </header>
        <div className="empty">
          <p>Your scorecard fills in once your profiles start trading.</p>
          <button className="btn btn-primary" onClick={() => navigate('/profiles')}>
            Create profiles
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="screen">
      <header className="topbar">
        <h1>Scorecard</h1>
        <span className="pill num">{trades.filter((t) => t.exitPremium !== undefined).length} trades</span>
      </header>

      <section className="section">
        <p className="eyebrow">Leaderboard</p>
        <div className="card podium" style={{ paddingBlock: 4 }}>
          {ranked.map(({ profile, stats }, i) => (
            <div className="podium-row" key={profile.id}>
              <span className="podium-rank num">{i + 1}</span>
              <Avatar name={profile.name} color={profile.color} />
              <div style={{ minWidth: 0 }}>
                <strong>{profile.name}</strong>
                <div className="help num">
                  {stats.trades} trade{stats.trades === 1 ? '' : 's'} · {Math.round(stats.winRate * 100)}% wins · {rupees(stats.balance)}
                </div>
              </div>
              <div className="podium-pts num">
                <strong>{signedPts(stats.points)}</strong>
                <span className={tone(stats.net)}>{signedRupees(stats.net)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {focus && (
        <>
          <div className="segmented" role="group" aria-label="Profile" style={{ alignSelf: 'flex-start' }}>
            {ranked.map(({ profile }) => (
              <button key={profile.id} aria-pressed={profile.id === focus.profile.id} onClick={() => setSelected(profile.id)}>
                {profile.name}
              </button>
            ))}
          </div>
          <ProfileDetail profile={focus.profile} stats={focus.stats} trades={trades.filter((t) => t.profileId === focus.profile.id)} />
        </>
      )}

      <section className="section">
        <p className="eyebrow">Days</p>
        {days.length === 0 && <p className="help">Finish a replay to see the day's grades here.</p>}
        {days.length > 0 && (
          <div className="card" style={{ paddingBlock: 4 }}>
            {days.map((d) => {
              const doneCount = INSTRUMENTS.filter((s) => progress[progressKey(d, s.id)]?.status === 'done').length;
              return (
                <div className="journal-row" key={d}>
                  <span className="grade" aria-label="Day grade">
                    {dayGrade(trades.filter((t) => t.date === d).reduce((s, t) => s + (tradeResult(t)?.points ?? 0), 0) / Math.max(1, profiles.length))}
                  </span>
                  <div className="what">
                    <strong>{prettyDate(d, true)}</strong>
                    {doneCount}/{INSTRUMENTS.length} subjects finished
                  </div>
                  <div className="score num" style={{ display: 'flex', gap: 6 }}>
                    {profiles.map((p) => {
                      const pts = trades.filter((t) => t.date === d && t.profileId === p.id).reduce((s, t) => s + (tradeResult(t)?.points ?? 0), 0);
                      return (
                        <span key={p.id} title={p.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          <Avatar name={p.name} color={p.color} size="sm" />
                          <span className={tone(pts)}>{signedPts(pts)}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="help">Day grade: average points per profile. S 120+, A 60+, B 20+, C 0+, D above −30, F below.</p>
      </section>
    </main>
  );
}

function ProfileDetail({ profile, stats, trades }: { profile: Profile; stats: ProfileStats; trades: Trade[] }) {
  const closed = trades.filter((t) => t.exitPremium !== undefined).sort((a, b) => (a.date === b.date ? (b.exitTime ?? 0) - (a.exitTime ?? 0) : a.date < b.date ? 1 : -1));
  const notes = coachNotes(closed);
  return (
    <>
      <section className="card section">
        <div className="stat-grid">
          <Stat label="Balance" value={rupees(stats.balance)} />
          <Stat label="Net P&L" value={signedRupees(stats.net)} cls={tone(stats.net)} />
          <Stat label="Points" value={signedPts(stats.points)} />
          <Stat label="Win rate" value={`${Math.round(stats.winRate * 100)}%`} />
          <Stat label="Avg return" value={signedPct(stats.avgRoi)} cls={tone(stats.avgRoi)} />
          <Stat label="On signal" value={`${Math.round(stats.discipline * 100)}%`} />
          <Stat label="Win streak" value={String(stats.winStreak)} />
          <Stat label="Best trade" value={stats.best ? signedRupees(stats.best.result.net) : '—'} cls={stats.best ? tone(stats.best.result.net) : undefined} />
          <Stat label="Worst trade" value={stats.worst ? signedRupees(stats.worst.result.net) : '—'} cls={stats.worst ? tone(stats.worst.result.net) : undefined} />
        </div>
        <EquityCurve values={stats.equity} color={profile.color} />
        <div className="split">
          {INSTRUMENTS.map((inst) => {
            const s = stats.bySymbol[inst.id];
            return (
              <div key={inst.id}>
                <span>{inst.name}</span>
                <strong className={`num ${tone(s?.net ?? 0)}`}>{signedRupees(s?.net ?? 0)}</strong>
                <span className="num">
                  {s?.trades ?? 0} trades · {signedPts(s?.points ?? 0)} pts
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {notes.length > 0 && (
        <section className="section">
          <p className="eyebrow">What the numbers say</p>
          <ul className="check-list">
            {notes.map((n) => (
              <li key={n}>
                <span className="mark accent" style={{ color: 'var(--accent)' }}>
                  •
                </span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <p className="eyebrow">Trade journal</p>
        {closed.length === 0 && <p className="help">No finished trades yet for {profile.name}.</p>}
        {closed.length > 0 && (
          <div className="card" style={{ paddingBlock: 4 }}>
            {closed.map((t) => {
              const r = tradeResult(t)!;
              return (
                <div className="journal-row" key={t.id}>
                  <span className={`pill ${t.side === 'CE' ? 'up' : 'down'}`}>{t.side}</span>
                  <div className="what num">
                    <strong>
                      {getInstrument(t.symbol).name} {t.strike}
                    </strong>
                    {prettyDate(t.date)} · {istClock(t.entryTime)}→{istClock(t.exitTime!)} · ₹{price(t.entryPremium)}→₹{price(t.exitPremium!)}
                    <br />
                    {t.entrySignal === 'with' ? 'On signal' : t.entrySignal === 'against' ? 'Against signal' : 'Off signal'} ·{' '}
                    {t.exitReason === 'target' ? 'target' : t.exitReason === 'stoploss' ? 'stop-loss' : t.exitReason === 'squareoff' ? 'square-off' : 'manual exit'}
                    {r.capture !== null && ` · ${Math.round(r.capture * 100)}% of best move`}
                  </div>
                  <div className="score num">
                    <strong className={tone(r.net)}>{signedRupees(r.net)}</strong>
                    {signedPts(r.points)} pts
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={`num ${cls ?? ''}`}>{value}</strong>
    </div>
  );
}

/** Balance after each trade, with the starting capital as a dashed baseline. Hover or tap to read a point. */
function EquityCurve({ values, color }: { values: number[]; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (values.length < 2) return <p className="help">The balance curve appears after the first finished trade.</p>;
  const W = 300;
  const H = 84;
  const pad = 6;
  const min = Math.min(...values, STARTING_CAPITAL);
  const max = Math.max(...values, STARTING_CAPITAL);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - pad * 2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const shown = hover ?? values.length - 1;
  return (
    <div className="section" style={{ gap: 6 }}>
      <div className="section-head">
        <span className="help">Balance after each trade</span>
        <span className="help num">
          {shown === 0 ? 'Start' : `Trade ${shown}`} · <strong style={{ color: 'var(--fg)' }}>{rupees(values[shown])}</strong>
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        <svg
          className="equity"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Balance from ${rupees(values[0])} to ${rupees(values[values.length - 1])} over ${values.length - 1} trades`}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setHover(Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - box.left) / box.width) * (values.length - 1)))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <path d={area} fill={color} opacity={0.14} />
          <line x1={0} x2={W} y1={y(STARTING_CAPITAL)} y2={y(STARTING_CAPITAL)} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          <line x1={x(shown)} x2={x(shown)} y1={0} y2={H} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </svg>
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `calc(${(x(shown) / W) * 100}% - 5px)`,
            top: `calc(${(y(values[shown]) / H) * 100}% - 5px)`,
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: color,
            border: '2px solid var(--surface)',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

function coachNotes(trades: Trade[]): string[] {
  if (trades.length < 2) return [];
  const notes: string[] = [];
  const results = trades.map((t) => ({ t, r: tradeResult(t)! }));
  const on = results.filter((x) => x.t.entrySignal === 'with');
  const off = results.filter((x) => x.t.entrySignal !== 'with');
  const avg = (xs: typeof results) => xs.reduce((s, x) => s + x.r.roiPct, 0) / xs.length;
  if (on.length && off.length) {
    const a = avg(on);
    const b = avg(off);
    notes.push(
      a >= b
        ? `Trades taken on your system's signal averaged ${signedPct(a)} against ${signedPct(b)} off it. The system is earning its keep.`
        : `Off-signal trades averaged ${signedPct(b)}, better than ${signedPct(a)} on signal. Your conditions may need another look.`,
    );
  } else if (!on.length) notes.push('None of these trades were taken on a live system signal. Waiting for the setup earns +10 points a trade.');
  const manualWinners = results.filter((x) => x.t.exitReason === 'manual' && x.r.net > 0 && x.r.capture !== null && x.r.capture < 0.25).length;
  if (manualWinners >= 2) notes.push(`${manualWinners} winners were closed by hand after catching under a quarter of the day's move. Letting the target work may pay more.`);
  const stops = results.filter((x) => x.t.exitReason === 'stoploss').length;
  if (stops / results.length > 0.5) notes.push(`More than half the trades hit the stop-loss. Consider waiting for confirmation or widening the stop.`);
  return notes.slice(0, 3);
}
