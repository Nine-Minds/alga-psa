import { describe, expect, it } from 'vitest';
import {
  BOARD_DEFAULT_WATCHLIST_MAX_RECIPIENTS,
  BoardDefaultWatchlistValidationError,
  normalizeWatchlistEmail,
  parseBoardDefaultWatchlistInput,
  readBoardDefaultWatchlist,
  withBoardDefaultWatchers,
} from '../boardDefaultWatchlist';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

describe('normalizeWatchlistEmail', () => {
  it('trims and lower-cases valid addresses', () => {
    expect(normalizeWatchlistEmail('  Ops@Example.COM ')).toBe('ops@example.com');
  });
  it.each(['', '   ', 'nope', 'a@', '@b.com', 'a b@c.com', null, undefined, 5])('rejects %p', (value) => {
    expect(normalizeWatchlistEmail(value)).toBeNull();
  });
});

describe('parseBoardDefaultWatchlistInput (write side, strict)', () => {
  it('treats null/undefined as an empty list', () => {
    expect(parseBoardDefaultWatchlistInput(null)).toEqual({ user_ids: [], emails: [] });
    expect(parseBoardDefaultWatchlistInput(undefined)).toEqual({ user_ids: [], emails: [] });
  });

  it('normalises and de-duplicates case-insensitively', () => {
    expect(
      parseBoardDefaultWatchlistInput({ user_ids: [ID_A, ID_A.toUpperCase()], emails: ['A@x.com', ' a@X.com ', 'b@x.com'] })
    ).toEqual({ user_ids: [ID_A], emails: ['a@x.com', 'b@x.com'] });
  });

  it('rejects, rather than drops, an invalid email and reports it', () => {
    try {
      parseBoardDefaultWatchlistInput({ emails: ['ok@x.com', 'bad'] });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BoardDefaultWatchlistValidationError);
      expect((error as BoardDefaultWatchlistValidationError).code).toBe('INVALID_EMAIL');
      expect((error as BoardDefaultWatchlistValidationError).invalidValues).toEqual(['bad']);
    }
  });

  it('rejects malformed user ids and wrong shapes', () => {
    expect(() => parseBoardDefaultWatchlistInput({ user_ids: ['x'] })).toThrow(/invalid user/);
    expect(() => parseBoardDefaultWatchlistInput([])).toThrow(BoardDefaultWatchlistValidationError);
    expect(() => parseBoardDefaultWatchlistInput({ emails: 'a@b.com' })).toThrow(BoardDefaultWatchlistValidationError);
  });

  it('caps the total number of recipients', () => {
    const emails = Array.from({ length: BOARD_DEFAULT_WATCHLIST_MAX_RECIPIENTS }, (_, i) => `u${i}@x.com`);
    expect(parseBoardDefaultWatchlistInput({ emails }).emails).toHaveLength(BOARD_DEFAULT_WATCHLIST_MAX_RECIPIENTS);
    expect(() => parseBoardDefaultWatchlistInput({ user_ids: [ID_A], emails })).toThrow(/at most/);
  });
});

describe('readBoardDefaultWatchlist (read side, lenient)', () => {
  it('accepts parsed and stringified jsonb', () => {
    const doc = { user_ids: [ID_A], emails: ['a@x.com'] };
    expect(readBoardDefaultWatchlist(doc)).toEqual(doc);
    expect(readBoardDefaultWatchlist(JSON.stringify(doc))).toEqual(doc);
  });
  it('never throws; drops bad entries', () => {
    expect(readBoardDefaultWatchlist(null)).toEqual({ user_ids: [], emails: [] });
    expect(readBoardDefaultWatchlist('{not json')).toEqual({ user_ids: [], emails: [] });
    expect(readBoardDefaultWatchlist([1])).toEqual({ user_ids: [], emails: [] });
    expect(readBoardDefaultWatchlist({ user_ids: [ID_A, 'x', 3], emails: ['ok@x.com', 'bad', 1] })).toEqual({
      user_ids: [ID_A],
      emails: ['ok@x.com'],
    });
  });
});

describe('withBoardDefaultWatchers', () => {
  const defaults = [
    { email: 'dl@x.com', active: true, source: 'board_default' },
    { email: 'Ops@x.com', active: true, source: 'board_default' },
  ];

  it('returns attributes untouched when there is nothing to add', () => {
    const attrs = { a: 1 };
    expect(withBoardDefaultWatchers(attrs, [])).toBe(attrs);
    expect(withBoardDefaultWatchers(undefined, [])).toBeUndefined();
    expect(withBoardDefaultWatchers(null, [])).toBeNull();
  });

  it('creates a watch_list on empty attributes and keeps other attributes', () => {
    const result = withBoardDefaultWatchers({ description: 'd' }, defaults) as any;
    expect(result.description).toBe('d');
    expect(result.watch_list.map((w: any) => w.email).sort()).toEqual(['dl@x.com', 'ops@x.com']);
    expect(withBoardDefaultWatchers(null, defaults)).toHaveProperty('watch_list');
  });

  it('does not mutate its input', () => {
    const attrs = { description: 'd' };
    withBoardDefaultWatchers(attrs, defaults);
    expect(attrs).toEqual({ description: 'd' });
  });

  it('existing entries win, including inactive ones', () => {
    const attrs = { watch_list: [{ email: 'DL@x.com', active: false, source: 'manual' }] };
    const result = withBoardDefaultWatchers(attrs, defaults) as any;
    const dl = result.watch_list.find((w: any) => w.email === 'dl@x.com');
    expect(dl).toMatchObject({ active: false, source: 'manual' });
    expect(result.watch_list).toHaveLength(2);
  });

  it('returns the original attributes when every default is already present', () => {
    const attrs = { watch_list: [{ email: 'dl@x.com', active: true }, { email: 'ops@x.com', active: true }] };
    expect(withBoardDefaultWatchers(attrs, defaults)).toBe(attrs);
  });
});
