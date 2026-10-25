import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TextField } from '@/components/ui/TextField';
import { parseBirthDate } from '@/onboarding/steps';
import { useTheme } from '@/theme/useTheme';

interface BirthDateInputProps {
  /** YYYY-MM-DD or null */
  value: string | null;
  onChange: (value: string | null) => void;
  today?: Date;
}

function splitIso(value: string | null): [string, string, string] {
  if (!value) return ['', '', ''];
  const [year = '', month = '', day = ''] = value.split('-');
  return [String(Number(day)), String(Number(month)), year];
}

/** Day / month / year number fields: no native date picker, so it works the same everywhere. */
export function BirthDateInput({ value, onChange, today = new Date() }: BirthDateInputProps) {
  const { colors, spacing, typography } = useTheme();
  const [initialDay, initialMonth, initialYear] = splitIso(value);
  const [day, setDay] = useState(initialDay);
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);
  const [problem, setProblem] = useState<string | null>(null);

  function update(nextDay: string, nextMonth: string, nextYear: string) {
    setDay(nextDay);
    setMonth(nextMonth);
    setYear(nextYear);
    if (!nextDay || !nextMonth || nextYear.length < 4) {
      setProblem(null);
      onChange(null);
      return;
    }
    const result = parseBirthDate(Number(nextDay), Number(nextMonth), Number(nextYear), today);
    if ('problem' in result) {
      setProblem(result.problem);
      onChange(null);
    } else {
      setProblem(null);
      onChange(result.value);
    }
  }

  const digits = (text: string) => text.replace(/\D/g, '');

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <View style={styles.small}>
          <TextField
            label="Day"
            value={day}
            onChangeText={(t) => update(digits(t).slice(0, 2), month, year)}
            keyboardType="number-pad"
            placeholder="DD"
            testID="birth-day"
          />
        </View>
        <View style={styles.small}>
          <TextField
            label="Month"
            value={month}
            onChangeText={(t) => update(day, digits(t).slice(0, 2), year)}
            keyboardType="number-pad"
            placeholder="MM"
            testID="birth-month"
          />
        </View>
        <View style={styles.large}>
          <TextField
            label="Year"
            value={year}
            onChangeText={(t) => update(day, month, digits(t).slice(0, 4))}
            keyboardType="number-pad"
            placeholder="YYYY"
            testID="birth-year"
          />
        </View>
      </View>
      {problem ? (
        <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  small: { flex: 1 },
  large: { flex: 1.5 },
});
