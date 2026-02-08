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

import { getEmailLogs } from '@alga-psa/email/actions';

describe('emailLogActions.getEmailLogs', () => {
  let knex: Knex;
  let tenantId: string;
  const ticketId = uuidv4();

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
        to_addresses: JSON.stringify(['alice@example.com']),
        subject: 'A1',
        status: 'sent',
        sent_at: new Date('2026-01-01T10:00:00Z'),
        entity_type: 'ticket',
        entity_id: ticketId,
      },
      {
        tenant: tenantId,
        message_id: 'm2',
        provider_id: 'p',
        provider_type: 'test',
        from_address: 'from@example.com',
        to_addresses: JSON.stringify(['bob@example.com']),
        subject: 'B1',
        status: 'failed',
        error_message: 'boom',
        sent_at: new Date('2026-01-02T10:00:00Z'),
        entity_type: 'ticket',
        entity_id: ticketId,
      },
      {
        tenant: tenantId,
        message_id: 'm3',
        provider_id: 'p',
        provider_type: 'test',
        from_address: 'from@example.com',
        to_addresses: JSON.stringify(['alice@example.com']),
        subject: 'A2',
        status: 'sent',
        sent_at: new Date('2026-01-02T12:00:00Z'),
        entity_type: 'ticket',
        entity_id: ticketId,
      },
      {
        tenant: tenantId,
        message_id: 'm4',
        provider_id: 'p',
        provider_type: 'test',
        from_address: 'from@example.com',
        to_addresses: JSON.stringify(['carol@example.com']),
        subject: 'C1',
        status: 'sent',
        sent_at: new Date('2026-01-03T10:00:00Z'),
        entity_type: 'ticket',
        entity_id: ticketId,
      },
    ]);
  });

  afterAll(async () => {
    await knex.destroy();
    await resetTenantConnectionPool();
  });

  it('returns paginated results', async () => {
    const result = await getEmailLogs({ page: 1, pageSize: 2, sortBy: 'sent_at', sortDirection: 'desc' });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
    expect(result.total).toBe(4);
    expect(result.data.length).toBe(2);
    expect(result.totalPages).toBe(2);
  });

  it('filters by date range when provided', async () => {
    const result = await getEmailLogs({
      page: 1,
      pageSize: 50,
      startDate: '2026-01-02T00:00:00Z',
      endDate: '2026-01-02T23:59:59Z',
    });
    const messageIds = result.data.map((r) => r.message_id);
    expect(messageIds.sort()).toEqual(['m2', 'm3']);
  });

  it('treats date-only endDate as inclusive end of day', async () => {
    const result = await getEmailLogs({
      page: 1,
      pageSize: 50,
      startDate: '2026-01-02',
      endDate: '2026-01-02',
    });
    const messageIds = result.data.map((r) => r.message_id).sort();
    expect(messageIds).toEqual(['m2', 'm3']);
  });

  it('filters by status when provided', async () => {
    const result = await getEmailLogs({ page: 1, pageSize: 50, status: 'failed' });
    expect(result.total).toBe(1);
    expect(result.data.length).toBe(1);
    expect(result.data[0]?.message_id).toBe('m2');
    expect(result.data[0]?.status).toBe('failed');
  });

  it('filters by recipient email when provided', async () => {
    const result = await getEmailLogs({ page: 1, pageSize: 50, recipientEmail: 'alice@example.com' });
    const messageIds = result.data.map((r) => r.message_id).sort();
    expect(messageIds).toEqual(['m1', 'm3']);
  });

  it('supports sorting by sent_at ascending/descending', async () => {
    const asc = await getEmailLogs({ page: 1, pageSize: 50, sortBy: 'sent_at', sortDirection: 'asc' });
    expect(asc.data[0]?.message_id).toBe('m1');
    expect(asc.data[asc.data.length - 1]?.message_id).toBe('m4');

    const desc = await getEmailLogs({ page: 1, pageSize: 50, sortBy: 'sent_at', sortDirection: 'desc' });
    expect(desc.data[0]?.message_id).toBe('m4');
    expect(desc.data[desc.data.length - 1]?.message_id).toBe('m1');
  });
});
