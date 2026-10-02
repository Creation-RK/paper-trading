import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'profiles' }
  | { name: 'system'; profileId: string }
  | { name: 'play'; date: string; symbol: string }
  | { name: 'scorecard' };

function parse(path: string): Route {
  const parts = path.replace(/^#?\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'profiles' && parts[2] === 'system') return { name: 'system', profileId: parts[1] };
  if (parts[0] === 'profiles') return { name: 'profiles' };
  if (parts[0] === 'play' && parts[1] && parts[2]) return { name: 'play', date: parts[1], symbol: parts[2] };
  if (parts[0] === 'scorecard') return { name: 'scorecard' };
  return { name: 'home' };
}

const readHash = () => {
  try {
    return window.location.hash;
  } catch {
    return '';
  }
};

// The route lives in memory and is mirrored to the URL hash when the host allows it,
// so the back button works in a browser and nothing breaks in sandboxed frames.
let current: Route = parse(readHash());
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parse(readHash());
    emit();
  });
}

export function navigate(path: string) {
  current = parse(path);
  try {
    if (window.location.hash !== `#${path}`) window.location.hash = path;
  } catch {
    /* hash not writable here; the in-memory route still changes */
  }
  emit();
  window.scrollTo?.(0, 0);
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
