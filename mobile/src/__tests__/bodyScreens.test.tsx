import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import type { BodyRepo } from '@/body/repo';
import { weekStartMs } from '@/body/trend';
import { session } from '@/auth/session';
import { resetAuthStoreForTests, useAuth } from '@/stores/auth';
import type { OutboxItem, OutboxRepo } from '@/sync/outbox';
import { jsonResponse, makeMe, tokenPair } from '@/test/helpers';

import BodyWeightScreen from '../../app/body/index';
import MeasurementsScreen from '../../app/body/measurements';
import ProgressPhotosScreen from '../../app/body/photos';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: false })),
  launchCameraAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///photo.jpg', mimeType: 'image/jpeg' }],
  })),
  launchImageLibraryAsync: jest.fn(),
}));

const body = jest.requireMock<{ sqliteBodyRepo: BodyRepo }>('@/body/sqliteRepo').sqliteBodyRepo;
const outbox = jest.requireMock<{ sqliteOutbox: OutboxRepo & { items: OutboxItem[] } }>(
  '@/sync/sqliteOutbox',
).sqliteOutbox;

function signIn(units: { unit_weight: 'kg' | 'lb'; unit_length: 'cm' | 'in' }) {
  const me = makeMe({ onboarding_complete: true });
  useAuth.setState({ status: 'signedIn', me: { ...me, profile: { ...me.profile, ...units } } });
}

async function show(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuthStoreForTests();
  await session.start(tokenPair('a'));
  signIn({ unit_weight: 'kg', unit_length: 'cm' });
  await body.clear();
  await outbox.clear();
});

describe('Body weight', () => {
  it('logs a weigh-in in pounds, offline, and queues it', async () => {
    signIn({ unit_weight: 'lb', unit_length: 'in' });
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await show(<BodyWeightScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Weight (lb)'), '176,4');
    await fireEvent.press(screen.getByLabelText('Log weight'));

    await waitFor(async () => expect(await body.weights()).toHaveLength(1));
    const [logged] = await body.weights();
    expect(logged?.weight_kg).toBe(80.01);
    expect(outbox.items).toEqual([
      expect.objectContaining({
        entity: 'body_weight',
        op: 'upsert',
        data: expect.objectContaining({ weight_kg: 80.01, source: 'manual' }),
      }),
    ]);
    expect(useAuth.getState().me?.profile.weight_kg).toBe(80.01);
    expect(await screen.findByText(/Log 2 more weigh-ins this week/)).toBeOnTheScreen();
  });

  it('shows the weekly average once the week has 3 weigh-ins', async () => {
    const monday = weekStartMs(Date.now());
    for (const [hours, kg] of [
      [1, 80],
      [2, 80.4],
      [3, 79.8],
    ] as const) {
      const at = new Date(monday + hours * 3_600_000).toISOString();
      await body.putWeight({
        id: `w${hours}`,
        measured_at: at,
        weight_kg: kg,
        source: 'manual',
        version: 1,
        created_at: at,
        updated_at: at,
      });
    }
    await show(<BodyWeightScreen />);

    expect(await screen.findByText('80.1 kg average')).toBeOnTheScreen();
    expect(screen.getByText(/80\.1 kg \(3 weigh-ins\)/)).toBeOnTheScreen();
    expect(
      screen.getByLabelText(/Weight trend: 3 weigh-ins, .*latest weekly average 80\.1 kg/),
    ).toBeOnTheScreen();
  });

  it('refuses an implausible weight', async () => {
    await show(<BodyWeightScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Weight (kg)'), '900');
    await fireEvent.press(screen.getByLabelText('Log weight'));

    expect(await screen.findByText(/Enter a weight between 25 kg and 350 kg/)).toBeOnTheScreen();
    expect(outbox.items).toEqual([]);
  });
});

describe('Measurements', () => {
  it('saves in inches as cm and shows the change', async () => {
    signIn({ unit_weight: 'lb', unit_length: 'in' });
    await show(<MeasurementsScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Waist (in)'), '33');
    await fireEvent.press(screen.getByLabelText('Save measurement'));
    await waitFor(async () => expect(await body.measurements()).toHaveLength(1));
    await fireEvent.changeText(screen.getByLabelText('Waist (in)'), '32');
    await fireEvent.press(screen.getByLabelText('Save measurement'));

    await waitFor(async () => expect(await body.measurements()).toHaveLength(2));
    expect((await body.measurements()).map((m) => m.value).sort()).toEqual([81.3, 83.8]);
    expect(await screen.findByText(/Waist: 32 in \(−1 in\)/)).toBeOnTheScreen();
    expect(outbox.items.map((i) => i.entity)).toEqual(['body_measurement', 'body_measurement']);
  });

  it('takes body fat in percent', async () => {
    await show(<MeasurementsScreen />);

    await fireEvent.press(await screen.findByLabelText('Body fat'));
    await fireEvent.changeText(screen.getByLabelText('Body fat (%)'), '95');
    await fireEvent.press(screen.getByLabelText('Save measurement'));

    expect(await screen.findByText('Enter body fat between 2% and 70%.')).toBeOnTheScreen();
  });
});

describe('Progress photos', () => {
  it('uploads a camera photo straight to storage, then records it', async () => {
    const calls: [string, string][] = [];
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push([init?.method ?? 'GET', url]);
      if (url === 'file:///photo.jpg') return { blob: async () => 'bytes' } as unknown as Response;
      if (url.endsWith('/uploads/presign'))
        return jsonResponse(200, {
          object_key: 'u/p.jpg',
          upload_url: 'http://s3.test/progress-photos/u/p.jpg?X-Amz-Signature=x',
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          expires_at: '2026-10-30T10:00:00Z',
        });
      if (url.startsWith('http://s3.test')) return { ok: true, status: 200 } as Response;
      if (url.endsWith('/body/photos') && init?.method === 'POST')
        return jsonResponse(201, { id: 'p1' });
      return jsonResponse(200, { items: [], next_cursor: null });
    }) as unknown as typeof fetch;
    await show(<ProgressPhotosScreen />);

    await fireEvent.press(await screen.findByLabelText('Pose: Side'));
    await fireEvent.press(screen.getByLabelText('Take photo'));

    await waitFor(() =>
      expect(calls.some(([m, u]) => m === 'POST' && u.endsWith('/body/photos'))).toBe(true),
    );
    expect(calls.map(([m, u]) => `${m} ${u.replace('http://api.test/v1', '')}`)).toEqual(
      expect.arrayContaining([
        'POST /uploads/presign',
        'PUT http://s3.test/progress-photos/u/p.jpg?X-Amz-Signature=x',
        'POST /body/photos',
      ]),
    );
    const created = (globalThis.fetch as jest.Mock).mock.calls.find(
      ([u, i]: [string, RequestInit | undefined]) =>
        u.endsWith('/body/photos') && i?.method === 'POST',
    );
    expect(JSON.parse(created[1].body as string)).toMatchObject({
      object_key: 'u/p.jpg',
      pose: 'side',
    });
  });

  it('asks for library access, and says photos need a connection', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await show(<ProgressPhotosScreen />);

    expect(await screen.findByText('Photos need a connection.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Choose from library'));
    expect(await screen.findByText(/Allow photo library access/)).toBeOnTheScreen();
  });
});
