import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FR-B3 — status-slug validation, and the one case that is not about a bad
 * slug: a tenant whose `asset_statuses` was never seeded. Without a fallback
 * every asset create and update on that tenant is refused.
 */

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const TENANT = 'tenant-1';
  const dbState: Record<string, Row[]> = { asset_statuses: [], assets: [] };

  const resetDb = () => {
    dbState.asset_statuses = [];
    dbState.assets = [];
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

    select(..._cols: unknown[]) { return this; }
    orderBy() { return this; }

    private filtered(): Row[] {
      return this.rows.filter((row) =>
        this.wheres.every((where) => Object.entries(where).every(([k, v]) => row[k] === v))
      );
    }

    first() {
      return Promise.resolve(this.filtered()[0]);
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
    tenantJoin: (builder: any) => builder,
  }),
}));

const { validateAssetStatusSlug } = await import('./assetStatusRegistry');

const TENANT = h.TENANT;

const seed = (slug: string, overrides: Row = {}) => {
  h.dbState.asset_statuses.push({
    tenant: TENANT,
    status_id: `status-${slug}`,
    slug,
    label: slug,
    kind: 'deployable',
    is_builtin: true,
    is_active: true,
    display_order: 0,
    ...overrides,
  });
};

beforeEach(() => {
  h.resetDb();
});

describe('validateAssetStatusSlug', () => {
  it('accepts a slug the tenant has', async () => {
    seed('active');
    await expect(validateAssetStatusSlug(h.knexMock, TENANT, 'active')).resolves.toEqual({
      ok: true,
      value: 'active',
    });
  });

  it('rejects a slug the tenant does not have', async () => {
    seed('active');
    const result = await validateAssetStatusSlug(h.knexMock, TENANT, 'on_a_boat');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe('unknown_status');
  });

  it('accepts an archived slug only when it is the one the asset already carries', async () => {
    seed('retired', { is_active: false, kind: 'archived' });
    const refused = await validateAssetStatusSlug(h.knexMock, TENANT, 'retired', 'active');
    expect(refused.ok === false && refused.error.code).toBe('archived_status');
    await expect(validateAssetStatusSlug(h.knexMock, TENANT, 'retired', 'retired')).resolves.toEqual({
      ok: true,
      value: 'retired',
    });
  });

  it('falls back to the builtin slugs when the registry was never seeded', async () => {
    // The seeding gap that bites standard_statuses reaches asset_statuses too;
    // an unseeded tenant must still be able to save an asset.
    await expect(validateAssetStatusSlug(h.knexMock, TENANT, 'inactive')).resolves.toEqual({
      ok: true,
      value: 'inactive',
    });
  });

  it('still refuses an invented slug on an unseeded tenant', async () => {
    const result = await validateAssetStatusSlug(h.knexMock, TENANT, 'somewhere_over_the_rainbow');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe('unknown_status');
  });

  it('refuses an empty slug', async () => {
    const result = await validateAssetStatusSlug(h.knexMock, TENANT, '  ');
    expect(result.ok === false && result.error.code).toBe('invalid_status');
  });
});
