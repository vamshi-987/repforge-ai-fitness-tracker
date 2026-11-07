import * as Sentry from '@sentry/react-native';
import { useEffect } from 'react';

import { useAuth } from '@/stores/auth';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/** Crash reports, when a DSN is set. Only the user's id goes with them: no names or emails. */
export function initSentry(): void {
  if (!DSN) return;
  Sentry.init({ dsn: DSN, sendDefaultPii: false, tracesSampleRate: 0.1 });
}

export function useSentryUser(): void {
  const userId = useAuth((state) => state.me?.id ?? null);

  useEffect(() => {
    if (DSN) Sentry.setUser(userId ? { id: userId } : null);
  }, [userId]);
}

export const wrapRoot: typeof Sentry.wrap = (component) =>
  DSN ? Sentry.wrap(component) : component;
