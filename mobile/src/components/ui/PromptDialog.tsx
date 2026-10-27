import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useTheme } from '@/theme/useTheme';

import { Button } from './Button';
import { TextField } from './TextField';

interface PromptDialogProps {
  visible: boolean;
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  maxLength?: number;
  /** Resolve to close the dialog; reject with a message to show it and stay open. */
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}

/** A text prompt that works on both platforms (Alert.prompt is iOS-only). */
export function PromptDialog(props: PromptDialogProps) {
  // Remount per opening, so the field starts from `initialValue` every time.
  return props.visible ? <PromptBody {...props} /> : null;
}

function PromptBody({
  title,
  label,
  initialValue = '',
  confirmLabel = 'Save',
  maxLength,
  onSubmit,
  onClose,
}: PromptDialogProps) {
  const { colors, radius, spacing, typography } = useTheme();
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!value.trim()) {
      setError('Enter a name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.center, { backgroundColor: 'rgba(0,0,0,0.4)', padding: spacing.xl }]}
      >
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.lg,
            gap: spacing.md,
            alignSelf: 'stretch',
          }}
        >
          <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>
            {title}
          </Text>
          <TextField
            label={label}
            value={value}
            onChangeText={setValue}
            maxLength={maxLength}
            error={error}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
          />
          <View style={[styles.row, { gap: spacing.sm }]}>
            <View style={styles.flex}>
              <Button label="Cancel" variant="secondary" onPress={onClose} />
            </View>
            <View style={styles.flex}>
              <Button label={confirmLabel} loading={busy} onPress={() => void submit()} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  row: { flexDirection: 'row' },
  flex: { flex: 1 },
});
