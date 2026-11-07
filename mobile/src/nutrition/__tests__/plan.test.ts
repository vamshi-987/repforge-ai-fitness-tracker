import { formatMealTime, parseMealTime, readPlannedMeal, sortPlan } from '../plan';

describe('parseMealTime', () => {
  it.each([
    ['8', '08:00'],
    ['8:30', '08:30'],
    ['0830', '08:30'],
    ['830', '08:30'],
    ['13:05', '13:05'],
    ['00:00', '00:00'],
    ['1pm', '13:00'],
    ['1:30 PM', '13:30'],
    ['12am', '00:00'],
    ['12:15 pm', '12:15'],
  ])('reads %s as %s', (text, time) => {
    expect(parseMealTime(text)).toBe(time);
  });

  it.each(['', 'soon', '24:00', '8:60', '13pm', '0am', '8:3'])('refuses %s', (text) => {
    expect(parseMealTime(text)).toBeNull();
  });
});

describe('the plan', () => {
  it('shows a time the way the phone does', () => {
    expect(formatMealTime('13:30')).toMatch(/1:30|13:30/);
  });

  it('sorts by time', () => {
    const plan = [
      { name: 'Dinner', time: '20:00' },
      { name: 'Breakfast', time: '08:00' },
    ];
    expect(sortPlan(plan).map((meal) => meal.name)).toEqual(['Breakfast', 'Dinner']);
  });

  it('reads a meal, tidying the name', () => {
    expect(readPlannedMeal('  Pre  workout ', '5pm').meal).toEqual({
      name: 'Pre workout',
      time: '17:00',
    });
  });

  it('says what’s wrong with each field', () => {
    expect(readPlannedMeal(' ', 'later').errors).toEqual({
      name: 'Give it a name',
      time: 'Use a time like 8:30 or 1:30 pm',
    });
    expect(readPlannedMeal('x'.repeat(41), '8').errors).toEqual({
      name: 'Use at most 40 characters',
    });
  });
});
