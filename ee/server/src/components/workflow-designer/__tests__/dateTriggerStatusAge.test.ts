import { describe, expect, it } from 'vitest';
import { isStatusNameAvailable, parseDayCount, statusNameOptions } from '../dateTriggerStatusAge';

const statuses = [
  { id: 's1', name: 'Waiting for client', board_id: 'b1' },
  { id: 's2', name: 'waiting for client', board_id: 'b2' },
  { id: 's3', name: 'In progress', board_id: 'b1' },
  { id: 's4', name: 'Escalated', board_id: 'b2' },
];

describe('status-age trigger controls', () => {
  it('offers distinct status names (case-insensitive) across boards', () => {
    expect(statusNameOptions(statuses, null).map((o) => o.value)).toEqual(['Escalated', 'In progress', 'Waiting for client']);
  });

  it('narrows to the chosen board', () => {
    expect(statusNameOptions(statuses, 'b1').map((o) => o.value)).toEqual(['In progress', 'Waiting for client']);
    expect(statusNameOptions(statuses, 'b2').map((o) => o.value)).toEqual(['Escalated', 'waiting for client']);
  });

  it('reports a status name the chosen board does not have', () => {
    expect(isStatusNameAvailable(statuses, 'b2', 'Escalated')).toBe(true);
    expect(isStatusNameAvailable(statuses, 'b2', 'In progress')).toBe(false);
    expect(isStatusNameAvailable(statuses, null, 'waiting FOR client')).toBe(true);
  });

  it('clamps day counts to 1..365', () => {
    expect(parseDayCount('')).toBeNull();
    expect(parseDayCount('0')).toBe(1);
    expect(parseDayCount('400')).toBe(365);
    expect(parseDayCount('7.9')).toBe(7);
  });
});

describe('closed statuses', () => {
  const statuses = [
    { id: '1', name: 'Open', board_id: 'a', is_closed: false },
    { id: '2', name: 'SMOKE Closed', board_id: 'a', is_closed: true },
    { id: '3', name: 'Shared', board_id: 'a', is_closed: true },
    { id: '4', name: 'shared', board_id: 'b', is_closed: false },
  ];
  const names = (boardId: string | null) => statusNameOptions(statuses, boardId).map((o) => o.value);

  it('excludes a closed status', () => {
    expect(names(null)).not.toContain('SMOKE Closed');
    expect(names(null)).toContain('Open');
  });

  it('keeps a name that is closed on one board but open on another when no board is selected', () => {
    expect(names(null)).toContain('shared');
  });

  it('excludes that name when the board where it is closed is selected', () => {
    expect(names('a')).toEqual(['Open']);
    expect(names('b')).toEqual(['shared']);
  });
});
