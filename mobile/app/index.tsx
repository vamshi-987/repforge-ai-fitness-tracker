import { Redirect } from 'expo-router';

import { destination } from '@/auth/destination';
import { ProfileUnavailable } from '@/components/ProfileUnavailable';
import { Splash } from '@/components/Splash';
import { useAuth } from '@/stores/auth';

/** The anchor route: every guard that flips sends the user here, and this picks the next stop. */
export default function Index() {
  const status = useAuth((state) => state.status);
  const me = useAuth((state) => state.me);
  const meStatus = useAuth((state) => state.meStatus);

  switch (destination(status, me, meStatus)) {
    case 'splash':
      return <Splash />;
    case 'login':
      return <Redirect href="/login" />;
    case 'profileUnavailable':
      return <ProfileUnavailable />;
    case 'onboarding':
    case 'app':
      return <Redirect href="/home" />;
  }
}
