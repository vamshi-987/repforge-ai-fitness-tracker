import type { Me } from '@/api/types';
import type { AuthStatus, MeStatus } from '@/stores/auth';

export type Destination = 'splash' | 'login' | 'onboarding' | 'app' | 'profileUnavailable';

/** Where the app should be, given the auth state. The one routing decision for the gate. */
export function destination(status: AuthStatus, me: Me | null, meStatus: MeStatus): Destination {
  if (status === 'loading') return 'splash';
  if (status === 'signedOut') return 'login';
  // Signed in but never loaded a profile on this device (first launch after sign-in).
  if (me === null) return meStatus === 'error' ? 'profileUnavailable' : 'splash';
  return me.onboarding_complete ? 'app' : 'onboarding';
}
