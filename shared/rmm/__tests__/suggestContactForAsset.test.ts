import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F044 / FR-D5 — which organization mapping the suggestion reads.
 *
 * A tenant may run two integrations of the same provider (a migration, two
 * NinjaOne instances). Resolving the integration by provider alone takes
 * whichever row comes back first, and then reads the other mapping's mode and
 * the other integration's explicit user mappings.
 */

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const dbState: Record<string, Row[]> = {};

  const resetDb = () => {
    for (const key of Object.keys(dbState)) delete dbState[key];
    for (const name of [
      'assets', 'contacts', 'workstation_assets', 'server_assets',
      'rmm_integrations', 'rmm_organization_mappings',
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
    private inWheres: Array<{ col: string; values: any[] }> = [];
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

    whereIn(col: string, values: any[]) {
      this.inWheres.push({ col: strip(col), values });
      return this;
    }

    whereNot(arg1: Record<string, any>) {
      const normalized: Record<string, any> = {};
      for (const [k, v] of Object.entries(arg1)) normalized[strip(k)] = v;
      this.notWheres.push(normalized);
      return this;
    }

    whereNotNull(col: string) {
      this.nullWheres.push({ col: strip(col), isNull: false });
      return this;
    }

    join(_table: string, _fn: unknown) { return this; }
    select(..._cols: unknown[]) { return this as any; }
    orderBy() { return this; }

    private filtered(): Row[] {
      let rows = [...this.rows];
      for (const where of this.objWheres) {
        rows = rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      }
      for (const where of this.notWheres) {
        rows = rows.filter((row) => !Object.entries(where).every(([k, v]) => row[k] === v));
      }
      for (const { col, values } of this.inWheres) {
        rows = rows.filter((row) => values.includes(row[col]));
      }
      for (const { col, isNull } of this.nullWheres) {
        rows = rows.filter((row) => (isNull ? row[col] == null : row[col] != null));
      }
      return rows;
    }

    first() {
      return Promise.resolve(this.filtered().map((row) => ({ ...row }))[0]);
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

const { suggestContactForAsset } = await import('../signedInUserMappings');

const TENANT = 'tenant-1';
const CLIENT = 'client-1';
const ASSET = 'asset-1';
const ORG = 'org-77';

beforeEach(() => {
  h.resetDb();
  h.dbState.assets.push({
    tenant: TENANT,
    asset_id: ASSET,
    client_id: CLIENT,
    rmm_provider: 'ninjaone',
    rmm_organization_id: ORG,
  });
  h.dbState.workstation_assets.push({
    tenant: TENANT,
    asset_id: ASSET,
    current_user: 'CORP\\jdoe',
  });
  h.dbState.contacts.push({
    tenant: TENANT,
    contact_name_id: 'c-jane',
    client_id: CLIENT,
    contact_kind: 'person',
    email: 'jdoe@acme.com',
    full_name: 'Jane Doe',
  });
});

describe('suggestContactForAsset', () => {
  it('reads the mapping of the integration whose provider the asset names', async () => {
    // A tacticalrmm mapping for the same organization id is `off`; the device is
    // a NinjaOne device, so the NinjaOne mapping's mode is what counts.
    h.dbState.rmm_integrations.push(
      { tenant: TENANT, integration_id: 'int-tactical', provider: 'tacticalrmm' },
      { tenant: TENANT, integration_id: 'int-ninja', provider: 'ninjaone' },
    );
    h.dbState.rmm_organization_mappings.push(
      {
        tenant: TENANT,
        integration_id: 'int-tactical',
        external_organization_id: ORG,
        client_id: CLIENT,
        contact_assignment_mode: 'off',
      },
      {
        tenant: TENANT,
        integration_id: 'int-ninja',
        external_organization_id: ORG,
        client_id: CLIENT,
        contact_assignment_mode: 'suggest',
      },
    );

    const suggestion = await suggestContactForAsset(h.knexMock, TENANT, ASSET);

    expect(suggestion).toMatchObject({
      integrationId: 'int-ninja',
      provider: 'ninjaone',
      contactId: 'c-jane',
      contactName: 'Jane Doe',
      rawUser: 'CORP\\jdoe',
    });
  });

  it('stays silent when that mapping is off, whatever the other one says', async () => {
    h.dbState.rmm_integrations.push(
      { tenant: TENANT, integration_id: 'int-ninja-old', provider: 'ninjaone' },
      { tenant: TENANT, integration_id: 'int-tactical', provider: 'tacticalrmm' },
    );
    h.dbState.rmm_organization_mappings.push(
      {
        tenant: TENANT,
        integration_id: 'int-tactical',
        external_organization_id: ORG,
        client_id: CLIENT,
        contact_assignment_mode: 'suggest',
      },
      {
        tenant: TENANT,
        integration_id: 'int-ninja-old',
        external_organization_id: ORG,
        client_id: CLIENT,
        contact_assignment_mode: 'off',
      },
    );

    expect(await suggestContactForAsset(h.knexMock, TENANT, ASSET)).toBeNull();
  });

  it('suggests by default when the mapping sets no mode', async () => {
    h.dbState.rmm_integrations.push({ tenant: TENANT, integration_id: 'int-ninja', provider: 'ninjaone' });
    h.dbState.rmm_organization_mappings.push({
      tenant: TENANT,
      integration_id: 'int-ninja',
      external_organization_id: ORG,
      client_id: CLIENT,
      contact_assignment_mode: null,
    });

    expect(await suggestContactForAsset(h.knexMock, TENANT, ASSET)).toMatchObject({
      integrationId: 'int-ninja',
      contactId: 'c-jane',
    });
  });

  it('returns nothing when no mapping points this organization at the asset client', async () => {
    h.dbState.rmm_integrations.push({ tenant: TENANT, integration_id: 'int-ninja', provider: 'ninjaone' });
    h.dbState.rmm_organization_mappings.push({
      tenant: TENANT,
      integration_id: 'int-ninja',
      external_organization_id: ORG,
      client_id: 'another-client',
      contact_assignment_mode: 'suggest',
    });

    expect(await suggestContactForAsset(h.knexMock, TENANT, ASSET)).toBeNull();
  });
});
