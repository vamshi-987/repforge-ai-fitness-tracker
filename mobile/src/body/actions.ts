import type { BodyMeasurement, BodyWeight, MeasurementKind } from '@/api/types';
import { newId } from '@/lib/ids';
import { roundTo } from '@/lib/units';
import { useAuth } from '@/stores/auth';
import { deletion, measurementChange, weightChange } from '@/sync/changes';
import { queueChange } from '@/sync/queue';

import { bodyRepo } from './store';

// Logged on the device first and queued for the server, so weighing in works offline.

/** Keep the profile's weight (used by the water goal) on the newest weigh-in. */
async function refreshProfileWeight(): Promise<void> {
  const [latest] = await bodyRepo.weights();
  const { me, setMe } = useAuth.getState();
  if (me && latest && me.profile.weight_kg !== latest.weight_kg)
    setMe({ ...me, profile: { ...me.profile, weight_kg: latest.weight_kg } });
}

export async function logWeight(weightKg: number, measuredAt: number): Promise<BodyWeight> {
  const at = new Date(measuredAt).toISOString();
  const row: BodyWeight = {
    id: newId(),
    measured_at: at,
    weight_kg: roundTo(weightKg, 2),
    source: 'manual',
    version: 0,
    created_at: at,
    updated_at: at,
  };
  await bodyRepo.putWeight(row);
  await queueChange(weightChange(row));
  await refreshProfileWeight();
  return row;
}

export async function deleteWeight(id: string): Promise<void> {
  await bodyRepo.removeWeight(id);
  await queueChange(deletion('body_weight', id));
  await refreshProfileWeight();
}

export async function logMeasurement(
  kind: MeasurementKind,
  value: number,
  measuredAt: number,
): Promise<BodyMeasurement> {
  const at = new Date(measuredAt).toISOString();
  const row: BodyMeasurement = {
    id: newId(),
    measured_at: at,
    kind,
    value: roundTo(value, 1),
    version: 0,
    created_at: at,
    updated_at: at,
  };
  await bodyRepo.putMeasurement(row);
  await queueChange(measurementChange(row));
  return row;
}

export async function deleteMeasurement(id: string): Promise<void> {
  await bodyRepo.removeMeasurement(id);
  await queueChange(deletion('body_measurement', id));
}
