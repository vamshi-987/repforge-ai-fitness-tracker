import * as Sharing from 'expo-sharing';
import { useRef, useState, type ComponentRef } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { Button } from '@/components/ui/Button';
import type { WeightUnit } from '@/api/types';
import { formatWeight } from '@/lib/units';
import { useTheme } from '@/theme/useTheme';
import type { SavedWorkout } from '@/workout/history';
import { formatDurationWords } from '@/workout/time';

const SHOWN_EXERCISES = 6;

function Stat({ label, value }: { label: string; value: string }) {
  const { colors, typography } = useTheme();

  return (
    <View style={styles.stat}>
      <Text style={[typography.heading, { color: '#FFFFFF' }]}>{value}</Text>
      <Text style={[typography.caption, { color: colors.primaryMuted }]}>{label}</Text>
    </View>
  );
}

/** Opens a preview of the workout as an image, and shares that image. */
export function ShareWorkout({ workout, unit }: { workout: SavedWorkout; unit: WeightUnit }) {
  const { colors, radius, spacing, typography } = useTheme();
  const card = useRef<ComponentRef<typeof View>>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = new Date(workout.startedAt).toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  async function share() {
    setBusy(true);
    setError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('unavailable');
      const uri = await captureRef(card, { format: 'png', quality: 1 });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: workout.title });
      setOpen(false);
    } catch {
      setError('This workout couldn’t be shared from this device.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button label="Share workout" variant="secondary" onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={[styles.backdrop, { padding: spacing.lg, gap: spacing.md }]}>
          <View
            ref={card}
            collapsable={false}
            style={{
              backgroundColor: '#18181B',
              borderRadius: radius.lg,
              padding: spacing.lg,
              gap: spacing.md,
            }}
          >
            <Text style={[typography.caption, { color: colors.primaryMuted }]}>RepForge</Text>
            <View style={{ gap: spacing.xs }}>
              <Text style={[typography.title, { color: '#FFFFFF' }]}>{workout.title}</Text>
              <Text style={[typography.caption, { color: colors.primaryMuted }]}>{when}</Text>
            </View>
            <View style={[styles.row, { gap: spacing.md }]}>
              <Stat label="Time" value={formatDurationWords(workout.endedAt - workout.startedAt)} />
              <Stat label="Volume" value={formatWeight(workout.volumeKg, unit)} />
              <Stat label="Sets" value={String(workout.setCount)} />
            </View>
            <View style={{ gap: spacing.xs }}>
              {workout.exercises.slice(0, SHOWN_EXERCISES).map((exercise) => (
                <Text key={exercise.id} style={[typography.body, { color: '#FFFFFF' }]}>
                  {exercise.name}
                </Text>
              ))}
            </View>
          </View>
          {error ? (
            <Text accessibilityLiveRegion="polite" style={[typography.body, { color: '#FFFFFF' }]}>
              {error}
            </Text>
          ) : null}
          <Button label="Share image" loading={busy} onPress={() => void share()} />
          <Button label="Close" variant="secondary" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.7)' },
  row: { flexDirection: 'row' },
  stat: { flex: 1 },
});
