import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import {
  closeAccount,
  exportEverything,
  exportWorkoutsCsv,
  importWorkoutsCsv,
} from '@/api/portability';
import { Button } from '@/components/ui/Button';
import { PromptDialog } from '@/components/ui/PromptDialog';
import { shareTextFile } from '@/settings/dataFile';
import { describeImport } from '@/settings/importReport';
import { useAuth } from '@/stores/auth';
import { wakeSync } from '@/sync/queue';
import { useTheme } from '@/theme/useTheme';

const NEEDS_CONNECTION = 'This needs a connection. Try again when you’re online.';

/** Take your data with you, bring workouts in, or close the account. */
export function DataSettings() {
  const { colors, spacing, typography } = useTheme();
  const signOut = useAuth((state) => state.signOut);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  async function run(name: string, task: () => Promise<void>) {
    setBusy(name);
    setMessage(null);
    try {
      await task();
    } catch (cause) {
      const offline = cause instanceof ApiError && cause.status === 0;
      setMessage(offline ? NEEDS_CONNECTION : 'That didn’t work. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function importFile() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'application/csv'],
      copyToCacheDirectory: true,
    });
    const file = picked.canceled ? undefined : picked.assets[0];
    if (!file) return;
    const report = await importWorkoutsCsv(file.uri, file.name);
    setMessage(describeImport(report));
    // The new workouts reach this phone like any other server change.
    wakeSync();
  }

  async function confirmClose(text: string) {
    if (text.trim() !== 'DELETE') throw new Error('Type DELETE to confirm');
    try {
      await closeAccount();
    } catch (cause) {
      const offline = cause instanceof ApiError && cause.status === 0;
      throw new Error(offline ? NEEDS_CONNECTION : 'That didn’t work. Please try again.');
    }
    setClosing(false);
    await signOut();
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <Button
        label="Export all my data"
        variant="secondary"
        loading={busy === 'all'}
        onPress={() =>
          void run('all', async () => {
            const data = await exportEverything();
            await shareTextFile(
              'repforge-export.json',
              JSON.stringify(data, null, 2),
              'application/json',
            );
          })
        }
      />
      <Button
        label="Export workouts (CSV)"
        variant="secondary"
        loading={busy === 'csv'}
        onPress={() =>
          void run('csv', async () => {
            await shareTextFile('repforge-workouts.csv', await exportWorkoutsCsv(), 'text/csv');
          })
        }
      />
      <Button
        label="Import workouts (CSV)"
        variant="secondary"
        loading={busy === 'import'}
        onPress={() => void run('import', importFile)}
      />
      {message ? (
        <Text accessibilityLiveRegion="polite" style={[typography.body, { color: colors.text }]}>
          {message}
        </Text>
      ) : null}
      <Button label="Delete my account" variant="ghost" onPress={() => setClosing(true)} />
      <PromptDialog
        visible={closing}
        title="Delete your account?"
        label="Your account closes now and everything is erased within 30 days. Type DELETE."
        confirmLabel="Delete account"
        maxLength={10}
        onSubmit={confirmClose}
        onClose={() => setClosing(false)}
      />
    </View>
  );
}
