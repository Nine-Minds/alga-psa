import { beforeEach, describe, expect, it, vi } from 'vitest';

const admission = vi.hoisted(() => vi.fn());
vi.mock('@alga-psa/licensing', () => ({ assertCoManagedSeatAdmission: admission,
  CoManagedAdmissionError: class extends Error { constructor(public readonly code: string, message: string) { super(message); } } }));
beforeEach(() => admission.mockReset());

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
  }),
}));

import { checkInternalUserLicenseLimit } from './internalUserLicenseGuard';

function fakeTrx(input: { plan: string | null; licensedUserCount: number | null; usedInternalUsers: number; productCode?: string }) {
  const conn = ((table: string) => {
    if (table === 'tenants') {
      const tenantRow = { licensed_user_count: input.licensedUserCount, plan: input.plan, product_code: input.productCode };
      return { first: async (..._fields: any[]) => tenantRow, forUpdate: () => ({ first: async (..._f: any[]) => tenantRow }) };
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
  conn.isTransaction = true;
  return conn as any;
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

  // A co-managed workspace at its own technician ceiling is not an MSP that has
  // run out of user licences, and the two refusals must not print the same
  // sentence. Each admission reason therefore keeps its own code.
  it.each([
    ['CO_MANAGED_SEAT_LIMIT', 'The customer technician allocation is full. Ask the sponsoring MSP to allocate more seats.'],
    ['CO_MANAGED_POOL_LIMIT', 'The sponsoring MSP needs more available co-managed seats before increasing this allocation.'],
    ['CO_MANAGED_NOT_ACTIVE', 'The customer administrator must activate the co-management relationship first.'],
    ['CO_MANAGED_LICENSE_LAPSED', 'Restore the sponsoring Pro license and co-managed seats before adding customer technicians.'],
    ['CO_MANAGED_INVITATION_INVALID', 'This invitation is no longer valid. Request a new invitation from your administrator.'],
    ['CO_MANAGED_ALLOCATION_CONFLICT', 'The customer allocation changed or is no longer available. Refresh before trying again.'],
  ])('reports a co-managed %s refusal under its own code', async (code, message) => {
    const { CoManagedAdmissionError } = await import('@alga-psa/licensing');
    admission.mockRejectedValueOnce(new (CoManagedAdmissionError as any)(code, message));

    const result = await checkInternalUserLicenseLimit(
      fakeTrx({ plan: 'pro', licensedUserCount: 50, usedInternalUsers: 1, productCode: 'co_managed' }),
      'tenant-1'
    );

    expect(result).toEqual({ ok: false, code, error: message });
  });

  it('admits a co-managed workspace that is within its allocation', async () => {
    admission.mockResolvedValueOnce(undefined);

    const result = await checkInternalUserLicenseLimit(
      fakeTrx({ plan: 'pro', licensedUserCount: 50, usedInternalUsers: 1, productCode: 'co_managed' }),
      'tenant-1'
    );

    expect(result).toEqual({ ok: true });
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

it('uses customer allocation admission even when the ordinary MSP limit is zero or Solo', async () => {
  admission.mockResolvedValue({ managed: true });
  const trx: any = (table: string) => {
    if (table === 'tenants') return { first: async () => ({ product_code: 'co_managed', plan: 'solo', licensed_user_count: 0 }) };
    throw new Error('Customer admission must not use the ordinary MSP counter');
  };
  trx.isTransaction = true;
  expect(await checkInternalUserLicenseLimit(trx, 'customer', { email: 'tech@example.test' })).toEqual({ ok: true });
});
