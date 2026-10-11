/**
 * Contact assignment on assets (portal manager scope): the assignee must be a
 * real person (not a shared mailbox) belonging to the asset's effective client;
 * an explicit null clears it; moving the asset to another client clears it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'a0000000-0000-4000-8000-00000000000a';
const CLIENT_ID = 'b0000000-0000-4000-8000-00000000000b';
const NOW_ISO = '2026-06-12T12:00:00.000Z';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const TENANT = 'a0000000-0000-4000-8000-00000000000a';

  const dbState: Record<string, Row[]> = {};
  const updateCalls: Array<{ table: string; patch: Row }> = [];
  let uuidCounter = 0;

  const nextUuid = () => {
    uuidCounter += 1;
    return `c0000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
  };

  const resetDb = () => {
    for (const key of Object.keys(dbState)) delete dbState[key];
    dbState.assets = [];
    dbState.asset_type_registry = [];
    dbState.asset_remote_access_links = [];
    dbState.asset_history = [];
    dbState.asset_relationships = [];
    dbState.asset_associations = [];
    dbState.team_members = [];
    dbState.users = [];
    dbState.user_roles = [];
    dbState.clients = [];
    dbState.contacts = [];
    dbState.workstation_assets = [];
    dbState.network_device_assets = [];
    dbState.server_assets = [];
    dbState.mobile_device_assets = [];
    dbState.printer_assets = [];
    updateCalls.length = 0;
    uuidCounter = 0;
  };

  const stripPrefix = (key: string) => (key.includes('.') ? key.split('.').pop()! : key);

  const isRaw = (value: unknown): value is { __raw: true; sql: string; bindings: string } =>
    Boolean(value && typeof value === 'object' && (value as any).__raw === true);

  class QB {
    private readonly table: string;
    private objWheres: Array<Record<string, any>> = [];
    private inWheres: Array<{ col: string; vals: any[] }> = [];

    constructor(tableSpec: string) {
      this.table = tableSpec.split(' as ')[0];
    }

    private get rows(): Row[] {
      if (!dbState[this.table]) dbState[this.table] = [];
      return dbState[this.table];
    }

    private notWheres: Array<Record<string, any>> = [];

    whereNot(arg1: Record<string, any>) {
      const normalized: Record<string, any> = {};
      for (const [key, value] of Object.entries(arg1)) normalized[stripPrefix(key)] = value;
      this.notWheres.push(normalized);
      return this;
    }

    where(arg1: any, arg2?: any) {
      if (typeof arg1 === 'function') return this;
      if (typeof arg1 === 'string') {
        this.objWheres.push({ [stripPrefix(arg1)]: arg2 });
        return this;
      }
      const normalized: Record<string, any> = {};
      for (const [key, value] of Object.entries(arg1)) normalized[stripPrefix(key)] = value;
      this.objWheres.push(normalized);
      return this;
    }

    andWhere(arg1: any, arg2?: any) {
      return this.where(arg1, arg2);
    }

    orWhere() {
      return this;
    }

    whereIn(col: string, vals: any[]) {
      this.inWheres.push({ col: stripPrefix(col), vals });
      return this;
    }

    select(..._cols: any[]) {
      return this;
    }

    leftJoin(_table: any, _fn: any) {
      return this;
    }

    orderBy() {
      return this;
    }

    private filtered(): Row[] {
      let rows = [...this.rows];
      for (const where of this.objWheres) {
        rows = rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      }
      for (const { col, vals } of this.inWheres) {
        rows = rows.filter((row) => vals.includes(row[col]));
      }
      for (const where of this.notWheres) {
        rows = rows.filter((row) => !Object.entries(where).every(([k, v]) => row[k] === v));
      }
      return rows;
    }

    // Real knex returns detached row objects — copy so later UPDATEs can't
    // mutate rows a caller already fetched.
    private detached(): Row[] {
      return this.filtered().map((row) => ({ ...row }));
    }

    first() {
      return Promise.resolve(this.detached()[0]);
    }

    insert(data: Row | Row[]) {
      const incoming = (Array.isArray(data) ? data : [data]).map((row) => {
        const copy: Row = { ...row };
        if (this.table === 'assets' && !copy.asset_id) copy.asset_id = nextUuid();
        if (typeof copy.attributes === 'string') copy.attributes = JSON.parse(copy.attributes);
        return copy;
      });
      this.rows.push(...incoming);
      const result: any = Promise.resolve(incoming);
      result.returning = () => Promise.resolve(incoming);
      return result;
    }

    update(patch: Row) {
      updateCalls.push({ table: this.table, patch });
      const applied: Row = {};
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'attributes' && isRaw(value)) {
          continue; // applied per-row below
        }
        applied[key] = value;
      }
      const rows = this.filtered();
      for (const row of rows) {
        Object.assign(row, applied);
        if (isRaw(patch.attributes)) {
          // simulate `coalesce(attributes,'{}'::jsonb) || ?::jsonb`
          row.attributes = { ...(row.attributes ?? {}), ...JSON.parse(patch.attributes.bindings) };
        } else if (typeof row.attributes === 'string') {
          row.attributes = JSON.parse(row.attributes);
        }
      }
      return Promise.resolve(rows.length);
    }

    delete() {
      const remaining = this.rows.filter(
        (row) =>
          !(
            this.objWheres.every((where) => Object.entries(where).every(([k, v]) => row[k] === v)) &&
            this.inWheres.every(({ col, vals }) => vals.includes(row[col]))
          )
      );
      const removed = this.rows.length - remaining.length;
      dbState[this.table] = remaining;
      return Promise.resolve(removed);
    }

    then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
      return Promise.resolve(this.detached()).then(resolve, reject);
    }

    catch(onReject: (reason: unknown) => any) {
      return Promise.resolve(this.detached()).catch(onReject);
    }
  }

  const knexMock: any = (tableSpec: string) => new QB(tableSpec);
  knexMock.raw = (sql: string, bindings: string) => ({ __raw: true, sql, bindings });
  knexMock.fn = { now: () => '2026-06-12T12:00:00.000Z' };
  knexMock.transaction = async (cb: (trx: any) => Promise<any>) => cb(knexMock);
  knexMock.schema = { hasTable: async () => false };

  const mockUser = {
    user_id: 'd0000000-0000-4000-8000-00000000000d',
    user_type: 'internal' as const,
    roles: [{ role_id: 'role-1' }],
  };

  return { TENANT, dbState, updateCalls, knexMock, mockUser, resetDb };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(h.mockUser, { tenant: h.TENANT }, ...args),
  hasPermission: vi.fn(async () => true),
  localizeActionError: vi.fn(async (error: unknown) => error),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knexMock, tenant: h.TENANT })),
  withTransaction: vi.fn(async (_knex: unknown, cb: (trx: unknown) => Promise<unknown>) => cb(h.knexMock)),
  tenantDb: (conn: any, tenant: string) => ({
    table: (t: string) => conn(t).where({ tenant }),
    unscoped: (t: string, _reason?: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
  }),
}));

vi.mock('@alga-psa/core', () => ({ deleteEntityWithValidation: vi.fn() }));

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(async () => undefined) }));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildAssetAssignedPayload: vi.fn(() => ({})),
  buildAssetCreatedPayload: vi.fn(() => ({})),
  buildAssetUnassignedPayload: vi.fn(() => ({})),
  buildAssetUpdatedPayload: vi.fn(() => ({})),
  buildAssetWarrantyExpiringPayload: vi.fn(() => ({})),
  computeAssetWarrantyExpiring: vi.fn(() => null),
}));

vi.mock('@alga-psa/authorization/kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {
    constructor(_opts: unknown) {}
  },
  RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: () => ({ authorizeResource: async () => ({ allowed: true }) }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

vi.mock('@alga-psa/authorization/pagination', () => ({
  buildAuthorizationAwarePage: vi.fn(),
}));

vi.mock('../lib/assetFactsService', () => ({
  listAvailableAssetFactsForAsset: vi.fn(async () => []),
}));

import { createAsset, updateAsset, bulkUpdateAssets } from './assetActions';

const OTHER_CLIENT_ID = 'b1000000-0000-4000-8000-00000000000b';
const CONTACT_ID = '11000000-0000-4000-8000-000000000001';
const OTHER_CLIENT_CONTACT_ID = '11000000-0000-4000-8000-000000000002';
const MAILBOX_ID = '11000000-0000-4000-8000-000000000003';
const MISSING_CONTACT_ID = '11000000-0000-4000-8000-0000000000ff';
const UNAVAILABLE = 'Selected contact is not available for this client';

function seedContacts() {
  h.dbState.contacts.push(
    { tenant: TENANT, contact_name_id: CONTACT_ID, client_id: CLIENT_ID, full_name: 'Pat Person', contact_kind: 'person' },
    { tenant: TENANT, contact_name_id: OTHER_CLIENT_CONTACT_ID, client_id: OTHER_CLIENT_ID, full_name: 'Olive Other', contact_kind: 'person' },
    { tenant: TENANT, contact_name_id: MAILBOX_ID, client_id: CLIENT_ID, full_name: 'helpdesk@acme', contact_kind: 'shared_mailbox' }
  );
}

function seedAsset(overrides: Row = {}): Row {
  const row: Row = {
    tenant: TENANT,
    asset_id: 'f0000000-0000-4000-8000-00000000000f',
    asset_type: 'workstation',
    client_id: CLIENT_ID,
    asset_tag: 'WS-001',
    name: 'Front desk PC',
    status: 'active',
    serial_number: '',
    location: '',
    location_id: null,
    contact_name_id: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    attributes: null,
    ...overrides,
  };
  h.dbState.assets.push(row);
  return row;
}

const baseCreateRequest = {
  asset_type: 'workstation',
  client_id: CLIENT_ID,
  asset_tag: 'WS-001',
  name: 'Front desk PC',
  status: 'active',
} as const;

const rejection = async (promise: Promise<unknown>) => {
  try {
    const result = await promise;
    // withAuth-wrapped actions may resolve with a typed action error instead of throwing.
    return result instanceof Error ? result : new Error(JSON.stringify(result));
  } catch (error) {
    return error as Error;
  }
};

beforeEach(() => {
  h.resetDb();
  vi.clearAllMocks();
  seedContacts();
});

describe('createAsset contact assignment', () => {
  it('stores a valid contact of the asset client', async () => {
    const created = await createAsset({ ...baseCreateRequest, contact_name_id: CONTACT_ID });

    expect(h.dbState.assets[0].contact_name_id).toBe(CONTACT_ID);
    expect(created.contact_name_id).toBe(CONTACT_ID);
  });

  it('defaults to unassigned when no contact is given', async () => {
    await createAsset({ ...baseCreateRequest });
    expect(h.dbState.assets[0].contact_name_id).toBeNull();
  });

  it('rejects a contact that belongs to another client and inserts nothing', async () => {
    const error = await rejection(createAsset({ ...baseCreateRequest, contact_name_id: OTHER_CLIENT_CONTACT_ID }));
    expect(error.message).toContain(UNAVAILABLE);
    expect(h.dbState.assets).toHaveLength(0);
  });

  it('rejects a shared mailbox contact', async () => {
    const error = await rejection(createAsset({ ...baseCreateRequest, contact_name_id: MAILBOX_ID }));
    expect(error.message).toContain(UNAVAILABLE);
    expect(h.dbState.assets).toHaveLength(0);
  });

  it('rejects a contact that does not exist in the tenant', async () => {
    const error = await rejection(createAsset({ ...baseCreateRequest, contact_name_id: MISSING_CONTACT_ID }));
    expect(error.message).toContain(UNAVAILABLE);
    expect(h.dbState.assets).toHaveLength(0);
  });

  it('rejects a contact id that is not a uuid', async () => {
    const error = await rejection(createAsset({ ...baseCreateRequest, contact_name_id: 'not-a-uuid' }));
    expect(error).toBeInstanceOf(Error);
    expect(h.dbState.assets).toHaveLength(0);
  });
});

describe('updateAsset contact assignment', () => {
  it('assigns a valid contact', async () => {
    const asset = seedAsset();
    const updated = await updateAsset(asset.asset_id, { contact_name_id: CONTACT_ID });

    expect(h.dbState.assets[0].contact_name_id).toBe(CONTACT_ID);
    expect(updated.contact_name_id).toBe(CONTACT_ID);
  });

  it('keeps an explicit null and clears the assignee', async () => {
    const asset = seedAsset({ contact_name_id: CONTACT_ID });
    await updateAsset(asset.asset_id, { contact_name_id: null });

    const clearing = h.updateCalls.find((call) => call.table === 'assets' && 'contact_name_id' in call.patch);
    expect(clearing?.patch.contact_name_id).toBeNull();
    expect(h.dbState.assets[0].contact_name_id).toBeNull();
  });

  it('leaves the assignee alone when the field is omitted', async () => {
    const asset = seedAsset({ contact_name_id: CONTACT_ID });
    await updateAsset(asset.asset_id, { name: 'Renamed' });

    expect(h.dbState.assets[0].contact_name_id).toBe(CONTACT_ID);
    expect(h.dbState.assets[0].name).toBe('Renamed');
  });

  it('rejects a contact from another client, a shared mailbox and a missing contact', async () => {
    const asset = seedAsset();

    for (const contactId of [OTHER_CLIENT_CONTACT_ID, MAILBOX_ID, MISSING_CONTACT_ID]) {
      const error = await rejection(updateAsset(asset.asset_id, { contact_name_id: contactId }));
      expect(error.message).toContain(UNAVAILABLE);
    }
    expect(h.dbState.assets[0].contact_name_id).toBeNull();
  });

  it('clears the assignee when the asset moves to another client', async () => {
    const asset = seedAsset({ contact_name_id: CONTACT_ID });
    await updateAsset(asset.asset_id, { client_id: OTHER_CLIENT_ID });

    expect(h.dbState.assets[0].client_id).toBe(OTHER_CLIENT_ID);
    expect(h.dbState.assets[0].contact_name_id).toBeNull();
  });

  it('keeps the assignee when client_id is sent unchanged', async () => {
    const asset = seedAsset({ contact_name_id: CONTACT_ID });
    await updateAsset(asset.asset_id, { client_id: CLIENT_ID });

    expect(h.dbState.assets[0].contact_name_id).toBe(CONTACT_ID);
  });

  it('validates a new contact against the NEW client when the client changes in the same update', async () => {
    const asset = seedAsset({ contact_name_id: CONTACT_ID });

    const stale = await rejection(updateAsset(asset.asset_id, { client_id: OTHER_CLIENT_ID, contact_name_id: CONTACT_ID }));
    expect(stale.message).toContain(UNAVAILABLE);
    expect(h.dbState.assets[0].client_id).toBe(CLIENT_ID);

    await updateAsset(asset.asset_id, { client_id: OTHER_CLIENT_ID, contact_name_id: OTHER_CLIENT_CONTACT_ID });
    expect(h.dbState.assets[0]).toMatchObject({ client_id: OTHER_CLIENT_ID, contact_name_id: OTHER_CLIENT_CONTACT_ID });
  });
});

describe('bulkUpdateAssets contact assignment', () => {
  it('assigns per asset and reports per-asset failures for contacts of another client', async () => {
    const own = seedAsset({ asset_id: 'f0000000-0000-4000-8000-0000000000a1' });
    const foreign = seedAsset({ asset_id: 'f0000000-0000-4000-8000-0000000000a2', client_id: OTHER_CLIENT_ID });

    const response: any = await bulkUpdateAssets([own.asset_id, foreign.asset_id], { contact_name_id: CONTACT_ID });

    expect(response.succeeded).toBe(1);
    expect(response.failed).toBe(1);
    const failure = response.results.find((r: any) => !r.success);
    expect(failure.asset_id).toBe(foreign.asset_id);
    expect(failure.error).toContain(UNAVAILABLE);
    expect(h.dbState.assets.find((a) => a.asset_id === own.asset_id)?.contact_name_id).toBe(CONTACT_ID);
    expect(h.dbState.assets.find((a) => a.asset_id === foreign.asset_id)?.contact_name_id).toBeNull();
  });
});
