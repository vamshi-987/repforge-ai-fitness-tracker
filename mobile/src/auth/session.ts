import { ApiError, apiRequest, type RequestOptions } from '@/api/client';
import type { TokenPair } from '@/api/types';

import {
  secureTokenStorage,
  tokensFromPair,
  type StoredTokens,
  type TokenStorage,
} from './tokenStorage';

/** Refresh this long before the access token expires, so requests rarely see a 401. */
export const REFRESH_SKEW_MS = 30_000;

type AuthedOptions = Omit<RequestOptions, 'token'>;

/**
 * Owns the tokens and makes authenticated requests.
 *
 * - Refreshes proactively shortly before expiry, and reactively on a 401, then retries once.
 * - **Single-flight refresh:** concurrent callers share one refresh request. The server
 *   rotates refresh tokens and treats a second use of the old one as theft (revoking the
 *   session), so two parallel refreshes would log the user out.
 * - A refresh rejected with 401 ends the session; listeners are told so the UI signs out.
 *   Network errors keep the session: offline is not signed out.
 */
export class AuthSession {
  private tokens: StoredTokens | null = null;
  private refreshing: Promise<StoredTokens> | null = null;
  private readonly endedListeners = new Set<() => void>();

  constructor(
    private readonly storage: TokenStorage = secureTokenStorage,
    private readonly now: () => number = Date.now,
  ) {}

  /** Load tokens saved by a previous launch. True if a session exists (no network needed). */
  async restore(): Promise<boolean> {
    this.tokens = await this.storage.load();
    return this.tokens !== null;
  }

  async start(pair: TokenPair): Promise<void> {
    this.tokens = tokensFromPair(pair, this.now());
    await this.storage.save(this.tokens);
  }

  /** Forget the tokens locally. Returns the refresh token so the caller can revoke it. */
  async clear(): Promise<string | null> {
    const refreshToken = this.tokens?.refreshToken ?? null;
    this.tokens = null;
    this.refreshing = null;
    await this.storage.clear();
    return refreshToken;
  }

  hasSession(): boolean {
    return this.tokens !== null;
  }

  onEnded(listener: () => void): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  refresh(): Promise<StoredTokens> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<StoredTokens> {
    const current = this.tokens;
    if (!current) throw new ApiError(401, 'not_authenticated', 'Sign in to continue');
    let pair: TokenPair;
    try {
      pair = await apiRequest<TokenPair>('/auth/refresh', {
        method: 'POST',
        body: { refresh_token: current.refreshToken },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await this.end();
      throw error;
    }
    // Signed out (or signed in again) while the refresh was in flight: drop the result.
    if (this.tokens !== current)
      throw new ApiError(401, 'not_authenticated', 'Sign in to continue');
    const next = tokensFromPair(pair, this.now());
    // Persist before anyone uses the new token: the old refresh token is already revoked.
    await this.storage.save(next);
    this.tokens = next;
    return next;
  }

  private async end(): Promise<void> {
    await this.clear();
    this.endedListeners.forEach((listener) => listener());
  }

  private async validAccessToken(): Promise<string> {
    const current = this.tokens;
    if (!current) throw new ApiError(401, 'not_authenticated', 'Sign in to continue');
    if (current.accessExpiresAt - this.now() > REFRESH_SKEW_MS) return current.accessToken;
    try {
      return (await this.refresh()).accessToken;
    } catch (error) {
      // Offline: try the old token anyway; the request will report the real problem.
      if (error instanceof ApiError && error.code === 'network_error' && this.tokens) {
        return this.tokens.accessToken;
      }
      throw error;
    }
  }

  async request<T>(path: string, options: AuthedOptions = {}): Promise<T> {
    const token = await this.validAccessToken();
    try {
      return await apiRequest<T>(path, { ...options, token });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || !this.tokens) throw error;
      // Another request may have refreshed while this one was in flight.
      const latest =
        this.tokens.accessToken !== token
          ? this.tokens.accessToken
          : (await this.refresh()).accessToken;
      return apiRequest<T>(path, { ...options, token: latest });
    }
  }
}

/** The app-wide session. */
export const session = new AuthSession();
