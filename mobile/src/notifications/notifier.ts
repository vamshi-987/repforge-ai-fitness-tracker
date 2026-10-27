/**
 * The few local notifications the app shows, behind one small module so screens and tests
 * never touch expo-notifications directly. Every call fails quietly: a missing permission
 * or an unsupported platform must never break logging a workout.
 */
import * as Notifications from 'expo-notifications';
import {
  AndroidImportance,
  SchedulableTriggerInputTypes,
  type NotificationBehavior,
} from 'expo-notifications';
import { Platform } from 'react-native';

export const CHANNELS = { workout: 'workout-in-progress', rest: 'rest-timer' } as const;

export const ONGOING_NOTIFICATION_ID = 'workout-in-progress';
export const REST_NOTIFICATION_ID = 'rest-timer';

const quiet = { shouldPlaySound: false, shouldSetBadge: false };

/**
 * How a notification shows while the app is open. Without a handler, expo-notifications
 * shows nothing in the foreground at all. The workout notification goes to the tray only;
 * the rest timer's is silenced, because the open app already buzzes and clears it.
 */
export function foregroundBehavior(identifier: string): NotificationBehavior {
  if (identifier === REST_NOTIFICATION_ID)
    return { ...quiet, shouldShowBanner: false, shouldShowList: false };
  if (identifier === ONGOING_NOTIFICATION_ID)
    return { ...quiet, shouldShowBanner: false, shouldShowList: true };
  return {
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  };
}

export function installNotificationHandler(): void {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) =>
        foregroundBehavior(notification.request.identifier),
    });
  } catch {
    // Not available on this platform.
  }
}

let channels: Promise<void> | null = null;

function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channels ??= Promise.all([
    Notifications.setNotificationChannelAsync(CHANNELS.workout, {
      name: 'Workout in progress',
      importance: AndroidImportance.LOW,
      sound: null,
    }),
    Notifications.setNotificationChannelAsync(CHANNELS.rest, {
      name: 'Rest timer',
      importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 300, 200, 300],
    }),
  ]).then(() => undefined);
  return channels;
}

/** Ask once; later calls return the stored answer. */
export async function ensurePermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** An Android notification that stays while a workout is in progress. */
export async function showOngoing(title: string, body: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await ensureChannels();
    if (!(await ensurePermission())) return;
    await Notifications.scheduleNotificationAsync({
      identifier: ONGOING_NOTIFICATION_ID,
      content: { title, body, sticky: true, autoDismiss: false, sound: false },
      trigger: { channelId: CHANNELS.workout },
    });
  } catch {
    // Notifications are a convenience; the workout carries on without them.
  }
}

export async function dismiss(id: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(id);
  } catch {
    // Nothing shown, or not supported.
  }
}

/** Replace any pending rest notification with one at `endsAt` (epoch ms). */
export async function scheduleRestEnd(endsAt: number, body: string): Promise<void> {
  try {
    await ensureChannels();
    if (!(await ensurePermission())) return;
    await Notifications.cancelScheduledNotificationAsync(REST_NOTIFICATION_ID);
    await Notifications.scheduleNotificationAsync({
      identifier: REST_NOTIFICATION_ID,
      content: {
        title: 'Rest is over',
        body,
        sound: 'default',
        interruptionLevel: 'timeSensitive',
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DATE,
        date: endsAt,
        channelId: CHANNELS.rest,
      },
    });
  } catch {
    // The in-app timer still runs and buzzes while the app is open.
  }
}

/** Cancel a pending rest notification and clear one already shown. */
export async function cancelRestEnd(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(REST_NOTIFICATION_ID);
  } catch {
    // Nothing scheduled.
  }
  await dismiss(REST_NOTIFICATION_ID);
}
