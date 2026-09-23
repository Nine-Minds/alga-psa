import { describe, expect, it } from 'vitest';

import { toClientSinceDate } from './clientSince';

describe('toClientSinceDate', () => {
  it.each(['', null, undefined])('treats %j as "clear the column"', (input) => {
    expect(toClientSinceDate(input)).toBeNull();
  });

  it.each([
    ['2015-06-01', '2015-06-01'],
    [' 2015-06-01 ', '2015-06-01'],
    ['2015-06-01T00:00:00.000Z', '2015-06-01'],
    ['2015-06-01 00:00:00', '2015-06-01'],
  ])('keeps the calendar date of %j', (input, expected) => {
    expect(toClientSinceDate(input)).toBe(expected);
  });

  it('reads a Date with local parts, the way the driver built it from a DATE', () => {
    expect(toClientSinceDate(new Date(2015, 0, 1))).toBe('2015-01-01');
  });

  it.each(['June 2015', '06/01/2015', '2015-02-30', '2015-13-01', 'not a date', 42, new Date('nope')])(
    'rejects %j rather than guessing',
    (input) => {
      expect(toClientSinceDate(input)).toBeUndefined();
    },
  );
});
