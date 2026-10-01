import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = ({ size = 22, ...rest }: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...rest,
});

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconBack = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);
export const IconPlay = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
  </svg>
);
export const IconPause = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);
export const IconStep = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l7 6-7 6M17 6v12" />
  </svg>
);
export const IconSkip = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6l6 6-6 6M12 6l6 6-6 6" />
  </svg>
);
export const IconPencil = (p: P) => (
  <svg {...base(p)}>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);
export const IconMinus = (p: P) => (
  <svg {...base(p)} strokeWidth={3}>
    <path d="M6 12h12" />
  </svg>
);
export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconSliders = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M4 12h16M9 17h6M10 20l2 1.5 2-1.5" />
  </svg>
);
export const IconTrophy = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6" />
  </svg>
);
export const IconUsers = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" />
  </svg>
);
export const IconCandles = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 3v4M7 15v6M17 3v6M17 17v4" />
    <rect x="4.5" y="7" width="5" height="8" rx="1" />
    <rect x="14.5" y="9" width="5" height="8" rx="1" />
  </svg>
);
export const IconWave = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 16l4-5 4 3 5-7 5 5" />
  </svg>
);
export const IconEye = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const IconEyeOff = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);
export const IconLock = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
export const IconAlert = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l10 18H2zM12 10v5M12 18v.5" />
  </svg>
);
export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const IconCaretDown = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M6 9h12l-6 7z" />
  </svg>
);

export const Wordmark = () => (
  <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="wm" x1="0" x2="1" y1="1" y2="0">
        <stop offset="0" stopColor="var(--accent)" />
        <stop offset="1" stopColor="var(--accent-2)" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="16" fill="url(#wm)" />
    <path d="M14 44 L26 30 L34 37 L50 18" stroke="#fff" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="50" cy="18" r="4" fill="#fff" />
  </svg>
);
