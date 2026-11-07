import { useEffect } from 'react';

import { useAuth } from '@/stores/auth';

import { startPurchases } from './purchases';

/** While signed in, purchases belong to this account. */
export function usePurchases(): void {
  const userId = useAuth((state) => state.me?.id);

  useEffect(() => {
    if (userId) void startPurchases(userId);
  }, [userId]);
}
