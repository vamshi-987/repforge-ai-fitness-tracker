import { notificationAsync, NotificationFeedbackType } from 'expo-haptics';

/** A short "done" buzz, e.g. when rest is over. Never throws (no haptics on some devices). */
export function buzzDone(): void {
  notificationAsync(NotificationFeedbackType.Success).catch(() => undefined);
}
