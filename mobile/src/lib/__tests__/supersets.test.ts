import { repairSupersets } from '../supersets';

describe('repairSupersets', () => {
  // Same numbering as the server's normalize_supersets (backend/tests/test_routine_rules.py).
  it.each<[(number | null)[], (number | null)[]]>([
    [[], []],
    [
      [null, null],
      [null, null],
    ],
    [
      [7, 7, null, 3, 3, 3],
      [1, 1, null, 2, 2, 2],
    ],
    [
      [2, 2, 1, 1],
      [1, 1, 2, 2],
    ],
    [[5], [null]],
    [
      [1, 2, 2, 3],
      [null, 1, 1, null],
    ],
    // Where the server rejects, the editor repairs: a reappearing group starts a new one.
    [
      [1, 1, null, 1, 1],
      [1, 1, null, 2, 2],
    ],
    [
      [1, null, 1],
      [null, null, null],
    ],
  ])('%p → %p', (input, expected) => {
    expect(repairSupersets(input)).toEqual(expected);
  });
});
