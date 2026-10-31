import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/stores/auth';

import { syncWaterReminders } from './actions';

/**
 * Keep water reminders in step with today: on launch, when the app comes back (a new day
 * may have started), and when the reminder settings change.
 */
export function useWaterReminders(): void {
  const settings = useAuth((state) => state.me?.settings);
  const key = settings
    ? `${settings.reminders_enabled}|${settings.water_reminder_every_h}|${settings.wake_time}|${settings.sleep_time}`
    : '';

  useEffect(() => {
    void syncWaterReminders();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void syncWaterReminders();
    });
    return () => subscription.remove();
  }, [key]);
}
