import { removePushToken } from '@/api/social';

// Long enough for a normal request; signing out never waits on a bad network.
const FORGET_TIMEOUT_MS = 2000;

let current: string | null = null;

export function rememberPushToken(token: string): void {
  current = token;
}

/** Tell the server to stop pushing to this phone. Best effort. */
export async function forgetPushToken(): Promise<void> {
  const token = current;
  if (!token) return;
  current = null;
  await Promise.race([
    removePushToken(token).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, FORGET_TIMEOUT_MS)),
  ]);
}
