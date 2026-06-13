/**
 * T313 (F310): createAsset/updateAsset accept registered custom asset-type
 * slugs, reject unknown ones with a typed 'invalid_asset_type' error, validate
 * attributes against the type's fields_schema, and jsonb-MERGE attributes on
 * update (sibling namespaces like hudu_fields survive — same SQL shape as the
 * Phase 2.1 Hudu sync writer).
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
    dbState.asset_history = [];
    dbState.asset_relationships = [];
    dbState.asset_associations = [];
    dbState.team_members = [];
    dbState.users = [];
    dbState.user_roles = [];
    dbState.clients = [];
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
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knexMock, tenant: h.TENANT })),
  withTransaction: vi.fn(async (_knex: unknown, cb: (trx: unknown) => Promise<unknown>) => cb(h.knexMock)),
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

import { createAsset, updateAsset } from './assetActions';

const CLOUD_ACCOUNT_FIELDS = [
  { key: 'account_name', label: 'Account Name', kind: 'text', required: true },
  { key: 'seats', label: 'Seats', kind: 'number' },
];

function seedCloudAccountType() {
  h.dbState.asset_type_registry.push({
    tenant: TENANT,
    type_id: 'e0000000-0000-4000-8000-00000000000e',
    slug: 'cloud_account',
    name: 'Cloud Account',
    icon: null,
    fields_schema: JSON.stringify(CLOUD_ACCOUNT_FIELDS),
    is_builtin: false,
    display_order: 0,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  });
}

function seedAsset(overrides: Row = {}): Row {
  const row: Row = {
    tenant: TENANT,
    asset_id: 'f0000000-0000-4000-8000-00000000000f',
    asset_type: 'cloud_account',
    client_id: CLIENT_ID,
    asset_tag: 'CA-001',
    name: 'Acme Cloud',
    status: 'active',
    serial_number: '',
    location: '',
    location_id: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    attributes: { account_name: 'Old Name', hudu_fields: [{ label: 'Plan', value: 'Gold' }] },
    ...overrides,
  };
  h.dbState.assets.push(row);
  return row;
}

const baseCreateRequest = {
  asset_type: 'cloud_account',
  client_id: CLIENT_ID,
  asset_tag: 'CA-001',
  name: 'Acme Cloud',
  status: 'active',
} as const;

beforeEach(() => {
  h.resetDb();
  vi.clearAllMocks();
});

describe('createAsset with custom asset types (T313)', () => {
  it('accepts a registered custom slug with an attributes payload (extra namespace keys allowed)', async () => {
    seedCloudAccountType();

    const created = await createAsset({
      ...baseCreateRequest,
      attributes: { account_name: 'Acme Prod', seats: 25, acme_namespace: { keep: true } },
    });

    expect(created.asset_type).toBe('cloud_account');
    expect(created.attributes).toEqual({
      account_name: 'Acme Prod',
      seats: 25,
      acme_namespace: { keep: true },
    });

    expect(h.dbState.assets).toHaveLength(1);
    expect(h.dbState.assets[0].attributes).toEqual({
      account_name: 'Acme Prod',
      seats: 25,
      acme_namespace: { keep: true },
    });
  });

  it('rejects an unregistered slug with a typed invalid_asset_type error and inserts nothing', async () => {
    await expect(createAsset({ ...baseCreateRequest, asset_type: 'door_access' })).rejects.toThrow(
      /invalid_asset_type/
    );

    await createAsset({ ...baseCreateRequest, asset_type: 'door_access' }).catch((error: Error) => {
      expect(JSON.parse(error.message)).toEqual({ kind: 'invalid_asset_type', asset_type: 'door_access' });
    });

    expect(h.dbState.assets).toHaveLength(0);
  });

  it('enforces required schema fields for custom types', async () => {
    seedCloudAccountType();

    await createAsset({ ...baseCreateRequest, attributes: { seats: 3 } }).catch((error: Error) => {
      const parsed = JSON.parse(error.message);
      expect(parsed.kind).toBe('validation');
      expect(parsed.issues).toEqual([
        { path: ['attributes', 'account_name'], message: 'Account Name is required', code: 'required' },
      ]);
    });

    expect(h.dbState.assets).toHaveLength(0);
  });

  it('rejects schema-kind mismatches for custom types', async () => {
    seedCloudAccountType();

    await createAsset({
      ...baseCreateRequest,
      attributes: { account_name: 'ok', seats: 'five' },
    }).catch((error: Error) => {
      const parsed = JSON.parse(error.message);
      expect(parsed.kind).toBe('validation');
      expect(parsed.issues[0].path).toEqual(['attributes', 'seats']);
    });

    expect(h.dbState.assets).toHaveLength(0);
  });

  it('built-in regression: workstation create still lands extension data, no registry lookup, no attributes', async () => {
    // Registry intentionally EMPTY — built-ins must not require a registry row.
    const created = await createAsset({
      ...baseCreateRequest,
      asset_type: 'workstation',
      workstation: {
        os_type: 'Windows',
        os_version: '11',
        cpu_model: 'i7',
        cpu_cores: 8,
        ram_gb: 32,
        storage_type: 'nvme',
        storage_capacity_gb: 1024,
        installed_software: [],
      },
    });

    expect(created.asset_type).toBe('workstation');
    expect(created.workstation).toMatchObject({ os_type: 'Windows', os_version: '11' });
    expect(created.attributes).toBeUndefined();
    expect(h.dbState.workstation_assets).toHaveLength(1);
  });
});

describe('updateAsset with custom asset types (T313)', () => {
  it('jsonb-MERGES the attributes payload so sibling namespaces survive', async () => {
    seedCloudAccountType();
    const asset = seedAsset();

    const updated = await updateAsset(asset.asset_id, {
      attributes: { account_name: 'New Name' },
    });

    // Merge semantics: hudu_fields untouched, schema key overwritten.
    expect(h.dbState.assets[0].attributes).toEqual({
      account_name: 'New Name',
      hudu_fields: [{ label: 'Plan', value: 'Gold' }],
    });
    expect(updated.attributes).toEqual({
      account_name: 'New Name',
      hudu_fields: [{ label: 'Plan', value: 'Gold' }],
    });

    // SQL shape: coalesce-merge, exactly like the Phase 2.1 hudu writer.
    const attributeUpdate = h.updateCalls.find(
      (call) => call.table === 'assets' && call.patch.attributes
    );
    expect(attributeUpdate).toBeDefined();
    const raw = attributeUpdate!.patch.attributes as { sql: string; bindings: string };
    expect(raw.sql).toContain(`coalesce(attributes, '{}'::jsonb) ||`);
    expect(JSON.parse(raw.bindings)).toEqual({ account_name: 'New Name' });
  });

  it('rejects an unregistered asset_type with the typed error and leaves the row untouched', async () => {
    seedCloudAccountType();
    const asset = seedAsset();

    await expect(updateAsset(asset.asset_id, { asset_type: 'door_access' })).rejects.toThrow(
      /invalid_asset_type/
    );
    expect(h.dbState.assets[0].asset_type).toBe('cloud_account');
    expect(h.dbState.assets[0].attributes.account_name).toBe('Old Name');
  });

  it('validates provided attribute kinds against the current custom type schema', async () => {
    seedCloudAccountType();
    const asset = seedAsset();

    await updateAsset(asset.asset_id, { attributes: { seats: 'five' } }).catch((error: Error) => {
      const parsed = JSON.parse(error.message);
      expect(parsed.kind).toBe('validation');
      expect(parsed.issues[0].path).toEqual(['attributes', 'seats']);
    });

    expect(h.dbState.assets[0].attributes).toEqual({
      account_name: 'Old Name',
      hudu_fields: [{ label: 'Plan', value: 'Gold' }],
    });
  });

  it('allows partial updates that omit required fields (merge keeps stored values)', async () => {
    seedCloudAccountType();
    const asset = seedAsset();

    await updateAsset(asset.asset_id, { attributes: { seats: 50 } });

    expect(h.dbState.assets[0].attributes).toEqual({
      account_name: 'Old Name',
      seats: 50,
      hudu_fields: [{ label: 'Plan', value: 'Gold' }],
    });
  });

  it('switches a built-in asset to a registered custom slug, dropping the old extension row safely', async () => {
    seedCloudAccountType();
    const asset = seedAsset({
      asset_type: 'workstation',
      attributes: null,
    });
    h.dbState.workstation_assets.push({
      tenant: TENANT,
      asset_id: asset.asset_id,
      os_type: 'Windows',
      os_version: '11',
      cpu_model: 'i7',
      cpu_cores: 8,
      ram_gb: 32,
      storage_type: 'nvme',
      storage_capacity_gb: 1024,
      installed_software: [],
    });

    const updated = await updateAsset(asset.asset_id, {
      asset_type: 'cloud_account',
      attributes: { account_name: 'Migrated' },
    });

    expect(updated.asset_type).toBe('cloud_account');
    expect(h.dbState.workstation_assets).toHaveLength(0);
    expect(h.dbState.assets[0].attributes).toEqual({ account_name: 'Migrated' });
  });
});
