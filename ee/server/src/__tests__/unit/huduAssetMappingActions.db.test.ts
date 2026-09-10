/** Database persistence cases extracted from the mixed unit suite. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';
import { HUDU_MAPPING_TABLE } from '../../lib/integrations/hudu/contracts';

describe('hudu asset mappings — DB persistence (T214/T215)', () => {
  const HOOK_TIMEOUT = 60_000;

  let db: Knex;
  let tenantId: string;
  let clientA: string;
  let assetA: string;
  let assetB: string;
  let assetMappingDb: typeof import('../../lib/integrations/hudu/assetMapping');
  let companyMappingDb: typeof import('../../lib/integrations/hudu/companyMapping');

  // createTestDbConnection recreates, migrates, and seeds the entire database.
  // That bootstrap can exceed a minute on CI; keep the shorter cleanup limit.
  beforeAll(async () => {
    assetMappingDb = await vi.importActual('@ee/lib/integrations/hudu/assetMapping');
    companyMappingDb = await vi.importActual('@ee/lib/integrations/hudu/companyMapping');

    db = await createTestDbConnection();

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
  }, 300_000);

  afterAll(async () => {
    if (db && tenantId) {
      await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId }).del().catch(() => undefined);
      await db('assets').where({ tenant: tenantId }).del().catch(() => undefined);
      await db('clients').where({ tenant: tenantId }).del().catch(() => undefined);
      await db('tenants').where({ tenant: tenantId }).del().catch(() => undefined);
    }
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

  it('T214: a competing insert after the pre-checks maps the real unique violation to mapping_conflict', async () => {
    const client = db.client as any;
    const originalRunner = client.runner.bind(client);
    let competingInsert = false;
    const runnerSpy = vi.spyOn(client, 'runner').mockImplementation((builder: any) => {
      const runner = originalRunner(builder);
      const run = runner.run.bind(runner);
      runner.run = async () => {
        if (!competingInsert && builder._method === 'insert' && builder._single.table === HUDU_MAPPING_TABLE) {
          competingInsert = true;
          // Both pre-checks already ran. Another writer wins the same asset
          // namespace before this insert reaches the real PostgreSQL constraint.
          await db(HUDU_MAPPING_TABLE).insert({
            tenant: tenantId, integration_type: 'hudu', alga_entity_type: 'asset',
            alga_entity_id: assetB, external_entity_id: '777', external_realm_id: '101',
            sync_status: 'manual_link',
          });
        }
        return run();
      };
      return runner;
    });
    try {
      const result = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
        assetId: assetA, huduAssetId: 777, huduCompanyId: 101,
      });
      expect(competingInsert).toBe(true);
      expect(result).toMatchObject({ ok: false, code: 'mapping_conflict' });
      expect((result as { message: string }).message).toMatch(/just mapped/);
      const rows = await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId });
      expect(rows).toHaveLength(1);
      expect(rows[0].alga_entity_id).toBe(assetB);
    } finally {
      runnerSpy.mockRestore();
    }
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
