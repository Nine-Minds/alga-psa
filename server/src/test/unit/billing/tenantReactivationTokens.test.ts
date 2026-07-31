import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachCheckoutSessionToReactivationToken,
  consumeTenantReactivationTokenByCheckoutSession,
  createTenantReactivationToken,
  hashTenantReactivationToken,
  reserveTenantReactivationToken,
  verifyTenantReactivationToken,
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
          where: vi.fn().mockReturnThis(),
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

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const result = await createTenantReactivationToken({
      tenantId: 'tenant-1',
      deletionId: '11111111-1111-1111-1111-111111111111',
      licenseCount: 5,
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
    expect(verifyTenantReactivationToken(result.token)?.license_count).toBe(5);

    const [encodedPayload, signature] = result.token.split('.');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    const tamperedToken = `${Buffer.from(JSON.stringify({
      ...payload,
      license_count: 6,
    })).toString('base64url')}.${signature}`;
    expect(verifyTenantReactivationToken(tamperedToken)).toBeNull();
  });

  it.each([0, -1, 1.5, 1001])('rejects invalid license count %s', async (licenseCount) => {
    await expect(createTenantReactivationToken({
      tenantId: 'tenant-1',
      deletionId: '11111111-1111-1111-1111-111111111111',
      licenseCount,
      knex: vi.fn() as any,
    })).rejects.toThrow('License count must be an integer from 1 through 1000');
  });

  it('T066/T067: atomically reserves a valid token once and rejects replay or expired tokens', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const rows: Array<Record<string, any>> = [];
    const makeKnex = () => Object.assign(
      (tableName: string) => {
        expect(tableName).toBe('tenant_reactivation_tokens');
        const builder: any = {
          criteria: {} as Record<string, unknown>,
          requireReservedNull: false,
          requireConsumedNull: false,
          requireCheckoutSessionNull: false,
          requireReservedNotNull: false,
          insert: vi.fn(async (row: Record<string, unknown>) => {
            rows.push(row);
          }),
          where(criteriaOrColumn: Record<string, unknown> | string, operator?: string, value?: unknown) {
            if (typeof criteriaOrColumn === 'string') {
              if (criteriaOrColumn.endsWith('.tenant') || criteriaOrColumn === 'tenant') {
                this.criteria.tenant = operator;
              } else {
                this.expiresAfterNow = operator === '>' && value === 'NOW()';
              }
            } else {
              this.criteria = { ...this.criteria, ...criteriaOrColumn };
            }
            return this;
          },
          whereNull(column: string) {
            if (column === 'reserved_at') this.requireReservedNull = true;
            if (column === 'consumed_at') this.requireConsumedNull = true;
            if (column === 'checkout_session_id') this.requireCheckoutSessionNull = true;
            return this;
          },
          whereNotNull(column: string) {
            if (column === 'reserved_at') this.requireReservedNotNull = true;
            return this;
          },
          update(values: Record<string, unknown>) {
            const row = rows.find((candidate) => {
              const matchesCriteria = Object.entries(this.criteria)
                .every(([key, expected]) => candidate[key] === expected);
              return matchesCriteria
                && (!this.requireReservedNull || candidate.reserved_at == null)
                && (!this.requireReservedNotNull || candidate.reserved_at != null)
                && (!this.requireConsumedNull || candidate.consumed_at == null)
                && (!this.requireCheckoutSessionNull || candidate.checkout_session_id == null)
                && (!this.expiresAfterNow || candidate.expires_at > new Date());
            });

            if (!row) {
              const result: any = new Number(0);
              result.returning = vi.fn(async () => []);
              result.valueOf = () => 0;
              return result;
            }

            Object.assign(row, values);
            const result: any = new Number(1);
            result.returning = vi.fn(async () => [{
              tenant: row.tenant,
              deletion_id: row.deletion_id,
            }]);
            result.valueOf = () => 1;
            return result;
          },
        };

        return builder;
      },
      {
        fn: {
          now: () => 'NOW()',
        },
      },
    ) as any;

    const token = await createTenantReactivationToken({
      tenantId: 'tenant-1',
      deletionId: '11111111-1111-1111-1111-111111111111',
      licenseCount: 5,
      expiresAt,
      knex: makeKnex(),
    });

    await expect(reserveTenantReactivationToken(token.token, makeKnex())).resolves.toEqual({
      tenantId: 'tenant-1',
      deletionId: '11111111-1111-1111-1111-111111111111',
      tokenHash: token.tokenHash,
      licenseCount: 5,
    });
    expect(rows[0].reserved_at).toBe('NOW()');

    await expect(reserveTenantReactivationToken(token.token, makeKnex())).resolves.toBeNull();
    await expect(reserveTenantReactivationToken('malformed-token', makeKnex())).resolves.toBeNull();

    await expect(
      attachCheckoutSessionToReactivationToken(token.token, 'cs_reactivate_123', makeKnex()),
    ).resolves.toBe(true);
    expect(rows[0].checkout_session_id).toBe('cs_reactivate_123');

    await expect(
      attachCheckoutSessionToReactivationToken(token.token, 'cs_reactivate_456', makeKnex()),
    ).resolves.toBe(false);

    await expect(
      consumeTenantReactivationTokenByCheckoutSession('cs_reactivate_123', makeKnex()),
    ).resolves.toBe(true);
    expect(rows[0].consumed_at).toBe('NOW()');

    await expect(
      consumeTenantReactivationTokenByCheckoutSession('cs_reactivate_123', makeKnex()),
    ).resolves.toBe(false);
  });
});
