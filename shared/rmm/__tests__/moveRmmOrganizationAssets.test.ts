import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T133 / T134 (F091) — re-pointing an RMM organization's assets: both
 * identification routes, everything the old client owned cleared, history
 * written, and nothing belonging to another organization or tenant touched.
 */

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const dbState: Record<string, Row[]> = {};

  const resetDb = () => {
    for (const key of Object.keys(dbState)) delete dbState[key];
    for (const name of [
      'assets', 'contacts', 'asset_assignments', 'asset_history',
      'asset_group_members', 'asset_groups', 'tenant_external_entity_mappings',
    ]) {
      dbState[name] = [];
    }
  };

  const strip = (key: string) => (key.includes('.') ? key.split('.').pop()! : key);

  class QB {
    private readonly table: string;
    private objWheres: Array<Record<string, any>> = [];
    private notWheres: Array<Record<string, any>> = [];
    private nullWheres: Array<{ col: string; isNull: boolean }> = [];

    constructor(spec: string) {
      this.table = spec.split(' as ')[0];
    }

    private get rows(): Row[] {
      if (!dbState[this.table]) dbState[this.table] = [];
      return dbState[this.table];
    }

    where(arg1: any, arg2?: any) {
      if (typeof arg1 === 'function') return this;
      if (typeof arg1 === 'string') {
        this.objWheres.push({ [strip(arg1)]: arg2 });
        return this;
      }
      const normalized: Record<string, any> = {};
      for (const [k, v] of Object.entries(arg1)) normalized[strip(k)] = v;
      this.objWheres.push(normalized);
      return this;
    }

    whereNot(arg1: Record<string, any>) {
      const normalized: Record<string, any> = {};
      for (const [k, v] of Object.entries(arg1)) normalized[strip(k)] = v;
      this.notWheres.push(normalized);
      return this;
    }

    whereNull(col: string) {
      this.nullWheres.push({ col: strip(col), isNull: true });
      return this;
    }

    join(_table: string, _fn: unknown) { return this; }
    select(..._cols: unknown[]) { return this; }
    orderBy() { return this; }

    pluck(col: string) {
      return Promise.resolve(this.filtered().map((row) => row[strip(col)]));
    }

    private filtered(): Row[] {
      let rows = [...this.rows];
      for (const where of this.objWheres) {
        rows = rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      }
      for (const where of this.notWheres) {
        rows = rows.filter((row) => !Object.entries(where).every(([k, v]) => row[k] === v));
      }
      for (const { col, isNull } of this.nullWheres) {
        rows = rows.filter((row) => (isNull ? row[col] == null : row[col] != null));
      }
      return rows;
    }

    first() {
      return Promise.resolve(this.filtered().map((row) => ({ ...row }))[0]);
    }

    insert(data: Row | Row[]) {
      const incoming = (Array.isArray(data) ? data : [data]).map((row, index) => ({
        assignment_id: `as-${this.rows.length + index + 1}`,
        unassigned_at: null,
        ...row,
      }));
      this.rows.push(...incoming);
      const result: any = Promise.resolve(incoming);
      result.returning = () => Promise.resolve(incoming);
      return result;
    }

    update(patch: Row) {
      const rows = this.filtered();
      for (const row of rows) Object.assign(row, patch);
      return Promise.resolve(rows.length);
    }

    delete() {
      const doomed = new Set(this.filtered());
      dbState[this.table] = this.rows.filter((row) => !doomed.has(row));
      return Promise.resolve(doomed.size);
    }

    then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
      return Promise.resolve(this.filtered().map((row) => ({ ...row }))).then(resolve, reject);
    }
  }

  const knexMock: any = (spec: string) => new QB(spec);
  knexMock.raw = (sql: string, bindings: unknown) => ({ __raw: true, sql, bindings });
  knexMock.fn = { now: () => '2026-10-09T12:00:00.000Z' };

  return { dbState, knexMock, resetDb };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (name: string) => conn(name).where({ tenant }),
  }),
}));

const { countRmmOrganizationAssets, findRmmOrganizationAssetIds, moveRmmOrganizationAssets } =
  await import('../moveRmmOrganizationAssets');

const TENANT = 'tenant-1';
const OLD_CLIENT = 'client-old';
const NEW_CLIENT = 'client-new';
const ACTOR = 'user-1';

const asset = (id: string, overrides: Row = {}): Row => ({
  tenant: TENANT,
  asset_id: id,
  client_id: OLD_CLIENT,
  contact_name_id: null,
  billing_profile_id: null,
  location_id: null,
  location: '',
  rmm_provider: 'tacticalrmm',
  rmm_organization_id: 'org-1',
  ...overrides,
});

