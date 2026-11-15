import { describe, expect, it, vi } from 'vitest';
import { createFakeKnex, tenantDbMock, type FakeTables } from './helpers/fakeKnex';

const dbRef = vi.hoisted(() => ({ knex: null as any }));
vi.mock('@alga-psa/core/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: tenantDbMock,
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex })),
}));

import { applyTicketThreadHeaders } from '../BaseEmailService';
import { reconcileOnWireMessageId } from '../reconcileOnWireMessageId';

const T = 'tenant-1';
const ROOT = '<root@customer.example>';
const GEN_1 = '<gen-1@alga.example>';
const GEN_2 = '<gen-2@alga.example>';
const WIRE_1 = '<0100aaa-000000@email.amazonses.com>';
const WIRE_2 = '<0100bbb-000000@email.amazonses.com>';

describe('thread headers after on-wire reconciliation (T002, F002)', () => {
  it('builds In-Reply-To/References from on-wire ids with no replaced generated id left in the chain', async () => {
    const log = (id: number, providerId: string, gen: string) => ({
      id, tenant: T, provider_type: 'resend', provider_message_id: providerId, rfc_message_id: gen,
      entity_type: 'ticket', entity_id: 't1', comment_id: null, comment_thread_id: null,
      to_addresses: JSON.stringify(['customer@example.com']), cc_addresses: null, bcc_addresses: null,
      metadata: {},
    });
    const tables: FakeTables = {
      email_sending_logs: [log(1, 're_1', GEN_1), log(2, 're_2', GEN_2)],
      tickets: [{ tenant: T, ticket_id: 't1', email_metadata: { messageId: ROOT, references: [GEN_1, GEN_2] } }],
      comments: [],
      comment_threads: [],
      users: [],
    };
    dbRef.knex = createFakeKnex(tables, { 'lower(email)': () => false });

    await reconcileOnWireMessageId(dbRef.knex, { tenant: T, providerMessageId: 're_1', onWireMessageId: WIRE_1 });
    await reconcileOnWireMessageId(dbRef.knex, { tenant: T, providerMessageId: 're_2', onWireMessageId: WIRE_2 });

    const headers: Record<string, string> = {};
    await applyTicketThreadHeaders({ tenantId: T, ticketId: 't1', headers, serviceName: 'Test' });

    expect(headers['In-Reply-To']).toBe(WIRE_2);
    expect(headers.References).toBe([ROOT, WIRE_1, WIRE_2].join(' '));
    expect(headers.References).not.toContain('alga.example');
  });
});
