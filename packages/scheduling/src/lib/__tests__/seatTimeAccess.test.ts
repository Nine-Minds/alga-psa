import knex from 'knex';
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

  it('the approval queue skips a sheet whose every entry is operational, probing operational entries through the read scope', () => {
    const sql = knex({ client: 'pg' });
    const applied: string[] = [];
    const scope: any = {
      narrowed: true,
      subject: null,
      apply: (builder: any) => { applied.push('apply'); builder.whereRaw('op_te.user_id = ?', ['scope-user']); },
      applyWith: () => { throw new Error('not used'); },
    };
    const query = sql('time_sheets').select('time_sheets.id');
    excludeOperationalOnlyTimeSheets(query, scope);
    const text = query.toSQL().toNative().sql;
    expect(applied).toEqual(['apply']);
    // NOT EXISTS (a readable operational entry) OR EXISTS (a commercial entry): never hides a sheet with commercial work.
    expect(text).toMatch(/not exists \(select 1 from "time_entries" as "op_te" where op_te\.tenant = time_sheets\.tenant AND op_te\.time_sheet_id = time_sheets\.id and NOT \(op_te\.billing_mode <> 'operational'\) and op_te\.user_id = \$1\) or exists \(select 1 from "time_entries" as "co_te" where co_te\.tenant = time_sheets\.tenant AND co_te\.time_sheet_id = time_sheets\.id and co_te\.billing_mode <> 'operational'\)/);
    // The read scope narrows the operational probe only.
    expect(text.slice(text.indexOf('"co_te"'))).not.toContain('scope-user');
    expect(text.slice(text.indexOf('"co_te"'))).not.toContain('$1');
  });
});
