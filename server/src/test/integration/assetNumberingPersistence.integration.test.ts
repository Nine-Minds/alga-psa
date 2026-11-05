import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  claimAssetTag,
  commitAssetReservation,
  nextAssetTag,
  normalizeAssetTag,
  previewNextAssetTag,
  reserveAssetNumber,
} from '@alga-psa/shared/services/assetNumbering';
import { activateAssetTagUniquenessForTenant } from '@alga-psa/shared/services/assetTagActivation';
import { ingestNormalizedRmmDeviceSnapshot } from '@alga-psa/shared/rmm/sharedAssetIngestionService';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined }),
}));

const databaseName = process.env.ASSET_NUMBERING_TEST_DB_NAME || `asset_numbering_test_${process.pid}`;
let db: Knex;
const fixtureTenants: string[] = [];

async function fixture() {
  const tenant = randomUUID();
  fixtureTenants.push(tenant);
  const client1 = randomUUID();
  const client2 = randomUUID();
  await inTenant(tenant, async (trx) => {
    await trx('tenants').insert({ tenant, client_name: `Asset numbering ${tenant.slice(0, 8)}`, email: `${tenant}@example.test` });
    await tenantDb(trx, tenant).table('clients').insert([
      { tenant, client_id: client1, client_name: 'Northwind', asset_prefix: 'NW', asset_prefix_normalized: 'NW' },
      { tenant, client_id: client2, client_name: 'Contoso', asset_prefix: 'CT', asset_prefix_normalized: 'CT' },
    ]);
  });
  return { tenant, client1, client2 };
}

async function inTenant<T>(tenant: string, body: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.current_tenant', ?, true)", [tenant]);
    return body(trx);
  });
}

async function createBareAsset(tenant: string, clientId: string, tag: string, assetId = randomUUID()) {
  await inTenant(tenant, (trx) => tenantDb(trx, tenant).table('assets').insert({
      tenant,
      asset_id: assetId,
      asset_type: 'unknown',
      client_id: clientId,
      asset_tag: tag,
      asset_tag_normalized: normalizeAssetTag(tag),
      name: `Fixture ${tag}`,
      status: 'active',
      ownership: 'client',
    }));
  return assetId;
}

