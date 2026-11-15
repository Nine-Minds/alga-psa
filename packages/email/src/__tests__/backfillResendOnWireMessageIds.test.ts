import { describe, expect, it, vi } from 'vitest';
import { createFakeKnex, tenantDbMock, type FakeTables, type Row } from './helpers/fakeKnex';

vi.mock('@alga-psa/core/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@alga-psa/db', () => ({ tenantDb: tenantDbMock }));

import { backfillResendOnWireMessageIds, type ResendRetrieve } from '../backfillResendOnWireMessageIds';

const T = 'tenant-1';
const row = (id: number, providerId: string, over: Row = {}): Row => ({
  id, tenant: T, provider_type: 'resend', status: 'sent', provider_message_id: providerId,
  rfc_message_id: `<gen-${id}@alga.test>`, entity_type: 'ticket', entity_id: 't1', comment_thread_id: null, metadata: {}, ...over,
});

// The fake cannot evaluate SQL; this mirrors the candidate query's "not yet recorded" predicate.
const rawFilters = {
  onWireMessageId: (r: Row) => !r.metadata?.onWireMessageId && !r.metadata?.generatedRfcMessageId && !r.metadata?.sesMessageId,
};

function setup() {
  const tables: FakeTables = {
    email_sending_logs: [
      row(1, 're_found'),
      row(2, 're_gone'), // Resend no longer returns it
      row(3, 're_pending'), // message_id still null
      row(4, 're_smtp', { provider_type: 'smtp' }),
      row(5, 're_other_tenant', { tenant: 'tenant-2' }),
      row(6, 're_done', { rfc_message_id: '<w@email.amazonses.com>', metadata: { onWireMessageId: '<w@email.amazonses.com>' } }),
    ],
    comment_threads: [],
    tickets: [{ tenant: T, ticket_id: 't1', email_metadata: { references: ['<gen-1@alga.test>', '<x@y>'] } }],
  };
  const knex = createFakeKnex(tables, rawFilters);
  const retrieve = vi.fn<ResendRetrieve>(async (id) => {
    if (id === 're_found') return { kind: 'found', messageId: '<0100abc-000000@email.amazonses.com>' };
    if (id === 're_pending') return { kind: 'found', messageId: null };
    return { kind: 'not_found' };
  });
  return { tables, knex, retrieve };
}

describe('backfillResendOnWireMessageIds (T006, F006)', () => {
  it('updates rows Resend returns, leaves the rest, and a second run changes nothing', async () => {
    const { tables, knex, retrieve } = setup();
    const sleep = vi.fn(async () => undefined);

    const first = await backfillResendOnWireMessageIds(knex, { tenant: T, retrieve, sleep });
    expect(first).toMatchObject({ candidates: 3, recorded: 1, notReturnedByResend: 1, noMessageIdYet: 1, errors: 0 });
    expect(tables.email_sending_logs[0].rfc_message_id).toBe('<0100abc-000000@email.amazonses.com>');
    expect(tables.email_sending_logs[0].metadata.generatedRfcMessageId).toBe('<gen-1@alga.test>');
    expect(tables.tickets[0].email_metadata.references).toEqual(['<0100abc-000000@email.amazonses.com>', '<x@y>']);
    // untouched: Resend does not return it, other provider, other tenant, already recorded
    expect(tables.email_sending_logs[1].rfc_message_id).toBe('<gen-2@alga.test>');
    expect(tables.email_sending_logs[3].rfc_message_id).toBe('<gen-4@alga.test>');
    expect(tables.email_sending_logs[4].rfc_message_id).toBe('<gen-5@alga.test>');
    expect(retrieve).not.toHaveBeenCalledWith('re_other_tenant');
    expect(retrieve).not.toHaveBeenCalledWith('re_smtp');
    expect(retrieve).not.toHaveBeenCalledWith('re_done');

    const snapshot = JSON.stringify(tables);
    const second = await backfillResendOnWireMessageIds(knex, { tenant: T, retrieve, sleep });
    expect(second.recorded).toBe(0);
    expect(JSON.stringify(tables)).toBe(snapshot);
  });

  it('backs off on 429 using Retry-After and then succeeds', async () => {
    const { knex } = setup();
    const sleep = vi.fn(async () => undefined);
    const retrieve = vi
      .fn<ResendRetrieve>()
      .mockResolvedValueOnce({ kind: 'rate_limited', retryAfterMs: 7000 })
      .mockResolvedValue({ kind: 'not_found' });
    const summary = await backfillResendOnWireMessageIds(knex, { tenant: T, retrieve, sleep, limit: 1 });
    expect(sleep).toHaveBeenCalledWith(7000);
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(summary.errors).toBe(0);
  });

  it('can resume from a cursor and supports dry-run', async () => {
    const { tables, knex, retrieve } = setup();
    const dry = await backfillResendOnWireMessageIds(knex, { tenant: T, retrieve, sleep: async () => undefined, dryRun: true });
    expect(dry.wouldRecord).toBe(1);
    expect(tables.email_sending_logs[0].rfc_message_id).toBe('<gen-1@alga.test>');

    retrieve.mockClear();
    const resumed = await backfillResendOnWireMessageIds(knex, { tenant: T, retrieve, sleep: async () => undefined, afterId: 1 });
    expect(retrieve).not.toHaveBeenCalledWith('re_found');
    expect(resumed.candidates).toBe(2);
  });
});
