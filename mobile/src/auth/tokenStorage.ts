import * as SecureStore from 'expo-secure-store';

import type { TokenPair } from '@/api/types';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms, computed on this device from `expires_in` (so server clock skew is irrelevant). */
  accessExpiresAt: number;
}

export interface TokenStorage {
  load(): Promise<StoredTokens | null>;
  save(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}

export function tokensFromPair(pair: TokenPair, now: number = Date.now()): StoredTokens {
  return {
    accessToken: pair.access_token,
    refreshToken: pair.refresh_token,
    accessExpiresAt: now + pair.expires_in * 1000,
  };
}

function isStoredTokens(value: unknown): value is StoredTokens {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof v.accessExpiresAt === 'number'
  );
}

const KEY = 'repforge.auth.tokens';
// Readable after the first unlock, so a background sync can refresh; never leaves the device.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** Tokens live in the iOS Keychain / Android Keystore, never in plain storage. */
export const secureTokenStorage: TokenStorage = {
  async load() {
    const raw = await SecureStore.getItemAsync(KEY, OPTIONS);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isStoredTokens(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  async save(tokens) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(tokens), OPTIONS);
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY, OPTIONS);
  },
};
