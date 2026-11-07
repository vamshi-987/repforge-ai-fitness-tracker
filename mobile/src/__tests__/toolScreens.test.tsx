import { fireEvent, render, screen } from '@testing-library/react-native';

import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/helpers';

import ToolsScreen from '../../app/tools/index';
import OneRepMaxScreen from '../../app/tools/one-rep-max';
import PlateCalculatorScreen from '../../app/tools/plates';
import WarmupScreen from '../../app/tools/warmup';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const expoRouter = jest.requireMock<{ router: { push: jest.Mock } }>('expo-router');

function signIn(unit: 'kg' | 'lb' = 'kg') {
  const me = makeMe({ onboarding_complete: true });
  useAuth.setState({
    status: 'signedIn',
    me: { ...me, profile: { ...me.profile, unit_weight: unit } },
  });
}

beforeEach(() => signIn());

describe('Tools', () => {
  it('opens each calculator', async () => {
    await render(<ToolsScreen />);

    await fireEvent.press(screen.getByLabelText('Plate calculator'));
    await fireEvent.press(screen.getByLabelText('1RM calculator'));
    await fireEvent.press(screen.getByLabelText('Warm-up sets'));

    expect(expoRouter.router.push.mock.calls.map((c) => c[0])).toEqual([
      '/tools/plates',
      '/tools/one-rep-max',
      '/tools/warmup',
    ]);
  });

  it('loads the bar for a target', async () => {
    await render(<PlateCalculatorScreen />);

    await fireEvent.changeText(screen.getByLabelText('Target weight (kg)'), '102,5');
    expect(screen.getByLabelText('Each side: 1 × 25, 1 × 15, 1 × 1.25')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('15 kg bar'));
    expect(screen.getByLabelText('Each side: 1 × 25, 1 × 15, 1 × 2.5, 1 × 1.25')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Target weight (kg)'), '101');
    expect(screen.getByText(/short/)).toBeOnTheScreen();
  });

  it('uses lb plates for lb users', async () => {
    signIn('lb');
    await render(<PlateCalculatorScreen />);

    await fireEvent.changeText(screen.getByLabelText('Target weight (lb)'), '225');

    expect(screen.getByLabelText('Each side: 2 × 45')).toBeOnTheScreen();
  });

  it('estimates a 1RM and its rep table', async () => {
    await render(<OneRepMaxScreen />);

    await fireEvent.changeText(screen.getByLabelText('Weight (kg)'), '100');
    await fireEvent.changeText(screen.getByLabelText('Reps'), '5');

    expect(screen.getByLabelText('Estimated 1RM: 116.7 kg')).toBeOnTheScreen();
    expect(screen.getByText('10 reps · 75%')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Reps'), '15');
    expect(screen.getByText(/Rough estimate/)).toBeOnTheScreen();
  });

  it('lays out warm-up sets with their plates', async () => {
    await render(<WarmupScreen />);

    await fireEvent.changeText(screen.getByLabelText('Working weight (kg)'), '100');

    expect(screen.getByLabelText('20 kg × 10')).toBeOnTheScreen();
    expect(screen.getByLabelText('60 kg × 3')).toBeOnTheScreen();
    expect(screen.getByText('Each side: 1 × 20')).toBeOnTheScreen();
    expect(screen.getByText('Each side: 1 × 25, 1 × 5')).toBeOnTheScreen();
  });
});
