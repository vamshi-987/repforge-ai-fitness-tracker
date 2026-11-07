import Storage from 'expo-sqlite/kv-store';

import type { BodyRepo } from '@/body/repo';
import type { OutboxItem, OutboxRepo } from '@/sync/outbox';

import { healthBridge, type HealthBridge, type HealthWeight } from '../bridge';
import {
  disableHealth,
  enableHealth,
  exportWorkoutToHealth,
  healthEnabled,
  importHealthWeights,
} from '../sync';

jest.mock('../bridge', () => ({ healthBridge: jest.fn() }));

const bridgeModule = jest.requireMock<{ healthBridge: jest.Mock }>('../bridge');
const body = jest.requireMock<{ sqliteBodyRepo: BodyRepo }>('@/body/sqliteRepo').sqliteBodyRepo;
const outbox = jest.requireMock<{ sqliteOutbox: OutboxRepo & { items: OutboxItem[] } }>(
  '@/sync/sqliteOutbox',
).sqliteOutbox;

const NOW = Date.UTC(2026, 10, 7, 8);
const ID = '11111111-2222-4333-8444-555555555555';

function bridge(samples: HealthWeight[] = [], granted = true) {
  return {
    name: 'Apple Health',
    connect: jest.fn(async () => granted),
    weightsSince: jest.fn(async () => samples),
    saveWorkout: jest.fn(async () => undefined),
  } satisfies HealthBridge;
}

const sample = (overrides: Partial<HealthWeight> = {}): HealthWeight => ({
  id: ID.toUpperCase(),
  measuredAt: NOW - 3_600_000,
  weightKg: 80.123,
  ...overrides,
});

beforeEach(async () => {
  jest.clearAllMocks();
  await disableHealth();
  await body.clear();
  await outbox.clear();
});

describe('Health import', () => {
  it('does nothing until it’s turned on', async () => {
    const phone = bridge([sample()]);

    expect(await importHealthWeights(phone, NOW)).toBe(0);
    expect(await importHealthWeights(null, NOW)).toBe(0);

    expect(phone.weightsSince).not.toHaveBeenCalled();
  });

  it('turns on with permission, and brings 90 days of weigh-ins in', async () => {
    const phone = bridge([sample()]);

    expect(await enableHealth(phone, NOW)).toBe(true);

    expect(await healthEnabled()).toBe(true);
    expect(phone.weightsSince).toHaveBeenCalledWith(NOW - 90 * 86_400_000);
    expect(await body.weights()).toEqual([
      expect.objectContaining({ id: ID, weight_kg: 80.12, source: 'health', version: 0 }),
    ]);
    expect(outbox.items).toEqual([
      expect.objectContaining({ entity: 'body_weight', entityId: ID, op: 'upsert' }),
    ]);
  });

  it('stays off if the user says no', async () => {
    expect(await enableHealth(bridge([], false), NOW)).toBe(false);

    expect(await healthEnabled()).toBe(false);
  });

  it('brings a sample in once, however often it’s read', async () => {
    const phone = bridge([sample()]);
    await enableHealth(phone, NOW);

    expect(await importHealthWeights(phone, NOW + 1000)).toBe(0);

    expect(await body.weights()).toHaveLength(1);
  });

  it('later imports overlap the last one by a day', async () => {
    const phone = bridge();
    await enableHealth(phone, NOW);

    await importHealthWeights(phone, NOW + 7 * 86_400_000);

    expect(phone.weightsSince).toHaveBeenLastCalledWith(NOW - 86_400_000);
  });

  it('skips what the server would refuse', async () => {
    const phone = bridge([
      sample({ id: 'not-a-uuid' }),
      sample({ weightKg: 10 }),
      sample({ id: ID.replace('1', '2'), weightKg: 500 }),
    ]);

    await enableHealth(phone, NOW);

    expect(await body.weights()).toEqual([]);
  });

  it('forgets everything when turned off', async () => {
    await enableHealth(bridge(), NOW);

    await disableHealth();

    expect(await healthEnabled()).toBe(false);
    expect(await Storage.getItemAsync('repforge.health.lastImport')).toBeNull();
  });
});

describe('Health export', () => {
  const WORKOUT = { title: 'Push', startedAt: NOW - 3_600_000, endedAt: NOW };

  it('saves a finished workout when turned on', async () => {
    const phone = bridge();
    bridgeModule.healthBridge.mockResolvedValue(phone);
    await enableHealth(phone, NOW);

    await exportWorkoutToHealth(WORKOUT);

    expect(phone.saveWorkout).toHaveBeenCalledWith(WORKOUT);
  });

  it('does nothing when off', async () => {
    const phone = bridge();
    bridgeModule.healthBridge.mockResolvedValue(phone);

    await exportWorkoutToHealth(WORKOUT);

    expect(phone.saveWorkout).not.toHaveBeenCalled();
  });

  it('never lets a failure reach the workout', async () => {
    const phone = bridge();
    await enableHealth(phone, NOW);
    bridgeModule.healthBridge.mockRejectedValue(new Error('no'));

    await expect(exportWorkoutToHealth(WORKOUT)).resolves.toBeUndefined();
    expect(healthBridge).toHaveBeenCalled();
  });
});
