import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { buzzDone } from '@/lib/haptics';
import { cancelRestEnd, scheduleRestEnd } from '@/notifications/notifier';
import { adjustEnd } from '@/workout/rest';

const KEY = 'repforge.restTimer';

interface Saved {
  endsAt: number;
  totalS: number;
  label: string;
}

export interface RestTimerState {
  /** Epoch ms when rest is over; null = not resting. The countdown is `endsAt − now`. */
  endsAt: number | null;
  /** Length of this rest for the progress bar; ±15 s changes it too. */
  totalS: number;
  /** What the rest follows, e.g. "Bench Press (Barbell)". */
  label: string | null;
  start(seconds: number, label: string, now: number): void;
  /** ±15 s; going to zero or below stops the timer. */
  adjust(deltaS: number, now: number): void;
  skip(): void;
  /** Rest ran out while the app is open: buzz, clear the notification, stop. */
  expire(): void;
  /** On launch: pick up a rest that is still running. */
  restore(now: number): Promise<void>;
}

function save(state: Saved | null): void {
  const write = state
    ? Storage.setItemAsync(KEY, JSON.stringify(state))
    : Storage.removeItemAsync(KEY);
  write.catch(() => undefined);
}

const stopped = { endsAt: null, totalS: 0, label: null };

/**
 * The rest timer. It stores when rest ends, never a countdown, and schedules a local
 * notification for that moment, so it is right after backgrounding and fires even when the
 * app is closed. The state is kept on the device so a relaunch shows the remaining time.
 */
export const useRestTimer = create<RestTimerState>()((set, get) => ({
  ...stopped,

  start(seconds, label, now) {
    const endsAt = now + seconds * 1000;
    set({ endsAt, totalS: seconds, label });
    save({ endsAt, totalS: seconds, label });
    void scheduleRestEnd(endsAt, `Time for your next set of ${label}.`);
  },

  adjust(deltaS, now) {
    const { endsAt, totalS, label } = get();
    if (endsAt === null || label === null) return;
    const next = adjustEnd(endsAt, deltaS, now);
    if (next === null) {
      get().skip();
      return;
    }
    const total = Math.max(1, totalS + deltaS);
    set({ endsAt: next, totalS: total });
    save({ endsAt: next, totalS: total, label });
    void scheduleRestEnd(next, `Time for your next set of ${label}.`);
  },

  skip() {
    if (get().endsAt === null) return;
    set(stopped);
    save(null);
    void cancelRestEnd();
  },

  expire() {
    if (get().endsAt === null) return;
    set(stopped);
    save(null);
    buzzDone();
    void cancelRestEnd();
  },

  async restore(now) {
    try {
      const raw = await Storage.getItemAsync(KEY);
      const saved = raw ? (JSON.parse(raw) as Saved) : null;
      if (saved && saved.endsAt > now) set(saved);
      else if (saved) save(null);
    } catch {
      save(null);
    }
  },
}));
