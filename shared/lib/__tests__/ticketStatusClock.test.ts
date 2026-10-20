import { describe, expect, it, vi } from 'vitest';
import { ticketStatusClockPatch, ticketStatusClockPatchFromSql } from '../ticketStatusClock';

const AT = new Date('2026-10-13T10:00:00.000Z');
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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
    const patch = ticketStatusClockPatch(db, 'status-2', AT);

    expect(db.raw).toHaveBeenCalledTimes(1);
    expect(patch).toEqual({
      status_changed_at: {
        __raw: true,
        sql: 'CASE WHEN status_id IS DISTINCT FROM ?::uuid THEN ?::timestamptz ELSE status_changed_at END',
        bindings: ['status-2', '2026-10-13T10:00:00.000Z'],
      },
    });
  });

  it('binds the current time as a parameter instead of calling now() inside the CASE (Citus)', () => {
    const db = fakeDb();
    ticketStatusClockPatch(db, 'status-2');
    const [sql, bindings] = db.raw.mock.calls[0];
    expect(sql).not.toMatch(/now\(\)|CURRENT_TIMESTAMP/i);
    expect(bindings[1]).toMatch(ISO_RE);
  });

  it('accepts a preformatted ISO string', () => {
    const db = fakeDb();
    ticketStatusClockPatch(db, 'status-2', '2026-01-01T00:00:00.000Z');
    expect(db.raw.mock.calls[0][1]).toEqual(['status-2', '2026-01-01T00:00:00.000Z']);
  });
});

describe('ticketStatusClockPatchFromSql', () => {
  it('wraps the status expression and appends the timestamp after its bindings', () => {
    const db = fakeDb();
    ticketStatusClockPatchFromSql(db, 'SELECT status_id FROM statuses WHERE name = ?', ['Closed'], AT);

    expect(db.raw).toHaveBeenCalledWith(
      'CASE WHEN status_id IS DISTINCT FROM (SELECT status_id FROM statuses WHERE name = ?) THEN ?::timestamptz ELSE status_changed_at END',
      ['Closed', '2026-10-13T10:00:00.000Z']
    );
  });

  it('defaults to no status bindings and the current time', () => {
    const db = fakeDb();
    ticketStatusClockPatchFromSql(db, 'some_column');
    const [sql, bindings] = db.raw.mock.calls[0];
    expect(sql).toContain('(some_column)');
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatch(ISO_RE);
  });
});
