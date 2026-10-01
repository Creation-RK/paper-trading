/** Rolling-window maths shared by the indicators. Leading `null`s mean "not enough data yet". */

export type Series = (number | null)[];

export function sma(src: Series, len: number): Series {
  const out: Series = new Array(src.length).fill(null);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v === null) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count++;
    if (count > len) {
      sum -= src[i - len] as number;
      count = len;
    }
    if (count === len) out[i] = sum / len;
  }
  return out;
}

function smoothed(src: Series, len: number, alpha: number): Series {
  const out: Series = new Array(src.length).fill(null);
  let prev: number | null = null;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v === null) continue;
    if (prev === null) {
      seedSum += v;
      seedCount++;
      if (seedCount === len) {
        prev = seedSum / len;
        out[i] = prev;
      }
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/** Exponential moving average, seeded with an SMA like TradingView's ta.ema. */
export function ema(src: Series, len: number): Series {
  return smoothed(src, len, 2 / (len + 1));
}

/** Wilder's moving average (ta.rma). */
export function rma(src: Series, len: number): Series {
  return smoothed(src, len, 1 / len);
}

export function highest(src: Series, len: number): Series {
  return src.map((_, i) => {
    if (i < len - 1) return null;
    let m = -Infinity;
    for (let k = i - len + 1; k <= i; k++) {
      const v = src[k];
      if (v === null) return null;
      if (v > m) m = v;
    }
    return m;
  });
}

export function lowest(src: Series, len: number): Series {
  return src.map((_, i) => {
    if (i < len - 1) return null;
    let m = Infinity;
    for (let k = i - len + 1; k <= i; k++) {
      const v = src[k];
      if (v === null) return null;
      if (v < m) m = v;
    }
    return m;
  });
}

export function stdev(src: Series, len: number): Series {
  const mean = sma(src, len);
  return src.map((_, i) => {
    const m = mean[i];
    if (m === null) return null;
    let acc = 0;
    for (let k = i - len + 1; k <= i; k++) acc += ((src[k] as number) - m) ** 2;
    return Math.sqrt(acc / len);
  });
}

export function zip(a: Series, b: Series, fn: (x: number, y: number) => number): Series {
  return a.map((x, i) => {
    const y = b[i];
    return x === null || y === null ? null : fn(x, y);
  });
}
