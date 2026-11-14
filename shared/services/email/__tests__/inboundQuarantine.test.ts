import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory stand-in for the tenant-scoped admin transaction: just enough
 * query-builder surface for recordInboundQuarantine (email_providers /
 * tickets lookups, the dedupe probe, the daily-cap count and the insert).
 */
const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, any>>,
  failDb: false,
  mailbox: 'support@msp.example',
  ticketNumber: 'TIC-1042' as string | null,
}));

vi.mock('../tenantAdminTransaction', () => ({
  withTenantAdminTransaction: async (_tenant: string, cb: (trx: any, db: any) => Promise<any>) => {
    if (state.failDb) throw new Error('db down');
    const trx = { raw: (sql: string) => sql };
    const db = {
      table(name: string) {
        const filters: Record<string, any> = {};
        const b: any = {
          where(a: any) { if (typeof a === 'object') Object.assign(filters, a); return b; },
          first: async () => {
            if (name === 'email_providers') return { mailbox: state.mailbox };
            if (name === 'tickets') return state.ticketNumber ? { ticket_number: state.ticketNumber } : undefined;
            if (name === 'inbound_email_quarantine') {
              if (b._count) return { count: String(state.rows.filter((r) => r.provider_id === filters.provider_id).length) };
              return state.rows.find((r) => r.provider_id === filters.provider_id && r.message_id_hash === filters.message_id_hash);
            }
            return undefined;
          },
          count() { b._count = true; return b; },
          insert(row: any) { b._row = row; return b; },
          onConflict() { return b; },
          ignore() { return b; },
          returning: async () => {
            const dup = state.rows.find((r) => r.provider_id === b._row.provider_id && r.message_id_hash === b._row.message_id_hash);
            if (dup) return [];
            state.rows.push(b._row);
            return [{ id: b._row.id }];
          },
        };
        // `where('col', op, value)` form used by the cap query is accepted and ignored.
        const origWhere = b.where;
        b.where = (...args: any[]) => (args.length === 1 ? origWhere(args[0]) : b);
        return b;
      },
    };
    return cb(trx, db);
  },
}));

import {
  QUARANTINE_DAILY_ROW_CAP_PER_MAILBOX,
  QUARANTINE_REASONS,
  QUARANTINE_SUBJECT_MAX_LENGTH,
  assertInboundQuarantineNotifierRegistered,
  clearInboundQuarantineNotifier,
  dispatchInboundQuarantineNotification,
  hashQuarantineMessageId,
  recordInboundQuarantine,
  registerInboundQuarantineNotifier,
  surfaceInboundQuarantine,
  truncateQuarantineSubject,
  type InboundQuarantineRecordInput,
} from '../inboundQuarantine';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PROVIDER = '22222222-2222-4222-8222-222222222222';
const TICKET = '33333333-3333-4333-8333-333333333333';

const input = (overrides: Partial<InboundQuarantineRecordInput> = {}): InboundQuarantineRecordInput => ({
  tenant: TENANT,
  providerId: PROVIDER,
  messageId: '<abc@mail.example>',
  sender: 'stranger@evil.example',
  subject: 'Re: printer',
  receivedAt: '2026-11-14T10:00:00.000Z',
  reason: 'unauthorized_thread_header_sender',
  matchedBy: 'thread_headers',
  ticketId: TICKET,
  ...overrides,
});

beforeEach(() => {
  state.rows = [];
  state.failDb = false;
  clearInboundQuarantineNotifier();
  vi.restoreAllMocks();
});

describe('subject truncation and Message-ID hashing', () => {
  it('leaves short subjects alone and truncates long ones to the cap with an ellipsis', () => {
    expect(truncateQuarantineSubject('  Hello  ')).toBe('Hello');
    expect(truncateQuarantineSubject(null)).toBe('');
    const long = 'x'.repeat(QUARANTINE_SUBJECT_MAX_LENGTH + 50);
    const out = truncateQuarantineSubject(long);
    expect(out).toHaveLength(QUARANTINE_SUBJECT_MAX_LENGTH);
    expect(out.endsWith('…')).toBe(true);
  });

  it('hashes the normalized Message-ID with sha256 so bracketed and bare forms dedupe together', () => {
    const expected = createHash('sha256').update('abc@mail.example').digest('hex');
    expect(hashQuarantineMessageId('<abc@mail.example>')).toBe(expected);
    expect(hashQuarantineMessageId('abc@mail.example')).toBe(expected);
    expect(hashQuarantineMessageId('<other@mail.example>')).not.toBe(expected);
  });
});

