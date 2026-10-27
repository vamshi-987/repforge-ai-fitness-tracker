import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Routine, RoutineFolder } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { OptionSheet, type SheetOption } from '@/components/ui/OptionSheet';
import { PromptDialog } from '@/components/ui/PromptDialog';
import {
  createFolder,
  deleteFolder,
  renameFolder,
  reorderFolders,
  reorderRoutines,
  routineError,
} from '@/routines/actions';
import { ROUTINES_QUERY_KEY, useRoutines, useRoutineSync } from '@/routines/store';
import { groupRoutines, moveId, routinePreview } from '@/routines/view';
import { useTheme } from '@/theme/useTheme';
import { startEmptyWorkout, startRoutineWorkout } from '@/workout/start';

type Prompt = { kind: 'new' } | { kind: 'rename'; folder: RoutineFolder };

export default function WorkoutScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const routines = useRoutines();
  const sync = useRoutineSync();
  const [reordering, setReordering] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [menuFolder, setMenuFolder] = useState<RoutineFolder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = routines.data;
  const sections = groupRoutines(data?.routines ?? [], data?.folders ?? []);
  const folderIds = sections.flatMap((s) => (s.folder ? [s.folder.id] : []));
  const count = data?.routines.length ?? 0;
  const atLimit = data?.limit !== null && data?.limit !== undefined && count >= data.limit;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(routineError(err));
    } finally {
      await queryClient.invalidateQueries({ queryKey: ROUTINES_QUERY_KEY });
    }
  }

  const moveRoutine = (folderId: string | null, list: Routine[], id: string, delta: -1 | 1) => {
    const ids = moveId(
      list.map((r) => r.id),
      id,
      delta,
    );
    if (ids) void run(() => reorderRoutines(folderId, ids));
  };

  const moveFolder = (id: string, delta: -1 | 1) => {
    const ids = moveId(folderIds, id, delta);
    if (ids) void run(() => reorderFolders(ids));
  };

  const folderOptions = (folder: RoutineFolder): SheetOption[] => [
    { label: 'Rename folder', onPress: () => setPrompt({ kind: 'rename', folder }) },
    { label: 'Move folder up', onPress: () => moveFolder(folder.id, -1) },
    { label: 'Move folder down', onPress: () => moveFolder(folder.id, 1) },
    {
      label: 'Delete folder',
      destructive: true,
      onPress: () => void run(() => deleteFolder(folder.id)),
    },
  ];

  const submitPrompt = async (name: string) => {
    if (!prompt) return;
    try {
      if (prompt.kind === 'new') await createFolder(name);
      else await renameFolder(prompt.folder.id, name);
    } catch (err) {
      throw new Error(routineError(err));
    }
    await queryClient.invalidateQueries({ queryKey: ROUTINES_QUERY_KEY });
  };

  const arrow = (label: string, glyph: string, onPress: () => void, enabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      hitSlop={8}
      style={{ opacity: enabled ? 1 : 0.3, paddingHorizontal: spacing.sm }}
    >
      <Text style={[typography.heading, { color: colors.text }]}>{glyph}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.flex, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        refreshControl={
          <RefreshControl
            refreshing={sync.status === 'syncing' && routines.isSuccess}
            onRefresh={() => void sync.refresh()}
          />
        }
      >
        <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>
          Workout
        </Text>
        <Button label="Start empty workout" onPress={startEmptyWorkout} />

        <View style={[styles.row, styles.between]}>
          <Text style={[typography.heading, { color: colors.text }]}>Routines</Text>
          {count > 1 || folderIds.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={reordering ? 'Done reordering' : 'Reorder routines'}
              onPress={() => setReordering((on) => !on)}
              hitSlop={8}
            >
              <Text style={[typography.body, styles.bold, { color: colors.primary }]}>
                {reordering ? 'Done' : 'Reorder'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.row, { gap: spacing.sm }]}>
          <View style={styles.flex}>
            <Button
              label="New routine"
              variant="secondary"
              disabled={atLimit}
              onPress={() => router.push('/routine/edit')}
            />
          </View>
          <View style={styles.flex}>
            <Button
              label="New folder"
              variant="secondary"
              onPress={() => setPrompt({ kind: 'new' })}
            />
          </View>
        </View>

        {data?.limit !== null && data?.limit !== undefined ? (
          <Text
            style={[typography.caption, { color: atLimit ? colors.warning : colors.textMuted }]}
          >
            {count} of {data.limit} routines on the free plan
            {atLimit ? '. Delete one or upgrade to Pro to add more.' : ''}
          </Text>
        ) : null}
        {error ? <Text style={[typography.body, { color: colors.danger }]}>{error}</Text> : null}

        {routines.isSuccess && count === 0 && folderIds.length === 0 ? (
          <Text style={[typography.body, { color: colors.textMuted }]}>
            {sync.status === 'failed'
              ? 'Connect to the internet to load your routines.'
              : 'Save a routine to start the same workout again in one tap.'}
          </Text>
        ) : null}

        {sections.map((section) => (
          <View key={section.folder?.id ?? 'loose'} style={{ gap: spacing.sm }}>
            {section.folder ? (
              <View style={[styles.row, styles.between, { marginTop: spacing.sm }]}>
                <Text
                  accessibilityRole="header"
                  style={[typography.body, styles.bold, { color: colors.textMuted }]}
                >
                  {section.folder.name}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Folder options: ${section.folder.name}`}
                  onPress={() => setMenuFolder(section.folder)}
                  hitSlop={12}
                >
                  <Text style={[typography.heading, { color: colors.textMuted }]}>⋯</Text>
                </Pressable>
              </View>
            ) : null}
            {section.folder && section.routines.length === 0 ? (
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                Empty. Move a routine here from its screen.
              </Text>
            ) : null}
            {section.routines.map((routine, index) => (
              <View
                key={routine.id}
                style={[
                  styles.row,
                  {
                    backgroundColor: colors.surface,
                    borderRadius: radius.lg,
                    borderColor: colors.border,
                    borderWidth: StyleSheet.hairlineWidth,
                    padding: spacing.lg,
                    gap: spacing.sm,
                  },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={routine.name}
                  onPress={() =>
                    router.push({ pathname: '/routine/[id]', params: { id: routine.id } })
                  }
                  style={styles.flex}
                >
                  <Text style={[typography.body, styles.bold, { color: colors.text }]}>
                    {routine.name}
                  </Text>
                  <Text numberOfLines={2} style={[typography.caption, { color: colors.textMuted }]}>
                    {routinePreview(routine)}
                  </Text>
                </Pressable>
                {reordering ? null : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Start ${routine.name}`}
                    onPress={() => startRoutineWorkout(routine)}
                    hitSlop={8}
                    style={{
                      backgroundColor: colors.primary,
                      borderRadius: radius.md,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                    }}
                  >
                    <Text style={[typography.caption, styles.bold, { color: '#FFFFFF' }]}>
                      Start
                    </Text>
                  </Pressable>
                )}
                {reordering ? (
                  <View style={styles.row}>
                    {arrow(
                      `Move ${routine.name} up`,
                      '▲',
                      () =>
                        moveRoutine(section.folder?.id ?? null, section.routines, routine.id, -1),
                      index > 0,
                    )}
                    {arrow(
                      `Move ${routine.name} down`,
                      '▼',
                      () =>
                        moveRoutine(section.folder?.id ?? null, section.routines, routine.id, 1),
                      index < section.routines.length - 1,
                    )}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ))}

        <Button
          label="Exercise library"
          variant="ghost"
          onPress={() => router.push('/exercises')}
        />
      </ScrollView>

      <OptionSheet
        visible={menuFolder !== null}
        title={menuFolder?.name ?? ''}
        options={menuFolder ? folderOptions(menuFolder) : []}
        onClose={() => setMenuFolder(null)}
      />
      <PromptDialog
        visible={prompt !== null}
        title={prompt?.kind === 'rename' ? 'Rename folder' : 'New folder'}
        label="Folder name"
        initialValue={prompt?.kind === 'rename' ? prompt.folder.name : ''}
        confirmLabel={prompt?.kind === 'rename' ? 'Save' : 'Create'}
        maxLength={60}
        onSubmit={submitPrompt}
        onClose={() => setPrompt(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { justifyContent: 'space-between' },
  bold: { fontWeight: '600' },
});
