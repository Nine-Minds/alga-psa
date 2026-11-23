import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: any[] = [];
let insertResult: any[] = [];
let updateResult = 0;
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      const q: any = { name };
      q.insert = (v: any) => { calls.push(['insert', name, v]); return q; };
      q.onConflict = (c: any) => { calls.push(['onConflict', c]); return q; };
      q.ignore = () => q;
      q.returning = () => Promise.resolve(insertResult);
      q.where = (w: any) => { calls.push(['where', w]); return q; };
      q.whereIn = (c: any, v: any) => { calls.push(['whereIn', c, v]); return q; };
      q.update = (u: any) => { calls.push(['update', u]); return Promise.resolve(updateResult); };
      return q;
    },
  }),
}));

import { claimDelivery, finishDelivery, CO_MANAGED_LEDGER, COMMENT_EMAIL_LEDGER, SCHEDULE_REMINDER_LEDGER, scheduleReminderKey } from '../deliveryLedger';
const db: any = { raw: (s: string) => s };

describe('deliveryLedger', () => {
  beforeEach(() => { calls.length = 0; insertResult = []; updateResult = 0; });

  it('fresh insert owns the send', async () => {
    insertResult = [{ comment_id: 'c' }];
    expect(await claimDelivery(db, COMMENT_EMAIL_LEDGER, 't', { comment_id: 'c', recipient: ' A@B.com ' })).toBe(true);
    expect(calls[0][2]).toMatchObject({ recipient: 'a@b.com', state: 'sending', tenant: 't' });
    expect(calls[1][1]).toEqual(['tenant', 'comment_id', 'recipient']);
  });
  it('replay of sent/sending row is not re-claimed', async () => {
    expect(await claimDelivery(db, CO_MANAGED_LEDGER, 't', { delivery_kind: 'comment_email', source_id: 's', recipient: 'x' })).toBe(false);
  });
  it('failed row is re-claimed with attempts+1', async () => {
    updateResult = 1;
    expect(await claimDelivery(db, CO_MANAGED_LEDGER, 't', { delivery_kind: 'k', source_id: 's', recipient: 'x' })).toBe(true);
    expect(calls.find((c) => c[0] === 'update')[1]).toMatchObject({ state: 'sending', attempts: expect.anything() });
  });
  it('co-managed ledger re-claims pending rows without counting an attempt', async () => {
    updateResult = 1;
    await claimDelivery(db, CO_MANAGED_LEDGER, 't', { delivery_kind: 'k', source_id: 's', recipient: 'x' });
    const wh = calls.filter((c) => c[0] === 'whereIn');
    expect(JSON.stringify(wh)).toContain('pending');
  });
  it('finishing as sending records requires_reconciliation (crash/unknown outcome)', async () => {
    await finishDelivery(db, COMMENT_EMAIL_LEDGER, 't', { comment_id: 'c', recipient: 'a@b.com' }, 'sending');
    expect(calls.find((c) => c[0] === 'update')[1]).toMatchObject({ state: 'sending', requires_reconciliation: true });
  });
  it('rejects a key missing a column', async () => {
    await expect(claimDelivery(db, CO_MANAGED_LEDGER, 't', { delivery_kind: 'k' } as any)).rejects.toThrow(/source_id/);
  });

  describe('schedule reminder ledger', () => {
    const start = new Date('2026-11-23T14:45:00.000Z');
    it('builds canonical keys: ISO-8601 UTC timestamp and decimal lead', () => {
      expect(scheduleReminderKey({ entryId: 'e', occurrenceStart: new Date('2026-11-23T09:45:00-05:00'), userId: 'u', leadMinutes: 15 }))
        .toEqual({ entry_id: 'e', occurrence_start: '2026-11-23T14:45:00.000Z', user_id: 'u', lead_minutes: '15' });
      expect(scheduleReminderKey({ entryId: 'e', occurrenceStart: '2026-11-23T14:45:00Z', userId: 'u', leadMinutes: 0 }).lead_minutes).toBe('0');
    });
    it('claim inserts on the tenant-leading PK with canonical values, from raw Date/number keys too', async () => {
      insertResult = [{ entry_id: 'e' }];
      expect(await claimDelivery(db, SCHEDULE_REMINDER_LEDGER, 't', { entry_id: 'e', occurrence_start: start, user_id: 'u', lead_minutes: 0 })).toBe(true);
      expect(calls[0][2]).toMatchObject({ tenant: 't', entry_id: 'e', occurrence_start: '2026-11-23T14:45:00.000Z', user_id: 'u', lead_minutes: '0', state: 'sending' });
      expect(calls[1][1]).toEqual(['tenant', 'entry_id', 'occurrence_start', 'user_id', 'lead_minutes']);
    });
    it('re-claims only failed rows by default and matches the same key', async () => {
      updateResult = 1;
      await claimDelivery(db, SCHEDULE_REMINDER_LEDGER, 't', scheduleReminderKey({ entryId: 'e', occurrenceStart: start, userId: 'u', leadMinutes: 5 }));
      expect(calls.find((c) => c[0] === 'whereIn')[2]).toEqual(['failed']);
      expect(calls.find((c) => c[0] === 'where')[1]).toMatchObject({ occurrence_start: '2026-11-23T14:45:00.000Z', lead_minutes: '5' });
    });
    it('rejects non-integer leads and invalid dates', async () => {
      await expect(claimDelivery(db, SCHEDULE_REMINDER_LEDGER, 't', { entry_id: 'e', occurrence_start: start, user_id: 'u', lead_minutes: 1.5 })).rejects.toThrow(/lead_minutes/);
      await expect(claimDelivery(db, SCHEDULE_REMINDER_LEDGER, 't', { entry_id: 'e', occurrence_start: new Date('x'), user_id: 'u', lead_minutes: 5 })).rejects.toThrow(/occurrence_start/);
      expect(() => scheduleReminderKey({ entryId: 'e', occurrenceStart: 'nope', userId: 'u', leadMinutes: 5 })).toThrow(/occurrence_start/);
    });
  });
});
