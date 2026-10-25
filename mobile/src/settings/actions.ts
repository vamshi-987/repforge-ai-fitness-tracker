import { updateProfile, updateSettings } from '@/api/me';
import type { Me, Profile, Settings } from '@/api/types';
import { useAuth } from '@/stores/auth';

type Section = 'settings' | 'profile';
type ProfilePrefs = Pick<Profile, 'unit_weight' | 'unit_length'>;

// Writes per section run one after another, so the server sees them in the order the user
// made them. Each key's latest local change holds a ticket; only that change may be
// confirmed or rolled back, so an older response never overwrites a newer tap.
const queues: Record<Section, Promise<unknown>> = {
  settings: Promise.resolve(),
  profile: Promise.resolve(),
};
const tickets = new Map<string, number>();
let nextTicket = 0;

function applyKeys<S extends Section>(section: S, values: Partial<Me[S]>, ticket: number): void {
  const current = useAuth.getState().me;
  if (!current) return;
  const owned = Object.fromEntries(
    Object.entries(values).filter(([key]) => tickets.get(`${section}.${key}`) === ticket),
  );
  if (Object.keys(owned).length === 0) return;
  useAuth.getState().setMe({ ...current, [section]: { ...current[section], ...owned } });
}

/**
 * Optimistic write: apply the change locally now, send it, then adopt the server's values
 * (or roll back on failure). Resolves false if the change was rolled back.
 */
function optimistic<S extends Section>(
  section: S,
  patch: Partial<Me[S]>,
  send: () => Promise<Me[S]>,
): Promise<boolean> {
  const me = useAuth.getState().me;
  if (!me) return Promise.resolve(false);

  const ticket = ++nextTicket;
  const keys = Object.keys(patch) as (keyof Me[S])[];
  const before = Object.fromEntries(keys.map((key) => [key, me[section][key]])) as Partial<Me[S]>;
  keys.forEach((key) => tickets.set(`${section}.${String(key)}`, ticket));
  useAuth.getState().setMe({ ...me, [section]: { ...me[section], ...patch } });

  const run = queues[section].then(async () => {
    try {
      const saved = await send();
      const confirmed = Object.fromEntries(keys.map((key) => [key, saved[key]])) as Partial<Me[S]>;
      applyKeys(section, confirmed, ticket);
      return true;
    } catch {
      applyKeys(section, before, ticket);
      // `before` may itself be an unconfirmed optimistic value; resync when reachable.
      void useAuth.getState().refreshMe();
      return false;
    }
  });
  queues[section] = run;
  return run;
}

export function saveSettings(patch: Partial<Settings>): Promise<boolean> {
  return optimistic('settings', patch, () => updateSettings(patch));
}

export function saveUnits(patch: Partial<ProfilePrefs>): Promise<boolean> {
  return optimistic('profile', patch, () => updateProfile(patch));
}
