import { StyleSheet, View } from 'react-native';

import { TextField } from '@/components/ui/TextField';
import type { Amounts } from '@/lib/macros';
import { withMacro, type EntryForm, type MacroText } from '@/nutrition/entry';
import { formatAmount } from '@/nutrition/rules';
import { useTheme } from '@/theme/useTheme';

const MACRO_FIELDS: { field: keyof MacroText; label: string }[] = [
  { field: 'protein', label: 'Protein' },
  { field: 'carbs', label: 'Carbs' },
  { field: 'fat', label: 'Fat' },
  { field: 'fiber', label: 'Fiber' },
];

interface AmountFieldsProps {
  form: EntryForm;
  amounts: Amounts;
  onChange: (form: EntryForm) => void;
  /** Tells rows apart on a screen with several, e.g. "Dal". */
  labelPrefix?: string;
}

/** Calories and macros, showing the computed values until the user types over them. */
export function AmountFields({ form, amounts, onChange, labelPrefix }: AmountFieldsProps) {
  const { spacing } = useTheme();
  const label = (text: string) => (labelPrefix ? `${labelPrefix} ${text.toLowerCase()}` : text);

  const macroValue = (field: keyof MacroText): string => {
    if (form.macros) return form.macros[field];
    const amount = {
      protein: amounts.protein_g,
      carbs: amounts.carbs_g,
      fat: amounts.fat_g,
      fiber: amounts.fiber_g,
    }[field];
    return amount === null ? '' : formatAmount(amount);
  };

  return (
    <>
      <TextField
        label={label(amounts.kcal_overridden ? 'Calories (manual)' : 'Calories')}
        value={form.kcal ?? formatAmount(amounts.kcal)}
        onChangeText={(kcal) => onChange({ ...form, kcal })}
        keyboardType="decimal-pad"
        maxLength={8}
        suffix="kcal"
      />
      <View style={[styles.grid, { gap: spacing.sm }]}>
        {MACRO_FIELDS.map(({ field, label: text }) => (
          <View key={field} style={styles.cell}>
            <TextField
              label={label(text)}
              value={macroValue(field)}
              onChangeText={(value) => onChange(withMacro(form, amounts, field, value))}
              keyboardType="decimal-pad"
              maxLength={7}
              suffix="g"
            />
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { flexBasis: '47%', flexGrow: 1 },
});
