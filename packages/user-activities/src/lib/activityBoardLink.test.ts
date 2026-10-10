import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_BOARD_PARAM,
  ACTIVITY_BOARD_PATH,
  buildActivityBoardHref,
  buildActivityKey,
  parseActivityKey,
} from './activityBoardLink';

describe('activityBoardLink', () => {
  it('builds /msp/user-activities?activity=<type>:<id>', () => {
    const href = buildActivityBoardHref('ticket', 'abc-123');
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe(ACTIVITY_BOARD_PATH);
    expect(url.searchParams.get(ACTIVITY_BOARD_PARAM)).toBe('ticket:abc-123');
  });

  it('round-trips through parseActivityKey for each linked type', () => {
    for (const type of ['ticket', 'projectTask']) {
      const id = '11111111-2222-3333-4444-555555555555';
      const key = new URL(buildActivityBoardHref(type, id), 'http://x').searchParams.get(ACTIVITY_BOARD_PARAM);
      expect(parseActivityKey(key)).toEqual({ type, id });
    }
  });

  it('round-trips ids that contain a colon or need URL encoding', () => {
    const id = 'a:b c&d=e';
    const key = new URL(buildActivityBoardHref('ticket', id), 'http://x').searchParams.get(ACTIVITY_BOARD_PARAM);
    expect(parseActivityKey(key)).toEqual({ type: 'ticket', id });
  });

  it('parseActivityKey rejects malformed values', () => {
    for (const bad of [null, undefined, '', 'ticket', ':id', 'ticket:']) {
      expect(parseActivityKey(bad as any)).toBeNull();
    }
  });

  it('uses the same key shape as the grouped view rows', () => {
    expect(buildActivityKey('ticket', '1')).toBe('ticket:1');
  });
});