beforeEach(() => {
  h.resetDb();
  h.dbState.contacts.push({
    tenant: TENANT, contact_name_id: 'c1', client_id: OLD_CLIENT, contact_kind: 'person',
  });
});

const move = () =>
  moveRmmOrganizationAssets(h.knexMock, TENANT, {
    integrationId: 'integration-1',
    provider: 'tacticalrmm',
    externalOrganizationId: 'org-1',
    newClientId: NEW_CLIENT,
    actorUserId: ACTOR,
  });

describe('findRmmOrganizationAssetIds', () => {
  it('finds assets by the rmm_organization_id column and by the external mapping', async () => {
    h.dbState.assets.push(
      asset('by-column'),
      asset('by-mapping', { rmm_organization_id: null }),
    );
    h.dbState.tenant_external_entity_mappings.push({
      tenant: TENANT,
      integration_type: 'tacticalrmm',
      alga_entity_type: 'asset',
      alga_entity_id: 'by-mapping',
      external_realm_id: 'org-1',
    });

    const ids = await findRmmOrganizationAssetIds(h.knexMock, TENANT, {
      provider: 'tacticalrmm',
      externalOrganizationId: 'org-1',
    });
    expect(ids.sort()).toEqual(['by-column', 'by-mapping']);
    expect(await countRmmOrganizationAssets(h.knexMock, TENANT, {
      provider: 'tacticalrmm',
      externalOrganizationId: 'org-1',
    })).toBe(2);
  });
});

describe('moveRmmOrganizationAssets', () => {
  it('re-points the client and clears everything the old client owned', async () => {
    h.dbState.assets.push(asset('a1', {
      contact_name_id: 'c1',
      billing_profile_id: 'profile-old',
      location_id: 'loc-old',
      location: 'Old site',
    }));
    h.dbState.asset_assignments.push({
      tenant: TENANT, assignment_id: 'as-0', asset_id: 'a1', contact_name_id: 'c1',
      source: 'manual', unassigned_at: null,
    });
    h.dbState.asset_groups.push({ tenant: TENANT, group_id: 'g1', kind: 'bundle' });
    h.dbState.asset_group_members.push({ tenant: TENANT, group_id: 'g1', asset_id: 'a1' });

    const result = await move();

    expect(result).toEqual({ moved: 1, assetIds: ['a1'] });
    expect(h.dbState.assets[0]).toMatchObject({
      client_id: NEW_CLIENT,
      contact_name_id: null,
      billing_profile_id: null,
      location_id: null,
      location: '',
    });
    expect(h.dbState.asset_assignments[0].unassigned_at).not.toBeNull();
    expect(h.dbState.asset_group_members).toHaveLength(0);
    const move_history = h.dbState.asset_history.find((row) => row.change_type === 'updated');
    expect(move_history?.changes).toMatchObject({ previous_client_id: OLD_CLIENT, client_id: NEW_CLIENT });
    // FR-E5/F068: leaving the group is its own timeline entry, not a footnote
    // on the client change.
    const group_history = h.dbState.asset_history.find((row) => row.change_type === 'group_removed');
    expect(group_history?.changes).toMatchObject({
      group_id: 'g1',
      group_kind: 'bundle',
      source: 'rmm_organization_move',
    });
  });

  it('leaves another organization and another tenant alone', async () => {
    h.dbState.assets.push(
      asset('mine'),
      asset('other-org', { asset_id: 'other-org', rmm_organization_id: 'org-2' }),
      asset('other-tenant', { asset_id: 'other-tenant', tenant: 'tenant-2' }),
    );

    const result = await move();

    expect(result.assetIds).toEqual(['mine']);
    expect(h.dbState.assets.find((row) => row.asset_id === 'other-org')?.client_id).toBe(OLD_CLIENT);
    expect(h.dbState.assets.find((row) => row.asset_id === 'other-tenant')?.client_id).toBe(OLD_CLIENT);
  });

  it('still records the move when there is no actor', async () => {
    h.dbState.assets.push(asset('a1'));

    await moveRmmOrganizationAssets(h.knexMock, TENANT, {
      integrationId: 'integration-1',
      provider: 'tacticalrmm',
      externalOrganizationId: 'org-1',
      newClientId: NEW_CLIENT,
      actorUserId: null,
    });

    const move_history = h.dbState.asset_history.find((row) => row.change_type === 'updated');
    expect(move_history).toMatchObject({ changed_by: null });
    expect(move_history?.changes).toMatchObject({ source: 'rmm_organization_move' });
  });

  it('skips an asset already on the new client', async () => {
    h.dbState.assets.push(asset('already', { client_id: NEW_CLIENT }));
    expect(await move()).toEqual({ moved: 0, assetIds: [] });
    expect(h.dbState.asset_history).toHaveLength(0);
  });
});
