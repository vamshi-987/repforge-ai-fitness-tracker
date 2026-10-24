import { Redirect } from 'expo-router';

export default function Index() {
  // Phase 1 adds the auth gate here (signed out → /login, onboarding incomplete → /onboarding).
  return <Redirect href="/home" />;
}
