import type { ActivityLevel, Experience, Goal, Sex } from '@/api/types';
import type { Choice } from '@/components/ui/ChoiceList';

export const SEX_CHOICES: Choice<Sex>[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

export const ACTIVITY_CHOICES: Choice<ActivityLevel>[] = [
  { value: 'sedentary', label: 'Mostly sitting', description: 'Desk job, little walking' },
  { value: 'light', label: 'Lightly active', description: 'On your feet some of the day' },
  { value: 'moderate', label: 'Moderately active', description: 'Training 3–5 days a week' },
  { value: 'active', label: 'Very active', description: 'Hard training most days' },
  {
    value: 'very_active',
    label: 'Extremely active',
    description: 'Physical job plus hard training',
  },
];

export const GOAL_CHOICES: Choice<Goal>[] = [
  { value: 'muscle_gain', label: 'Build muscle', description: 'Gain slowly to limit fat gain' },
  { value: 'fat_loss', label: 'Lose fat', description: 'Lose weight while keeping muscle' },
  { value: 'maintain', label: 'Maintain', description: 'Stay at your current weight' },
];

export const EXPERIENCE_CHOICES: Choice<Experience>[] = [
  { value: 'beginner', label: 'Beginner', description: 'Less than a year of regular training' },
  { value: 'intermediate', label: 'Intermediate', description: '1–3 years of regular training' },
  { value: 'advanced', label: 'Advanced', description: 'More than 3 years, structured programs' },
];
