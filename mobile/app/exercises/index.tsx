import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { TextField } from '@/components/ui/TextField';
import { useLibrary, useLibrarySync } from '@/exercises/library';
import { searchExercises } from '@/exercises/search';
import { useTheme } from '@/theme/useTheme';

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function ExerciseLibraryScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const library = useLibrary();
  const sync = useLibrarySync();
  const [query, setQuery] = useState('');
  const [muscleFilter, setMuscleFilter] = useState<string[]>([]);
  const [equipmentFilter, setEquipmentFilter] = useState<string[]>([]);

  const data = library.data;
  const muscleNames = useMemo(
    () => new Map((data?.muscles ?? []).map((m) => [m.slug, m.name])),
    [data?.muscles],
  );
  const equipmentNames = useMemo(
    () => new Map((data?.equipment ?? []).map((e) => [e.slug, e.name])),
    [data?.equipment],
  );
  const results = useMemo(
    () =>
      searchExercises(data?.exercises ?? [], {
        query,
        muscles: muscleFilter,
        equipment: equipmentFilter,
      }),
    [data?.exercises, query, muscleFilter, equipmentFilter],
  );

  const empty = (data?.exercises.length ?? 0) === 0;
  const filtered = query !== '' || muscleFilter.length > 0 || equipmentFilter.length > 0;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create exercise"
              onPress={() => router.push('/exercise/form')}
              hitSlop={12}
            >
              <Text style={[typography.body, styles.bold, { color: colors.primary }]}>New</Text>
            </Pressable>
          ),
        }}
      />
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm }}>
        <TextField
          label="Search exercises"
          placeholder="Bench, db curl, rdl…"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={[styles.row, { gap: spacing.xs }]}>
            {(data?.muscles ?? []).map((m) => (
              <Chip
                key={m.slug}
                label={m.name}
                accessibilityLabel={`Muscle: ${m.name}`}
                selected={muscleFilter.includes(m.slug)}
                onPress={() => setMuscleFilter((list) => toggle(list, m.slug))}
              />
            ))}
          </View>
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={[styles.row, { gap: spacing.xs }]}>
            {(data?.equipment ?? []).map((e) => (
              <Chip
                key={e.slug}
                label={e.name}
                accessibilityLabel={`Equipment: ${e.name}`}
                selected={equipmentFilter.includes(e.slug)}
                onPress={() => setEquipmentFilter((list) => toggle(list, e.slug))}
              />
            ))}
          </View>
        </ScrollView>
      </View>

      {empty && library.isSuccess ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Text style={[typography.body, { color: colors.textMuted }]}>
            {sync.status === 'failed'
              ? 'Connect to the internet once to download the exercise library.'
              : 'Downloading the exercise library…'}
          </Text>
          {sync.status === 'failed' ? (
            <Button label="Try again" variant="secondary" onPress={sync.retry} />
          ) : null}
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
          ListEmptyComponent={
            filtered ? (
              <Text style={[typography.body, { color: colors.textMuted, padding: spacing.lg }]}>
                No exercises match. Try fewer filters, or create your own with “New”.
              </Text>
            ) : undefined
          }
          ItemSeparatorComponent={() => (
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
          )}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.name}
              onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: item.id } })}
              style={({ pressed }) => [
                styles.item,
                { paddingVertical: spacing.md, opacity: pressed ? 0.6 : 1, gap: spacing.sm },
              ]}
            >
              <View style={styles.flex}>
                <Text style={[typography.body, { color: colors.text }]}>{item.name}</Text>
                <Text style={[typography.caption, { color: colors.textMuted }]}>
                  {muscleNames.get(item.primary_muscle) ?? item.primary_muscle} ·{' '}
                  {equipmentNames.get(item.equipment) ?? item.equipment}
                </Text>
              </View>
              {item.is_custom ? (
                <Text
                  style={[
                    typography.caption,
                    styles.badge,
                    {
                      color: colors.primary,
                      borderColor: colors.primary,
                      borderRadius: radius.sm,
                      paddingHorizontal: spacing.xs,
                    },
                  ]}
                >
                  Custom
                </Text>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  bold: { fontWeight: '600' },
  item: { flexDirection: 'row', alignItems: 'center' },
  badge: { borderWidth: 1, fontWeight: '600', overflow: 'hidden' },
});
