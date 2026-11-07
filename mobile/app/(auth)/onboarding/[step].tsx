import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { updateProfile } from '@/api/me';
import { authErrorMessage } from '@/auth/messages';
import { BirthDateInput } from '@/components/onboarding/BirthDateInput';
import { HeightInput } from '@/components/onboarding/HeightInput';
import { WeightInput } from '@/components/onboarding/WeightInput';
import { Button } from '@/components/ui/Button';
import { ChoiceList } from '@/components/ui/ChoiceList';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { deviceTimezone } from '@/lib/timezone';
import {
  ACTIVITY_CHOICES,
  EXPERIENCE_CHOICES,
  GOAL_CHOICES,
  SEX_CHOICES,
} from '@/onboarding/options';
import {
  isAnswered,
  isStepId,
  nextStep,
  STEPS,
  stepForMissing,
  toProfileUpdate,
  type StepId,
} from '@/onboarding/steps';
import { useAuth } from '@/stores/auth';
import { useOnboarding } from '@/stores/onboarding';
import { useTheme } from '@/theme/useTheme';

const COPY: Record<StepId, { title: string; subtitle: string }> = {
  units: {
    title: 'Pick your units',
    subtitle: 'You can change these any time in Settings.',
  },
  sex: {
    title: 'What is your sex?',
    subtitle: 'Used only to estimate your calorie needs.',
  },
  'birth-date': {
    title: 'When were you born?',
    subtitle: 'Your age changes how many calories you burn at rest.',
  },
  height: { title: 'How tall are you?', subtitle: 'Used for your calorie estimate.' },
  weight: {
    title: 'What do you weigh today?',
    subtitle: 'This becomes your first weigh-in.',
  },
  activity: {
    title: 'How active are you?',
    subtitle: 'Think of a typical week, including training.',
  },
  goal: { title: 'What is your goal?', subtitle: 'Your targets and coaching follow from this.' },
  experience: {
    title: 'How long have you been training?',
    subtitle: 'Sets how fast we suggest adding weight.',
  },
};

export default function OnboardingStepScreen() {
  const { step } = useLocalSearchParams<{ step: string }>();
  const { colors, radius, spacing, typography } = useTheme();
  const me = useAuth((state) => state.me);
  const setMe = useAuth((state) => state.setMe);
  const signOut = useAuth((state) => state.signOut);
  const draft = useOnboarding((state) => state.draft);
  const update = useOnboarding((state) => state.update);
  const seed = useOnboarding((state) => state.seed);
  const reset = useOnboarding((state) => state.reset);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me && !me.onboarding_complete) seed(me.id, me.profile);
  }, [me, seed]);

  if (!isStepId(step)) return <Redirect href="/onboarding/units" />;

  const index = STEPS.indexOf(step);
  const next = nextStep(step);
  const copy = COPY[step];

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const profile = await updateProfile(toProfileUpdate(draft, deviceTimezone()));
      // Completing flips the route guards, which take the user into the app.
      if (me)
        setMe({ ...me, profile, onboarding_complete: profile.onboarding_completed_at !== null });
      reset();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'onboarding_incomplete') {
        const target = stepForMissing((cause.details as { missing?: unknown } | null)?.missing);
        if (target) router.replace(`/onboarding/${target}`);
      }
      setError(authErrorMessage(cause));
      setBusy(false);
    }
  }

  function onContinue() {
    if (next) router.push(`/onboarding/${next}`);
    else void finish();
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View
            accessibilityLabel={`Step ${index + 1} of ${STEPS.length}`}
            style={{
              width: `${((index + 1) / STEPS.length) * 100}%`,
              height: '100%',
              backgroundColor: colors.primary,
              borderRadius: radius.pill,
            }}
          />
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
        >
          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              Step {index + 1} of {STEPS.length}
            </Text>
            <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>
              {copy.title}
            </Text>
            <Text style={[typography.body, { color: colors.textMuted }]}>{copy.subtitle}</Text>
          </View>

          {step === 'units' ? (
            <View style={{ gap: spacing.lg }}>
              <SegmentedControl
                label="Body weight and lifts"
                segments={[
                  { value: 'kg', label: 'kg' },
                  { value: 'lb', label: 'lb' },
                ]}
                value={draft.unitWeight}
                onChange={(unitWeight) => update({ unitWeight })}
              />
              <SegmentedControl
                label="Height and measurements"
                segments={[
                  { value: 'cm', label: 'cm' },
                  { value: 'in', label: 'ft / in' },
                ]}
                value={draft.unitLength}
                onChange={(unitLength) => update({ unitLength })}
              />
            </View>
          ) : null}
          {step === 'sex' ? (
            <ChoiceList
              choices={SEX_CHOICES}
              value={draft.sex}
              onChange={(sex) => update({ sex })}
            />
          ) : null}
          {step === 'birth-date' ? (
            <BirthDateInput
              value={draft.birthDate}
              onChange={(birthDate) => update({ birthDate })}
            />
          ) : null}
          {step === 'height' ? (
            <HeightInput
              unit={draft.unitLength}
              valueCm={draft.heightCm}
              onChange={(heightCm) => update({ heightCm })}
            />
          ) : null}
          {step === 'weight' ? (
            <WeightInput
              unit={draft.unitWeight}
              valueKg={draft.weightKg}
              onChange={(weightKg) => update({ weightKg })}
            />
          ) : null}
          {step === 'activity' ? (
            <ChoiceList
              choices={ACTIVITY_CHOICES}
              value={draft.activityLevel}
              onChange={(activityLevel) => update({ activityLevel })}
            />
          ) : null}
          {step === 'goal' ? (
            <ChoiceList
              choices={GOAL_CHOICES}
              value={draft.goal}
              onChange={(goal) => update({ goal })}
            />
          ) : null}
          {step === 'experience' ? (
            <ChoiceList
              choices={EXPERIENCE_CHOICES}
              value={draft.experience}
              onChange={(experience) => update({ experience })}
            />
          ) : null}

          {error ? (
            <Text accessibilityRole="alert" style={[typography.body, { color: colors.danger }]}>
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <View style={{ padding: spacing.xl, gap: spacing.sm }}>
          <Button
            label={next ? 'Continue' : 'Finish'}
            onPress={onContinue}
            disabled={!isAnswered(step, draft)}
            loading={busy}
            testID="continue"
          />
          {index === 0 ? (
            <Button label="Log out" variant="ghost" onPress={() => void signOut()} />
          ) : (
            <Button label="Back" variant="ghost" onPress={() => router.back()} />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  progressTrack: { height: 4, marginHorizontal: 24, marginTop: 8, borderRadius: 999 },
});
