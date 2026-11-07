import Storage from 'expo-sqlite/kv-store';

import type { BodyWeight } from '@/api/types';
import { bodyRepo } from '@/body/store';
import { roundTo } from '@/lib/units';
import { weightChange } from '@/sync/changes';
import { queueChange } from '@/sync/queue';

import { healthBridge, type HealthBridge, type HealthWorkout } from './bridge';

const ENABLED_KEY = 'repforge.health.enabled';
const LAST_IMPORT_KEY = 'repforge.health.lastImport';
// How far back the first import looks.
const FIRST_IMPORT_MS = 90 * 86_400_000;
// Re-read a little before the last import, for samples that synced to the phone late.
const OVERLAP_MS = 86_400_000;
// What the server accepts as a weigh-in.
const MIN_KG = 25;
const MAX_KG = 350;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function healthEnabled(): Promise<boolean> {
  return (await Storage.getItemAsync(ENABLED_KEY)) === 'true';
}

/** Import weigh-ins the app hasn't seen. A sample's own id is the row's, so it comes in once. */
export async function importHealthWeights(
  bridge: HealthBridge | null,
  now = Date.now(),
): Promise<number> {
  if (!bridge || !(await healthEnabled())) return 0;
  const last = Number(await Storage.getItemAsync(LAST_IMPORT_KEY));
  const since = last ? last - OVERLAP_MS : now - FIRST_IMPORT_MS;
  const samples = await bridge.weightsSince(since);
  const known = new Set((await bodyRepo.weights()).map((w) => w.id));
  let added = 0;
  for (const sample of samples) {
    const id = sample.id.toLowerCase();
    if (known.has(id) || !UUID.test(id)) continue;
    if (sample.weightKg < MIN_KG || sample.weightKg > MAX_KG) continue;
    const at = new Date(sample.measuredAt).toISOString();
    const row: BodyWeight = {
      id,
      measured_at: at,
      weight_kg: roundTo(sample.weightKg, 2),
      source: 'health',
      version: 0,
      created_at: at,
      updated_at: at,
    };
    await bodyRepo.putWeight(row);
    await queueChange(weightChange(row));
    added += 1;
  }
  await Storage.setItemAsync(LAST_IMPORT_KEY, String(now));
  return added;
}

/** Ask for access and bring existing weigh-ins in. False if the user said no. */
export async function enableHealth(bridge: HealthBridge, now = Date.now()): Promise<boolean> {
  if (!(await bridge.connect())) return false;
  await Storage.setItemAsync(ENABLED_KEY, 'true');
  await importHealthWeights(bridge, now);
  return true;
}

export async function disableHealth(): Promise<void> {
  await Storage.removeItemAsync(ENABLED_KEY);
  await Storage.removeItemAsync(LAST_IMPORT_KEY);
}

/** A convenience on top of the app's own history, so a failure here is never the user's. */
export async function exportWorkoutToHealth(workout: HealthWorkout): Promise<void> {
  try {
    if (!(await healthEnabled())) return;
    await (await healthBridge())?.saveWorkout(workout);
  } catch {
    // The workout is safe in RepForge either way.
  }
}
