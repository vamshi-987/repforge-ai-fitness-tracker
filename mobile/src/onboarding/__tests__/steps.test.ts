import { makeMe } from '@/test/helpers';

import {
  ageOn,
  draftFromProfile,
  EMPTY_DRAFT,
  firstUnanswered,
  heightProblem,
  isAnswered,
  isStepId,
  nextStep,
  parseBirthDate,
  previousStep,
  STEPS,
  stepForMissing,
  toProfileUpdate,
  weightProblem,
  type OnboardingDraft,
} from '../steps';

const COMPLETE: OnboardingDraft = {
  unitWeight: 'lb',
  unitLength: 'in',
  sex: 'female',
  birthDate: '1995-03-01',
  heightCm: 168.3,
  weightKg: 64.46,
  activityLevel: 'moderate',
  goal: 'fat_loss',
  experience: 'beginner',
};

const TODAY = new Date(2026, 9, 25); // 25 Oct 2026, local time

describe('step navigation', () => {
  it('starts with units and walks forward and back', () => {
    expect(STEPS[0]).toBe('units');
    expect(nextStep('units')).toBe('sex');
    expect(nextStep('experience')).toBeNull();
    expect(previousStep('sex')).toBe('units');
    expect(previousStep('units')).toBeNull();
  });

  it('recognises step ids', () => {
    expect(isStepId('birth-date')).toBe(true);
    expect(isStepId('nope')).toBe(false);
    expect(isStepId(undefined)).toBe(false);
  });
});

describe('answers', () => {
  it('needs every step except units answered', () => {
    expect(isAnswered('units', EMPTY_DRAFT)).toBe(true);
    expect(STEPS.filter((step) => !isAnswered(step, EMPTY_DRAFT))).toHaveLength(STEPS.length - 1);
    expect(STEPS.every((step) => isAnswered(step, COMPLETE))).toBe(true);
  });

  it('finds the first unanswered step', () => {
    expect(firstUnanswered(EMPTY_DRAFT)).toBe('sex');
    expect(firstUnanswered({ ...COMPLETE, weightKg: null })).toBe('weight');
    expect(firstUnanswered(COMPLETE)).toBeNull();
  });

  it('seeds the draft from the server profile', () => {
    const me = makeMe();
    expect(draftFromProfile(me.profile)).toEqual(EMPTY_DRAFT);
    expect(draftFromProfile({ ...me.profile, unit_weight: 'lb', goal: 'maintain' })).toMatchObject({
      unitWeight: 'lb',
      goal: 'maintain',
    });
  });

  it('maps server missing fields to the earliest step', () => {
    expect(stepForMissing(['experience', 'height_cm'])).toBe('height');
    expect(stepForMissing(['weight_kg'])).toBe('weight');
    expect(stepForMissing(['unknown'])).toBeNull();
    expect(stepForMissing('not-a-list')).toBeNull();
  });
});

describe('toProfileUpdate', () => {
  it('builds the final PATCH body with the timezone', () => {
    expect(toProfileUpdate(COMPLETE, 'Asia/Kolkata')).toEqual({
      unit_weight: 'lb',
      unit_length: 'in',
      sex: 'female',
      birth_date: '1995-03-01',
      height_cm: 168.3,
      weight_kg: 64.46,
      activity_level: 'moderate',
      goal: 'fat_loss',
      experience: 'beginner',
      timezone: 'Asia/Kolkata',
      onboarding_complete: true,
    });
  });

  it('refuses an incomplete draft', () => {
    expect(() => toProfileUpdate({ ...COMPLETE, goal: null }, 'UTC')).toThrow('goal');
  });
});

describe('validation mirrors the API', () => {
  it('computes age around birthdays', () => {
    expect(ageOn(new Date(1996, 9, 25), TODAY)).toBe(30);
    expect(ageOn(new Date(1996, 9, 26), TODAY)).toBe(29);
  });

  it.each([
    [1, 3, 1995, { value: '1995-03-01' }],
    [25, 10, 2013, { value: '2013-10-25' }],
    [26, 10, 2013, { problem: 'You must be at least 13 to use RepForge.' }],
    [31, 2, 1995, { problem: 'That date does not exist.' }],
    [0, 1, 1995, { problem: 'That date does not exist.' }],
    [1, 1, 2027, { problem: 'Birth date is in the future.' }],
    [1, 1, 1900, { problem: 'Enter an age of 100 or less.' }],
  ])('parseBirthDate(%p, %p, %p)', (day, month, year, expected) => {
    expect(parseBirthDate(day, month, year, TODAY)).toEqual(expected);
  });

  it('checks height and weight ranges in the user unit', () => {
    expect(heightProblem(170, 'cm')).toBeNull();
    expect(heightProblem(99, 'cm')).toBe('Enter a height between 100 cm and 250 cm.');
    expect(heightProblem(260, 'in')).toBe('Enter a height between 3′3″ and 8′2″.');
    expect(weightProblem(80, 'kg')).toBeNull();
    expect(weightProblem(20, 'lb')).toBe('Enter a weight between 55.1 lb and 771.6 lb.');
  });
});
