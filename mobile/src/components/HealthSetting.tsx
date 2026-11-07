import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { BODY_QUERY_KEY } from '@/body/store';
import { healthBridge, type HealthBridge } from '@/health/bridge';
import { disableHealth, enableHealth, healthEnabled } from '@/health/sync';
import { useTheme } from '@/theme/useTheme';

/** The switch for Apple Health or Health Connect, whichever this phone has. */
export function HealthSetting() {
  const { colors, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const [bridge, setBridge] = useState<HealthBridge | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    void (async () => {
      setBridge(await healthBridge());
      setEnabled(await healthEnabled());
      setChecked(true);
    })();
  }, []);

  async function change(value: boolean) {
    setDenied(false);
    if (!bridge) return;
    if (!value) {
      await disableHealth();
      setEnabled(false);
      return;
    }
    try {
      const granted = await enableHealth(bridge);
      setEnabled(granted);
      setDenied(!granted);
      await queryClient.invalidateQueries({ queryKey: BODY_QUERY_KEY });
    } catch {
      setDenied(true);
    }
  }

  if (!checked) return null;
  if (!bridge) {
    return (
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Health data isn’t available in this version of the app.
      </Text>
    );
  }
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={[styles.row, { gap: spacing.md }]}>
        <Text style={[typography.body, styles.flex, { color: colors.text }]}>{bridge.name}</Text>
        <Switch
          accessibilityLabel={bridge.name}
          value={enabled}
          onValueChange={(value) => void change(value)}
        />
      </View>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Brings your weigh-ins in, and saves your finished workouts there.
      </Text>
      {denied ? (
        <Text style={[typography.caption, { color: colors.danger }]}>
          Allow access in {bridge.name} to turn this on.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