describe('asset numbering persistence (PostgreSQL integration)', () => {
  beforeAll(async () => {
    if (!/^asset_numbering_test_[a-z0-9_]+$/.test(databaseName)) throw new Error('Use a dedicated asset_numbering_test_* database');
    db = await createTestDbConnection({ databaseName, runSeeds: false });
  }, 300_000);

  afterAll(async () => {
    for (const tenant of fixtureTenants) {
      await inTenant(tenant, async (trx) => {
        for (const table of ['asset_tag_activation', 'asset_tag_claims', 'asset_number_reservations', 'asset_tag_audit', 'assets', 'clients', 'next_number', 'tenants']) {
          await trx(table).where({ tenant }).del().catch(() => undefined);
        }
      }).catch(() => undefined);
    }
    if (db) await db.destroy();
  });

  it('previews without consuming and applies two client prefixes to one shared sequence', async () => {
    const { tenant, client1, client2 } = await fixture();
    const previewBefore = await inTenant(tenant, (trx) => previewNextAssetTag(trx, tenant, client1));
    const before = await db('next_number').where({ tenant, entity_type: 'ASSET' }).first('last_number');
    expect(before).toBeUndefined();
    const first = await inTenant(tenant, (trx) => nextAssetTag(trx, tenant, client1));
    const second = await inTenant(tenant, (trx) => nextAssetTag(trx, tenant, client2));
    expect(first).toBe(previewBefore.tag);
    expect(second).toBe(`CT${String(previewBefore.value + 1).padStart(previewBefore.padding, '0')}`);
  });

  it('serializes concurrent allocations and rejects concurrent normalized manual/import claims', async () => {
    const { tenant, client1 } = await fixture();
    const allocated = await Promise.all(Array.from({ length: 12 }, () => inTenant(tenant, (trx) => nextAssetTag(trx, tenant, null))));
    expect(new Set(allocated).size).toBe(allocated.length);
    const tag = 'Legacy-Tag-77';
    const claims = await Promise.allSettled([
      inTenant(tenant, (trx) => claimAssetTag(trx, { tenant, assetTag: tag, ownerKind: 'asset', ownerId: randomUUID() })),
      inTenant(tenant, (trx) => claimAssetTag(trx, { tenant, assetTag: ' legacy-tag-77 ', ownerKind: 'asset', ownerId: randomUUID() })),
    ]);
    expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(claims.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const otherTenant = await fixture();
    await expect(inTenant(otherTenant.tenant, (trx) => claimAssetTag(trx, {
      tenant: otherTenant.tenant, assetTag: tag, ownerKind: 'asset', ownerId: randomUUID(),
    }))).resolves.toBeUndefined();
    const importedId = await createBareAsset(tenant, client1, 'LEGACY-IMPORTED-88');
    expect(importedId).toBeTruthy();
    await expect(inTenant(tenant, (trx) => claimAssetTag(trx, {
      tenant, assetTag: ' legacy-imported-88 ', ownerKind: 'asset', ownerId: randomUUID(),
    }))).rejects.toThrow(/already exists/);
  });

  it('keeps reservations claimed across release/expiry and allows only one commit owner', async () => {
    const { tenant, client1 } = await fixture();
    const reservation = await inTenant(tenant, (trx) => reserveAssetNumber(trx, { tenant, clientId: client1 }));
    const manualRace = await Promise.allSettled([
      inTenant(tenant, (trx) => claimAssetTag(trx, { tenant, assetTag: reservation.assetTag, ownerKind: 'asset', ownerId: randomUUID() })),
      inTenant(tenant, (trx) => claimAssetTag(trx, { tenant, assetTag: ` ${reservation.assetTag.toLowerCase()} `, ownerKind: 'asset', ownerId: randomUUID() })),
    ]);
    expect(manualRace.every((result) => result.status === 'rejected')).toBe(true);
    const assetIds = [randomUUID(), randomUUID()];
    await inTenant(tenant, async (trx) => {
      await tenantDb(trx, tenant).table('asset_number_reservations').where({ reservation_id: reservation.reservationId })
        .update({ state: 'expired' });
    });
    const commits = await Promise.allSettled(assetIds.map((assetId) => inTenant(tenant, (trx) => commitAssetReservation(trx, {
      tenant, reservationId: reservation.reservationId, assetId, assetTag: reservation.assetTag,
    }))));
    expect(commits.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(commits.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const claim = await db('asset_tag_claims').where({ tenant, normalized_tag: normalizeAssetTag(reservation.assetTag) }).first();
    expect(claim.owner_kind).toBe('asset');
    const next = await inTenant(tenant, (trx) => nextAssetTag(trx, tenant, client1));
    expect(normalizeAssetTag(next)).not.toBe(normalizeAssetTag(reservation.assetTag));
    const released = await inTenant(tenant, (trx) => reserveAssetNumber(trx, { tenant, clientId: client1 }));
    await inTenant(tenant, (trx) => tenantDb(trx, tenant).table('asset_number_reservations')
      .where({ reservation_id: released.reservationId }).update({ state: 'released' }));
    const releasedClaim = await inTenant(tenant, (trx) => tenantDb(trx, tenant).table('asset_tag_claims')
      .where({ normalized_tag: normalizeAssetTag(released.assetTag) }).first());
    expect(releasedClaim.owner_kind).toBe('reservation');
    expect(normalizeAssetTag(await inTenant(tenant, (trx) => nextAssetTag(trx, tenant, client1))))
      .not.toBe(normalizeAssetTag(released.assetTag));
  });

  it('allows one clean tenant to activate while another tenant still has reviewed legacy duplicates', async () => {
    const clean = await fixture();
    const legacy = await fixture();
    await createBareAsset(clean.tenant, clean.client1, 'CLEAN-0001');
    const duplicate1 = await createBareAsset(legacy.tenant, legacy.client1, 'DUP-9');
    const duplicate2 = await createBareAsset(legacy.tenant, legacy.client2, ' dup-9 ');
    await inTenant(legacy.tenant, (trx) => tenantDb(trx, legacy.tenant).table('asset_tag_audit').insert([
      { tenant: legacy.tenant, asset_id: duplicate1, asset_tag: 'DUP-9', normalized_tag: 'DUP-9', reason: 'duplicate' },
      { tenant: legacy.tenant, asset_id: duplicate2, asset_tag: ' dup-9 ', normalized_tag: 'DUP-9', reason: 'duplicate' },
    ]));
    const activation = await inTenant(clean.tenant, (trx) => activateAssetTagUniquenessForTenant(trx, clean.tenant, randomUUID()));
    expect(activation).toEqual({ success: true });
    expect(await db('asset_tag_activation').where({ tenant: clean.tenant }).first()).toBeTruthy();
    expect(await db('asset_tag_activation').where({ tenant: legacy.tenant }).first()).toBeUndefined();
    const duplicateRows = await db('assets').where({ tenant: legacy.tenant }).count('* as count').first<{ count: string }>();
    expect(Number(duplicateRows?.count)).toBe(2);
  });

  it('preserves a stored physical tag when client and ownership fields change', async () => {
    const { tenant, client1, client2 } = await fixture();
    const assetId = await createBareAsset(tenant, client1, 'PHYSICAL-0042');
    const row = await inTenant(tenant, async (trx) => {
      await tenantDb(trx, tenant).table('assets').where({ asset_id: assetId }).update({ client_id: client2, ownership: 'msp' });
      return tenantDb(trx, tenant).table('assets').where({ asset_id: assetId }).first('asset_tag', 'asset_tag_normalized', 'client_id', 'ownership');
    });
    expect(row).toMatchObject({ asset_tag: 'PHYSICAL-0042', asset_tag_normalized: 'PHYSICAL-0042', client_id: client2, ownership: 'msp' });
  });

  it('keeps the physical tag and external identity separate when Level resyncs an existing asset', async () => {
    const { tenant, client1 } = await fixture();
    const tag = 'FTS-PRINTED-314';
    const assetId = await createBareAsset(tenant, client1, tag);
    await inTenant(tenant, (trx) => tenantDb(trx, tenant).table('assets').where({ asset_id: assetId }).update({
      rmm_provider: 'levelio', rmm_device_id: 'device-314', rmm_organization_id: 'org-1',
    }));
    const result = await ingestNormalizedRmmDeviceSnapshot({
      tenant,
      knex: db,
      resolvedClientId: client1,
      snapshot: {
        provider: 'levelio', integrationId: randomUUID(), externalDeviceId: 'device-314', externalScopeId: 'org-1',
        lifecycleState: 'active', assetType: 'unknown', displayName: 'Resynced equipment',
        assetTag: 'levelio:device-314', serialNumber: 'SERIAL-314',
      },
    });
    expect(result).toMatchObject({ action: 'updated', assetId });
    const row = await db('assets').where({ tenant, asset_id: assetId }).first('asset_tag', 'rmm_device_id', 'name');
    expect(row).toMatchObject({ asset_tag: tag, rmm_device_id: 'device-314', name: 'Resynced equipment' });
    expect(Number((await db('assets').where({ tenant, rmm_provider: 'levelio', rmm_device_id: 'device-314' }).count('* as count').first<{ count: string }>())?.count)).toBe(1);
  });
});
