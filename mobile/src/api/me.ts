import { session } from '@/auth/session';

import type { Me, MeUpdate, Profile, ProfileUpdate, Settings, SettingsUpdate } from './types';

export function getMe(signal?: AbortSignal): Promise<Me> {
  return session.request<Me>('/me', { signal });
}

export function updateMe(body: MeUpdate): Promise<Me> {
  return session.request<Me>('/me', { method: 'PATCH', body });
}

export function updateProfile(body: ProfileUpdate): Promise<Profile> {
  return session.request<Profile>('/me/profile', { method: 'PATCH', body });
}

export function updateSettings(body: SettingsUpdate): Promise<Settings> {
  return session.request<Settings>('/me/settings', { method: 'PATCH', body });
}
