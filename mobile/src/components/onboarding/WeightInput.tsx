import { useState } from 'react';
import { Text, View } from 'react-native';

import type { WeightUnit } from '@/api/types';
import { TextField } from '@/components/ui/TextField';
import { displayWeight, parseDecimal, weightToKg } from '@/lib/units';
import { weightProblem } from '@/onboarding/steps';
import { useTheme } from '@/theme/useTheme';

interface WeightInputProps {
  unit: WeightUnit;
  valueKg: number | null;
  /** Called with a valid weight in kg, or null while the input is empty or out of range. */
  onChange: (kg: number | null) => void;
}

export function WeightInput({ unit, valueKg, onChange }: WeightInputProps) {
  const { colors, spacing, typography } = useTheme();
  const [text, setText] = useState(valueKg === null ? '' : String(displayWeight(valueKg, unit)));
  const [problem, setProblem] = useState<string | null>(null);

  function change(next: string) {
    setText(next);
    const value = parseDecimal(next);
    if (value === null) {
      setProblem(null);
      onChange(null);
      return;
    }
    const kg = weightToKg(value, unit);
    const issue = weightProblem(kg, unit);
    setProblem(issue);
    onChange(issue ? null : kg);
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <TextField
        label="Current weight"
        value={text}
        onChangeText={change}
        keyboardType="decimal-pad"
        suffix={unit}
        placeholder={unit === 'kg' ? '75' : '165'}
        testID="weight"
      />
      {problem ? (
        <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>
          {problem}
        </Text>
      ) : null}
    </View>
  );
}
