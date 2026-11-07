import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { LengthUnit } from '@/api/types';
import { TextField } from '@/components/ui/TextField';
import { cmToFeetInches, feetInchesToCm, parseDecimal, roundTo } from '@/lib/units';
import { heightProblem } from '@/onboarding/steps';
import { useTheme } from '@/theme/useTheme';

interface HeightInputProps {
  unit: LengthUnit;
  valueCm: number | null;
  /** Called with a valid height in cm, or null while the input is empty or out of range. */
  onChange: (cm: number | null) => void;
}

export function HeightInput({ unit, valueCm, onChange }: HeightInputProps) {
  const { colors, spacing, typography } = useTheme();
  const initial = valueCm === null ? null : cmToFeetInches(valueCm);
  const [cmText, setCmText] = useState(valueCm === null ? '' : String(roundTo(valueCm, 1)));
  const [feetText, setFeetText] = useState(initial ? String(initial.feet) : '');
  const [inchesText, setInchesText] = useState(initial ? String(initial.inches) : '');
  const [problem, setProblem] = useState<string | null>(null);

  function report(cm: number | null) {
    if (cm === null) {
      setProblem(null);
      onChange(null);
      return;
    }
    const issue = heightProblem(cm, unit);
    setProblem(issue);
    onChange(issue ? null : cm);
  }

  function changeCm(text: string) {
    setCmText(text);
    const value = parseDecimal(text);
    report(value === null ? null : roundTo(value, 1));
  }

  function changeFeetInches(nextFeet: string, nextInches: string) {
    setFeetText(nextFeet);
    setInchesText(nextInches);
    const feet = parseDecimal(nextFeet);
    const inches = nextInches.trim() === '' ? 0 : parseDecimal(nextInches);
    if (feet === null || inches === null || !Number.isInteger(feet) || inches >= 12) {
      report(null);
      return;
    }
    report(feetInchesToCm({ feet, inches }));
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {unit === 'cm' ? (
        <TextField
          label="Height"
          value={cmText}
          onChangeText={changeCm}
          keyboardType="decimal-pad"
          suffix="cm"
          placeholder="175"
          testID="height-cm"
        />
      ) : (
        <View style={[styles.row, { gap: spacing.sm }]}>
          <View style={styles.flex}>
            <TextField
              label="Feet"
              value={feetText}
              onChangeText={(t) => changeFeetInches(t, inchesText)}
              keyboardType="number-pad"
              suffix="ft"
              placeholder="5"
              testID="height-feet"
            />
          </View>
          <View style={styles.flex}>
            <TextField
              label="Inches"
              value={inchesText}
              onChangeText={(t) => changeFeetInches(feetText, t)}
              keyboardType="decimal-pad"
              suffix="in"
              placeholder="9"
              testID="height-inches"
            />
          </View>
        </View>
      )}
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
  flex: { flex: 1 },
});
