import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerPushToken } from '@/api/social';

import { ensurePermission } from './notifier';
import { rememberPushToken } from './pushToken';

/** Pushes open these screens; anything else in a payload is ignored. */
export function pushPath(data: unknown): string | null {
  const path = (data as { path?: unknown } | null | undefined)?.path;
  if (typeof path !== 'string') return null;
  return path === '/coach/weekly' || path.startsWith('/social/') ? path : null;
}

/**
 * Register this phone for pushes. Quietly does nothing without permission or an EAS project id:
 * Expo Go can't receive remote pushes, so this needs a development build.
 */
export async function registerForPush(): Promise<boolean> {
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  if (!projectId || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return false;
  try {
    if (!(await ensurePermission())) return false;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerPushToken(data, Platform.OS);
    rememberPushToken(data);
    return true;
  } catch {
    return false;
  }
}

function open(response: Notifications.NotificationResponse | null): void {
  const path = pushPath(response?.notification.request.content.data);
  // A path checked above, so it's one of the app's routes.
  if (path) router.push(path as Href);
}

/** While signed in: keep this phone registered, and open what a tapped push points at. */
export function usePushNotifications(): void {
  useEffect(() => {
    void registerForPush();
    // The push that launched the app, if any.
    void Notifications.getLastNotificationResponseAsync()
      .then(open)
      .catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);
}
