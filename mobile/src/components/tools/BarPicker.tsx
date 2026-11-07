import { View } from 'react-native';

import type { WeightUnit } from '@/api/types';
import { Chip } from '@/components/ui/Chip';
import { BARS } from '@/lib/plates';
import { useTheme } from '@/theme/useTheme';

/** The bar the plates go on, in the user's unit. */
export function BarPicker({
  unit,
  bar,
  onChange,
}: {
  unit: WeightUnit;
  bar: number;
  onChange: (bar: number) => void;
}) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {BARS[unit].map((weight) => (
        <Chip
          key={weight}
          label={`${weight} ${unit} bar`}
          selected={bar === weight}
          onPress={() => onChange(weight)}
        />
      ))}
    </View>
  );
}
