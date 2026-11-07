import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { FoodDraft, Meal } from '@/api/types';
import { AmountFields } from '@/components/nutrition/AmountFields';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import {
  confirmDraft,
  draftError,
  draftKcal,
  isUnsure,
  readRow,
  rowsFromDraft,
  useTextDraft,
  type DraftRow,
  type DraftTarget,
} from '@/nutrition/draft';
import { NUTRITION_QUERY_KEY, usePhotoAnalysis } from '@/nutrition/store';
import { useTheme } from '@/theme/useTheme';

function Row({
  row,
  onChange,
  onRemove,
}: {
  row: DraftRow;
  onChange: (row: DraftRow) => void;
  onRemove: () => void;
}) {
  const { colors, radius, spacing, typography } = useTheme();
  const { amounts } = readRow(row);

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      <TextField
        label="Item"
        value={row.name}
        onChangeText={(name) => onChange({ ...row, name })}
        maxLength={200}
      />
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {row.food_id ? 'Numbers from the food database' : 'Estimated'}
        {isUnsure(row) ? ' · Check this one' : ''}
      </Text>
      <TextField
        label={`${row.name} grams`}
        value={row.form.quantity}
        onChangeText={(quantity) => onChange({ ...row, form: { ...row.form, quantity } })}
        keyboardType="decimal-pad"
        maxLength={7}
        suffix="g"
      />
      <AmountFields
        form={row.form}
        amounts={amounts}
        labelPrefix={row.name}
        onChange={(form) => onChange({ ...row, form })}
      />
      <Button label={`Remove ${row.name}`} variant="ghost" onPress={onRemove} />
    </View>
  );
}

function Review({ draft, target }: { draft: FoodDraft; target: DraftTarget }) {
  const { colors, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(() => rowsFromDraft(draft));
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    const problem = draftError(rows);
    setError(problem);
    if (problem) return;
    await confirmDraft(rows, target);
    await queryClient.invalidateQueries({ queryKey: NUTRITION_QUERY_KEY });
    router.dismissTo('/nutrition');
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <Text style={[typography.body, { color: colors.text }]}>
        Check each item. Nothing is logged until you confirm.
      </Text>
      {draft.notes ? (
        <Text style={[typography.caption, { color: colors.textMuted }]}>{draft.notes}</Text>
      ) : null}
      {rows.map((row) => (
        <Row
          key={row.key}
          row={row}
          onChange={(next) => setRows(rows.map((r) => (r.key === next.key ? next : r)))}
          onRemove={() => setRows(rows.filter((r) => r.key !== row.key))}
        />
      ))}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[typography.body, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}
      <Button
        label={`Add ${draftKcal(rows)} kcal`}
        disabled={rows.length === 0}
        onPress={() => void confirm()}
      />
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Estimates only, not medical advice.
      </Text>
    </ScrollView>
  );
}

function Message({ text }: { text: string }) {
  const { colors, spacing, typography } = useTheme();

  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      <Text style={[typography.body, { color: colors.text }]}>{text}</Text>
      <Button label="Add it by hand" variant="secondary" onPress={() => router.back()} />
    </View>
  );
}

interface Params extends Record<string, string> {
  analysis: string;
  date: string;
  meal: Meal;
}

/** Waits for a photo's draft, then lets the user fix it before anything is logged. Without an
 * `analysis`, the draft is the one read from typed text. */
export default function ReviewPhotoScreen() {
  const { colors, spacing, typography } = useTheme();
  const { analysis, date, meal } = useLocalSearchParams<Params>();
  const query = usePhotoAnalysis(analysis);
  const textDraft = useTextDraft((state) => state.draft);

  if (!analysis) {
    if (!textDraft) return <Message text="There’s nothing to review." />;
    return <Review draft={textDraft} target={{ date, meal, source: 'text', analysisId: null }} />;
  }
  if (query.isError) return <Message text="The server can’t be reached right now." />;
  if (!query.data || query.data.status === 'pending') {
    return (
      <View accessibilityLiveRegion="polite" style={[styles.center, { gap: spacing.md }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[typography.body, { color: colors.textMuted }]}>Reading your photo…</Text>
      </View>
    );
  }
  const { draft } = query.data;
  if (query.data.status === 'failed' || !draft) {
    return <Message text="This photo couldn’t be analysed." />;
  }
  if (draft.items.length === 0) return <Message text="No food was found in this photo." />;
  return (
    <Review draft={draft} target={{ date, meal, source: 'photo', analysisId: query.data.id }} />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
