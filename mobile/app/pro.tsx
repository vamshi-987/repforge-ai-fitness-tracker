import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { buyPackage, proPackages, restorePurchases, type ProPackage } from '@/pro/purchases';
import { waitForPro } from '@/pro/waitForPro';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

const BENEFITS = [
  'Unlimited routines',
  'Charts and stats beyond 3 months',
  'Weekly report with calorie adjustments',
  'Progressive overload targets in your workouts',
  '50 food photos a day',
];
const SLOW_ACTIVATION = 'Your purchase went through. Pro will switch on in a moment.';

/** What Pro adds, and the store's plans. */
export default function ProScreen() {
  const { colors, spacing, typography } = useTheme();
  const isPro = useAuth((state) => state.me?.is_pro ?? false);
  const packages = useQuery({
    queryKey: ['pro-packages'],
    queryFn: proPackages,
    retry: false,
    networkMode: 'always',
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(name: string, task: () => Promise<void>, failure: string) {
    setBusy(name);
    setMessage(null);
    try {
      await task();
    } catch {
      setMessage(failure);
    } finally {
      setBusy(null);
    }
  }

  async function activate() {
    if (await waitForPro()) router.back();
    else setMessage(SLOW_ACTIVATION);
  }

  const buy = (pkg: ProPackage) =>
    run(
      pkg.id,
      async () => {
        if ((await buyPackage(pkg)) === 'bought') await activate();
      },
      'The purchase didn’t go through, and you weren’t charged by RepForge. Please try again.',
    );
  const restore = () =>
    run(
      'restore',
      async () => {
        await restorePurchases();
        if (await waitForPro(1000)) router.back();
        else setMessage('No active subscription was found for this account.');
      },
      'Purchases couldn’t be restored right now. Please try again.',
    );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>
        RepForge Pro
      </Text>
      <View style={{ gap: spacing.xs }}>
        {BENEFITS.map((benefit) => (
          <Text key={benefit} style={[typography.body, { color: colors.text }]}>
            • {benefit}
          </Text>
        ))}
      </View>

      {isPro ? (
        <Text style={[typography.body, { color: colors.success }]}>
          You have RepForge Pro. Manage it in your store’s subscription settings.
        </Text>
      ) : (
        <>
          {packages.isPending ? <ActivityIndicator color={colors.primary} /> : null}
          {packages.data?.map((pkg) => (
            <Button
              key={pkg.id}
              label={`${pkg.title}: ${pkg.price}`}
              loading={busy === pkg.id}
              disabled={busy !== null}
              onPress={() => void buy(pkg)}
            />
          ))}
          {packages.isSuccess && packages.data.length === 0 ? (
            <Text style={[typography.body, { color: colors.textMuted }]}>
              Subscriptions aren’t available in this version of the app.
            </Text>
          ) : null}
          {packages.isError ? (
            <Text style={[typography.body, { color: colors.textMuted }]}>
              Plans couldn’t be loaded. Check your connection and try again.
            </Text>
          ) : null}
          <Button
            label="Restore purchases"
            variant="ghost"
            loading={busy === 'restore'}
            disabled={busy !== null}
            onPress={() => void restore()}
          />
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            Subscriptions renew automatically until cancelled in your store’s settings, at least 24
            hours before the period ends.
          </Text>
        </>
      )}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={[typography.body, { color: colors.text }]}>
          {message}
        </Text>
      ) : null}
    </ScrollView>
  );
}
