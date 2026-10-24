import { ApiStatus } from '@/components/ApiStatus';
import { Screen } from '@/components/Screen';

export default function HomeScreen() {
  return (
    <Screen title="Home" subtitle="Today's rings and your feed will live here.">
      <ApiStatus />
    </Screen>
  );
}
