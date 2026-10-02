import { useState } from 'react';
import { IconBack, IconClose, IconMinus, IconPencil, IconPlus } from '../components/Icons';
import { Sheet, showToast } from '../components/ui';
import { getIndicatorDef, INDICATORS, IndicatorInstance, indicatorLabel, newIndicator } from '../lib/indicators';
import { TIMEFRAMES, timeframeLabel } from '../lib/market/aggregate';
import {
  COMPARATORS,
  Comparator,
  defaultSystem,
  newRule,
  Operand,
  operandChoices,
  pruneRules,
  Rule,
  ruleLabel,
  ruleUsesIndicator,
  SystemDef,
} from '../lib/system';
import { navigate } from '../router';
import { useGame } from '../store/game';

type SheetState = { kind: 'catalog' } | { kind: 'indicator'; id: string } | { kind: 'rule'; side: 'callRules' | 'putRules' } | null;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function SystemEditor({ profileId }: { profileId: string }) {
  const profile = useGame((s) => s.profiles.find((p) => p.id === profileId));
  const setSystem = useGame((s) => s.setSystem);
  const [draft, setDraft] = useState<SystemDef | null>(() => (profile ? clone(profile.system) : null));
  const [sheet, setSheet] = useState<SheetState>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  if (!profile || !draft) {
    return (
      <main className="screen">
        <div className="empty">
          This profile no longer exists.{' '}
          <button className="btn btn-sm" onClick={() => navigate('/profiles')}>
            Back to profiles
          </button>
        </div>
      </main>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(profile.system);
  const update = (patch: Partial<SystemDef>) => setDraft({ ...draft, ...patch });

  const removeIndicator = (id: string) => {
    const ind = draft.indicators.find((i) => i.id === id);
    const used = [...draft.callRules, ...draft.putRules].filter((r) => ruleUsesIndicator(r, id)).length;
    setDraft(pruneRules({ ...draft, indicators: draft.indicators.filter((i) => i.id !== id) }));
    if (ind) showToast(used ? `Removed ${indicatorLabel(ind)} and ${used} condition${used > 1 ? 's' : ''} that used it` : `Removed ${indicatorLabel(ind)}`);
  };

  const save = () => {
    setSystem(profile.id, pruneRules(draft));
    showToast(`${profile.name}'s system saved`);
    navigate('/profiles');
  };

  const editing = sheet?.kind === 'indicator' ? draft.indicators.find((i) => i.id === sheet.id) : undefined;

  return (
    <main className="screen">
      <header className="topbar">
        <div className="back">
          <button className="icon-btn bare" aria-label="Back to profiles" onClick={() => navigate('/profiles')}>
            <IconBack />
          </button>
          <h1>{profile.name}'s system</h1>
        </div>
        {dirty && <span className="pill warn">Unsaved</span>}
      </header>

      <section className="section">
        <label className="field" htmlFor="system-name">
          <span>System name</span>
          <input id="system-name" className="input" value={draft.name} maxLength={32} onChange={(e) => update({ name: e.target.value })} />
        </label>
        <div className="field">
          <span>Signal timeframe</span>
          <div className="tags" role="group" aria-label="Signal timeframe">
            {TIMEFRAMES.map((m) => (
              <button key={m} className="chip" aria-pressed={draft.timeframe === m} onClick={() => update({ timeframe: m })}>
                {timeframeLabel(m)}
              </button>
            ))}
          </div>
          <span className="help">Your CALL and PUT conditions are checked on candles of this size.</span>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="h2">Added indicators ({draft.indicators.length})</h2>
        </div>
        <div className="card" style={{ paddingBlock: 4 }}>
          {draft.indicators.length === 0 && <p className="empty">No indicators yet.</p>}
          {draft.indicators.map((ind) => (
            <div className="ind-row" key={ind.id}>
              <button className="remove-dot" aria-label={`Remove ${indicatorLabel(ind)}`} onClick={() => removeIndicator(ind.id)}>
                <IconMinus size={14} />
              </button>
              <span className="label">
                {indicatorLabel(ind)}
                <small>
                  {getIndicatorDef(ind.type).placement === 'pane' ? 'Lower pane' : 'On price'}
                  {!ind.visible && ' · hidden'}
                </small>
              </span>
              {Object.values(ind.colors)
                .slice(0, 2)
                .map((c, i) => (
                  <span key={i} className="color-dot" style={{ background: c }} />
                ))}
              <button className="icon-btn bare" aria-label={`Edit ${indicatorLabel(ind)}`} onClick={() => setSheet({ kind: 'indicator', id: ind.id })}>
                <IconPencil />
              </button>
            </div>
          ))}
        </div>
        <button className="btn btn-outline" onClick={() => setSheet({ kind: 'catalog' })}>
          <IconPlus size={18} /> Add indicator
        </button>
      </section>

      <RuleSide
        title="CALL setup"
        help="Buy a call when all of these are true."
        rules={draft.callRules}
        indicators={draft.indicators}
        onRemove={(id) => update({ callRules: draft.callRules.filter((r) => r.id !== id) })}
        onAdd={() => setSheet({ kind: 'rule', side: 'callRules' })}
      />
      <RuleSide
        title="PUT setup"
        help="Buy a put when all of these are true."
        rules={draft.putRules}
        indicators={draft.indicators}
        onRemove={(id) => update({ putRules: draft.putRules.filter((r) => r.id !== id) })}
        onAdd={() => setSheet({ kind: 'rule', side: 'putRules' })}
      />

      <section className="section">
        <h2 className="h2">Exit plan</h2>
        <div className="field-row">
          <NumberField id="risk-lots" label="Lots per trade" value={draft.risk.lots} min={1} max={10} step={1} onChange={(v) => update({ risk: { ...draft.risk, lots: v } })} />
          <NumberField
            id="risk-sl"
            label="Stop-loss %"
            value={draft.risk.stopLossPct}
            min={0}
            max={90}
            step={5}
            onChange={(v) => update({ risk: { ...draft.risk, stopLossPct: v } })}
          />
          <NumberField
            id="risk-tgt"
            label="Target %"
            value={draft.risk.targetPct}
            min={0}
            max={500}
            step={5}
            onChange={(v) => update({ risk: { ...draft.risk, targetPct: v } })}
          />
        </div>
        <span className="help">Percent of the option premium. 0 turns the stop or target off. Open trades are squared off 10 minutes before the close.</span>
      </section>

      <section className="section">
        <label className="field" htmlFor="system-notes">
          <span>Trading plan</span>
          <textarea
            id="system-notes"
            className="textarea"
            value={draft.notes}
            maxLength={600}
            placeholder="What you wait for, when you stay out, how you manage the trade."
            onChange={(e) => update({ notes: e.target.value })}
          />
        </label>
      </section>

      <div className="save-bar">
        <button
          className="btn btn-outline"
          onClick={() => {
            if (!confirmReset) return setConfirmReset(true);
            setDraft(defaultSystem());
            setConfirmReset(false);
          }}
        >
          {confirmReset ? 'Tap to confirm' : 'Reset to default'}
        </button>
        <button className="btn btn-primary" disabled={!dirty || !draft.name.trim()} onClick={save}>
          Save system
        </button>
      </div>

      {sheet?.kind === 'catalog' && (
        <Sheet title="Add indicator" onClose={() => setSheet(null)}>
          <div className="catalog">
            {INDICATORS.map((def) => (
              <button
                key={def.type}
                onClick={() => {
                  const ind = newIndicator(def.type);
                  update({ indicators: [...draft.indicators, ind] });
                  setSheet({ kind: 'indicator', id: ind.id });
                }}
              >
                <strong>
                  {def.name} <span className="pill">{def.placement === 'pane' ? 'Lower pane' : 'On price'}</span>
                </strong>
                <span>{def.description}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {editing && (
        <IndicatorSheet
          ind={editing}
          onChange={(next) => update({ indicators: draft.indicators.map((i) => (i.id === next.id ? next : i)) })}
          onRemove={() => {
            removeIndicator(editing.id);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'rule' && (
        <RuleSheet
          side={sheet.side === 'callRules' ? 'CALL' : 'PUT'}
          indicators={draft.indicators}
          onAdd={(rule) => {
            update({ [sheet.side]: [...draft[sheet.side], rule] } as Partial<SystemDef>);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </main>
  );
}

function NumberField({ id, label, value, min, max, step, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        className="input num"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}

function RuleSide({
  title,
  help,
  rules,
  indicators,
  onRemove,
  onAdd,
}: {
  title: string;
  help: string;
  rules: Rule[];
  indicators: IndicatorInstance[];
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <section className="rule-side">
      <div className="rule-side-head">
        <h2 className="h2">{title}</h2>
        <span className="pill">{rules.length} conditions</span>
      </div>
      <span className="help">{help}</span>
      {rules.map((r) => (
        <div className="rule" key={r.id}>
          <span>{ruleLabel(r, indicators)}</span>
          <button className="icon-btn bare" aria-label={`Remove condition: ${ruleLabel(r, indicators)}`} onClick={() => onRemove(r.id)}>
            <IconClose size={18} />
          </button>
        </div>
      ))}
      <button className="btn btn-sm" onClick={onAdd}>
        <IconPlus size={16} /> Add condition
      </button>
    </section>
  );
}

function IndicatorSheet({ ind, onChange, onRemove, onClose }: { ind: IndicatorInstance; onChange: (i: IndicatorInstance) => void; onRemove: () => void; onClose: () => void }) {
  const def = getIndicatorDef(ind.type);
  return (
    <Sheet
      title={indicatorLabel(ind)}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-danger" onClick={onRemove}>
            Remove
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p className="help">{def.description}</p>
      {def.params.length > 0 && (
        <div className="field-row">
          {def.params.map((ps) => (
            <NumberField
              key={ps.key}
              id={`param-${ind.id}-${ps.key}`}
              label={ps.label}
              value={ind.params[ps.key]}
              min={ps.min}
              max={ps.max}
              step={ps.step}
              onChange={(v) => onChange({ ...ind, params: { ...ind.params, [ps.key]: v } })}
            />
          ))}
        </div>
      )}
      <div className="field">
        <span>Colours</span>
        <div className="tags">
          {def.outputs
            .filter((o) => o.style !== 'hidden' && o.style !== 'histogram')
            .map((o) => (
              <label key={o.key} className="chip" htmlFor={`color-${ind.id}-${o.key}`}>
                <input
                  id={`color-${ind.id}-${o.key}`}
                  type="color"
                  value={ind.colors[o.key] ?? o.color}
                  onChange={(e) => onChange({ ...ind, colors: { ...ind.colors, [o.key]: e.target.value } })}
                  style={{ width: 22, height: 22, padding: 0, border: 0, background: 'none' }}
                />
                {o.label}
              </label>
            ))}
        </div>
      </div>
      <label className="chip" htmlFor={`visible-${ind.id}`} style={{ alignSelf: 'flex-start' }}>
        <input id={`visible-${ind.id}`} type="checkbox" checked={ind.visible} onChange={(e) => onChange({ ...ind, visible: e.target.checked })} />
        Show on chart
      </label>
    </Sheet>
  );
}

const encode = (o: Operand) => (o.kind === 'price' ? 'price' : o.kind === 'num' ? 'num' : `ind:${o.ref}:${o.output}`);

function decode(v: string, num: number): Operand {
  if (v === 'price') return { kind: 'price' };
  if (v === 'num') return { kind: 'num', value: num };
  const [, ref, output] = v.split(':');
  return { kind: 'ind', ref, output };
}

function RuleSheet({ side, indicators, onAdd, onClose }: { side: 'CALL' | 'PUT'; indicators: IndicatorInstance[]; onAdd: (r: Rule) => void; onClose: () => void }) {
  const choices = operandChoices(indicators);
  const firstInd = choices.find((c) => c.operand.kind === 'ind');
  const [left, setLeft] = useState('price');
  const [op, setOp] = useState<Comparator>(side === 'CALL' ? '>' : '<');
  const [right, setRight] = useState(firstInd ? encode(firstInd.operand) : 'num');
  const [num, setNum] = useState(50);
  const rule = newRule(decode(left, num), op, decode(right, num));
  const valid = left !== right && left !== 'num';

  return (
    <Sheet
      title={`Add ${side} condition`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onAdd(rule)}>
            Add condition
          </button>
        </>
      }
    >
      <div className="rule-builder">
        <label className="field" htmlFor="rule-left">
          <span>When</span>
          <select id="rule-left" className="select" value={left} onChange={(e) => setLeft(e.target.value)}>
            {choices.map((c) => (
              <option key={encode(c.operand)} value={encode(c.operand)}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="rule-op">
          <span>Condition</span>
          <select id="rule-op" className="select" value={op} onChange={(e) => setOp(e.target.value as Comparator)}>
            {COMPARATORS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="rule-right">
          <span>Compared with</span>
          <select id="rule-right" className="select" value={right} onChange={(e) => setRight(e.target.value)}>
            {choices.map((c) => (
              <option key={encode(c.operand)} value={encode(c.operand)}>
                {c.label}
              </option>
            ))}
            <option value="num">A number…</option>
          </select>
        </label>
        {right === 'num' && (
          <label className="field" htmlFor="rule-num">
            <span>Number</span>
            <input id="rule-num" className="input num" type="number" inputMode="decimal" value={num} onChange={(e) => setNum(Number(e.target.value))} />
          </label>
        )}
        <div className="rule">
          <span>{valid ? ruleLabel(rule, indicators) : 'Pick two different values to compare.'}</span>
        </div>
      </div>
    </Sheet>
  );
}
