import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FR-D6 — how far the "auto" follow-along reaches.
 *
 * An integration can cover several clients. Walking every `auto` organization
 * of the integration meant another client's device reporting the same
 * `CORP\jdoe` was handed our contact: the assignment helper rejects a contact
 * from another client, the throw rolled back the whole transaction, and the
 * operator lost both the explicit mapping and the assignment they clicked.
 */

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const dbState: Record<string, Row[]> = {};

  const resetDb = () => {
    for (const key of Object.keys(dbState)) delete dbState[key];
    for (const name of [
      'assets', 'contacts', 'workstation_assets', 'server_assets',
      'rmm_organization_mappings', 'tenant_external_entity_mappings',
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
      this.objWheres.push({ __notNull: strip(col) });
      return this;
    }

    join() { return this; }
    select(..._cols: unknown[]) { return this as any; }
    orderBy() { return this; }

    private filtered(): Row[] {
      let rows = [...this.rows];
      for (const where of this.objWheres) {
        if (where.__notNull) {
          rows = rows.filter((row) => row[where.__notNull] != null);
          continue;
        }
        rows = rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      }
      for (const where of this.notWheres) {
        rows = rows.filter((row) => !Object.entries(where).every(([k, v]) => row[k] === v));
      }
      for (const { col, values } of this.inWheres) {
        rows = rows.filter((row) => values.includes(row[col]));
      }
      return rows;
    }

    insert(values: Row | Row[]) {
      for (const value of Array.isArray(values) ? values : [values]) this.rows.push({ ...value });
      return Promise.resolve([{ ...(Array.isArray(values) ? values[0] : values) }]) as any;
    }

    update(patch: Row) {
      const matched = this.filtered();
      for (const row of this.rows) {
        if (matched.includes(row)) Object.assign(row, patch);
      }
      return Promise.resolve(matched.length) as any;
    }

    delete() {
      const matched = new Set(this.filtered());
      const kept = this.rows.filter((row) => !matched.has(row));
      dbState[this.table] = kept;
      return Promise.resolve(matched.size) as any;
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

  const setAssetAssignee = vi.fn();
  const getOpenAssetAssignment = vi.fn(async () => null);

  return { dbState, knexMock, resetDb, setAssetAssignee, getOpenAssetAssignment };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (name: string) => conn(name).where({ tenant }),
  }),
}));

class FakeAssigneeError extends Error {
  readonly code = 'workspace_member';
  constructor() {
    super('workspace member');
    this.name = 'AssetAssigneeError';
  }
}

vi.mock('../../models/assetAssignmentModel', () => ({
  setAssetAssignee: h.setAssetAssignee,
  getOpenAssetAssignment: h.getOpenAssetAssignment,
  isAssetAssigneeError: (error: unknown) =>
    error instanceof Error && error.name === 'AssetAssigneeError',
}));

const { mapSignedInUserToContact } = await import('../signedInUserMappings');

const TENANT = 'tenant-1';
const INTEGRATION = 'int-1';
const OURS = 'client-ours';
const THEIRS = 'client-theirs';

function device(assetId: string, clientId: string, org: string, user: string) {
  h.dbState.assets.push({
    tenant: TENANT,
    asset_id: assetId,
    client_id: clientId,
    rmm_provider: 'ninjaone',
    rmm_organization_id: org,
  });
  h.dbState.workstation_assets.push({ tenant: TENANT, asset_id: assetId, current_user: user });
}

beforeEach(() => {
  h.resetDb();
  h.setAssetAssignee.mockReset();
  h.setAssetAssignee.mockResolvedValue({ changed: true, previousContactId: null, contactId: 'c-jane' });
  h.getOpenAssetAssignment.mockReset();
  h.getOpenAssetAssignment.mockResolvedValue(null);

  h.dbState.contacts.push({
    tenant: TENANT,
    contact_name_id: 'c-jane',
    client_id: OURS,
    contact_kind: 'person',
    email: 'jdoe@acme.com',
    full_name: 'Jane Doe',
  });

  // Two organizations on one integration, both auto, different clients.
  h.dbState.rmm_organization_mappings.push(
    {
      tenant: TENANT,
      integration_id: INTEGRATION,
      external_organization_id: 'org-ours',
      client_id: OURS,
      contact_assignment_mode: 'auto',
    },
    {
      tenant: TENANT,
      integration_id: INTEGRATION,
      external_organization_id: 'org-theirs',
      client_id: THEIRS,
      contact_assignment_mode: 'auto',
    },
  );

  device('asset-ours', OURS, 'org-ours', 'CORP\\jdoe');
  device('asset-theirs', THEIRS, 'org-theirs', 'CORP\\jdoe');
});

describe('mapSignedInUserToContact', () => {
  it('only follows along inside the contact’s own client', async () => {
    const result = await mapSignedInUserToContact(h.knexMock, TENANT, {
      integrationId: INTEGRATION,
      provider: 'ninjaone',
      rawUser: 'CORP\\jdoe',
      contactId: 'c-jane',
      actorUserId: 'user-1',
    });

    expect(result.assignedAssetIds).toEqual(['asset-ours']);
    const touched = h.setAssetAssignee.mock.calls.map((call) => call[2]);
    expect(touched).not.toContain('asset-theirs');
    // The explicit mapping survives, which is the whole point.
    expect(h.dbState.tenant_external_entity_mappings).toHaveLength(1);
  });

  it('skips a device the assignment helper refuses and keeps the rest', async () => {
    device('asset-ours-2', OURS, 'org-ours', 'CORP\\jdoe');
    h.setAssetAssignee.mockImplementation(async (_trx: unknown, _tenant: string, assetId: string) => {
      if (assetId === 'asset-ours') throw new FakeAssigneeError();
      return { changed: true, previousContactId: null, contactId: 'c-jane' };
    });

    const result = await mapSignedInUserToContact(h.knexMock, TENANT, {
      integrationId: INTEGRATION,
      provider: 'ninjaone',
      rawUser: 'CORP\\jdoe',
      contactId: 'c-jane',
      actorUserId: 'user-1',
    });

    expect(result.assignedAssetIds).toEqual(['asset-ours-2']);
    expect(h.dbState.tenant_external_entity_mappings).toHaveLength(1);
  });

  it('lets a real failure out rather than swallowing it', async () => {
    h.setAssetAssignee.mockRejectedValue(new Error('connection terminated'));

    await expect(
      mapSignedInUserToContact(h.knexMock, TENANT, {
        integrationId: INTEGRATION,
        provider: 'ninjaone',
        rawUser: 'CORP\\jdoe',
        contactId: 'c-jane',
        actorUserId: 'user-1',
      }),
    ).rejects.toThrow('connection terminated');
  });

  it('removing a mapping assigns nothing', async () => {
    await mapSignedInUserToContact(h.knexMock, TENANT, {
      integrationId: INTEGRATION,
      provider: 'ninjaone',
      rawUser: 'CORP\\jdoe',
      contactId: null,
    });

    expect(h.setAssetAssignee).not.toHaveBeenCalled();
  });
});
