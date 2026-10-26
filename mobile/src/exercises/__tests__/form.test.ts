import { ApiError } from '@/api/client';
import { BENCH } from '@/test/library';

import {
  draftFrom,
  friendlyError,
  instructionLines,
  serverFieldErrors,
  toCreate,
  toggleSecondary,
  toUpdate,
  typeLabel,
  validateDraft,
  withPrimary,
  type ExerciseDraft,
} from '../form';

const VALID: ExerciseDraft = {
  name: '  Landmine   Press ',
  type: 'weight_reps',
  equipment: 'barbell',
  primaryMuscle: 'front_delts',
  secondaryMuscles: ['chest'],
  instructionsText: 'Kneel down.\n\n  Press   up. \n',
};

describe('exercise form', () => {
  it('starts empty, or from an existing exercise', () => {
    expect(draftFrom()).toEqual({
      name: '',
      type: null,
      equipment: null,
      primaryMuscle: null,
      secondaryMuscles: [],
      instructionsText: '',
    });
    expect(draftFrom(BENCH)).toMatchObject({
      name: BENCH.name,
      primaryMuscle: 'chest',
      secondaryMuscles: ['front_delts', 'triceps'],
      instructionsText: BENCH.instructions.join('\n'),
    });
  });

  it('requires a name, type, equipment and primary muscle', () => {
    expect(validateDraft(draftFrom())).toEqual({
      name: 'Give the exercise a name.',
      type: 'Choose how sets are logged.',
      equipment: 'Choose the equipment.',
      primaryMuscle: 'Choose the main muscle worked.',
    });
    expect(validateDraft(VALID)).toEqual({});
  });

  it('enforces the server limits', () => {
    const errors = validateDraft({
      ...VALID,
      name: 'x'.repeat(81),
      secondaryMuscles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      instructionsText: Array.from({ length: 11 }, () => 'step').join('\n'),
    });

    expect(Object.keys(errors).sort()).toEqual(['instructionsText', 'name', 'secondaryMuscles']);
    expect(validateDraft({ ...VALID, instructionsText: 'x'.repeat(301) }).instructionsText).toBe(
      'Keep each line to 300 characters.',
    );
  });

  it('builds a clean create body', () => {
    expect(instructionLines(VALID.instructionsText)).toEqual(['Kneel down.', 'Press up.']);
    expect(toCreate(VALID)).toEqual({
      name: 'Landmine Press',
      type: 'weight_reps',
      equipment: 'barbell',
      primary_muscle: 'front_delts',
      secondary_muscles: ['chest'],
      instructions: ['Kneel down.', 'Press up.'],
    });
    expect(toCreate(VALID, 'client-id').id).toBe('client-id');
  });

  it('sends only changed fields on update, never the type', () => {
    expect(toUpdate(draftFrom(BENCH), BENCH)).toEqual({});
    const changed = toggleSecondary(
      withPrimary({ ...draftFrom(BENCH), name: 'Bench' }, 'triceps'),
      'lats',
    );

    expect(
      toUpdate(
        { ...changed, type: 'duration', equipment: 'dumbbell', instructionsText: 'One.' },
        BENCH,
      ),
    ).toEqual({
      name: 'Bench',
      equipment: 'dumbbell',
      primary_muscle: 'triceps',
      secondary_muscles: ['front_delts', 'lats'],
      instructions: ['One.'],
    });
  });

  it('keeps the primary muscle out of the secondary list', () => {
    const draft = withPrimary({ ...VALID, secondaryMuscles: ['chest', 'triceps'] }, 'chest');

    expect(draft.secondaryMuscles).toEqual(['triceps']);
    expect(toggleSecondary(draft, 'triceps').secondaryMuscles).toEqual([]);
    expect(toggleSecondary(draft, 'abs').secondaryMuscles).toEqual(['abs', 'triceps']);
  });

  it('maps server field errors and friendly messages', () => {
    const error = new ApiError(422, 'validation_error', 'Request is invalid', [
      { loc: ['body', 'equipment'], msg: "unknown equipment 'sled'" },
      { loc: ['body', 'secondary_muscles'], msg: 'cannot include the primary muscle' },
      { loc: ['body', 'surprise'], msg: 'ignored' },
    ]);

    expect(serverFieldErrors(error)).toEqual({
      equipment: "unknown equipment 'sled'",
      secondaryMuscles: 'cannot include the primary muscle',
    });
    expect(serverFieldErrors(new Error('x'))).toEqual({});
    expect(friendlyError(new ApiError(0, 'network_error', 'down'))).toMatch(/offline/);
    expect(friendlyError(new ApiError(409, 'exercise_exists', 'Already exists'))).toBe(
      'Already exists',
    );
    expect(friendlyError(new Error('boom'))).toBe('Something went wrong. Try again.');
    expect(typeLabel('distance_duration')).toBe('Distance & duration');
  });
});
