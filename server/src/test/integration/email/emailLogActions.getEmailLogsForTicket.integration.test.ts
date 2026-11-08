import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { resetTenantConnectionPool, tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../../test-utils/testDataFactory';

let mockTenantId = 'tenant-test';
let authorizedReaderId: string;

vi.mock('@alga-psa/auth', () => ({
  hasPermission: async () => true,
  withAuth: (fn: any) => async (...args: any[]) =>
    fn({ user_id: authorizedReaderId, tenant: mockTenantId, user_type: 'internal', roles: [] }, { tenant: mockTenantId }, ...args),
}));

import { getEmailLogsForTicket } from '@alga-psa/email/actions';

describe('emailLogActions.getEmailLogsForTicket', () => {
  let knex: Knex;
  let scoped: ReturnType<typeof tenantDb>;
  let tenantId: string;
  let clientId: string;
  let ticketId: string;
  let otherTicketId: string;

  async function createOwnedTicket(ticketNumber: string): Promise<string> {
    const id = uuidv4();
    await scoped.table('tickets').insert({
      tenant: tenantId,
      ticket_id: id,
      ticket_number: ticketNumber,
      title: `Email log ${ticketNumber}`,
      client_id: clientId,
      entered_by: authorizedReaderId,
      assigned_to: authorizedReaderId,
      attributes: {},
    });
    return id;
  }

  beforeAll(async () => {
    knex = await createTestDbConnection();
    await resetTenantConnectionPool();
    tenantId = await createTenant(knex, `Email Log Action ${uuidv4().slice(0, 8)}`);
    mockTenantId = tenantId;
    scoped = tenantDb(knex, tenantId);
    clientId = await createClient(knex, tenantId, `Email Log Client ${uuidv4().slice(0, 8)}`);
    authorizedReaderId = await createUser(knex, tenantId, {
      email: `email-log-reader-${uuidv4().slice(0, 8)}@example.com`,
      user_type: 'internal',
    });
    ticketId = await createOwnedTicket(`EL-${uuidv4().slice(0, 8)}`);
    otherTicketId = await createOwnedTicket(`EL-${uuidv4().slice(0, 8)}`);
  });

  beforeEach(async () => {
    await scoped.table('email_sending_logs').where({ tenant: tenantId }).delete();

    await scoped.table('email_sending_logs').insert([
      {
        tenant: tenantId,
        message_id: 'm1',
        provider_id: 'p',
        provider_type: 'test',
        from_address: 'from@example.com',
        to_addresses: JSON.stringify(['a@example.com']),
        subject: 'A1',
        status: 'sent',
        sent_at: new Date('2026-01-03T10:00:00Z'),
        entity_type: 'ticket',
        entity_id: ticketId,
      },
      {
        tenant: tenantId,
        message_id: 'm2',
        provider_id: 'p',
        provider_type: 'test',
        from_address: 'from@example.com',
        to_addresses: JSON.stringify(['b@example.com']),
        subject: 'B1',
        status: 'failed',
        sent_at: new Date('2026-01-04T10:00:00Z'),
        entity_type: 'ticket',
        entity_id: ticketId,
      },
      {
        tenant: tenantId,
        message_id: 'm3',
        provider_id: 'p',
        provider_type: 'test',
        from_address: 'from@example.com',
        to_addresses: JSON.stringify(['c@example.com']),
        subject: 'C1',
        status: 'sent',
        sent_at: new Date('2026-01-05T10:00:00Z'),
        entity_type: 'ticket',
        entity_id: otherTicketId,
      },
    ]);
  });

  afterAll(async () => {
    await knex.destroy();
    await resetTenantConnectionPool();
  });

  it('returns logs for a ticket ordered by sent_at desc', async () => {
    const result = await getEmailLogsForTicket(ticketId, { limit: 50 });
    expect(result.map((r) => r.recipient)).toEqual(['b@example.com', 'a@example.com']);
    expect(result.map((r) => r.subject)).toEqual(['B1', 'A1']);
    expect(result.every((r) => !('message_id' in r))).toBe(true);
  });

  it('respects limit', async () => {
    const result = await getEmailLogsForTicket(ticketId, { limit: 1 });
    expect(result.length).toBe(1);
    expect(result[0]).toMatchObject({ recipient: 'b@example.com', subject: 'B1' });
  });
});
