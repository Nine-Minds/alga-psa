import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
  }),
}));

import { checkInternalUserLicenseLimit, countPendingInvitationSeats, lockTenantSeatState } from './internalUserLicenseGuard';

const lockCalls: unknown[][] = [];

function asTransaction(fn: any) {
  fn.isTransaction = true;
  return fn;
}

function fakeTrx(input: { plan: string | null; licensedUserCount: number | null; usedInternalUsers: number }) {
  return asTransaction((table: string) => {
    if (table === 'tenants') {
      const tenantRow = { licensed_user_count: input.licensedUserCount, plan: input.plan };
      return {
        where: (criteria: Record<string, any>) => ({
          forUpdate: () => ({ first: async (..._fields: any[]) => { lockCalls.push(['tenant-for-update', criteria]); return { tenant: 'tenant-1' }; } }),
        }),
        first: async (..._fields: any[]) => tenantRow,
      };
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

describe('seat lock and transaction requirement', () => {
  it('locks the tenant row before seat admission reads', async () => {
    lockCalls.length = 0;
    await checkInternalUserLicenseLimit(
      fakeTrx({ plan: 'pro', licensedUserCount: 3, usedInternalUsers: 0 }),
      'tenant-1'
    );
    expect(lockCalls).toEqual([['tenant-for-update', { tenant: 'tenant-1' }]]);
  });

  it('requires a transaction before locking tenant seat state', async () => {
    const notTrx = (() => { throw new Error('must not query'); }) as any;
    await expect(lockTenantSeatState(notTrx, 'tenant-1')).rejects.toThrow(/inside a transaction/);
  });

  it('throws for a non-transaction caller', async () => {
    const notTrx = (() => { throw new Error('must not query'); }) as any;
    await expect(checkInternalUserLicenseLimit(notTrx, 'tenant-1')).rejects.toThrow(/inside a transaction/);
  });
});

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

  it('counts reserved seats (pending invitations) toward the limit', async () => {
    const result = await checkInternalUserLicenseLimit(
      fakeTrx({ plan: 'pro', licensedUserCount: 3, usedInternalUsers: 2 }),
      'tenant-1',
      { reservedSeats: 1 }
    );

    expect(result).toEqual({
      ok: false,
      code: 'LICENSE_LIMIT_REACHED',
      error: "You've reached your MSP user license limit.",
    });
  });

  it('allows when seats remain after reserved seats', async () => {
    const result = await checkInternalUserLicenseLimit(
      fakeTrx({ plan: 'pro', licensedUserCount: 3, usedInternalUsers: 1 }),
      'tenant-1',
      { reservedSeats: 1 }
    );

    expect(result).toEqual({ ok: true });
  });

  it('allows an unlimited (null licensed_user_count) tenant regardless of usage', async () => {
    const result = await checkInternalUserLicenseLimit(
      fakeTrx({ plan: 'pro', licensedUserCount: null, usedInternalUsers: 500 }),
      'tenant-1'
    );

    expect(result).toEqual({ ok: true });
  });

  it('throws when the tenant row cannot be found', async () => {
    const trx = asTransaction((table: string) => {
      if (table === 'tenants') {
        return {
          where: () => ({ forUpdate: () => ({ first: async () => undefined }) }),
          first: async () => undefined,
        };
      }
      throw new Error(`Unexpected tenant table ${table}`);
    }) as any;

    await expect(checkInternalUserLicenseLimit(trx, 'missing-tenant')).rejects.toThrow(
      'Tenant not found: missing-tenant'
    );
  });
});

describe('countPendingInvitationSeats', () => {
  function recordingTrx(count: string) {
    const calls: Array<[string, ...unknown[]]> = [];
    const query: any = {
      whereNull: (...a: unknown[]) => { calls.push(['whereNull', ...a]); return query; },
      where: (...a: unknown[]) => { calls.push(['where', ...a]); return query; },
      whereNot: (...a: unknown[]) => { calls.push(['whereNot', ...a]); return query; },
      count: () => query,
      first: async () => ({ count }),
    };
    const trx: any = (table: string) => { calls.push(['table', table]); return query; };
    trx.fn = { now: () => 'NOW' };
    return { trx, calls };
  }

  it('counts only unused, unexpired invitations of the tenant', async () => {
    const { trx, calls } = recordingTrx('3');
    await expect(countPendingInvitationSeats(trx, 'tenant-1')).resolves.toBe(3);
    expect(calls).toEqual([['table', 'user_invitations'], ['whereNull', 'used_at'], ['where', 'expires_at', '>', 'NOW']]);
  });

  it('leaves out the invitee being re-invited when asked to', async () => {
    const { trx, calls } = recordingTrx('0');
    await expect(countPendingInvitationSeats(trx, 'tenant-1', { excludeEmail: 'a@example.test' })).resolves.toBe(0);
    expect(calls).toContainEqual(['whereNot', 'email', 'a@example.test']);
  });
});
