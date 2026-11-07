import { ApiError } from '@/api/client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Client-side checks mirroring the API, so most mistakes never cost a round trip. */
export function credentialsProblem(
  email: string,
  password: string,
  mode: 'login' | 'register',
): string | null {
  if (!EMAIL_RE.test(email.trim())) return 'Enter a valid email address.';
  if (mode === 'login') return password ? null : 'Enter your password.';
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

function retryAfterSeconds(details: unknown): number | null {
  if (typeof details !== 'object' || details === null) return null;
  const value = (details as { retry_after_s?: unknown }).retry_after_s;
  return typeof value === 'number' ? value : null;
}

/** A user-facing sentence for an auth/API failure, keyed on the stable error `code`. */
export function authErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  switch (error.code) {
    case 'invalid_credentials':
      return 'Email or password is incorrect.';
    case 'email_taken':
      return 'An account with this email already exists. Log in instead.';
    case 'username_taken':
      return 'That username is taken.';
    case 'rate_limited': {
      const seconds = retryAfterSeconds(error.details);
      const minutes = seconds === null ? null : Math.max(1, Math.ceil(seconds / 60));
      return minutes === null
        ? 'Too many attempts. Try again later.'
        : `Too many attempts. Try again in ${minutes} min.`;
    }
    case 'network_error':
      return "Can't reach RepForge. Check your connection and try again.";
    case 'validation_error':
      return 'Some details look wrong. Check them and try again.';
    default:
      return error.status >= 500 ? 'RepForge is having trouble. Try again soon.' : error.message;
  }
}
