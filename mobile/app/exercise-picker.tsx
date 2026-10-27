import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Exercise } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { TextField } from '@/components/ui/TextField';
import { useLibrary } from '@/exercises/library';
import { exercisePicker } from '@/exercises/picker';
import { searchExercises } from '@/exercises/search';
import { useTheme } from '@/theme/useTheme';

/** Pick one or more exercises, in tap order, and hand them back to the opener. */
export default function ExercisePickerScreen() {
  const { colors, spacing, typography } = useTheme();
  const library = useLibrary();
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);
  const [picked, setPicked] = useState<Exercise[]>([]);

  const data = library.data;
  const results = useMemo(
    () =>
      searchExercises(data?.exercises ?? [], {
        query,
        muscles: muscle ? [muscle] : [],
        equipment: [],
      }),
    [data?.exercises, query, muscle],
  );
  const order = new Map(picked.map((e, i) => [e.id, i + 1]));

  const toggle = (exercise: Exercise) =>
    setPicked((list) =>
      list.some((e) => e.id === exercise.id)
        ? list.filter((e) => e.id !== exercise.id)
        : [...list, exercise],
    );

  const add = () => {
    exercisePicker.deliver(picked);
    router.back();
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Add exercises' }} />
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm }}>
        <TextField
          label="Search exercises"
          placeholder="Bench, db curl, rdl…"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={[styles.row, { gap: spacing.xs }]}>
            {(data?.muscles ?? []).map((m) => (
              <Chip
                key={m.slug}
                label={m.name}
                accessibilityLabel={`Muscle: ${m.name}`}
                selected={muscle === m.slug}
                onPress={() => setMuscle((current) => (current === m.slug ? null : m.slug))}
              />
            ))}
          </View>
        </ScrollView>
      </View>
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: spacing.lg }}
        ListEmptyComponent={
          <Text style={[typography.body, { color: colors.textMuted, padding: spacing.lg }]}>
            {data?.exercises.length
              ? 'No exercises match.'
              : 'Connect to the internet once to download the exercise library.'}
          </Text>
        }
        ItemSeparatorComponent={() => (
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
        )}
        renderItem={({ item }) => {
          const position = order.get(item.id);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: position !== undefined }}
              accessibilityLabel={item.name}
              onPress={() => toggle(item)}
              style={[styles.item, { paddingVertical: spacing.md, gap: spacing.md }]}
            >
              <View
                style={[
                  styles.check,
                  {
                    borderColor: position ? colors.primary : colors.border,
                    backgroundColor: position ? colors.primary : 'transparent',
                  },
                ]}
              >
                {position ? <Text style={styles.checkText}>{position}</Text> : null}
              </View>
              <Text style={[typography.body, styles.flex, { color: colors.text }]}>
                {item.name}
              </Text>
            </Pressable>
          );
        }}
      />
      <View style={{ padding: spacing.lg }}>
        <Button
          label={
            picked.length
              ? `Add ${picked.length} exercise${picked.length === 1 ? '' : 's'}`
              : 'Add exercises'
          }
          disabled={picked.length === 0}
          onPress={add}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  item: { flexDirection: 'row', alignItems: 'center' },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
});