describe('surfaceInboundQuarantine', () => {
  it.each(QUARANTINE_REASONS)('reason %s persists one row and produces exactly one dispatch', async (reason) => {
    const notifier = vi.fn(async () => undefined);
    registerInboundQuarantineNotifier(notifier);

    await surfaceInboundQuarantine(input({ reason, messageId: `<${reason}@mail>` }));

    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ reason, status: 'open', mailbox: 'support@msp.example', ticket_number: 'TIC-1042' });
    expect(notifier).toHaveBeenCalledTimes(1);
    expect(notifier.mock.calls[0][0]).toMatchObject({ tenant: TENANT, reason, mailbox: 'support@msp.example', ticketNumber: 'TIC-1042' });
  });

  it('stores the row even when no notifier is registered (persistence does not depend on the hook)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await surfaceInboundQuarantine(input());
    expect(state.rows).toHaveLength(1);
  });

  it('never stores bodies or raw headers: only the documented columns are written', async () => {
    await surfaceInboundQuarantine(input());
    expect(Object.keys(state.rows[0]).sort()).toEqual([
      'id', 'mailbox', 'matched_by', 'message_id_hash', 'provider_id', 'quarantined_at', 'reason',
      'received_at', 'sender', 'status', 'subject', 'tenant', 'ticket_id', 'ticket_number',
    ]);
  });

  it('redelivery of the same Message-ID dedupes: one row, one notification', async () => {
    const notifier = vi.fn(async () => undefined);
    registerInboundQuarantineNotifier(notifier);
    await surfaceInboundQuarantine(input());
    await surfaceInboundQuarantine(input({ messageId: 'abc@mail.example' }));
    expect(state.rows).toHaveLength(1);
    expect(notifier).toHaveBeenCalledTimes(1);
  });

  it('a failing notifier is swallowed and the row is still recorded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registerInboundQuarantineNotifier(async () => { throw new Error('bus down'); });
    await expect(surfaceInboundQuarantine(input())).resolves.toBeUndefined();
    expect(state.rows).toHaveLength(1);
  });

  it('a failing database is logged and swallowed, never thrown into the caller', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const notifier = vi.fn(async () => undefined);
    registerInboundQuarantineNotifier(notifier);
    state.failDb = true;
    await expect(surfaceInboundQuarantine(input())).resolves.toBeUndefined();
    expect(notifier).not.toHaveBeenCalled();
  });

  it('stops storing once the per-mailbox daily cap is reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.rows = Array.from({ length: QUARANTINE_DAILY_ROW_CAP_PER_MAILBOX }, (_, i) => ({
      provider_id: PROVIDER, message_id_hash: `h${i}`,
    }));
    const result = await recordInboundQuarantine(input());
    expect(result.status).toBe('capped');
    expect(state.rows).toHaveLength(QUARANTINE_DAILY_ROW_CAP_PER_MAILBOX);
  });
});

describe('notifier hook', () => {
  it('dispatch swallows a throwing notifier', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registerInboundQuarantineNotifier(async () => { throw new Error('boom'); });
    await expect(dispatchInboundQuarantineNotification({} as any)).resolves.toBeUndefined();
  });

  it('assert logs loudly but does not throw when nothing is registered', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(assertInboundQuarantineNotifierRegistered('test-entrypoint')).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('NO inbound quarantine notifier'), expect.objectContaining({ entrypoint: 'test-entrypoint' }));
    registerInboundQuarantineNotifier(async () => undefined);
    expect(assertInboundQuarantineNotifierRegistered('test-entrypoint')).toBe(true);
  });
});

describe('processInboundEmailInApp choke point', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../processInboundEmailInApp.ts'), 'utf8');

  it("builds a quarantined result in exactly one place (the helper) besides the type declaration", () => {
    const hits = source.split('\n').filter((line) => line.includes("outcome: 'quarantined'"));
    // one type member (`outcome: 'quarantined';`) + the helper's result literal
    expect(hits.filter((l) => l.trim().endsWith(';'))).toHaveLength(1);
    expect(hits.filter((l) => l.trim().endsWith(','))).toHaveLength(1);
  });

  it('derives the reason union from the closed QUARANTINE_REASONS list', () => {
    expect(source).toContain('reason: QuarantineReason;');
  });
});
