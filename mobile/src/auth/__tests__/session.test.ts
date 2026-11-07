import { ApiError } from '@/api/client';
import { errorResponse, fetchCalls, jsonResponse, tokenPair } from '@/test/helpers';

import { AuthSession, REFRESH_SKEW_MS } from '../session';
import type { StoredTokens, TokenStorage } from '../tokenStorage';

class MemoryStorage implements TokenStorage {
  value: StoredTokens | null = null;
  async load() {
    return this.value;
  }
  async save(tokens: StoredTokens) {
    this.value = tokens;
  }
  async clear() {
    this.value = null;
  }
}

function authHeader(init: RequestInit): string | undefined {
  return (init.headers as Record<string, string>).Authorization;
}

const NOW = 1_800_000_000_000;

function setup() {
  const storage = new MemoryStorage();
  let now = NOW;
  const clock = { advance: (ms: number) => (now += ms) };
  const session = new AuthSession(storage, () => now);
  return { storage, session, clock };
}

describe('AuthSession', () => {
  it('persists tokens on start and restores them later without the network', async () => {
    const { storage, session } = setup();
    await session.start(tokenPair('a'));

    const relaunched = new AuthSession(storage, () => NOW);

    await expect(relaunched.restore()).resolves.toBe(true);
    expect(relaunched.hasSession()).toBe(true);
    expect(storage.value).toEqual({
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      accessExpiresAt: NOW + 900_000,
    });
  });

  it('sends the bearer token', async () => {
    const { session } = setup();
    await session.start(tokenPair('a'));
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    globalThis.fetch = fetchMock;

    await expect(session.request('/me')).resolves.toEqual({ ok: true });

    expect(authHeader(fetchCalls(fetchMock)[0]!.init)).toBe('Bearer access-a');
  });

  it('refreshes on 401 and retries once with the new token', async () => {
    const { storage, session } = setup();
    await session.start(tokenPair('a'));
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(errorResponse(401, 'token_expired'))
      .mockResolvedValueOnce(jsonResponse(200, tokenPair('b')))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'u1' }));
    globalThis.fetch = fetchMock;

    await expect(session.request('/me')).resolves.toEqual({ id: 'u1' });

    const calls = fetchCalls(fetchMock);
    expect(calls.map((c) => c.url)).toEqual([
      'http://api.test/v1/me',
      'http://api.test/v1/auth/refresh',
      'http://api.test/v1/me',
    ]);
    expect(calls[1]!.init.body).toBe('{"refresh_token":"refresh-a"}');
    expect(authHeader(calls[2]!.init)).toBe('Bearer access-b');
    expect(storage.value?.refreshToken).toBe('refresh-b');
  });

  it('shares one refresh between concurrent 401s (single flight)', async () => {
    const { session } = setup();
    await session.start(tokenPair('a'));
    let releaseRefresh: (r: Response) => void = () => undefined;
    const fetchMock = jest.fn((url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        return new Promise<Response>((resolve) => (releaseRefresh = resolve));
      }
      return Promise.resolve(
        authHeader(init) === 'Bearer access-b'
          ? jsonResponse(200, { url })
          : errorResponse(401, 'token_expired'),
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const pending = Promise.all([
      session.request('/one'),
      session.request('/two'),
      session.request('/three'),
    ]);
    await new Promise((r) => setTimeout(r, 0));
    releaseRefresh(jsonResponse(200, tokenPair('b')));

    await expect(pending).resolves.toHaveLength(3);
    const refreshes = fetchCalls(fetchMock as unknown as jest.Mock).filter((c) =>
      c.url.endsWith('/auth/refresh'),
    );
    expect(refreshes).toHaveLength(1);
  });

  it('refreshes ahead of expiry instead of waiting for a 401', async () => {
    const { session, clock } = setup();
    await session.start(tokenPair('a'));
    clock.advance(900_000 - REFRESH_SKEW_MS + 1);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, tokenPair('b')))
      .mockResolvedValueOnce(jsonResponse(200, {}));
    globalThis.fetch = fetchMock;

    await session.request('/me');

    const calls = fetchCalls(fetchMock);
    expect(calls[0]!.url).toBe('http://api.test/v1/auth/refresh');
    expect(authHeader(calls[1]!.init)).toBe('Bearer access-b');
  });

  it('ends the session when the refresh token is rejected', async () => {
    const { storage, session } = setup();
    await session.start(tokenPair('a'));
    const ended = jest.fn();
    session.onEnded(ended);
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(errorResponse(401, 'token_expired'))
      .mockResolvedValueOnce(errorResponse(401, 'refresh_token_reused'));

    await expect(session.request('/me')).rejects.toMatchObject({ code: 'refresh_token_reused' });

    expect(ended).toHaveBeenCalledTimes(1);
    expect(session.hasSession()).toBe(false);
    expect(storage.value).toBeNull();
  });

  it('keeps the session when the refresh fails offline', async () => {
    const { session } = setup();
    await session.start(tokenPair('a'));
    const ended = jest.fn();
    session.onEnded(ended);
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(errorResponse(401, 'token_expired'))
      .mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(session.request('/me')).rejects.toMatchObject({ code: 'network_error' });

    expect(ended).not.toHaveBeenCalled();
    expect(session.hasSession()).toBe(true);
  });

  it('falls back to the old token when a proactive refresh is offline', async () => {
    const { session, clock } = setup();
    await session.start(tokenPair('a'));
    clock.advance(900_000);
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed'));
    globalThis.fetch = fetchMock;

    await expect(session.request('/me')).rejects.toBeInstanceOf(ApiError);

    expect(authHeader(fetchCalls(fetchMock)[1]!.init)).toBe('Bearer access-a');
  });

  it('retries with a token another request already refreshed', async () => {
    const { session } = setup();
    await session.start(tokenPair('a'));
    let releaseFirst: (r: Response) => void = () => undefined;
    const fetchMock = jest
      .fn()
      // /slow: answered later with 401 for the old token.
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (releaseFirst = resolve)))
      // /fast: 401, refresh, retry ok.
      .mockResolvedValueOnce(errorResponse(401, 'token_expired'))
      .mockResolvedValueOnce(jsonResponse(200, tokenPair('b')))
      .mockResolvedValueOnce(jsonResponse(200, { fast: true }))
      // /slow retry with access-b.
      .mockResolvedValueOnce(jsonResponse(200, { slow: true }));
    globalThis.fetch = fetchMock;

    const slow = session.request('/slow');
    await session.request('/fast');
    releaseFirst(errorResponse(401, 'token_expired'));

    await expect(slow).resolves.toEqual({ slow: true });
    const calls = fetchCalls(fetchMock);
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(authHeader(calls[4]!.init)).toBe('Bearer access-b');
  });

  it('drops a refresh that completes after sign-out', async () => {
    const { storage, session } = setup();
    await session.start(tokenPair('a'));
    let release: (r: Response) => void = () => undefined;
    globalThis.fetch = jest.fn(
      () => new Promise<Response>((resolve) => (release = resolve)),
    ) as unknown as typeof fetch;

    const refreshing = session.refresh();
    await session.clear();
    release(jsonResponse(200, tokenPair('b')));

    await expect(refreshing).rejects.toMatchObject({ code: 'not_authenticated' });
    expect(session.hasSession()).toBe(false);
    expect(storage.value).toBeNull();
  });

  it('rejects requests without a session', async () => {
    const { session } = setup();

    await expect(session.request('/me')).rejects.toMatchObject({
      status: 401,
      code: 'not_authenticated',
    });
  });

  it('returns the refresh token on clear so it can be revoked', async () => {
    const { session } = setup();
    await session.start(tokenPair('a'));

    await expect(session.clear()).resolves.toBe('refresh-a');
    await expect(session.clear()).resolves.toBeNull();
  });
});
