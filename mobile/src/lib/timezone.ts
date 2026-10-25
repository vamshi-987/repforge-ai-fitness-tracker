import { getCalendars } from 'expo-localization';

/** The device's IANA timezone (e.g. "Asia/Kolkata"), or UTC if the OS does not say. */
export function deviceTimezone(): string {
  try {
    return getCalendars()[0]?.timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
