import Storage from 'expo-sqlite/kv-store';

import type { Me } from '@/api/types';

const KEY = 'repforge.me';

/**
 * The last `/me` response, kept on the device so a cold start without network still knows
 * who is signed in and whether onboarding is done. Not secret, so not in SecureStore.
 */
export const meCache = {
  async load(): Promise<Me | null> {
    const raw = await Storage.getItemAsync(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Me;
    } catch {
      return null;
    }
  },
  async save(me: Me): Promise<void> {
    await Storage.setItemAsync(KEY, JSON.stringify(me));
  },
  async clear(): Promise<void> {
    await Storage.removeItemAsync(KEY);
  },
};
