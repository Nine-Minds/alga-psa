import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T125 / T127 / FR-F1-F2: the asset billing-profile resolver and the
 * client-boundary assertion, against an in-memory query builder.
 */

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const TENANT = 'a0000000-0000-4000-8000-00000000000a';
  const dbState: Record<string, Row[]> = {};

  const resetDb = () => {
    for (const key of Object.keys(dbState)) delete dbState[key];
    dbState.assets = [];
    dbState.client_locations = [];
    dbState.client_billing_profiles = [];
  };

  const strip = (key: string) => (key.includes('.') ? key.split('.').pop()! : key);

  class QB {
    private readonly table: string;
    private wheres: Array<Record<string, any>> = [];

    constructor(spec: string) {
      this.table = spec.split(' as ')[0];
    }

    private get rows(): Row[] {
      if (!dbState[this.table]) dbState[this.table] = [];
      return dbState[this.table];
    }

    where(arg1: any, arg2?: any) {
      if (typeof arg1 === 'string') {
        this.wheres.push({ [strip(arg1)]: arg2 });
        return this;
      }
      const normalized: Record<string, any> = {};
      for (const [k, v] of Object.entries(arg1)) normalized[strip(k)] = v;
      this.wheres.push(normalized);
      return this;
    }

    private filtered(): Row[] {
      let rows = [...this.rows];
      for (const where of this.wheres) {
        rows = rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      }
      return rows;
    }

    first(..._cols: unknown[]) {
      return Promise.resolve(this.filtered().map((row) => ({ ...row }))[0]);
    }

    then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
      return Promise.resolve(this.filtered()).then(resolve, reject);
    }
  }

  const knexMock: any = (spec: string) => new QB(spec);

  return { TENANT, dbState, knexMock, resetDb };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (name: string) => conn(name).where({ tenant }),
  }),
}));

const {
  resolveAssetBillingProfileId,
  resolveAssetBillingProfileIdForClient,
  assertBillingProfileForClient,
  ASSET_BILLING_PROFILE_UNAVAILABLE,
} = await import('../assetBillingProfileModel');

const TENANT = h.TENANT;
const ASSET = 'f0000000-0000-4000-8000-00000000000f';
const CLIENT = 'b0000000-0000-4000-8000-00000000000b';
const LOCATION = 'c0000000-0000-4000-8000-00000000000c';
const PROFILE_ASSET = '21000000-0000-4000-8000-000000000001';
const PROFILE_LOCATION = '21000000-0000-4000-8000-000000000002';
const PROFILE_ARCHIVED = '21000000-0000-4000-8000-000000000003';
const PROFILE_OTHER_CLIENT = '21000000-0000-4000-8000-000000000004';

beforeEach(() => {
  h.resetDb();
  h.dbState.client_billing_profiles.push(
    { tenant: TENANT, billing_profile_id: PROFILE_ASSET, client_id: CLIENT, is_active: true },
    { tenant: TENANT, billing_profile_id: PROFILE_LOCATION, client_id: CLIENT, is_active: true },
    { tenant: TENANT, billing_profile_id: PROFILE_ARCHIVED, client_id: CLIENT, is_active: false },
    { tenant: TENANT, billing_profile_id: PROFILE_OTHER_CLIENT, client_id: 'other', is_active: true },
  );
});

