import type { WaterLog } from '@/api/types';
import { newId } from '@/lib/ids';
import { replaceWaterReminders } from '@/notifications/notifier';
import { useAuth } from '@/stores/auth';
import { deletion, waterChange } from '@/sync/changes';
import { queueChange } from '@/sync/queue';

import { reminderTimes } from './rules';
import { loadToday, waterRepo } from './store';

// Drinks are logged on the device first and queued for the server, so they work offline.

export async function addWater(amountMl: number, now = Date.now()): Promise<WaterLog> {
  const at = new Date(now).toISOString();
  const row: WaterLog = {
    id: newId(),
    logged_at: at,
    amount_ml: Math.round(amountMl),
    version: 0,
    created_at: at,
    updated_at: at,
  };
  await waterRepo.put(row);
  await queueChange(waterChange(row));
  await syncWaterReminders(now);
  return row;
}

/** Undo a drink (the snackbar), or delete one from today's list. */
export async function removeWater(id: string, now = Date.now()): Promise<void> {
  await waterRepo.remove(id);
  await queueChange(deletion('water_log', id));
  await syncWaterReminders(now);
}

/**
 * Re-plan the local water reminders from today's total: none at all when reminders are off,
 * none for the rest of today once the goal is met (PLAN.md deviation 1), tomorrow's always.
 */
export async function syncWaterReminders(now = Date.now()): Promise<void> {
  const me = useAuth.getState().me;
  const settings = me?.settings;
  if (!settings?.reminders_enabled) {
    await replaceWaterReminders([], '');
    return;
  }
  const today = await loadToday(me, now);
  const times = reminderTimes({
    now,
    everyHours: settings.water_reminder_every_h,
    wake: settings.wake_time,
    sleep: settings.sleep_time,
    goalMet: today.totalMl >= today.goalMl,
  });
  await replaceWaterReminders(times, 'A glass now keeps you on track for your daily goal.');
}
