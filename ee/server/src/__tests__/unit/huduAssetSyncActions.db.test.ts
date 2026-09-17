/** Database persistence cases extracted from the mixed unit suite. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';
import { HUDU_MAPPING_TABLE } from '../../lib/integrations/hudu/contracts';
import { tenantDb } from '@alga-psa/db';
import { writeHuduAssetAttributes } from '../../lib/integrations/hudu/assetAttributes';

function tenantTable(db: Knex, tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

describe('hudu asset sync helpers — DB persistence (T226/T227/T228 row layer)', () => {
  const HOOK_TIMEOUT = 60_000;

  let db: Knex;
  let tenantId: string;
  let assetMappingDb: typeof import('../../lib/integrations/hudu/assetMapping');

  // This hook recreates, migrates, and seeds the full database on CI.
  beforeAll(async () => {
    assetMappingDb = await vi.importActual('@ee/lib/integrations/hudu/assetMapping');

    db = await createTestDbConnection();

    tenantId = randomUUID();
    await tenantTable(db, tenantId, 'tenants').insert({
      tenant: tenantId,
      client_name: 'Hudu Asset Sync Test Tenant',
      email: `hudu-asset-sync-${tenantId}@example.test`,
    });
  }, 300_000);

  afterAll(async () => {
    if (db && tenantId) {
      await tenantTable(db, tenantId, HUDU_MAPPING_TABLE).where({ tenant: tenantId }).del().catch(() => undefined);
      await tenantTable(db, tenantId, 'tenants').where({ tenant: tenantId }).del().catch(() => undefined);
    }
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await tenantTable(db, tenantId, HUDU_MAPPING_TABLE).where({ tenant: tenantId }).del();
  });

  it('T226: setHuduAssetMappingStale merges stale both ways, preserving every other metadata key', async () => {
    const created = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: randomUUID(),
      huduAssetId: 601,
      huduCompanyId: 101,
      metadata: {
        hudu_asset_name: 'EC-WS-001',
        asset_layout_id: 7,
        asset_layout_name: 'Computer Assets',
        primary_serial: 'SN-EC-1001',
        url: 'https://hudu.example.com/a/601',
      },
    });
    const mappingId = (created as { mapping: { id: string } }).mapping.id;

    expect(await assetMappingDb.setHuduAssetMappingStale(db, tenantId, { huduAssetId: 601 }, true)).toBe(1);
    let [row] = await tenantTable(db, tenantId, HUDU_MAPPING_TABLE).where({ tenant: tenantId });
    expect(row.metadata).toEqual({
      hudu_asset_name: 'EC-WS-001',
      hudu_company_id: '101',
      asset_layout_id: 7,
      asset_layout_name: 'Computer Assets',
      primary_serial: 'SN-EC-1001',
      url: 'https://hudu.example.com/a/601',
      stale: true,
    });

    // Reappearance clears the flag by mapping id; siblings still intact.
    expect(await assetMappingDb.setHuduAssetMappingStale(db, tenantId, { mappingId }, false)).toBe(1);
    [row] = await tenantTable(db, tenantId, HUDU_MAPPING_TABLE).where({ tenant: tenantId });
    expect(row.metadata).toMatchObject({ stale: false, hudu_asset_name: 'EC-WS-001', primary_serial: 'SN-EC-1001' });

    // Null metadata coalesces to an object instead of erroring.
    await tenantTable(db, tenantId, HUDU_MAPPING_TABLE).insert({
      tenant: tenantId,
      integration_type: 'hudu',
      alga_entity_type: 'asset',
      alga_entity_id: randomUUID(),
      external_entity_id: '602',
      external_realm_id: '101',
      sync_status: 'manual_link',
      metadata: null,
    });
    expect(await assetMappingDb.setHuduAssetMappingStale(db, tenantId, { huduAssetId: 602 }, true)).toBe(1);
    const bare = await tenantTable(db, tenantId, HUDU_MAPPING_TABLE).where({ tenant: tenantId, external_entity_id: '602' }).first();
    expect(bare.metadata).toEqual({ stale: true });

    // Misses report 0; missing ref throws; nothing was ever deleted (T227).
    expect(await assetMappingDb.setHuduAssetMappingStale(db, tenantId, { huduAssetId: 999 }, true)).toBe(0);
    expect(await assetMappingDb.setHuduAssetMappingStale(db, randomUUID(), { huduAssetId: 601 }, true)).toBe(0);
    await expect(assetMappingDb.setHuduAssetMappingStale(db, tenantId, {}, true)).rejects.toThrow(
      /requires mappingId or huduAssetId/
    );
    expect(await tenantTable(db, tenantId, HUDU_MAPPING_TABLE).where({ tenant: tenantId })).toHaveLength(2);
  });

  it('T252/T253 row layer: writeHuduAssetAttributes jsonb-merges the Hudu namespace, preserving sibling keys', async () => {
    const clientId = randomUUID();
    await tenantTable(db, tenantId, 'clients').insert({ tenant: tenantId, client_id: clientId, client_name: 'Hudu Attr Client' });
    try {
      const [asset] = await tenantTable(db, tenantId, 'assets')
        .insert({
          tenant: tenantId,
          client_id: clientId,
          asset_type: 'workstation',
          asset_tag: `hudu-attr-${clientId.slice(0, 8)}`,
          name: 'EC-WS-001',
          status: 'active',
          attributes: JSON.stringify({
            acme_namespace: { keep: true },
            hudu_fields: [{ label: 'Old', value: 'x' }],
            hudu_synced_at: '2026-06-10T00:00:00.000Z',
          }),
        })
        .returning('asset_id');

      const at = '2026-06-12T10:00:00.000Z';
      expect(
        await writeHuduAssetAttributes(db, tenantId, asset.asset_id, [{ label: 'Hostname', value: 'EC-WS-001' }], at)
      ).toBe(1);
      let row = await tenantTable(db, tenantId, 'assets').where({ tenant: tenantId, asset_id: asset.asset_id }).first();
      // Sibling namespace survives; hudu_fields is replaced wholesale.
      expect(row.attributes).toEqual({
        acme_namespace: { keep: true },
        hudu_fields: [{ label: 'Hostname', value: 'EC-WS-001' }],
        hudu_synced_at: at,
      });

      // Null attributes coalesce to an object instead of erroring.
      await tenantTable(db, tenantId, 'assets').where({ tenant: tenantId, asset_id: asset.asset_id }).update({ attributes: null });
      const later = '2026-06-12T11:00:00.000Z';
      expect(await writeHuduAssetAttributes(db, tenantId, asset.asset_id, [], later)).toBe(1);
      row = await tenantTable(db, tenantId, 'assets').where({ tenant: tenantId, asset_id: asset.asset_id }).first();
      expect(row.attributes).toEqual({ hudu_fields: [], hudu_synced_at: later });

      // Tenant scoping holds.
      expect(await writeHuduAssetAttributes(db, randomUUID(), asset.asset_id, [], later)).toBe(0);
    } finally {
      await tenantTable(db, tenantId, 'assets').where({ tenant: tenantId }).del().catch(() => undefined);
      await tenantTable(db, tenantId, 'clients').where({ tenant: tenantId }).del().catch(() => undefined);
    }
  });

  it('T228: touchHuduAssetMappingsSynced stamps last_synced_at on the given rows only', async () => {
    const first = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: randomUUID(),
      huduAssetId: 601,
      huduCompanyId: 101,
    });
    const second = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: randomUUID(),
      huduAssetId: 602,
      huduCompanyId: 101,
    });
    const firstId = (first as { mapping: { id: string } }).mapping.id;
    const secondId = (second as { mapping: { id: string } }).mapping.id;

    const at = '2026-06-11T12:00:00.000Z';
    expect(await assetMappingDb.touchHuduAssetMappingsSynced(db, tenantId, [firstId], at)).toBe(1);

    const stamped = await tenantTable(db, tenantId, HUDU_MAPPING_TABLE).where({ tenant: tenantId, id: firstId }).first();
    expect(new Date(stamped.last_synced_at).toISOString()).toBe(at);
    const untouched = await tenantTable(db, tenantId, HUDU_MAPPING_TABLE).where({ tenant: tenantId, id: secondId }).first();
    expect(untouched.last_synced_at).toBeNull();

    // Empty input is a no-op; tenant scoping holds; rows survive (T227).
    expect(await assetMappingDb.touchHuduAssetMappingsSynced(db, tenantId, [], at)).toBe(0);
    expect(await assetMappingDb.touchHuduAssetMappingsSynced(db, randomUUID(), [firstId, secondId], at)).toBe(0);
    expect(await assetMappingDb.touchHuduAssetMappingsSynced(db, tenantId, [firstId, secondId])).toBe(2);
    expect(await tenantTable(db, tenantId, HUDU_MAPPING_TABLE).where({ tenant: tenantId })).toHaveLength(2);
  });
});
