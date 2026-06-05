import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTenantReactivationToken,
  hashTenantReactivationToken,
} from '../../../../../ee/server/src/lib/billing/tenantReactivationTokens';

describe('tenant reactivation tokens', () => {
  beforeEach(() => {
    process.env.TENANT_REACTIVATION_TOKEN_SECRET = 'test-reactivation-secret';
  });

  it('T011/T077: creates a signed token and stores only its hash in the durable ledger', async () => {
    const insertedRows: Array<Record<string, unknown>> = [];
    const knex = Object.assign(
      (tableName: string) => {
        expect(tableName).toBe('tenant_reactivation_tokens');
        return {
          insert: vi.fn(async (row: Record<string, unknown>) => {
            insertedRows.push(row);
          }),
        };
      },
      {
        fn: {
          now: () => 'NOW()',
        },
      },
    ) as any;

    const expiresAt = new Date('2026-06-12T00:00:00.000Z');
    const result = await createTenantReactivationToken({
      tenantId: 'tenant-1',
      deletionId: '11111111-1111-1111-1111-111111111111',
      expiresAt,
      knex,
    });

    expect(result.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(result.tokenHash).toBe(hashTenantReactivationToken(result.token));
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      tenant: 'tenant-1',
      deletion_id: '11111111-1111-1111-1111-111111111111',
      token_hash: result.tokenHash,
      expires_at: expiresAt,
    });
    expect(JSON.stringify(insertedRows[0])).not.toContain(result.token);
  });
});
