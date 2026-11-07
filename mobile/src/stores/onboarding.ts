import { create } from 'zustand';

import type { Profile } from '@/api/types';
import { draftFromProfile, EMPTY_DRAFT, type OnboardingDraft } from '@/onboarding/steps';

interface OnboardingState {
  draft: OnboardingDraft;
  /** Server profile the draft was seeded from, so seeding happens once per account. */
  seededFor: string | null;
  update(patch: Partial<OnboardingDraft>): void;
  seed(userId: string, profile: Profile): void;
  reset(): void;
}

/** In-memory answers while onboarding; sent to the server in one PATCH at the end. */
export const useOnboarding = create<OnboardingState>()((set, get) => ({
  draft: EMPTY_DRAFT,
  seededFor: null,
  update: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  seed: (userId, profile) => {
    if (get().seededFor !== userId) set({ draft: draftFromProfile(profile), seededFor: userId });
  },
  reset: () => set({ draft: EMPTY_DRAFT, seededFor: null }),
}));
