import { session } from '@/auth/session';
import { resetAuthStoreForTests, useAuth } from '@/stores/auth';
import { errorResponse, fetchCalls, jsonResponse, makeMe, tokenPair } from '@/test/helpers';

import { saveSettings, saveUnits } from '../actions';

const settingsOf = () => useAuth.getState().me!.settings;

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(async () => {
  resetAuthStoreForTests();
  await session.start(tokenPair('a'));
  useAuth.setState({ status: 'signedIn', me: makeMe({ onboarding_complete: true }) });
});

describe('optimistic settings', () => {
  it('applies immediately and keeps the server value', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { ...makeMe().settings, theme: 'dark' }));
    globalThis.fetch = fetchMock;

    const saving = saveSettings({ theme: 'dark' });
    expect(settingsOf().theme).toBe('dark');

    await expect(saving).resolves.toBe(true);
    expect(settingsOf().theme).toBe('dark');
    const [call] = fetchCalls(fetchMock);
    expect(call?.url).toBe('http://api.test/v1/me/settings');
    expect(JSON.parse(call?.init.body as string)).toEqual({ theme: 'dark' });
  });

  it('rolls back only the keys it changed', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(errorResponse(503, 'service_unavailable'))
      .mockResolvedValue(jsonResponse(200, makeMe({ onboarding_complete: true })));
    useAuth.setState({
      me: makeMe({ onboarding_complete: true, display_name: 'Changed meanwhile' }),
    });

    await expect(saveSettings({ keep_awake: false })).resolves.toBe(false);

    expect(settingsOf().keep_awake).toBe(true);
  });

  it('does not let an older response overwrite a newer tap', async () => {
    const first = deferred<Response>();
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(jsonResponse(200, { ...makeMe().settings, default_rest_s: 120 }));
    globalThis.fetch = fetchMock;

    const a = saveSettings({ default_rest_s: 105 });
    const b = saveSettings({ default_rest_s: 120 });
    expect(settingsOf().default_rest_s).toBe(120);
    first.resolve(jsonResponse(200, { ...makeMe().settings, default_rest_s: 105 }));
    await Promise.all([a, b]);

    expect(settingsOf().default_rest_s).toBe(120);
  });

  it('sends writes in order, one at a time', async () => {
    const first = deferred<Response>();
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(jsonResponse(200, makeMe().settings));
    globalThis.fetch = fetchMock;

    const a = saveSettings({ theme: 'dark' });
    const b = saveSettings({ theme: 'light' });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    first.resolve(jsonResponse(200, { ...makeMe().settings, theme: 'dark' }));
    await Promise.all([a, b]);

    const bodies = fetchCalls(fetchMock).map((c) => JSON.parse(c.init.body as string));
    expect(bodies).toEqual([{ theme: 'dark' }, { theme: 'light' }]);
  });

  it('saves units through the profile endpoint', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { ...makeMe().profile, unit_weight: 'lb' }));
    globalThis.fetch = fetchMock;

    await expect(saveUnits({ unit_weight: 'lb' })).resolves.toBe(true);

    expect(useAuth.getState().me?.profile.unit_weight).toBe('lb');
    expect(fetchCalls(fetchMock)[0]?.url).toBe('http://api.test/v1/me/profile');
  });

  it('does nothing when signed out', async () => {
    useAuth.setState({ me: null });
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;

    await expect(saveSettings({ theme: 'dark' })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
