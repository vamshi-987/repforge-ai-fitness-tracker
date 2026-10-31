import type { BodyMeasurement, BodyWeight } from '@/api/types';
import { createMemoryBodyRepo } from '@/body/repo';
import { createMemoryRepo } from '@/exercises/repo';
import { createMemoryRoutineRepo } from '@/routines/repo';
import { createMemoryWaterRepo } from '@/water/repo';
import { createMemoryHistoryRepo } from '@/workout/history';

import { measurementChange, weightChange } from '../changes';
import { createLocalStore } from '../local';

const WEIGHT: BodyWeight = {
  id: 'w',
  measured_at: '2026-10-30T06:00:00.000Z',
  weight_kg: 80.2,
  source: 'manual',
  version: 3,
  created_at: '',
  updated_at: '',
};
const WAIST: BodyMeasurement = {
  id: 'm',
  measured_at: '2026-10-30T06:00:00.000Z',
  kind: 'waist',
  value: 82,
  version: 0,
  created_at: '',
  updated_at: '',
};

describe('body sync', () => {
  it('queues weigh-ins and measurements as their POST bodies', () => {
    expect(weightChange(WEIGHT)).toEqual({
      entity: 'body_weight',
      entityId: 'w',
      op: 'upsert',
      baseVersion: 3,
      data: { measured_at: WEIGHT.measured_at, weight_kg: 80.2, source: 'manual' },
    });
    expect(measurementChange(WAIST)).toMatchObject({
      entity: 'body_measurement',
      baseVersion: null,
      data: { measured_at: WAIST.measured_at, kind: 'waist', value: 82 },
    });
  });

  it('writes pulled body rows to the body repo', async () => {
    const body = createMemoryBodyRepo();
    const local = createLocalStore({
      library: createMemoryRepo(),
      routines: createMemoryRoutineRepo(),
      history: createMemoryHistoryRepo(),
      body,
      water: createMemoryWaterRepo(),
    });

    await local.apply('body_weight', 'w', WEIGHT);
    await local.apply('body_measurement', 'm', WAIST);
    expect(await body.weights()).toEqual([WEIGHT]);
    expect(await body.measurements()).toEqual([WAIST]);

    await local.apply('body_weight', 'w', null);
    await local.apply('body_measurement', 'm', null);
    expect(await body.weights()).toEqual([]);
    expect(await body.measurements()).toEqual([]);
  });
});
