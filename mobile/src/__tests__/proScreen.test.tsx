import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { ProPackage } from '@/pro/purchases';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/helpers';

import ProScreen from '../../app/pro';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('@/pro/purchases', () => ({
  buyPackage: jest.fn(),
  proPackages: jest.fn(),
  restorePurchases: jest.fn(),
}));
jest.mock('@/pro/waitForPro', () => ({ waitForPro: jest.fn() }));

const { router } = jest.requireMock<{ router: { back: jest.Mock } }>('expo-router');
const purchases =
  jest.requireMock<Record<'buyPackage' | 'proPackages' | 'restorePurchases', jest.Mock>>(
    '@/pro/purchases',
  );
const activation = jest.requireMock<{ waitForPro: jest.Mock }>('@/pro/waitForPro');

const MONTHLY = { id: 'monthly', title: 'Monthly', price: '₹499' } as ProPackage;

async function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.setState({ status: 'signedIn', me: makeMe({ onboarding_complete: true }) });
  purchases.proPackages.mockResolvedValue([MONTHLY]);
  activation.waitForPro.mockResolvedValue(true);
});

describe('The paywall', () => {
  it('lists what Pro adds and the store’s plans', async () => {
    await show();

    expect(await screen.findByLabelText('Monthly: ₹499')).toBeOnTheScreen();
    expect(screen.getByText(/Unlimited routines/)).toBeOnTheScreen();
    expect(screen.getByText(/renew automatically/)).toBeOnTheScreen();
  });

  it('buys a plan and closes once Pro is on', async () => {
    purchases.buyPackage.mockResolvedValue('bought');
    await show();

    await fireEvent.press(await screen.findByLabelText('Monthly: ₹499'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(purchases.buyPackage).toHaveBeenCalledWith(MONTHLY);
  });

  it('says so when the store is slower than the screen', async () => {
    purchases.buyPackage.mockResolvedValue('bought');
    activation.waitForPro.mockResolvedValue(false);
    await show();

    await fireEvent.press(await screen.findByLabelText('Monthly: ₹499'));

    expect(await screen.findByText(/will switch on in a moment/)).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('does nothing when the purchase is cancelled', async () => {
    purchases.buyPackage.mockResolvedValue('cancelled');
    await show();

    await fireEvent.press(await screen.findByLabelText('Monthly: ₹499'));

    await waitFor(() => expect(purchases.buyPackage).toHaveBeenCalled());
    expect(activation.waitForPro).not.toHaveBeenCalled();
  });

  it('explains a failed purchase', async () => {
    purchases.buyPackage.mockRejectedValue(new Error('store'));
    await show();

    await fireEvent.press(await screen.findByLabelText('Monthly: ₹499'));

    expect(await screen.findByText(/didn’t go through/)).toBeOnTheScreen();
  });

  it('restores a subscription', async () => {
    purchases.restorePurchases.mockResolvedValue(undefined);
    await show();

    await fireEvent.press(await screen.findByLabelText('Restore purchases'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('says when there is nothing to restore, or restoring fails', async () => {
    purchases.restorePurchases.mockResolvedValueOnce(undefined);
    activation.waitForPro.mockResolvedValue(false);
    await show();

    await fireEvent.press(await screen.findByLabelText('Restore purchases'));
    expect(await screen.findByText(/No active subscription/)).toBeOnTheScreen();

    purchases.restorePurchases.mockRejectedValueOnce(new Error('store'));
    await fireEvent.press(screen.getByLabelText('Restore purchases'));
    expect(await screen.findByText(/couldn’t be restored/)).toBeOnTheScreen();
  });

  it('explains a build without subscriptions', async () => {
    purchases.proPackages.mockResolvedValue([]);
    await show();

    expect(await screen.findByText(/aren’t available in this version/)).toBeOnTheScreen();
  });

  it('explains plans that won’t load', async () => {
    purchases.proPackages.mockRejectedValue(new Error('offline'));
    await show();

    expect(await screen.findByText(/couldn’t be loaded/)).toBeOnTheScreen();
  });

  it('thanks someone who already has it', async () => {
    useAuth.setState({ me: { ...makeMe({ onboarding_complete: true }), is_pro: true } });
    await show();

    expect(await screen.findByText(/You have RepForge Pro/)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Restore purchases')).toBeNull();
  });
});
