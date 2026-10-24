const DEFAULT_API_URL = 'http://localhost:8010';

/** Base URL including the `/v1` prefix, without a trailing slash. */
export function apiBaseUrl(envValue: string | undefined = process.env.EXPO_PUBLIC_API_URL): string {
  const origin = (envValue?.trim() || DEFAULT_API_URL).replace(/\/+$/, '');
  return `${origin}/v1`;
}
