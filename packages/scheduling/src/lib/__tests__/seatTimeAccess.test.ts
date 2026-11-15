import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ mode: 'commercial' as 'commercial' | 'operational' }));
vi.mock('../timeEntryMode', () => ({ resolveTimeEntryMode: async () => h.mode }));

import { SeatTimeAccessError, assertSeatOwnOperationalEntry, assertTimesheetSubmissionAvailable, isSeatTimePrincipal } from '../seatTimeAccess';
import { commercialEntriesOnly, excludeOperationalOnlyTimeSheets } from '../timeApprovalScope';

describe('seat time access (F070)', () => {
  it('allows only the technician\'s own operational entry', () => {
    expect(() => assertSeatOwnOperationalEntry({ user_id: 'u1', billing_mode: 'operational' }, 'u1')).not.toThrow();
    expect(() => assertSeatOwnOperationalEntry({ user_id: 'u2', billing_mode: 'operational' }, 'u1')).toThrow(SeatTimeAccessError);
    expect(() => assertSeatOwnOperationalEntry({ user_id: 'u1', billing_mode: 'commercial' }, 'u1')).toThrow(/own operational/);
    expect(() => assertSeatOwnOperationalEntry({ user_id: 'u1' }, 'u1')).toThrow(SeatTimeAccessError);
  });

  it('refusals read as permission errors the action boundary converts', () => {
    expect(() => assertSeatOwnOperationalEntry({ user_id: 'u2', billing_mode: 'operational' }, 'u1')).toThrow(/^Permission denied:/);
  });

  it('refuses submission for a seat principal only', async () => {
    h.mode = 'operational';
    await expect(assertTimesheetSubmissionAvailable({} as any, 't', 'u1')).rejects.toThrow(/^Permission denied:/);
    expect(await isSeatTimePrincipal({} as any, 't', 'u1')).toBe(true);
    h.mode = 'commercial';
    await expect(assertTimesheetSubmissionAvailable({} as any, 't', 'u1')).resolves.toBeUndefined();
    expect(await isSeatTimePrincipal({} as any, 't', 'u1')).toBe(false);
  });
});

describe('approval scope helpers', () => {
  const recorder = () => { const calls: string[] = []; const q: any = { whereRaw: (sql: string) => { calls.push(sql); return q; } }; return { q, calls }; };

  it('commercialEntriesOnly adds the shared predicate on the given alias', () => {
    const { q, calls } = recorder();
    commercialEntriesOnly(q, 'te');
    expect(calls).toEqual(["te.billing_mode <> 'operational'"]);
  });

  it('the approval queue skips a sheet whose every entry is operational', () => {
    const { q, calls } = recorder();
    excludeOperationalOnlyTimeSheets(q);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/NOT \(EXISTS .*billing_mode.*AND NOT EXISTS/s);
    expect(calls[0]).toContain('time_sheets.id');
  });
});
