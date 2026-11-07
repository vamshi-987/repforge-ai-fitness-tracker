import { Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

// Public SDK keys, safe in the app. Without one the paywall says subscriptions aren't available.
const API_KEY =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

export interface ProPackage {
  id: string;
  title: string;
  price: string;
  source: PurchasesPackage;
}

export type PurchaseResult = 'bought' | 'cancelled';

/** The SDK, or null where it can't run: no key, or Expo Go on a build without the module. */
async function purchases() {
  if (!API_KEY) return null;
  try {
    return (await import('react-native-purchases')).default;
  } catch {
    return null;
  }
}

/** Tie purchases to this account: the app user id is what the webhook finds them by. */
export async function startPurchases(userId: string): Promise<void> {
  const sdk = await purchases();
  if (!sdk || !API_KEY) return;
  try {
    if (await sdk.isConfigured()) await sdk.logIn(userId);
    else sdk.configure({ apiKey: API_KEY, appUserID: userId });
  } catch {
    // The paywall will say so if it matters.
  }
}

export async function stopPurchases(): Promise<void> {
  const sdk = await purchases();
  try {
    if (sdk && (await sdk.isConfigured())) await sdk.logOut();
  } catch {
    // An anonymous user can't log out; nothing to do.
  }
}

export async function proPackages(): Promise<ProPackage[]> {
  const sdk = await purchases();
  if (!sdk) return [];
  const offerings = await sdk.getOfferings();
  return (offerings.current?.availablePackages ?? []).map((source) => ({
    id: source.identifier,
    title: source.product.title,
    price: source.product.priceString,
    source,
  }));
}

export async function buyPackage(pkg: ProPackage): Promise<PurchaseResult> {
  const sdk = await purchases();
  if (!sdk) throw new Error('Purchases are not available');
  try {
    await sdk.purchasePackage(pkg.source);
    return 'bought';
  } catch (error) {
    if ((error as { userCancelled?: boolean }).userCancelled) return 'cancelled';
    throw error;
  }
}

export async function restorePurchases(): Promise<void> {
  const sdk = await purchases();
  if (!sdk) throw new Error('Purchases are not available');
  await sdk.restorePurchases();
}
