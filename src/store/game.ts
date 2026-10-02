import { create } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';
import { defaultSystem, SystemDef } from '../lib/system';
import type { ExitReason, Trade } from '../lib/types';

export const MAX_PROFILES = 3;

export const PROFILE_COLORS = ['#7b61ff', '#e0793f', '#1f9e8a', '#3d8bfd', '#d6457b', '#c9a227'];

export interface Profile {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  system: SystemDef;
}

/** Replay progress for one subject on one day. */
export interface DayProgress {
  /** Number of the day's 1-minute candles revealed so far. */
  cursor: number;
  status: 'playing' | 'done';
  updatedAt: number;
  /** Best possible ATM option return (%) for the day, set when the day is finished. */
  best?: { CE: number; PE: number };
}

export type ChartType = 'candles' | 'heikin' | 'wave';

export interface Settings {
  /** Replay speed in market minutes per second. */
  speed: number;
  chartType: ChartType;
  theme?: 'system' | 'dark' | 'light';
}

interface GameState {
  profiles: Profile[];
  activeProfileId: string | null;
  progress: Record<string, DayProgress>;
  trades: Trade[];
  settings: Settings;
  addProfile(name: string, color: string): Profile | null;
  updateProfile(id: string, patch: Partial<Pick<Profile, 'name' | 'color'>>): void;
  removeProfile(id: string): void;
  setSystem(id: string, system: SystemDef): void;
  setActiveProfile(id: string): void;
  setProgress(date: string, symbol: string, patch: Partial<DayProgress>): void;
  openTrade(trade: Trade): void;
  closeTrade(id: string, exit: { time: number; spot: number; premium: number; reason: ExitReason }): void;
  patchTrade(id: string, patch: Partial<Trade>): void;
  setSettings(patch: Partial<Settings>): void;
  resetProgress(): void;
}

export const progressKey = (date: string, symbol: string) => `${date}|${symbol}`;

/** localStorage that never throws (private windows, sandboxed frames, full quota). */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* progress stays in memory for this visit */
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const useGame = create<GameState>()(
  persist(
    (set, get) => ({
      profiles: [],
      activeProfileId: null,
      progress: {},
      trades: [],
      settings: { speed: 5, chartType: 'candles', theme: 'system' },

      addProfile(name, color) {
        if (get().profiles.length >= MAX_PROFILES) return null;
        const profile: Profile = { id: uid('p'), name: name.trim() || 'Trader', color, createdAt: Date.now(), system: defaultSystem() };
        set((s) => ({ profiles: [...s.profiles, profile], activeProfileId: s.activeProfileId ?? profile.id }));
        return profile;
      },
      updateProfile(id, patch) {
        set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
      },
      removeProfile(id) {
        set((s) => {
          const profiles = s.profiles.filter((p) => p.id !== id);
          return {
            profiles,
            trades: s.trades.filter((t) => t.profileId !== id),
            activeProfileId: s.activeProfileId === id ? (profiles[0]?.id ?? null) : s.activeProfileId,
          };
        });
      },
      setSystem(id, system) {
        set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, system } : p)) }));
      },
      setActiveProfile(id) {
        set({ activeProfileId: id });
      },
      setProgress(date, symbol, patch) {
        const key = progressKey(date, symbol);
        set((s) => {
          const prev = s.progress[key] ?? { cursor: 1, status: 'playing' as const, updatedAt: 0 };
          return { progress: { ...s.progress, [key]: { ...prev, ...patch, updatedAt: Date.now() } } };
        });
      },
      openTrade(trade) {
        set((s) => ({ trades: [...s.trades, trade] }));
      },
      closeTrade(id, exit) {
        set((s) => ({
          trades: s.trades.map((t) =>
            t.id === id && t.exitPremium === undefined
              ? { ...t, exitTime: exit.time, exitSpot: exit.spot, exitPremium: exit.premium, exitReason: exit.reason }
              : t,
          ),
        }));
      },
      patchTrade(id, patch) {
        set((s) => ({ trades: s.trades.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
      },
      setSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
      },
      resetProgress() {
        set({ progress: {}, trades: [] });
      },
    }),
    {
      name: 'paper-scalper-v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
    },
  ),
);

export const newTradeId = () => uid('t');
