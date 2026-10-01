const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1,00,000.00 style price. */
export const price = (v: number) => inr2.format(v);

/** ₹1,00,000 */
export const rupees = (v: number) => `${v < 0 ? '−' : ''}₹${inr0.format(Math.abs(Math.round(v)))}`;

/** +₹1,230 / −₹540 */
export const signedRupees = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}₹${inr0.format(Math.abs(Math.round(v)))}`;

export const signedPct = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;

export const signedPts = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;

export const tone = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';
