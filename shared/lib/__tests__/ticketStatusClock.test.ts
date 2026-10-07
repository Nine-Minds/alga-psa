import { describe, expect, it, vi } from 'vitest';
import { ticketStatusClockPatch, ticketStatusClockPatchFromSql } from '../ticketStatusClock';

function fakeDb() {
  return { raw: vi.fn((sql: string, bindings?: unknown[]) => ({ __raw: true, sql, bindings })) } as any;
}

describe('ticketStatusClockPatch', () => {
  it('returns an empty patch when the status is not being written', () => {
    const db = fakeDb();
    expect(ticketStatusClockPatch(db, undefined)).toEqual({});
    expect(db.raw).not.toHaveBeenCalled();
  });

  it('moves the clock only when the status differs from the pre-update row', () => {
    const db = fakeDb();
    const patch = ticketStatusClockPatch(db, 'status-2');

    expect(db.raw).toHaveBeenCalledTimes(1);
    expect(db.raw).toHaveBeenCalledWith(
      'CASE WHEN status_id IS DISTINCT FROM ?::uuid THEN now() ELSE status_changed_at END',
      ['status-2']
    );
    expect(patch).toEqual({
      status_changed_at: {
        __raw: true,
        sql: 'CASE WHEN status_id IS DISTINCT FROM ?::uuid THEN now() ELSE status_changed_at END',
        bindings: ['status-2'],
      },
    });
  });
});

describe('ticketStatusClockPatchFromSql', () => {
  it('wraps the status expression and forwards its bindings', () => {
    const db = fakeDb();
    ticketStatusClockPatchFromSql(db, 'SELECT status_id FROM statuses WHERE name = ?', ['Closed']);

    expect(db.raw).toHaveBeenCalledWith(
      'CASE WHEN status_id IS DISTINCT FROM (SELECT status_id FROM statuses WHERE name = ?) THEN now() ELSE status_changed_at END',
      ['Closed']
    );
  });

  it('defaults to no bindings', () => {
    const db = fakeDb();
    ticketStatusClockPatchFromSql(db, 'some_column');
    expect(db.raw).toHaveBeenCalledWith(expect.stringContaining('(some_column)'), []);
  });
});
