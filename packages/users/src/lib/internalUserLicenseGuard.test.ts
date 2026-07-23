import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
  }),
}));

import { checkInternalUserLicenseLimit } from './internalUserLicenseGuard';

function fakeTrx(input: { plan: string | null; licensedUserCount: number | null; usedInternalUsers: number }) {
  return ((table: string) => {
    if (table === 'tenants') {
      const tenantRow = { licensed_user_count: input.licensedUserCount, plan: input.plan };
      return { first: async (..._fields: any[]) => tenantRow };
    }

    if (table === 'users') {
      return {
        where: (_criteria: Record<string, any>) => ({
          count: async () => [{ count: String(input.usedInternalUsers) }],
        }),
      };
    }

    throw new Error(`Unexpected tenant table ${table}`);
  }) as any;
}

describe('checkInternalUserLicenseLimit', () => {
  it('blocks a second internal user on the Solo plan', async () => {
    const result = await checkInternalUserLicenseLimit(
      fakeTrx({ plan: 'solo', licensedUserCount: 1, usedInternalUsers: 1 }),
      'tenant-1'
    );

    expect(result).toEqual({
      ok: false,
      code: 'SOLO_PLAN_LIMIT',
      error: 'Solo plan is limited to 1 user. Upgrade to Pro to add more users.',
    });
  });

  it('allows the first internal user on the Solo plan', async () => {
    const result = await checkInternalUserLicenseLimit(
      fakeTrx({ plan: 'solo', licensedUserCount: 1, usedInternalUsers: 0 }),
      'tenant-1'
    );

    expect(result).toEqual({ ok: true });
  });

  it('blocks once a Pro tenant is at its licensed_user_count', async () => {
    const result = await checkInternalUserLicenseLimit(
      fakeTrx({ plan: 'pro', licensedUserCount: 3, usedInternalUsers: 3 }),
      'tenant-1'
    );

    expect(result).toEqual({
      ok: false,
      code: 'LICENSE_LIMIT_REACHED',
      error: "You've reached your MSP user license limit.",
    });
  });

  it('allows an unlimited (null licensed_user_count) tenant regardless of usage', async () => {
    const result = await checkInternalUserLicenseLimit(
      fakeTrx({ plan: 'pro', licensedUserCount: null, usedInternalUsers: 500 }),
      'tenant-1'
    );

    expect(result).toEqual({ ok: true });
  });

  it('throws when the tenant row cannot be found', async () => {
    const trx = ((table: string) => {
      if (table === 'tenants') {
        return { first: async () => undefined };
      }
      throw new Error(`Unexpected tenant table ${table}`);
    }) as any;

    await expect(checkInternalUserLicenseLimit(trx, 'missing-tenant')).rejects.toThrow(
      'Tenant not found: missing-tenant'
    );
  });
});
