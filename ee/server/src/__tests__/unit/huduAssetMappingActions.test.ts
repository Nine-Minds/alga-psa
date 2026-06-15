/**
 * T214–T217 — Hudu asset-mapping persistence + server actions.
 *
 * Persistence (T214/T215) runs against the REAL local dev DB (shared CE table
 * tenant_external_entity_mappings), mirroring
 * hudu-company-mappings.integration.test.ts incl. the advisory-lock
 * serialization; the real row functions are reached via vi.importActual.
 * The action layer (T216/T217) is unit-mocked like huduMappingActions.test.ts:
 * auth, flag, tiers, knex, huduDataActions and the row functions are fakes;
 * the matcher (assetMatching) and the reference cache stay REAL.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import { HUDU_MAPPING_TABLE } from '../../lib/integrations/hudu/contracts';
import { setCachedHuduList, clearHuduReferenceCache } from '../../lib/integrations/hudu/referenceData';

const TENANT = 'tenant-hudu-assets-1';
const CLIENT_1 = '11111111-1111-1111-1111-111111111111';
const ASSET_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const ASSET_2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
const HUDU_COMPANY_ID = '55';

const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

const hasPermissionMock = vi.fn();
const isEnabledMock = vi.fn();
const assertTierAccessMock = vi.fn();

const createTenantKnexMock = vi.fn();
let assetsRows: Array<{ asset_id: string; asset_name: string; serial_number: string | null }> = [];
const knexCallableMock = vi.fn((_table: string) => {
  const qb: Record<string, unknown> = {};
  qb.where = vi.fn(() => qb);
  qb.select = vi.fn(async () => assetsRows);
  return qb;
});

const getHuduCompanyAssetsMock = vi.fn();
const resolveHuduCompanyIdForClientMock = vi.fn();

const getHuduAssetMappingRowsMock = vi.fn();
const setHuduAssetMappingRowMock = vi.fn();
const clearHuduAssetMappingRowMock = vi.fn();
const getHuduAssetLayoutTypeMapMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    (...args: unknown[]) =>
      handler(internalUser, { tenant: TENANT }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/feature-flags/featureFlags', () => ({
  featureFlags: { isEnabled: isEnabledMock },
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: assertTierAccessMock,
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@ee/lib/actions/integrations/huduDataActions', () => ({
  getHuduCompanyAssets: getHuduCompanyAssetsMock,
}));

// Keep the REAL constants/shapes; fake only the resolver the actions consume.
vi.mock('@ee/lib/integrations/hudu/companyMapping', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  resolveHuduCompanyIdForClient: resolveHuduCompanyIdForClientMock,
}));

// Keep the REAL module (the DB block reaches it via importActual); fake only
// the knex-level row access for the action layer.
vi.mock('@ee/lib/integrations/hudu/assetMapping', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getHuduAssetMappingRows: getHuduAssetMappingRowsMock,
  setHuduAssetMappingRow: setHuduAssetMappingRowMock,
  clearHuduAssetMappingRow: clearHuduAssetMappingRowMock,
}));

// Keep isLayoutExcluded REAL; fake only the settings read (F259).
vi.mock('@ee/lib/integrations/hudu/assetLayoutMap', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getHuduAssetLayoutTypeMap: getHuduAssetLayoutTypeMapMock,
}));

async function importActions() {
  return import('@ee/lib/actions/integrations/huduAssetMappingActions');
}

function huduItems() {
  return [
    {
      id: 1,
      company_id: 55,
      name: 'EC-WS-001',
      asset_type: 'Computer Assets',
      asset_layout_id: 7,
      primary_serial: 'SN-EC-1001',
      url: '/a/1',
      archived: false,
      hudu_url: 'https://hudu.example.com/a/1',
    },
    {
      id: 2,
      company_id: 55,
      name: 'EC-SRV-01',
      asset_type: 'Computer Assets',
      asset_layout_id: 7,
      primary_serial: null,
      url: '/a/2',
      archived: false,
      hudu_url: 'https://hudu.example.com/a/2',
    },
    { id: 3, company_id: 55, name: 'Printer Closet B', archived: true, hudu_url: null },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  clearHuduReferenceCache();
  assetsRows = [];

  hasPermissionMock.mockResolvedValue(true);
  isEnabledMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);

  createTenantKnexMock.mockResolvedValue({ knex: knexCallableMock, tenant: TENANT });

  getHuduCompanyAssetsMock.mockResolvedValue({
    state: 'ok',
    items: huduItems(),
    count: 3,
    huduCompanyId: HUDU_COMPANY_ID,
    companyUrl: 'https://hudu.example.com/c/55',
    fetchedAt: '2026-06-11T10:00:00.000Z',
    fromCache: true,
  });
  resolveHuduCompanyIdForClientMock.mockResolvedValue(HUDU_COMPANY_ID);
  getHuduAssetMappingRowsMock.mockResolvedValue([]);
  setHuduAssetMappingRowMock.mockResolvedValue({ ok: true, mapping: { id: 'am-9' } });
  clearHuduAssetMappingRowMock.mockResolvedValue(1);
  getHuduAssetLayoutTypeMapMock.mockResolvedValue({});
});

// ============================================================================
// T214/T215 — persistence against the real DB (advisory-lock serialized)
// ============================================================================

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd(), '..', '..');

function readPostgresPassword(): string {
  try {
    return fs.readFileSync(path.join(repoRoot, 'secrets', 'postgres_password'), 'utf8').trim();
  } catch {
    return process.env.DB_PASSWORD_ADMIN || 'postpass123';
  }
}

describe('hudu asset mappings — DB persistence (T214/T215)', () => {
  const HOOK_TIMEOUT = 60_000;

  let db: Knex;
  let tenantId: string;
  let clientA: string;
  let assetA: string;
  let assetB: string;
  let assetMappingDb: typeof import('../../lib/integrations/hudu/assetMapping');
  let companyMappingDb: typeof import('../../lib/integrations/hudu/companyMapping');

  beforeAll(async () => {
    assetMappingDb = await vi.importActual('@ee/lib/integrations/hudu/assetMapping');
    companyMappingDb = await vi.importActual('@ee/lib/integrations/hudu/companyMapping');

    db = knexFactory({
      client: 'pg',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER_ADMIN || 'postgres',
        password: readPostgresPassword(),
        database: process.env.HUDU_TEST_DB_NAME || 'server',
      },
      // Single connection so the advisory lock below is held for the whole file.
      pool: { min: 1, max: 1 },
    });

    await db.raw('select 1');
    // Serialize against the other hudu DB tests (shared lock key, see
    // hudu-company-mappings.integration.test.ts).
    await db.raw("select pg_advisory_lock(hashtext('hudu-db-integration-tests'))");

    if (!(await db.schema.hasTable(HUDU_MAPPING_TABLE))) {
      const migration = require(
        path.resolve(repoRoot, 'server', 'migrations', '20250502173321_create_tenant_external_entity_mappings.cjs')
      );
      await migration.up(db);
      if (await db.schema.hasColumn(HUDU_MAPPING_TABLE, 'tenant_id')) {
        await db.raw(`ALTER TABLE ${HUDU_MAPPING_TABLE} RENAME COLUMN tenant_id TO tenant`);
      }
    }

    tenantId = randomUUID();
    await db('tenants').insert({
      tenant: tenantId,
      client_name: 'Hudu Asset Mapping Test Tenant',
      email: `hudu-asset-mapping-${tenantId}@example.test`,
    });

    const [client] = await db('clients')
      .insert({ tenant: tenantId, client_name: 'ExampleCo' })
      .returning(['client_id']);
    clientA = client.client_id;

    const inserted = await db('assets')
      .insert([
        {
          tenant: tenantId,
          client_id: clientA,
          asset_tag: 'HUDU-T214-1',
          name: 'EC-WS-001',
          status: 'active',
          asset_type: 'workstation',
          serial_number: 'SN-EC-1001',
        },
        {
          tenant: tenantId,
          client_id: clientA,
          asset_tag: 'HUDU-T214-2',
          name: 'EC-SRV-01',
          status: 'active',
          asset_type: 'server',
          serial_number: null,
        },
      ])
      .returning(['asset_id', 'name']);
    assetA = inserted.find((a: any) => a.name === 'EC-WS-001').asset_id;
    assetB = inserted.find((a: any) => a.name === 'EC-SRV-01').asset_id;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (db && tenantId) {
      await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId }).del().catch(() => undefined);
      await db('assets').where({ tenant: tenantId }).del().catch(() => undefined);
      await db('clients').where({ tenant: tenantId }).del().catch(() => undefined);
      await db('tenants').where({ tenant: tenantId }).del().catch(() => undefined);
    }
    await db?.raw('select pg_advisory_unlock_all()').catch(() => undefined);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId }).del();
  });

  it('T214: setHuduAssetMappingRow writes the asset row shape; list joins the asset name; resolvers work', async () => {
    const result = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: assetA,
      huduAssetId: 501,
      huduCompanyId: 101,
      metadata: {
        hudu_asset_name: 'EC-WS-001',
        asset_layout_id: 7,
        asset_layout_name: 'Computer Assets',
        primary_serial: 'SN-EC-1001',
        url: 'https://hudu.example.com/a/501',
      },
    });

    expect(result).toMatchObject({ ok: true });
    const mapping = (result as unknown as { mapping: Record<string, unknown> }).mapping;
    expect(mapping).toMatchObject({
      tenant: tenantId,
      integration_type: 'hudu',
      alga_entity_type: 'asset',
      alga_entity_id: assetA,
      external_entity_id: '501',
      external_realm_id: '101',
      sync_status: 'manual_link',
      metadata: {
        hudu_asset_name: 'EC-WS-001',
        hudu_company_id: '101',
        asset_layout_id: 7,
        asset_layout_name: 'Computer Assets',
        primary_serial: 'SN-EC-1001',
        url: 'https://hudu.example.com/a/501',
        stale: false,
      },
    });
    expect(mapping.id).toBeTruthy();

    const listed = await assetMappingDb.getHuduAssetMappingRows(db, tenantId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      external_entity_id: '501',
      alga_entity_id: assetA,
      asset_name: 'EC-WS-001',
    });
    // Per-company filter rides on external_realm_id.
    expect(await assetMappingDb.getHuduAssetMappingRows(db, tenantId, { huduCompanyId: 101 })).toHaveLength(1);
    expect(await assetMappingDb.getHuduAssetMappingRows(db, tenantId, { huduCompanyId: 999 })).toHaveLength(0);

    expect(await assetMappingDb.resolveAlgaAssetIdForHuduAsset(db, tenantId, 501)).toBe(assetA);
    expect(await assetMappingDb.resolveAlgaAssetIdForHuduAsset(db, tenantId, '501')).toBe(assetA);
    expect(await assetMappingDb.resolveHuduAssetIdForAlgaAsset(db, tenantId, assetA)).toBe('501');
    expect(await assetMappingDb.resolveAlgaAssetIdForHuduAsset(db, tenantId, 999)).toBeNull();
    expect(await assetMappingDb.resolveHuduAssetIdForAlgaAsset(db, tenantId, assetB)).toBeNull();
    expect(await assetMappingDb.resolveAlgaAssetIdForHuduAsset(db, randomUUID(), 501)).toBeNull();
  });

  it('T214: one-to-one is enforced in both directions with typed errors; replace is explicit clear+set', async () => {
    const first = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: assetA,
      huduAssetId: 501,
      huduCompanyId: 101,
    });
    expect(first).toMatchObject({ ok: true });

    const assetTaken = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: assetA,
      huduAssetId: 502,
      huduCompanyId: 101,
    });
    expect(assetTaken).toMatchObject({ ok: false, code: 'asset_already_mapped' });
    expect((assetTaken as { message: string }).message).toContain('501');

    const huduAssetTaken = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: assetB,
      huduAssetId: 501,
      huduCompanyId: 101,
    });
    expect(huduAssetTaken).toMatchObject({ ok: false, code: 'hudu_asset_already_mapped' });

    expect(await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId })).toHaveLength(1);

    expect(await assetMappingDb.clearHuduAssetMappingRow(db, tenantId, { huduAssetId: 501 })).toBe(1);
    const replaced = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: assetB,
      huduAssetId: 501,
      huduCompanyId: 101,
    });
    expect(replaced).toMatchObject({ ok: true });
    const rows = await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId });
    expect(rows).toHaveLength(1);
    expect(rows[0].alga_entity_id).toBe(assetB);
  });

  it('T214: a 23505 racing past the pre-checks maps to mapping_conflict', async () => {
    // Simulate the race window: a row the asset-scoped pre-checks cannot see
    // already owns the (tenant, hudu, external_entity_id, realm) unique tuple.
    await db(HUDU_MAPPING_TABLE).insert({
      tenant: tenantId,
      integration_type: 'hudu',
      alga_entity_type: 'client',
      alga_entity_id: clientA,
      external_entity_id: '777',
      external_realm_id: '101',
      sync_status: 'manual_link',
    });

    const result = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: assetA,
      huduAssetId: 777,
      huduCompanyId: 101,
    });

    expect(result).toMatchObject({ ok: false, code: 'mapping_conflict' });
    expect((result as { message: string }).message).toMatch(/just mapped/);
  });

  it('T214: clearHuduAssetMappingRow clears by Hudu asset id and by mapping id; misses report 0', async () => {
    await assetMappingDb.setHuduAssetMappingRow(db, tenantId, { assetId: assetA, huduAssetId: 501, huduCompanyId: 101 });

    expect(await assetMappingDb.clearHuduAssetMappingRow(db, tenantId, { huduAssetId: 501 })).toBe(1);
    expect(await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId })).toHaveLength(0);
    expect(await assetMappingDb.clearHuduAssetMappingRow(db, tenantId, { huduAssetId: 501 })).toBe(0);

    const again = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: assetA,
      huduAssetId: 502,
      huduCompanyId: 101,
    });
    const mappingId = (again as { mapping: { id: string } }).mapping.id;
    expect(await assetMappingDb.clearHuduAssetMappingRow(db, tenantId, { mappingId })).toBe(1);
    expect(await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId })).toHaveLength(0);
  });

  it('T215: client and asset mappings coexist for the same tenant, even with identical external ids', async () => {
    const companySet = await companyMappingDb.setHuduCompanyMappingRow(db, tenantId, {
      clientId: clientA,
      huduCompanyId: 101,
      metadata: { hudu_company_name: 'ExampleCo' },
    });
    expect(companySet).toMatchObject({ ok: true });

    // Hudu asset id 101 numerically equals the mapped Hudu company id — the
    // asset row's external_realm_id keeps the external unique index disjoint.
    const assetSet = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: assetA,
      huduAssetId: 101,
      huduCompanyId: 101,
    });
    expect(assetSet).toMatchObject({ ok: true });

    expect(await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId })).toHaveLength(2);

    // Listings are entity-type scoped — no cross-contamination.
    const companyRows = await companyMappingDb.getHuduCompanyMappingRows(db, tenantId);
    expect(companyRows).toHaveLength(1);
    expect(companyRows[0]).toMatchObject({ alga_entity_type: 'client', alga_entity_id: clientA });
    const assetRows = await assetMappingDb.getHuduAssetMappingRows(db, tenantId);
    expect(assetRows).toHaveLength(1);
    expect(assetRows[0]).toMatchObject({ alga_entity_type: 'asset', alga_entity_id: assetA });

    // Clearing the client mapping leaves the asset mapping untouched.
    expect(await companyMappingDb.clearHuduCompanyMappingRow(db, tenantId, { huduCompanyId: 101 })).toBe(1);
    expect(await assetMappingDb.resolveAlgaAssetIdForHuduAsset(db, tenantId, 101)).toBe(assetA);

    // And vice versa.
    await companyMappingDb.setHuduCompanyMappingRow(db, tenantId, { clientId: clientA, huduCompanyId: 101 });
    expect(await assetMappingDb.clearHuduAssetMappingRow(db, tenantId, { huduAssetId: 101 })).toBe(1);
    expect(await companyMappingDb.resolveClientIdForHuduCompany(db, tenantId, 101)).toBe(clientA);
    expect(await assetMappingDb.resolveAlgaAssetIdForHuduAsset(db, tenantId, 101)).toBeNull();
  });
});

// ============================================================================
// T216 — getHuduAssetMappings view composition (unit-mocked)
// ============================================================================

describe('T216: getHuduAssetMappings', () => {
  it('composes Hudu assets + mapping rows + suggestions into the view model', async () => {
    getHuduAssetMappingRowsMock.mockResolvedValue([
      {
        id: 'am-1',
        tenant: TENANT,
        integration_type: 'hudu',
        alga_entity_type: 'asset',
        alga_entity_id: ASSET_1,
        external_entity_id: '1',
        external_realm_id: HUDU_COMPANY_ID,
        metadata: { stale: true },
        asset_name: 'Mapped Asset',
      },
    ]);
    assetsRows = [
      { asset_id: ASSET_1, asset_name: 'Mapped Asset', serial_number: 'SN-EC-1001' },
      { asset_id: ASSET_2, asset_name: 'EC-SRV-1', serial_number: null },
    ];
    const { getHuduAssetMappings } = await importActions();

    const result = await getHuduAssetMappings(CLIENT_1);

    expect(getHuduCompanyAssetsMock).toHaveBeenCalledWith(CLIENT_1, undefined);
    expect(getHuduAssetMappingRowsMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      huduCompanyId: HUDU_COMPANY_ID,
    });

    expect(result).toEqual({
      state: 'ok',
      huduCompanyId: HUDU_COMPANY_ID,
      fetchedAt: '2026-06-11T10:00:00.000Z',
      fromCache: true,
      assets: [
        {
          hudu_asset_id: 1,
          hudu_asset_name: 'EC-WS-001',
          asset_layout_id: 7,
          asset_layout_name: 'Computer Assets',
          primary_serial: 'SN-EC-1001',
          url: 'https://hudu.example.com/a/1',
          archived: false,
          layout_excluded: false,
          mapping: { mapping_id: 'am-1', asset_id: ASSET_1, asset_name: 'Mapped Asset', stale: true },
          suggestion: null,
        },
        {
          hudu_asset_id: 2,
          hudu_asset_name: 'EC-SRV-01',
          asset_layout_id: 7,
          asset_layout_name: 'Computer Assets',
          primary_serial: null,
          url: 'https://hudu.example.com/a/2',
          archived: false,
          layout_excluded: false,
          mapping: null,
          // Near-name fuzzy match against the unmapped Alga asset.
          suggestion: { asset_id: ASSET_2, asset_name: 'EC-SRV-1', source: 'fuzzy_name', confidence: 0.8889 },
        },
        {
          hudu_asset_id: 3,
          hudu_asset_name: 'Printer Closet B',
          asset_layout_id: null,
          asset_layout_name: null,
          primary_serial: null,
          url: null,
          archived: true,
          layout_excluded: false,
          mapping: null,
          suggestion: null,
        },
      ],
    });
  });

  it("T261/F259: rows whose layout is marked 'excluded' carry layout_excluded (layout-less rows do not)", async () => {
    getHuduAssetLayoutTypeMapMock.mockResolvedValue({ '7': 'excluded' });
    const { getHuduAssetMappings } = await importActions();

    const result = await getHuduAssetMappings(CLIENT_1);

    if (result.state !== 'ok') throw new Error(`expected ok state, got ${result.state}`);
    expect(result.assets.map((a) => [a.hudu_asset_id, a.layout_excluded])).toEqual([
      [1, true],
      [2, true],
      [3, false], // no asset_layout_id → never excluded
    ]);
  });

  it('short-circuits to the typed unmapped state without touching the DB', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue({ state: 'unmapped' });
    const { getHuduAssetMappings } = await importActions();

    expect(await getHuduAssetMappings(CLIENT_1)).toEqual({ state: 'unmapped' });
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('forwards fetch errors (incl. errorKind) from the Phase 1 data action', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue({
      state: 'error',
      error: 'Hudu rate limit exceeded (429).',
      errorKind: 'rate_limited',
    });
    const { getHuduAssetMappings } = await importActions();

    expect(await getHuduAssetMappings(CLIENT_1)).toEqual({
      state: 'error',
      error: 'Hudu rate limit exceeded (429).',
      errorKind: 'rate_limited',
    });
  });

  it('is gated on asset read (not system_settings)', async () => {
    const { getHuduAssetMappings } = await importActions();

    await getHuduAssetMappings(CLIENT_1);

    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'asset', 'read');
  });
});

// ============================================================================
// T217 + envelopes — setHuduAssetMapping / clearHuduAssetMapping
// ============================================================================

describe('F213 action wrappers: setHuduAssetMapping / clearHuduAssetMapping', () => {
  it('resolves the client mapped company for the row write and passes metadata through', async () => {
    const { setHuduAssetMapping } = await importActions();

    const result = await setHuduAssetMapping({
      clientId: CLIENT_1,
      assetId: ASSET_1,
      huduAssetId: 1,
      metadata: { hudu_asset_name: 'EC-WS-001', asset_layout_id: 7, primary_serial: 'SN-EC-1001' },
    });

    expect(result).toEqual({ success: true, data: { mapping_id: 'am-9' } });
    expect(resolveHuduCompanyIdForClientMock).toHaveBeenCalledWith(knexCallableMock, TENANT, CLIENT_1);
    expect(setHuduAssetMappingRowMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      assetId: ASSET_1,
      huduAssetId: 1,
      huduCompanyId: HUDU_COMPANY_ID,
      metadata: { hudu_asset_name: 'EC-WS-001', asset_layout_id: 7, primary_serial: 'SN-EC-1001' },
    });
  });

  it('enriches missing metadata from the Phase 1 assets cache before writing', async () => {
    setCachedHuduList(TENANT, HUDU_COMPANY_ID, 'assets', huduItems().map(({ hudu_url, ...item }) => item));
    const { setHuduAssetMapping } = await importActions();

    const result = await setHuduAssetMapping({ clientId: CLIENT_1, assetId: ASSET_1, huduAssetId: 1 });

    expect(result).toEqual({ success: true, data: { mapping_id: 'am-9' } });
    expect(setHuduAssetMappingRowMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      assetId: ASSET_1,
      huduAssetId: 1,
      huduCompanyId: HUDU_COMPANY_ID,
      metadata: {
        hudu_asset_name: 'EC-WS-001',
        asset_layout_id: 7,
        asset_layout_name: 'Computer Assets',
        primary_serial: 'SN-EC-1001',
        url: '/a/1',
      },
    });
  });

  it('fails (typed envelope) when the client has no mapped Hudu company', async () => {
    resolveHuduCompanyIdForClientMock.mockResolvedValue(null);
    const { setHuduAssetMapping } = await importActions();

    const result = await setHuduAssetMapping({ clientId: CLIENT_1, assetId: ASSET_1, huduAssetId: 1 });

    expect(result).toEqual({ success: false, error: 'Client is not mapped to a Hudu company.' });
    expect(setHuduAssetMappingRowMock).not.toHaveBeenCalled();
  });

  it('surfaces the typed one-to-one rejection from the row layer', async () => {
    setHuduAssetMappingRowMock.mockResolvedValue({
      ok: false,
      code: 'hudu_asset_already_mapped',
      message: 'Hudu asset 1 is already mapped to another asset. Clear that mapping first.',
    });
    const { setHuduAssetMapping } = await importActions();

    const result = await setHuduAssetMapping({ clientId: CLIENT_1, assetId: ASSET_2, huduAssetId: 1 });

    expect(result).toEqual({
      success: false,
      code: 'hudu_asset_already_mapped',
      error: 'Hudu asset 1 is already mapped to another asset. Clear that mapping first.',
    });
  });

  it('clearHuduAssetMapping clears by mapping id and reports not_found when nothing was cleared', async () => {
    const { clearHuduAssetMapping } = await importActions();

    expect(await clearHuduAssetMapping({ mappingId: 'am-1' })).toEqual({ success: true, data: { cleared: 1 } });
    expect(clearHuduAssetMappingRowMock).toHaveBeenCalledWith(knexCallableMock, TENANT, { mappingId: 'am-1' });

    clearHuduAssetMappingRowMock.mockResolvedValue(0);
    expect(await clearHuduAssetMapping({ huduAssetId: 999 })).toEqual({
      success: false,
      error: 'Mapping not found.',
      code: 'not_found',
    });
  });

  it('T217: set/clear require asset update and reject without it (403 semantics)', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { setHuduAssetMapping, clearHuduAssetMapping } = await importActions();

    await expect(setHuduAssetMapping({ clientId: CLIENT_1, assetId: ASSET_1, huduAssetId: 1 })).rejects.toThrow(
      /insufficient permissions \(update\)/
    );
    await expect(clearHuduAssetMapping({ mappingId: 'am-1' })).rejects.toThrow(/insufficient permissions \(update\)/);
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'asset', 'update');
    expect(setHuduAssetMappingRowMock).not.toHaveBeenCalled();
    expect(clearHuduAssetMappingRowMock).not.toHaveBeenCalled();
  });

  it('T217: every action rejects when the hudu-integration flag is off (404 semantics)', async () => {
    isEnabledMock.mockResolvedValue(false);
    const { getHuduAssetMappings, setHuduAssetMapping, clearHuduAssetMapping } = await importActions();

    await expect(getHuduAssetMappings(CLIENT_1)).rejects.toThrow(/disabled for this tenant/);
    await expect(setHuduAssetMapping({ clientId: CLIENT_1, assetId: ASSET_1, huduAssetId: 1 })).rejects.toThrow(
      /disabled for this tenant/
    );
    await expect(clearHuduAssetMapping({ mappingId: 'am-1' })).rejects.toThrow(/disabled for this tenant/);
  });
});
