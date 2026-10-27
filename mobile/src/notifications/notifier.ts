/**
 * The few local notifications the app shows, behind one small module so screens and tests
 * never touch expo-notifications directly. Every call fails quietly: a missing permission
 * or an unsupported platform must never break logging a workout.
 */
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

export const CHANNELS = { workout: 'workout-in-progress', rest: 'rest-timer' } as const;

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
export async function showOngoing(id: string, title: string, body: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await ensureChannels();
    if (!(await ensurePermission())) return;
    await Notifications.scheduleNotificationAsync({
      identifier: id,
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
