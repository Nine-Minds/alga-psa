import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { resetTenantConnectionPool } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

let mockTenantId = 'tenant-test';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) =>
    fn({ user_id: 'user-test', tenant: mockTenantId, roles: [] }, { tenant: mockTenantId }, ...args),
}));

import { getEmailLogMetrics } from '@alga-psa/email/actions';

describe('emailLogActions.getEmailLogMetrics', () => {
  let knex: Knex;
  let tenantId: string;

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
        sent_at: new Date(),
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
        sent_at: new Date(),
      },
    ]);
  });

  afterAll(async () => {
    await knex.destroy();
    await resetTenantConnectionPool();
  });

  it('returns total, failed, today, failedRate', async () => {
    const result = await getEmailLogMetrics();
    expect(result.total).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.today).toBeGreaterThanOrEqual(0);
    expect(result.failedRate).toBeCloseTo(0.5);
  });
});
