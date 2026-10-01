import { ReactNode, useEffect, useState } from 'react';
import { initials } from '../lib/format';
import { IconBack } from './Icons';

export function Avatar({ name, color, size }: { name: string; color: string; size?: 'sm' | 'lg' }) {
  return (
    <span className={`avatar${size ? ` ${size}` : ''}`} style={{ background: color }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  footer,
  footerSingle,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  footerSingle?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-head">
          <button className="icon-btn bare" onClick={onClose} aria-label="Back">
            <IconBack />
          </button>
          <h2>{title}</h2>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className={`sheet-foot${footerSingle ? ' single' : ''}`}>{footer}</footer>}
      </section>
    </div>
  );
}

let toastSetter: ((msg: string | null) => void) | null = null;

export function showToast(msg: string) {
  toastSetter?.(msg);
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    toastSetter = setMsg;
    return () => {
      toastSetter = null;
    };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

/** Reads the colour tokens from CSS so the chart follows the light/dark theme. */
export interface ThemeTokens {
  bg: string;
  grid: string;
  text: string;
  line: string;
  up: string;
  down: string;
  accent: string;
  accent2: string;
  fg: string;
  muted: string;
}

function readTokens(): ThemeTokens {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    bg: v('--chart-bg'),
    grid: v('--chart-grid'),
    text: v('--chart-text'),
    line: v('--line'),
    up: v('--up'),
    down: v('--down'),
    accent: v('--accent'),
    accent2: v('--accent-2'),
    fg: v('--fg'),
    muted: v('--muted'),
  };
}

export function useThemeTokens(): ThemeTokens {
  const [tokens, setTokens] = useState(readTokens);
  useEffect(() => {
    const update = () => setTokens(readTokens());
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    return () => {
      mq?.removeEventListener?.('change', update);
      mo.disconnect();
    };
  }, []);
  return tokens;
}
