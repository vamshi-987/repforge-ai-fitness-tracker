import { Modal, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/useTheme';

export interface SheetOption {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  selected?: boolean;
}

interface OptionSheetProps {
  visible: boolean;
  title: string;
  options: SheetOption[];
  onClose: () => void;
}

/** A bottom sheet of choices. Picking one closes the sheet, then runs it. */
export function OptionSheet({ visible, title, options, onClose }: OptionSheetProps) {
  const { colors, radius, spacing, typography } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close"
        style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.4)' }]}
        onPress={onClose}
      />
      <SafeAreaView
        edges={['bottom']}
        style={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          padding: spacing.lg,
          gap: spacing.xs,
        }}
      >
        <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>
          {title}
        </Text>
        {options.map((option) => (
          <Pressable
            key={option.label}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: option.selected ?? false }}
            onPress={() => {
              onClose();
              option.onPress();
            }}
            style={({ pressed }) => [
              styles.option,
              { paddingVertical: spacing.md, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text
              style={[
                typography.body,
                {
                  color: option.destructive ? colors.danger : colors.text,
                  fontWeight: option.selected ? '700' : '400',
                },
              ]}
            >
              {option.label}
            </Text>
            {option.selected ? (
              <Text style={[typography.body, { color: colors.primary }]}>✓</Text>
            ) : null}
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onClose}
          style={[styles.option, { paddingVertical: spacing.md }]}
        >
          <Text style={[typography.body, styles.bold, { color: colors.textMuted }]}>Cancel</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bold: { fontWeight: '600' },
});
