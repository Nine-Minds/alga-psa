import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FR-F1 — what an RMM organization mapping is allowed to store as its billing
 * profile. The five mapping actions used to write whatever id arrived, so a
 * caller could attribute a client's alert tickets to another client's profile,
 * and a mapping moved to a new client kept the old client's profile whenever
 * the same call also carried a billing profile.
 */

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const dbState: Record<string, Row[]> = { client_billing_profiles: [] };

  class QB {
    private readonly table: string;
    private wheres: Array<Record<string, any>> = [];

    constructor(spec: string) {
      this.table = spec;
    }

    where(arg: Record<string, any>) {
      this.wheres.push(arg);
      return this;
    }

    first() {
      let rows = [...(dbState[this.table] ?? [])];
      for (const where of this.wheres) {
        rows = rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      }
      return Promise.resolve(rows[0]);
    }
  }

  const knexMock: any = (spec: string) => new QB(spec);
  return { dbState, knexMock };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (name: string) => conn(name).where({ tenant }),
  }),
}));

const { resolveMappingBillingProfileId } = await import('../mappingBillingProfile');

const TENANT = 'tenant-1';

beforeEach(() => {
  dbReset();
});

function dbReset() {
  h.dbState.client_billing_profiles = [
    { tenant: TENANT, billing_profile_id: 'bp-a', client_id: 'client-a', is_active: true },
    { tenant: TENANT, billing_profile_id: 'bp-a-old', client_id: 'client-a', is_active: false },
    { tenant: TENANT, billing_profile_id: 'bp-b', client_id: 'client-b', is_active: true },
  ];
}

describe('resolveMappingBillingProfileId', () => {
  it('leaves the column alone when the patch touches neither field', async () => {
    expect(
      await resolveMappingBillingProfileId(h.knexMock, TENANT, { existingClientId: 'client-a' }),
    ).toBeUndefined();
  });

  it('clears the profile when the client changes', async () => {
    expect(
      await resolveMappingBillingProfileId(h.knexMock, TENANT, {
        existingClientId: 'client-a',
        nextClientId: 'client-b',
      }),
    ).toBeNull();
  });

  it('accepts an active profile of the mapping’s client', async () => {
    expect(
      await resolveMappingBillingProfileId(h.knexMock, TENANT, {
        existingClientId: 'client-a',
        billingProfileId: 'bp-a',
      }),
    ).toBe('bp-a');
  });

  it('rejects another client’s profile', async () => {
    await expect(
      resolveMappingBillingProfileId(h.knexMock, TENANT, {
        existingClientId: 'client-a',
        billingProfileId: 'bp-b',
      }),
    ).rejects.toThrow(/not available/i);
  });

  it('rejects an inactive profile', async () => {
    await expect(
      resolveMappingBillingProfileId(h.knexMock, TENANT, {
        existingClientId: 'client-a',
        billingProfileId: 'bp-a-old',
      }),
    ).rejects.toThrow(/not available/i);
  });

  it('validates against the client the move lands on, not the one it left', async () => {
    // Client and profile in the same call: the old client's profile used to
    // survive the move because the clear branch was skipped.
    await expect(
      resolveMappingBillingProfileId(h.knexMock, TENANT, {
        existingClientId: 'client-a',
        nextClientId: 'client-b',
        billingProfileId: 'bp-a',
      }),
    ).rejects.toThrow(/not available/i);

    expect(
      await resolveMappingBillingProfileId(h.knexMock, TENANT, {
        existingClientId: 'client-a',
        nextClientId: 'client-b',
        billingProfileId: 'bp-b',
      }),
    ).toBe('bp-b');
  });

  it('an explicit null always clears', async () => {
    expect(
      await resolveMappingBillingProfileId(h.knexMock, TENANT, {
        existingClientId: 'client-a',
        billingProfileId: null,
      }),
    ).toBeNull();
  });

  it('refuses a profile when the mapping has no client at all', async () => {
    await expect(
      resolveMappingBillingProfileId(h.knexMock, TENANT, {
        existingClientId: null,
        billingProfileId: 'bp-a',
      }),
    ).rejects.toThrow(/not available/i);
  });
});
