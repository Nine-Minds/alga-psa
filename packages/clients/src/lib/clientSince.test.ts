import { describe, expect, it } from 'vitest';

import { clientSinceInputValue, toClientSinceDate, withClientSinceDateString } from './clientSince';

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

describe('clientSinceInputValue', () => {
  it.each([
    ['2011-03-17', '2011-03-17'],
    [' 2011-03-17 ', '2011-03-17'],
    ['2011-03-17T00:00:00.000Z', '2011-03-17'],
  ])('shows %j as %j', (input, expected) => {
    expect(clientSinceInputValue(input)).toBe(expected);
  });

  it('shows nothing rather than guess a day from a Date', () => {
    // A Date read off a DATE column is the server's midnight. Reading it here
    // would use the browser's timezone and show the day before; the actions
    // normalize to a string so the picker never has to.
    expect(clientSinceInputValue(new Date(2011, 2, 17))).toBe('');
  });

  it.each([null, undefined, '', 'March 2011', 42])('shows nothing for %j', (input) => {
    expect(clientSinceInputValue(input)).toBe('');
  });
});

describe('withClientSinceDateString', () => {
  it('turns the driver Date into the calendar date it was read from', () => {
    // pg builds DATE columns at the server's midnight. Leaving that Date on the
    // row lets the browser read it with its own timezone — a day early whenever
    // it sits west of the server.
    const row = withClientSinceDateString({ client_id: 'c1', client_since: new Date(2011, 2, 17) });

    expect(row.client_since).toBe('2011-03-17');
  });

  it('leaves a date already shaped as a string alone', () => {
    expect(withClientSinceDateString({ client_since: '2011-03-17' }).client_since).toBe('2011-03-17');
  });

  it('keeps an unset date null', () => {
    expect(withClientSinceDateString({ client_since: null }).client_since).toBeNull();
  });

  it('leaves rows that never selected the column untouched', () => {
    const row = { client_id: 'c1' };

    expect(withClientSinceDateString(row)).toBe(row);
  });

  it('does not disturb the rest of the row', () => {
    const row = withClientSinceDateString({
      client_id: 'c1',
      client_name: 'Emerald City',
      client_since: new Date(2011, 2, 17),
    });

    expect(row).toEqual({ client_id: 'c1', client_name: 'Emerald City', client_since: '2011-03-17' });
  });
});