describe('resolveAssetBillingProfileId (T127)', () => {
  it('prefers the asset’s own profile', async () => {
    h.dbState.assets.push({ tenant: TENANT, asset_id: ASSET, billing_profile_id: PROFILE_ASSET, location_id: LOCATION });
    h.dbState.client_locations.push({ tenant: TENANT, location_id: LOCATION, default_billing_profile_id: PROFILE_LOCATION });

    await expect(resolveAssetBillingProfileId(h.knexMock as any, TENANT, ASSET)).resolves.toBe(PROFILE_ASSET);
  });

  it('falls back to the location default', async () => {
    h.dbState.assets.push({ tenant: TENANT, asset_id: ASSET, billing_profile_id: null, location_id: LOCATION });
    h.dbState.client_locations.push({ tenant: TENANT, location_id: LOCATION, default_billing_profile_id: PROFILE_LOCATION });

    await expect(resolveAssetBillingProfileId(h.knexMock as any, TENANT, ASSET)).resolves.toBe(PROFILE_LOCATION);
  });

  it('returns null with no asset profile and no location default', async () => {
    h.dbState.assets.push({ tenant: TENANT, asset_id: ASSET, billing_profile_id: null, location_id: LOCATION });
    h.dbState.client_locations.push({ tenant: TENANT, location_id: LOCATION, default_billing_profile_id: null });

    await expect(resolveAssetBillingProfileId(h.knexMock as any, TENANT, ASSET)).resolves.toBeNull();
  });

  it('returns null for an asset with no location, and for a missing asset', async () => {
    h.dbState.assets.push({ tenant: TENANT, asset_id: ASSET, billing_profile_id: null, location_id: null });

    await expect(resolveAssetBillingProfileId(h.knexMock as any, TENANT, ASSET)).resolves.toBeNull();
    await expect(resolveAssetBillingProfileId(h.knexMock as any, TENANT, 'missing')).resolves.toBeNull();
  });
});

describe('resolveAssetBillingProfileIdForClient (T130)', () => {
  it('inherits the asset profile when it belongs to the ticket’s client', async () => {
    h.dbState.assets.push({ tenant: TENANT, asset_id: ASSET, billing_profile_id: PROFILE_ASSET, location_id: null });

    await expect(resolveAssetBillingProfileIdForClient(h.knexMock as any, TENANT, ASSET, CLIENT))
      .resolves.toBe(PROFILE_ASSET);
  });

  it('drops a profile the ticket’s client does not own instead of raising', async () => {
    h.dbState.assets.push({
      tenant: TENANT,
      asset_id: ASSET,
      billing_profile_id: PROFILE_OTHER_CLIENT,
      location_id: null,
    });

    await expect(resolveAssetBillingProfileIdForClient(h.knexMock as any, TENANT, ASSET, CLIENT))
      .resolves.toBeNull();
  });

  it('drops an archived profile instead of raising', async () => {
    h.dbState.assets.push({ tenant: TENANT, asset_id: ASSET, billing_profile_id: PROFILE_ARCHIVED, location_id: null });

    await expect(resolveAssetBillingProfileIdForClient(h.knexMock as any, TENANT, ASSET, CLIENT))
      .resolves.toBeNull();
  });

  it('returns null when the asset resolves to nothing', async () => {
    h.dbState.assets.push({ tenant: TENANT, asset_id: ASSET, billing_profile_id: null, location_id: null });

    await expect(resolveAssetBillingProfileIdForClient(h.knexMock as any, TENANT, ASSET, CLIENT))
      .resolves.toBeNull();
  });
});

describe('assertBillingProfileForClient (T125)', () => {
  it('accepts an active profile of the same client', async () => {
    await expect(assertBillingProfileForClient(h.knexMock as any, TENANT, CLIENT, PROFILE_ASSET))
      .resolves.toBe(PROFILE_ASSET);
  });

  it('rejects a profile belonging to another client', async () => {
    await expect(assertBillingProfileForClient(h.knexMock as any, TENANT, CLIENT, PROFILE_OTHER_CLIENT))
      .rejects.toThrow(ASSET_BILLING_PROFILE_UNAVAILABLE);
  });

  it('rejects an archived profile', async () => {
    await expect(assertBillingProfileForClient(h.knexMock as any, TENANT, CLIENT, PROFILE_ARCHIVED))
      .rejects.toThrow(ASSET_BILLING_PROFILE_UNAVAILABLE);
  });

  it('always allows null — clearing is how a client change is handled', async () => {
    await expect(assertBillingProfileForClient(h.knexMock as any, TENANT, CLIENT, null)).resolves.toBeNull();
  });
});
