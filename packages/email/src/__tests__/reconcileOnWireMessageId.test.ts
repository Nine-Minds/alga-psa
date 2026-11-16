import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeKnex, tenantDbMock, type FakeTables } from './helpers/fakeKnex';

const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: logger }));
vi.mock('@alga-psa/db', () => ({ tenantDb: tenantDbMock, createTenantKnex: vi.fn() }));

import { reconcileOnWireMessageId } from '../reconcileOnWireMessageId';
import { onWireMessageIdFields, replaceMessageIdInList } from '../onWireMessageId';

const T1 = 'tenant-1';
const T2 = 'tenant-2';
const GEN = '<gen-1@perceptiveit.net>';
const GEN_OTHER = '<gen-0@perceptiveit.net>';
const WIRE = '<0100019abc-def-000000@email.amazonses.com>';

function seed(): FakeTables {
  const log = (tenant: string, over: Record<string, unknown> = {}) => ({
    id: tenant === T1 ? 1 : 2,
    tenant,
    provider_type: 'resend',
    provider_message_id: 're_123', // same provider id in both tenants
    rfc_message_id: GEN,
    entity_type: 'ticket',
    entity_id: `ticket-${tenant}`,
    comment_thread_id: `thread-${tenant}`,
    metadata: { algaDiagnostics: { outbound: { rfcMessageId: GEN, ticketId: `ticket-${tenant}` } } },
    ...over,
  });
  return {
    email_sending_logs: [log(T1), log(T2)],
    comment_threads: [T1, T2].map((tenant) => ({
      tenant,
      thread_id: `thread-${tenant}`,
      email_message_id: GEN,
      email_references: [GEN_OTHER, GEN],
    })),
    tickets: [T1, T2].map((tenant) => ({
      tenant,
      ticket_id: `ticket-${tenant}`,
      email_metadata: { messageId: '<customer@x.com>', threadRoot: '<ticket-1@d>', references: ['<customer@x.com>', GEN_OTHER, GEN] },
    })),
  };
}

// Stored-copy rewrites (comment_threads / tickets) run as SQL; see onWireMessageIdStoredCopies.integration.test.ts.
describe('reconcileOnWireMessageId (T001, F001/F002)', () => {
  let tables: FakeTables;
  let knex: any;
  beforeEach(() => {
    logger.warn.mockClear();
    tables = seed();
    knex = createFakeKnex(tables);
  });
  const t1 = () => ({
    log: tables.email_sending_logs.find((r) => r.tenant === T1)!,
    thread: tables.comment_threads.find((r) => r.tenant === T1)!,
    ticket: tables.tickets.find((r) => r.tenant === T1)!,
  });
  const t2 = () => ({
    log: tables.email_sending_logs.find((r) => r.tenant === T2)!,
    thread: tables.comment_threads.find((r) => r.tenant === T2)!,
    ticket: tables.tickets.find((r) => r.tenant === T2)!,
  });

  it('records the on-wire id, keeps the generated id, and never touches another tenant with the same provider_message_id', async () => {
    const before2 = JSON.stringify(t2());
    const result = await reconcileOnWireMessageId(knex, { tenant: T1, providerMessageId: 're_123', onWireMessageId: WIRE });

    expect(result).toMatchObject({ status: 'recorded', rowsMatched: 1, rowsRecorded: 1 });
    const { log } = t1();
    expect(log.rfc_message_id).toBe(WIRE);
    expect(log.metadata.generatedRfcMessageId).toBe(GEN);
    expect(log.metadata.onWireMessageId).toBe(WIRE);
    expect(log.metadata.algaDiagnostics.outbound.rfcMessageId).toBe(WIRE);
    expect(JSON.stringify(t2())).toBe(before2);
  });

  it('is idempotent', async () => {
    const input = { tenant: T1, providerMessageId: 're_123', onWireMessageId: WIRE };
    await reconcileOnWireMessageId(knex, input);
    const snapshot = JSON.stringify(tables);
    const again = await reconcileOnWireMessageId(knex, input);
    expect(again.status).toBe('unchanged');
    // bracket / domain-case variants of the same id are the same id
    const variant = await reconcileOnWireMessageId(knex, { ...input, onWireMessageId: '0100019abc-def-000000@EMAIL.amazonses.com' });
    expect(variant.status).toBe('unchanged');
    expect(JSON.stringify(tables)).toBe(snapshot);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps the first on-wire id when offered a different one, and warns', async () => {
    await reconcileOnWireMessageId(knex, { tenant: T1, providerMessageId: 're_123', onWireMessageId: WIRE });
    const snapshot = JSON.stringify(tables);
    const result = await reconcileOnWireMessageId(knex, {
      tenant: T1,
      providerMessageId: 're_123',
      onWireMessageId: '<other@email.amazonses.com>',
    });
    expect(result.status).toBe('conflict');
    expect(JSON.stringify(tables)).toBe(snapshot);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('treats a row recorded by the synchronous SMTP SES path as already recorded', async () => {
    tables.email_sending_logs[0].rfc_message_id = WIRE;
    tables.email_sending_logs[0].metadata = { generatedRfcMessageId: GEN, sesMessageId: WIRE };
    const result = await reconcileOnWireMessageId(knex, { tenant: T1, providerMessageId: 're_123', onWireMessageId: '<x@email.amazonses.com>' });
    expect(result.status).toBe('conflict');
    expect(t1().log.rfc_message_id).toBe(WIRE);
  });

  it('reports not_found / invalid without writing', async () => {
    const snapshot = JSON.stringify(tables);
    expect((await reconcileOnWireMessageId(knex, { tenant: T1, providerMessageId: 'nope', onWireMessageId: WIRE })).status).toBe('not_found');
    expect((await reconcileOnWireMessageId(knex, { tenant: T1, providerMessageId: 're_123', onWireMessageId: 'not an id' })).status).toBe('invalid');
    expect((await reconcileOnWireMessageId(knex, { tenant: '', providerMessageId: 're_123', onWireMessageId: WIRE })).status).toBe('invalid');
    expect(JSON.stringify(tables)).toBe(snapshot);
  });
});

describe('shared on-wire contract helpers (F007)', () => {
  it('onWireMessageIdFields matches the SMTP SES shape', () => {
    expect(onWireMessageIdFields('<g@a.test>', '<w@email.amazonses.com>')).toEqual({
      rfcMessageId: '<w@email.amazonses.com>',
      metadata: { onWireMessageId: '<w@email.amazonses.com>', generatedRfcMessageId: '<g@a.test>' },
    });
    expect(onWireMessageIdFields('<g@a.test>', null)).toEqual({});
    expect(onWireMessageIdFields('<g@a.test>', 'g@A.TEST')).toEqual({});
  });

  it('replaceMessageIdInList replaces one element and de-duplicates', () => {
    expect(replaceMessageIdInList(['<a@x>', '<g@y>', '<w@z>'], 'g@Y', '<w@z>')).toEqual(['<a@x>', '<w@z>']);
    expect(replaceMessageIdInList(['<a@x>'], '<g@y>', '<w@z>')).toBeNull();
  });
});
