import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { session } from '@/auth/session';
import { resetAuthStoreForTests, useAuth } from '@/stores/auth';
import { errorResponse, fetchCalls, jsonResponse, makeMe, tokenPair } from '@/test/helpers';

import SettingsScreen from '../../app/settings';

const ME = makeMe({ onboarding_complete: true });

function bodiesTo(fetchMock: jest.Mock, path: string) {
  return fetchCalls(fetchMock)
    .filter((c) => c.url.endsWith(path) && c.init.method === 'PATCH')
    .map((c) => JSON.parse(c.init.body as string));
}

beforeEach(async () => {
  resetAuthStoreForTests();
  await session.start(tokenPair('a'));
  useAuth.setState({ status: 'signedIn', me: ME });
});

describe('Settings screen', () => {
  it('switches weight units', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { ...ME.profile, unit_weight: 'lb' }));
    globalThis.fetch = fetchMock;
    await render(<SettingsScreen />);

    await fireEvent.press(screen.getByLabelText('Body weight and lifts: lb'));

    await waitFor(() => expect(useAuth.getState().me?.profile.unit_weight).toBe('lb'));
    expect(bodiesTo(fetchMock, '/me/profile')).toEqual([{ unit_weight: 'lb' }]);
  });

  it('changes theme, rest timer and keep-awake', async () => {
    const fetchMock = jest.fn(async (_url: string, init: RequestInit) =>
      jsonResponse(200, { ...ME.settings, ...JSON.parse(init.body as string) }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await render(<SettingsScreen />);

    await fireEvent.press(screen.getByLabelText('Theme: Dark'));
    await fireEvent.press(screen.getByLabelText('Increase Default rest timer'));
    await fireEvent(screen.getByLabelText('Keep screen awake'), 'valueChange', false);

    await waitFor(() =>
      expect(useAuth.getState().me?.settings).toMatchObject({
        theme: 'dark',
        default_rest_s: 105,
        keep_awake: false,
      }),
    );
    expect(screen.getByLabelText('Default rest timer: 1:45')).toBeOnTheScreen();
    expect(bodiesTo(fetchMock as unknown as jest.Mock, '/me/settings')).toEqual([
      { theme: 'dark' },
      { default_rest_s: 105 },
      { keep_awake: false },
    ]);
  });

  it('says so when a change could not be saved', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(errorResponse(503, 'service_unavailable'));
    await render(<SettingsScreen />);

    await fireEvent.press(screen.getByLabelText('Theme: Light'));

    expect(await screen.findByText(/Couldn.t save that change/)).toBeOnTheScreen();
    expect(useAuth.getState().me?.settings.theme).toBe('system');
  });

  it('logs out', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(jsonResponse(204, null));
    await render(<SettingsScreen />);

    await fireEvent.press(screen.getByLabelText('Log out'));

    await waitFor(() => expect(useAuth.getState().status).toBe('signedOut'));
  });

  it('shows the medical disclaimer and data attributions', async () => {
    await render(<SettingsScreen />);

    expect(screen.getByText(/estimates only, not medical advice/)).toBeOnTheScreen();
    expect(screen.getByText(/Open Food Facts \(ODbL\)/)).toBeOnTheScreen();
  });
});
