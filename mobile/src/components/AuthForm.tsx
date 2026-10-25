import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { login, register } from '@/api/auth';
import { authErrorMessage, credentialsProblem, PASSWORD_MIN } from '@/auth/messages';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

interface AuthFormProps {
  mode: 'login' | 'register';
}

const COPY = {
  login: {
    title: 'Welcome back',
    subtitle: 'Log in to keep logging your lifts.',
    submit: 'Log in',
    switchPrompt: 'New to RepForge?',
    switchLabel: 'Create an account',
    switchHref: '/register',
  },
  register: {
    title: 'Create your account',
    subtitle: 'Track workouts, food and water in one place.',
    submit: 'Create account',
    switchPrompt: 'Already have an account?',
    switchLabel: 'Log in',
    switchHref: '/login',
  },
} as const;

export function AuthForm({ mode }: AuthFormProps) {
  const { colors, spacing, typography } = useTheme();
  const signIn = useAuth((state) => state.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = COPY[mode];

  async function submit() {
    const problem = credentialsProblem(email, password, mode);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const body = { email: email.trim(), password };
      // Success flips the auth state; the route guards then navigate away from this screen.
      await signIn(mode === 'login' ? await login(body) : await register(body));
    } catch (cause) {
      setError(authErrorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { padding: spacing.xl, gap: spacing.lg }]}
        >
          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.title, { color: colors.text }]}>RepForge</Text>
            <Text style={[typography.heading, { color: colors.text }]}>{copy.title}</Text>
            <Text style={[typography.body, { color: colors.textMuted }]}>{copy.subtitle}</Text>
          </View>

          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            testID="email"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            textContentType={mode === 'login' ? 'password' : 'newPassword'}
            placeholder={mode === 'register' ? `At least ${PASSWORD_MIN} characters` : undefined}
            returnKeyType="go"
            onSubmitEditing={submit}
            testID="password"
          />

          {error ? (
            <Text accessibilityRole="alert" style={[typography.body, { color: colors.danger }]}>
              {error}
            </Text>
          ) : null}

          <Button label={copy.submit} onPress={submit} loading={busy} testID="submit" />

          <View style={[styles.switchRow, { gap: spacing.xs }]}>
            <Text style={[typography.body, { color: colors.textMuted }]}>{copy.switchPrompt}</Text>
            <Link href={copy.switchHref} replace>
              <Text style={[typography.body, { color: colors.primary, fontWeight: '600' }]}>
                {copy.switchLabel}
              </Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' },
});
