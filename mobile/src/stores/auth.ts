import { create } from 'zustand';

import { logout } from '@/api/auth';
import { getMe } from '@/api/me';
import type { AuthResponse, Me } from '@/api/types';
import { meCache } from '@/auth/meCache';
import { session } from '@/auth/session';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';
export type MeStatus = 'idle' | 'loading' | 'error';

interface AuthState {
  status: AuthStatus;
  /** Last known `/me`; restored from the device cache on launch so it works offline. */
  me: Me | null;
  meStatus: MeStatus;
  bootstrap(): Promise<void>;
  signIn(response: AuthResponse): Promise<void>;
  signOut(): Promise<void>;
  refreshMe(): Promise<void>;
  setMe(me: Me): void;
}

let booting: Promise<void> | null = null;

export const useAuth = create<AuthState>()((set, get) => ({
  status: 'loading',
  me: null,
  meStatus: 'idle',

  bootstrap() {
    booting ??= (async () => {
      const [hasSession, cached] = await Promise.all([session.restore(), meCache.load()]);
      if (!hasSession) {
        await meCache.clear();
        set({ status: 'signedOut', me: null });
        return;
      }
      // Signed in from the saved session alone; refresh the profile in the background.
      set({ status: 'signedIn', me: cached });
      void get().refreshMe();
    })();
    return booting;
  },

  async signIn(response) {
    await session.start(response);
    set({ status: 'signedIn', me: null });
    await get().refreshMe();
  },

  async refreshMe() {
    set({ meStatus: 'loading' });
    try {
      get().setMe(await getMe());
      set({ meStatus: 'idle' });
    } catch {
      // Offline or server down: keep the cached copy. A dead session signs out via onEnded.
      set({ meStatus: 'error' });
    }
  },

  setMe(me) {
    set({ me });
    meCache.save(me).catch(() => undefined);
  },

  async signOut() {
    const refreshToken = await session.clear();
    await meCache.clear();
    set({ status: 'signedOut', me: null, meStatus: 'idle' });
    // Best effort: revoke on the server too, but never block signing out on the network.
    if (refreshToken) logout(refreshToken).catch(() => undefined);
  },
}));

// The server rejected our refresh token (expired, revoked, or reused): sign out locally.
session.onEnded(() => {
  meCache.clear().catch(() => undefined);
  useAuth.setState({ status: 'signedOut', me: null, meStatus: 'idle' });
});

/** Test hook: forget the memoised bootstrap so each test can boot from scratch. */
export function resetAuthStoreForTests(): void {
  booting = null;
  useAuth.setState({ status: 'loading', me: null, meStatus: 'idle' });
}
