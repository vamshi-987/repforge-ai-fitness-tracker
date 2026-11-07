import { useAuth } from '@/stores/auth';

const ATTEMPTS = 6;
const WAIT_MS = 2000;

/** Pro comes from the store's webhook, moments after a purchase. True once it has arrived. */
export async function waitForPro(wait = WAIT_MS): Promise<boolean> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    await useAuth.getState().refreshMe();
    if (useAuth.getState().me?.is_pro) return true;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return false;
}
