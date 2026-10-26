import { router } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';

export default function WorkoutScreen() {
  return (
    <Screen title="Workout" subtitle="Start an empty workout or pick a routine.">
      <Button
        label="Exercise library"
        variant="secondary"
        onPress={() => router.push('/exercises')}
      />
    </Screen>
  );
}
