import type { Me, TokenPair } from '@/api/types';

/** The in-memory SecureStore / kv-store maps installed by jest.setup.ts. */
export function mockStores(): { secure: Map<string, string>; kv: Map<string, string> } {
  return (
    globalThis as unknown as {
      __mockStores: { secure: Map<string, string>; kv: Map<string, string> };
    }
  ).__mockStores;
}

export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body === null ? '' : JSON.stringify(body)),
  } as Response;
}

export function errorResponse(status: number, code: string, details: unknown = null): Response {
  return jsonResponse(status, { error: { code, message: code, details } });
}

export function tokenPair(suffix: string, expiresIn = 900): TokenPair {
  return {
    access_token: `access-${suffix}`,
    refresh_token: `refresh-${suffix}`,
    token_type: 'bearer',
    expires_in: expiresIn,
    refresh_expires_in: 2_592_000,
  };
}

export function makeMe(overrides: Partial<Me> = {}): Me {
  return {
    id: 'u1',
    email: 'lifter@example.com',
    username: 'lifter',
    display_name: 'Lifter',
    avatar_url: null,
    is_private: false,
    is_pro: false,
    auth_provider: 'password',
    created_at: '2026-10-25T10:00:00Z',
    onboarding_complete: false,
    profile: {
      sex: null,
      birth_date: null,
      height_cm: null,
      weight_kg: null,
      activity_level: null,
      goal: null,
      experience: null,
      unit_weight: 'kg',
      unit_length: 'cm',
      water_goal_ml: null,
      timezone: 'UTC',
      onboarding_completed_at: null,
    },
    settings: {
      theme: 'system',
      default_rest_s: 90,
      keep_awake: true,
      show_burned_kcal: false,
      water_cup_sizes: [250, 500, 750],
      water_reminder_every_h: 2,
      wake_time: '07:00:00',
      sleep_time: '22:00:00',
      reminders_enabled: false,
    },
    ...overrides,
  };
}

/** Typed access to a mocked fetch's calls: [url, init]. */
export function fetchCalls(fetchMock: jest.Mock): { url: string; init: RequestInit }[] {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: url as string,
    init: init as RequestInit,
  }));
}
