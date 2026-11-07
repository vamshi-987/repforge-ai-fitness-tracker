import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * The current time (epoch ms), re-rendering every `intervalMs` while enabled. Timers derive
 * what they show from it (`now − startedAt`), so returning from the background shows the
 * right value at once instead of resuming a paused count.
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return undefined;
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, intervalMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [intervalMs, enabled]);

  return now;
}
