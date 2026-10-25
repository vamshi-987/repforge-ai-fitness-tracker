import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { session } from '@/auth/session';
import type { OnboardingDraft } from '@/onboarding/steps';
import { resetAuthStoreForTests, useAuth } from '@/stores/auth';
import { useOnboarding } from '@/stores/onboarding';
import { errorResponse, fetchCalls, jsonResponse, makeMe, tokenPair } from '@/test/helpers';

import OnboardingStepScreen from '../../app/(auth)/onboarding/[step]';

const expoRouter = jest.requireMock<{
  useLocalSearchParams: jest.Mock;
  router: { push: jest.Mock; replace: jest.Mock; back: jest.Mock };
}>('expo-router');
const mockRouter = expoRouter.router;

function atStep(step: string) {
  expoRouter.useLocalSearchParams.mockReturnValue({ step });
}

jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useLocalSearchParams: jest.fn(),
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
  };
});
jest.mock('expo-localization', () => ({ getCalendars: () => [{ timeZone: 'Asia/Kolkata' }] }));

const ANSWERED: OnboardingDraft = {
  unitWeight: 'kg',
  unitLength: 'cm',
  sex: 'male',
  birthDate: '1994-06-01',
  heightCm: 178,
  weightKg: 82.4,
  activityLevel: 'moderate',
  goal: 'muscle_gain',
  experience: null,
};

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuthStoreForTests();
  await session.start(tokenPair('a'));
  const me = makeMe();
  useAuth.setState({ status: 'signedIn', me });
  useOnboarding.setState({ draft: ANSWERED, seededFor: me.id });
});

describe('onboarding step screen', () => {
  it('moves to the next step', async () => {
    atStep('goal');
    await render(<OnboardingStepScreen />);

    await fireEvent.press(screen.getByText('Lose fat'));
    await fireEvent.press(screen.getByTestId('continue'));

    expect(useOnboarding.getState().draft.goal).toBe('fat_loss');
    expect(mockRouter.push).toHaveBeenCalledWith('/onboarding/experience');
  });

  it('keeps Continue disabled until the step is answered', async () => {
    atStep('experience');
    await render(<OnboardingStepScreen />);

    expect(screen.getByTestId('continue')).toBeDisabled();
    await fireEvent.press(screen.getByText('Intermediate'));
    expect(screen.getByTestId('continue')).toBeEnabled();
  });

  it('finishes: one PATCH with every answer, then marks onboarding complete', async () => {
    atStep('experience');
    const profile = { ...makeMe().profile, onboarding_completed_at: '2026-10-25T10:00:00Z' };
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, profile));
    globalThis.fetch = fetchMock;
    await render(<OnboardingStepScreen />);

    await fireEvent.press(screen.getByText('Intermediate'));
    await fireEvent.press(screen.getByTestId('continue'));

    await waitFor(() => expect(useAuth.getState().me?.onboarding_complete).toBe(true));
    const [call] = fetchCalls(fetchMock);
    expect(call?.url).toBe('http://api.test/v1/me/profile');
    expect(call?.init.method).toBe('PATCH');
    expect(JSON.parse(call?.init.body as string)).toEqual({
      unit_weight: 'kg',
      unit_length: 'cm',
      sex: 'male',
      birth_date: '1994-06-01',
      height_cm: 178,
      weight_kg: 82.4,
      activity_level: 'moderate',
      goal: 'muscle_gain',
      experience: 'intermediate',
      timezone: 'Asia/Kolkata',
      onboarding_complete: true,
    });
    expect(useOnboarding.getState().seededFor).toBeNull();
  });

  it('sends the user back to a step the server says is missing', async () => {
    atStep('experience');
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(errorResponse(422, 'onboarding_incomplete', { missing: ['weight_kg'] }));
    await render(<OnboardingStepScreen />);

    await fireEvent.press(screen.getByText('Beginner'));
    await fireEvent.press(screen.getByTestId('continue'));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding/weight'));
    expect(useAuth.getState().me?.onboarding_complete).toBe(false);
  });

  it('redirects unknown steps to the first one', async () => {
    atStep('nonsense');
    await render(<OnboardingStepScreen />);

    expect(screen.getByText('redirect:/onboarding/units')).toBeOnTheScreen();
  });
});
