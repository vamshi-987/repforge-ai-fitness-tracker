import Constants from 'expo-constants';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Settings } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Stepper } from '@/components/ui/Stepper';
import { formatRest, stepValue } from '@/lib/format';
import { saveSettings, saveUnits } from '@/settings/actions';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

const REST = { min: 0, max: 900, step: 15 } as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors, radius, spacing, typography } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text
        accessibilityRole="header"
        style={[typography.caption, styles.sectionTitle, { color: colors.textMuted }]}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.lg,
          padding: spacing.lg,
          gap: spacing.lg,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={[styles.row, { gap: spacing.md }]}>
      <View style={styles.rowText}>
        <Text style={[typography.body, { color: colors.text }]}>{label}</Text>
        {hint ? (
          <Text style={[typography.caption, { color: colors.textMuted }]}>{hint}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  const { colors, spacing, typography } = useTheme();
  const me = useAuth((state) => state.me);
  const signOut = useAuth((state) => state.signOut);
  const [saveFailed, setSaveFailed] = useState(false);

  if (!me) return null;
  const { settings, profile } = me;

  async function track(save: Promise<boolean>) {
    setSaveFailed(!(await save));
  }
  const setSetting = (patch: Partial<Settings>) => void track(saveSettings(patch));
  const changeRest = (delta: number) =>
    setSetting({
      default_rest_s: stepValue(settings.default_rest_s, delta, REST.min, REST.max, REST.step),
    });

  return (
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      style={[styles.flex, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl }}>
        {saveFailed ? (
          <Text accessibilityRole="alert" style={[typography.body, { color: colors.danger }]}>
            Couldn&apos;t save that change. Check your connection and try again.
          </Text>
        ) : null}

        <Section title="Units">
          <SegmentedControl
            label="Body weight and lifts"
            segments={[
              { value: 'kg', label: 'kg' },
              { value: 'lb', label: 'lb' },
            ]}
            value={profile.unit_weight}
            onChange={(unit_weight) => void track(saveUnits({ unit_weight }))}
          />
          <SegmentedControl
            label="Height and measurements"
            segments={[
              { value: 'cm', label: 'cm' },
              { value: 'in', label: 'ft / in' },
            ]}
            value={profile.unit_length}
            onChange={(unit_length) => void track(saveUnits({ unit_length }))}
          />
        </Section>

        <Section title="Appearance">
          <SegmentedControl
            label="Theme"
            segments={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={settings.theme}
            onChange={(theme) => setSetting({ theme })}
          />
        </Section>

        <Section title="Workouts">
          <Row label="Default rest timer" hint="Used when an exercise has no rest time of its own.">
            <Stepper
              label="Default rest timer"
              display={formatRest(settings.default_rest_s)}
              onDecrement={() => changeRest(-REST.step)}
              onIncrement={() => changeRest(REST.step)}
              canDecrement={settings.default_rest_s > REST.min}
              canIncrement={settings.default_rest_s < REST.max}
            />
          </Row>
          <Row label="Keep screen awake" hint="While a workout is open.">
            <Switch
              accessibilityLabel="Keep screen awake"
              value={settings.keep_awake}
              onValueChange={(keep_awake) => setSetting({ keep_awake })}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </Row>
        </Section>

        <Section title="Account">
          <Row label={me.display_name} hint={`@${me.username} · ${me.email}`} />
          <Button label="Log out" variant="secondary" onPress={() => void signOut()} />
        </Section>

        <Section title="About">
          <Text style={[typography.body, { color: colors.text }]}>
            RepForge {Constants.expoConfig?.version ?? ''}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            Food data: USDA FoodData Central (public domain), Open Food Facts (ODbL), Indian Food
            Composition Tables (NIN).
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            Nutrition and coaching numbers are estimates only, not medical advice.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowText: { flex: 1, gap: 2 },
});
