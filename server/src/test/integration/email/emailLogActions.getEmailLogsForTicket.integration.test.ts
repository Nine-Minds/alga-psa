import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { resetTenantConnectionPool } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

let mockTenantId = 'tenant-test';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) =>
    fn({ user_id: 'user-test', tenant: mockTenantId, roles: [] }, { tenant: mockTenantId }, ...args),
}));

import { getEmailLogsForTicket } from '@alga-psa/email/actions';

describe('emailLogActions.getEmailLogsForTicket', () => {
  let knex: Knex;
  let tenantId: string;
  const ticketId = uuidv4();
  const otherTicketId = uuidv4();

  beforeAll(async () => {
    knex = await createTestDbConnection();
    await resetTenantConnectionPool();

    const tenant = await knex('tenants').first('tenant');
    if (!tenant?.tenant) {
      throw new Error('No tenant found in seeded test DB');
    }
    tenantId = tenant.tenant;
    mockTenantId = tenantId;
  });

  beforeEach(async () => {
    await knex('email_sending_logs').del();

    await knex('email_sending_logs').insert([
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
    expect(result.map((r) => r.message_id)).toEqual(['m2', 'm1']);
  });

  it('respects limit', async () => {
    const result = await getEmailLogsForTicket(ticketId, { limit: 1 });
    expect(result.length).toBe(1);
    expect(result[0]?.message_id).toBe('m2');
  });
});
