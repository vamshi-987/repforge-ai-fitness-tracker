import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import type { WeeklyReport } from '@/api/types';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/helpers';

import WeeklyReportScreen from '../../app/coach/weekly';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/api/coach', () => ({ applyWeeklyReport: jest.fn(), getWeeklyReport: jest.fn() }));

const api =
  jest.requireMock<Record<'applyWeeklyReport' | 'getWeeklyReport', jest.Mock>>('@/api/coach');

const REPORT: WeeklyReport = {
  id: 'r1',
  week_start: '2026-10-26',
  status: 'too_slow',
  avg_weight_kg: 80.1,
  prev_avg_weight_kg: 80,
  change_kg: 0.1,
  rate_pct: 0.13,
  target_rate_min_pct: 0.25,
  target_rate_max_pct: 0.5,
  weigh_ins: 3,
  current_targets: { kcal: 2800, protein_g: 144, carbs_g: 350, fat_g: 78 },
  suggested_targets: { kcal: 3000, protein_g: 144, carbs_g: 419, fat_g: 83 },
  delta_kcal: 200,
  tdee_kcal: 2390,
  tdee_source: 'adaptive',
  avg_kcal_logged: 2500,
  avg_protein_g: 100,
  days_logged: 7,
  workouts: 3,
  check_in: false,
  floor_hit: false,
  headline: 'Weight is moving a little slower than planned',
  tips: ['Add a small snack after training.'],
  ai_written: true,
  applied: false,
  created_at: '',
};

async function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WeeklyReportScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.setState({ status: 'signedIn', me: makeMe({ onboarding_complete: true }) });
});

describe('Weekly report', () => {
  it('leads a free account to Pro', async () => {
    api.getWeeklyReport.mockRejectedValue(new ApiError(403, 'pro_required', 'Pro'));

    await show();

    await fireEvent.press(await screen.findByLabelText('See RepForge Pro'));
    const { router } = jest.requireMock<{ router: { push: jest.Mock } }>('expo-router');
    expect(router.push).toHaveBeenCalledWith('/pro');
  });

  it('shows the numbers, the change and the tips', async () => {
    api.getWeeklyReport.mockResolvedValue(REPORT);

    await show();

    expect(await screen.findByText(REPORT.headline)).toBeOnTheScreen();
    expect(screen.getByText(/Too slow/)).toBeOnTheScreen();
    expect(screen.getByText('2800 → 3000 kcal')).toBeOnTheScreen();
    expect(screen.getByText('P 144 · C 419 · F 83 g')).toBeOnTheScreen();
    expect(screen.getByText('2390 kcal')).toBeOnTheScreen();
    expect(screen.getByText(/small snack/)).toBeOnTheScreen();
    expect(screen.getByText('Estimates only, not medical advice.')).toBeOnTheScreen();
    expect(api.applyWeeklyReport).not.toHaveBeenCalled();
  });

  it('applies new targets only when asked', async () => {
    api.getWeeklyReport.mockResolvedValueOnce(REPORT);
    api.getWeeklyReport.mockResolvedValue({ ...REPORT, applied: true });
    api.applyWeeklyReport.mockResolvedValue({});
    await show();

    await fireEvent.press(await screen.findByLabelText('Apply new targets'));

    expect(await screen.findByText('Applied')).toBeOnTheScreen();
    expect(api.applyWeeklyReport).toHaveBeenCalledWith('r1');
  });

  it('keeps the button when applying fails', async () => {
    api.getWeeklyReport.mockResolvedValue(REPORT);
    api.applyWeeklyReport.mockRejectedValue(new ApiError(0, 'network_error', 'Offline'));
    await show();

    await fireEvent.press(await screen.findByLabelText('Apply new targets'));

    expect(await screen.findByText(/couldn’t be saved/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Apply new targets')).toBeOnTheScreen();
  });

  it('offers nothing to apply when on track', async () => {
    api.getWeeklyReport.mockResolvedValue({ ...REPORT, status: 'on_track', delta_kcal: 0 });

    await show();

    expect(await screen.findByText(/On track/)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Apply new targets')).toBeNull();
  });

  it('shows the check-in before anything else', async () => {
    api.getWeeklyReport.mockResolvedValue({ ...REPORT, check_in: true, delta_kcal: 0 });

    await show();

    expect(await screen.findByText('A gentle check-in')).toBeOnTheScreen();
    expect(screen.getByText(/doctor or dietitian/)).toBeOnTheScreen();
  });

  it('asks for more weigh-ins when there aren’t enough', async () => {
    api.getWeeklyReport.mockResolvedValue({
      ...REPORT,
      status: 'insufficient_data',
      avg_weight_kg: null,
      change_kg: null,
      rate_pct: null,
      suggested_targets: null,
      delta_kcal: 0,
      tdee_kcal: null,
      tdee_source: null,
      weigh_ins: 1,
      headline: 'Log more weigh-ins to get your weekly report.',
    });

    await show();

    expect(await screen.findByText('1 of 3 weigh-ins last week.')).toBeOnTheScreen();
  });

  it('labels an estimated burn', async () => {
    api.getWeeklyReport.mockResolvedValue({ ...REPORT, tdee_source: 'estimate' });

    await show();

    expect(await screen.findByText('Burned a day (estimate)')).toBeOnTheScreen();
  });

  it.each([
    [new ApiError(403, 'pro_required', 'Pro'), /part of RepForge Pro/],
    [new ApiError(0, 'network_error', 'Offline'), /needs a connection/],
  ])('explains why there is no report', async (error, message) => {
    api.getWeeklyReport.mockRejectedValue(error);

    await show();

    await waitFor(() => expect(screen.getByText(message)).toBeOnTheScreen());
  });
});
