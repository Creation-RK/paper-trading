import { useState } from 'react';
import { IconPencil, IconPlus } from '../components/Icons';
import { Avatar, Sheet, showToast } from '../components/ui';
import { rupees, signedPts } from '../lib/format';
import { indicatorLabel } from '../lib/indicators';
import { timeframeLabel } from '../lib/market/aggregate';
import { profileStats } from '../lib/scoring';
import { navigate } from '../router';
import { MAX_PROFILES, Profile, PROFILE_COLORS, useGame } from '../store/game';

export function Profiles() {
  const profiles = useGame((s) => s.profiles);
  const trades = useGame((s) => s.trades);
  const settings = useGame((s) => s.settings);
  const { setSettings, resetProgress } = useGame.getState();
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <main className="screen">
      <header className="topbar">
        <h1>Profiles</h1>
        <span className="pill num">
          {profiles.length}/{MAX_PROFILES}
        </span>
      </header>

      <p className="lede">Three traders, one market. Each profile trades with its own system, takes one CALL or PUT per subject a day, and keeps its own score.</p>

      <section className="section">
        {Array.from({ length: MAX_PROFILES }, (_, i) => {
          const p = profiles[i];
          if (!p) {
            return (
              <button key={`empty-${i}`} className="empty-slot" onClick={() => setEditing('new')} disabled={i !== profiles.length}>
                <span className="plus">
                  <IconPlus size={18} />
                </span>
                Create profile {i + 1}
              </button>
            );
          }
          const stats = profileStats(trades.filter((t) => t.profileId === p.id));
          return (
            <article className="card profile-card" key={p.id}>
              <div className="profile-head">
                <Avatar name={p.name} color={p.color} size="lg" />
                <div>
                  <h2 className="profile-name">{p.name}</h2>
                  <span className="help">
                    {p.system.name} · {timeframeLabel(p.system.timeframe)} candles
                  </span>
                </div>
                <button className="icon-btn" aria-label={`Rename ${p.name}`} onClick={() => setEditing(p)}>
                  <IconPencil size={18} />
                </button>
              </div>
              <div className="tags">
                {p.system.indicators.map((ind) => (
                  <span key={ind.id} className="pill">
                    {indicatorLabel(ind)}
                  </span>
                ))}
                <span className="pill accent">
                  SL {p.system.risk.stopLossPct || '–'}% · TGT {p.system.risk.targetPct || '–'}%
                </span>
              </div>
              <div className="stat-grid">
                <div className="stat">
                  <span>Balance</span>
                  <strong className="num">{rupees(stats.balance)}</strong>
                </div>
                <div className="stat">
                  <span>Points</span>
                  <strong className="num">{signedPts(stats.points)}</strong>
                </div>
                <div className="stat">
                  <span>Trades</span>
                  <strong className="num">{stats.trades}</strong>
                </div>
              </div>
              <button className="btn btn-outline btn-block" onClick={() => navigate(`/profiles/${p.id}/system`)}>
                Customise system
              </button>
            </article>
          );
        })}
      </section>

      <section className="section">
        <p className="eyebrow">Appearance</p>
        <div className="segmented" role="group" aria-label="Theme">
          {(['system', 'dark', 'light'] as const).map((t) => (
            <button key={t} aria-pressed={(settings.theme ?? 'system') === t} onClick={() => setSettings({ theme: t })}>
              {t === 'system' ? 'Match device' : t === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <p className="eyebrow">Game data</p>
        <p className="help">Progress is saved on this device. Resetting clears every replay and trade but keeps profiles and systems.</p>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true);
              return;
            }
            resetProgress();
            setConfirmReset(false);
            showToast('Progress reset');
          }}
        >
          {confirmReset ? 'Tap again to erase all trades' : 'Reset progress'}
        </button>
      </section>

      {editing && <ProfileSheet profile={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </main>
  );
}

function ProfileSheet({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const profiles = useGame((s) => s.profiles);
  const { addProfile, updateProfile, removeProfile } = useGame.getState();
  const used = new Set(profiles.map((p) => p.color));
  const [name, setName] = useState(profile?.name ?? '');
  const [color, setColor] = useState(profile?.color ?? PROFILE_COLORS.find((c) => !used.has(c)) ?? PROFILE_COLORS[0]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const valid = name.trim().length > 0;

  const save = () => {
    if (!valid) return;
    if (profile) updateProfile(profile.id, { name: name.trim(), color });
    else addProfile(name, color);
    onClose();
  };

  return (
    <Sheet
      title={profile ? 'Edit profile' : `Create profile ${profiles.length + 1}`}
      onClose={onClose}
      footer={
        <>
          {profile ? (
            <button
              className="btn btn-danger"
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true);
                removeProfile(profile.id);
                onClose();
              }}
            >
              {confirmDelete ? 'Tap to confirm' : 'Delete'}
            </button>
          ) : (
            <button className="btn btn-outline" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="btn btn-primary" disabled={!valid} onClick={save}>
            {profile ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <form
        className="section"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="field" htmlFor="profile-name">
          <span>Name</span>
          <input
            id="profile-name"
            className="input"
            value={name}
            maxLength={18}
            placeholder={['Scalper', 'Swing Sam', 'Contrarian'][profiles.length] ?? 'Trader'}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <div className="field">
          <span>Colour</span>
          <div className="swatches" role="group" aria-label="Profile colour">
            {PROFILE_COLORS.map((c) => (
              <button type="button" key={c} className="swatch" style={{ background: c }} aria-pressed={c === color} aria-label={`Colour ${c}`} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        {!profile && <p className="help">New profiles start with the ORB + VWAP Scalper system and ₹1,00,000 of virtual capital. Customise the system any time.</p>}
        {profile && confirmDelete && <p className="help down">Deleting removes this profile and all of its trades.</p>}
      </form>
    </Sheet>
  );
}
