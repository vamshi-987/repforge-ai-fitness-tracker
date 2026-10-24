import { apiBaseUrl } from '../config';

describe('apiBaseUrl', () => {
  it.each([
    ['http://192.168.1.20:8010', 'http://192.168.1.20:8010/v1'],
    ['http://192.168.1.20:8010/', 'http://192.168.1.20:8010/v1'],
    ['  https://api.repforge.app//  ', 'https://api.repforge.app/v1'],
  ])('normalises %p', (input, expected) => {
    expect(apiBaseUrl(input)).toBe(expected);
  });

  it.each(['', '   '])('falls back to localhost for %p', (input) => {
    expect(apiBaseUrl(input)).toBe('http://localhost:8010/v1');
  });
});
