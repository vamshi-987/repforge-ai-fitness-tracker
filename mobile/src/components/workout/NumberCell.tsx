import { useState } from 'react';
import { StyleSheet, TextInput, type KeyboardTypeOptions } from 'react-native';

import { useTheme } from '@/theme/useTheme';

interface NumberCellProps {
  /** Screen-reader label, e.g. "Bench Press set 2 weight". */
  label: string;
  value: number | null;
  /** Stored value → text in the user's units. */
  format: (value: number) => string;
  /** Typed text → stored value; null when it isn't a valid entry (yet). */
  parse: (text: string) => number | null;
  onCommit: (value: number | null) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
}

/**
 * A numeric input that keeps what the user typed. Text is turned into the stored value on
 * every valid keystroke, but never re-formatted while typing, so "62." or "135" lb don't jump
 * around. It shows the stored value again on blur, or when the value changes from outside
 * (e.g. filled from last session).
 */
export function NumberCell({
  label,
  value,
  format,
  parse,
  onCommit,
  placeholder,
  keyboardType = 'decimal-pad',
}: NumberCellProps) {
  const { colors, radius, typography } = useTheme();
  const show = (v: number | null) => (v === null ? '' : format(v));
  const [text, setText] = useState(() => show(value));
  const [seen, setSeen] = useState(value);

  // The value changed from outside: show it (React's "adjust state on prop change" pattern).
  if (value !== seen) {
    setSeen(value);
    setText(show(value));
  }

  const onChangeText = (next: string) => {
    setText(next);
    if (next.trim() === '') {
      setSeen(null);
      onCommit(null);
      return;
    }
    const parsed = parse(next);
    if (parsed !== null) {
      setSeen(parsed);
      onCommit(parsed);
    }
  };

  return (
    <TextInput
      accessibilityLabel={label}
      value={text}
      onChangeText={onChangeText}
      onBlur={() => setText(show(seen))}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      keyboardType={keyboardType}
      selectTextOnFocus
      style={[
        typography.body,
        styles.cell,
        { color: colors.text, backgroundColor: colors.background, borderRadius: radius.sm },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  cell: { paddingVertical: 8, paddingHorizontal: 6, textAlign: 'center', minWidth: 48 },
});
