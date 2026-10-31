import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { MuscleStats, StatsSummary } from '@/api/types';
import { session } from '@/auth/session';
import { resetAuthStoreForTests, useAuth } from '@/stores/auth';
import { jsonResponse, makeMe, tokenPair } from '@/test/helpers';

import ProfileScreen from '../../app/(tabs)/profile/index';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const SUMMARY: StatsSummary = {
  range: '3m',
  workouts: 3,
  duration_s: 3 * 3600,
  volume_kg: 12500,
  sets: 40,
  weeks: [
    { week_start: '2026-10-12', workouts: 1, duration_s: 3600, volume_kg: 4000, sets: 12 },
    { week_start: '2026-10-19', workouts: 0, duration_s: 0, volume_kg: 0, sets: 0 },
    { week_start: '2026-10-26', workouts: 2, duration_s: 7200, volume_kg: 8500, sets: 28 },
  ],
  streak_weeks: 1,
};
const MUSCLES: MuscleStats = {
  range: '3m',
  muscles: [{ slug: 'chest', name: 'Chest', body_map_key: 'chest', sets: 12 }],
};

async function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProfileScreen />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  resetAuthStoreForTests();
  await session.start(tokenPair('a'));
  useAuth.setState({ status: 'signedIn', me: makeMe({ onboarding_complete: true }) });
});

describe('Profile dashboard', () => {
  it('shows totals, the weekly chart and the muscles trained', async () => {
    const fetchMock = jest.fn(async (url: string) =>
      jsonResponse(200, url.includes('/stats/muscles') ? MUSCLES : SUMMARY),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await show();

    expect(await screen.findByLabelText('Workouts: 3')).toBeOnTheScreen();
    expect(screen.getByLabelText('Time: 3 h')).toBeOnTheScreen();
    expect(screen.getByLabelText('Streak: 1 wk')).toBeOnTheScreen();
    expect(screen.getByLabelText('Workouts per week over 3 weeks, this week 2')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Weekly chart: Volume'));
    expect(
      screen.getByLabelText('Volume per week over 3 weeks, this week 8500 kg'),
    ).toBeOnTheScreen();
    expect(await screen.findByText('Chest 12 sets')).toBeOnTheScreen();
  });

  it('keeps long ranges for Pro and explains being offline', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    globalThis.fetch = fetchMock;
    await show();

    expect(await screen.findByText(/Stats need a connection/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Stats range: All 🔒'));
    expect(screen.getByText(/part of RepForge Pro/)).toBeOnTheScreen();
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('range=all'))).toBe(true);
  });
});
