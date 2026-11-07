import { session } from '@/auth/session';
import { tokensFromPair } from '@/auth/tokenStorage';
import {
  errorResponse,
  fetchCalls,
  jsonResponse,
  makeMe,
  mockStores,
  tokenPair,
} from '@/test/helpers';

import { resetAuthStoreForTests, useAuth } from '../auth';

const TOKENS_KEY = 'repforge.auth.tokens';
const ME_KEY = 'repforge.me';

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  await session.clear();
  mockStores().secure.clear();
  mockStores().kv.clear();
  resetAuthStoreForTests();
});

describe('auth store', () => {
  it('boots signed out with no saved session', async () => {
    mockStores().kv.set(ME_KEY, JSON.stringify(makeMe()));

    await useAuth.getState().bootstrap();

    expect(useAuth.getState().status).toBe('signedOut');
    expect(mockStores().kv.has(ME_KEY)).toBe(false);
  });

  it('stays signed in across a relaunch, offline, using the cached profile', async () => {
    mockStores().secure.set(TOKENS_KEY, JSON.stringify(tokensFromPair(tokenPair('a'))));
    mockStores().kv.set(ME_KEY, JSON.stringify(makeMe({ onboarding_complete: true })));
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    await useAuth.getState().bootstrap();
    await flush();

    const state = useAuth.getState();
    expect(state.status).toBe('signedIn');
    expect(state.me?.onboarding_complete).toBe(true);
    expect(state.meStatus).toBe('error');
  });

  it('refreshes the cached profile in the background when online', async () => {
    mockStores().secure.set(TOKENS_KEY, JSON.stringify(tokensFromPair(tokenPair('a'))));
    mockStores().kv.set(ME_KEY, JSON.stringify(makeMe({ display_name: 'Old' })));
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, makeMe({ display_name: 'New' })));

    await useAuth.getState().bootstrap();
    await flush();

    expect(useAuth.getState().me?.display_name).toBe('New');
    expect(JSON.parse(mockStores().kv.get(ME_KEY) ?? '{}').display_name).toBe('New');
  });

  it('boots only once even if called twice', async () => {
    const restore = jest.spyOn(session, 'restore');

    await Promise.all([useAuth.getState().bootstrap(), useAuth.getState().bootstrap()]);

    expect(restore).toHaveBeenCalledTimes(1);
    restore.mockRestore();
  });

  it('signs in: saves tokens and loads the profile', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(jsonResponse(200, makeMe()));

    await useAuth.getState().signIn({ ...tokenPair('a'), user: makeMe(), is_new_user: true });

    expect(useAuth.getState().status).toBe('signedIn');
    expect(useAuth.getState().me?.username).toBe('lifter');
    expect(JSON.parse(mockStores().secure.get(TOKENS_KEY) ?? '{}').refreshToken).toBe('refresh-a');
  });

  it('signs out locally even when the logout request fails', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(200, makeMe()));
    await useAuth.getState().signIn({ ...tokenPair('a'), user: makeMe(), is_new_user: false });
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    globalThis.fetch = fetchMock;

    await useAuth.getState().signOut();
    await flush();

    expect(useAuth.getState()).toMatchObject({ status: 'signedOut', me: null });
    expect(mockStores().secure.has(TOKENS_KEY)).toBe(false);
    expect(mockStores().kv.has(ME_KEY)).toBe(false);
    const [logout] = fetchCalls(fetchMock);
    expect(logout?.url).toBe('http://api.test/v1/auth/logout');
    expect(logout?.init.body).toBe('{"refresh_token":"refresh-a"}');
  });

  it('signs out when the server rejects the refresh token', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(200, makeMe()));
    await useAuth.getState().signIn({ ...tokenPair('a'), user: makeMe(), is_new_user: false });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(errorResponse(401, 'token_expired'))
      .mockResolvedValueOnce(errorResponse(401, 'refresh_token_reused'));

    await useAuth.getState().refreshMe();

    expect(useAuth.getState().status).toBe('signedOut');
    expect(mockStores().kv.has(ME_KEY)).toBe(false);
  });
});
