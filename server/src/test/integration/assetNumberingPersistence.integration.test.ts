import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  claimAssetTag,
  commitAssetReservation,
  nextAssetTag,
  normalizeAssetTag,
  prepareAssetIdentity,
  previewNextAssetTag,
  reserveAssetNumber,
} from '@alga-psa/shared/services/assetNumbering';
import { activateAssetTagUniquenessForTenant } from '@alga-psa/shared/services/assetTagActivation';
import { SharedNumberingService } from '@alga-psa/shared/services/numberingService';
import { ingestNormalizedRmmDeviceSnapshot } from '@alga-psa/shared/rmm/sharedAssetIngestionService';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { insertTestAssets } from '../../../../shared/test-utils/assetFixtures';
import { AssetService } from '../../lib/api/services/AssetService';
import { createAssetInTransaction } from '@alga-psa/assets/actions/assetActions';
import { updateNumberSettings } from '../../../../packages/reference-data/src/actions/number-actions/numberingActions';

const settingsActor = vi.hoisted(() => ({ tenant: '', knex: null as Knex | null }));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/auth')>(),
  withAuth: (fn: any) => (...args: any[]) => fn(
    { user_id: '00000000-0000-4000-8000-000000000001', user_type: 'internal' },
    { tenant: settingsActor.tenant }, ...args,
  ),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: settingsActor.knex }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(async () => undefined) }));

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
    await tenantDb(trx, tenant).table('asset_statuses').insert({
      tenant, slug: 'active', label: 'Active', kind: 'deployable', is_builtin: true, is_active: true, display_order: 0,
    });
  });
  return { tenant, client1, client2 };
}

async function inTenant<T>(tenant: string, body: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.current_tenant', ?, true)", [tenant]);
    return body(trx);
  });
}

async function createBareAsset(tenant: string, clientId: string, tag: string, legacy = false) {
  return inTenant(tenant, async (trx) => {
    const identity = legacy
      ? { asset_id: randomUUID(), asset_tag: tag, asset_tag_normalized: normalizeAssetTag(tag) || null, asset_tag_legacy_exempt: true }
      : await prepareAssetIdentity(trx, { tenant, clientId, assetTag: tag });
    if (legacy) {
      // Seed the same immutable exception an upgrade from old data captures.
      await trx('asset_tag_legacy_bindings').insert({ tenant, asset_id: identity.asset_id, normalized_tag: normalizeAssetTag(tag), asset_tag: tag });
      if (normalizeAssetTag(tag)) {
        await trx('asset_tag_claims').insert({ tenant, normalized_tag: normalizeAssetTag(tag), asset_tag: tag, owner_kind: 'legacy', owner_id: randomUUID() })
          .onConflict(['tenant', 'normalized_tag']).ignore();
      }
    }
    await tenantDb(trx, tenant).table('assets').insert({
      tenant,
      ...identity,
      asset_type: 'unknown',
      client_id: clientId,
      name: `Fixture ${tag}`,
      status: 'active',
      ownership: 'client',
    });
    return identity.asset_id;
  });
}

describe('asset numbering persistence (PostgreSQL integration)', () => {
  beforeAll(async () => {
    if (!/^asset_numbering_test_[a-z0-9_]+$/.test(databaseName)) throw new Error('Use a dedicated asset_numbering_test_* database');
    db = await createTestDbConnection({ databaseName, runSeeds: false });
    settingsActor.knex = db;
  }, 300_000);

  afterAll(async () => {
    for (const tenant of fixtureTenants) {
      await inTenant(tenant, async (trx) => {
        for (const table of ['tenant_external_entity_mappings', 'asset_tag_activation', 'asset_number_reservations', 'asset_tag_audit', 'asset_history', 'assets', 'asset_tag_legacy_bindings', 'asset_tag_claims', 'asset_statuses', 'clients', 'users', 'next_number', 'tenants']) {
          await trx(table).where({ tenant }).del().catch(() => undefined);
        }
      }).catch(() => undefined);
    }
    if (db) await db.destroy();
  });

  it('inserts fixture identities atomically, preserving IDs and rejecting normalized collisions', async () => {
    const { tenant, client1 } = await fixture();
    const assetId = randomUUID();
    const row = { tenant, asset_id: assetId, client_id: client1, asset_type: 'unknown', name: 'Fixture', status: 'active', asset_tag: ' Mixed-42 ' };
    const [stored] = await insertTestAssets(db, row);
    expect(stored).toMatchObject({ asset_id: assetId, asset_tag: ' Mixed-42 ', asset_tag_normalized: 'MIXED-42' });
    expect(await db('asset_tag_claims').where({ tenant, normalized_tag: 'MIXED-42' }).first()).toMatchObject({ owner_kind: 'asset', owner_id: assetId });
    await expect(insertTestAssets(db, [
      { ...row, asset_id: randomUUID(), asset_tag: 'NEW-43' },
      { ...row, asset_id: randomUUID(), asset_tag: 'mixed-42' },
    ])).rejects.toThrow(/already exists/);
    expect(await db('asset_tag_claims').where({ tenant, normalized_tag: 'NEW-43' }).first()).toBeUndefined();
    expect(await db('assets').where({ tenant })).toHaveLength(1);
  });

  it('accepts N-1 inserts and tag edits before activation and checks their live physical tags', async () => {
    const { tenant, client1 } = await fixture();
    const assetId = randomUUID();
    // The previous release supplies neither identity metadata nor a claim.
    await db('assets').insert({ tenant, asset_id: assetId, client_id: client1,
      asset_type: 'unknown', name: 'Old release intake', status: 'active', asset_tag: 'Old-42' });
    await db('assets').where({ tenant, asset_id: assetId }).update({ asset_tag: ' nw00001 ' });
    await expect(inTenant(tenant, (trx) => claimAssetTag(trx, {
      tenant, assetTag: 'NW00001', ownerKind: 'asset', ownerId: randomUUID(),
    }))).rejects.toMatchObject({ code: 'ASSET_TAG_CONFLICT' });
    expect(await inTenant(tenant, (trx) => nextAssetTag(trx, tenant, client1))).toBe('NW00002');
    expect(await db('assets').where({ tenant, asset_id: assetId }).first())
      .toMatchObject({ asset_tag: ' nw00001 ', asset_tag_normalized: null, asset_tag_managed: false });
    // Blue/green overlap also lets old code edit an asset created by new code.
    const newCodeId = await createBareAsset(tenant, client1, 'NEW-CODE-3');
    await db('assets').where({ tenant, asset_id: newCodeId }).update({ asset_tag: ' Edited-By-Old-Code ' });
    await expect(inTenant(tenant, (trx) => claimAssetTag(trx, {
      tenant, assetTag: 'EDITED-BY-OLD-CODE', ownerKind: 'asset', ownerId: randomUUID(),
    }))).rejects.toMatchObject({ code: 'ASSET_TAG_CONFLICT' });
    expect(await inTenant(tenant, (trx) => activateAssetTagUniquenessForTenant(trx, tenant, randomUUID())))
      .toEqual({ success: true });
    expect(await db('assets').where({ tenant, asset_id: newCodeId }).first())
      .toMatchObject({ asset_tag_normalized: 'EDITED-BY-OLD-CODE', asset_tag_managed: true });
  });

  it('adopts N-1 rows on activation and fences every unmanaged writer afterwards', async () => {
    const { tenant, client1 } = await fixture();
    const assetId = randomUUID();
    const blankId = randomUUID();
    const raw = { tenant, client_id: client1, asset_type: 'unknown', name: 'Old release', status: 'active' };
    await db('assets').insert([
      { ...raw, asset_id: assetId, asset_tag: ' Mixed-42 ' },
      { ...raw, asset_id: blankId, asset_tag: '' },
    ]);
    expect(await inTenant(tenant, (trx) => activateAssetTagUniquenessForTenant(trx, tenant, randomUUID())))
      .toEqual({ success: true });
    expect(await db('assets').where({ tenant, asset_id: assetId }).first())
      .toMatchObject({ asset_tag: ' Mixed-42 ', asset_tag_normalized: 'MIXED-42', asset_tag_managed: true });
    expect(await db('asset_tag_claims').where({ tenant, normalized_tag: 'MIXED-42' }).first())
      .toMatchObject({ owner_kind: 'asset', owner_id: assetId });
    expect(await db('assets').where({ tenant, asset_id: blankId }).first())
      .toMatchObject({ asset_tag: '', asset_tag_legacy_exempt: true, asset_tag_managed: true });
    // A caller cannot bypass claims by omitting the new columns or demoting a row.
    await expect(db('assets').insert({ ...raw, asset_id: randomUUID(), asset_tag: 'UNCLAIMED' }))
      .rejects.toMatchObject({ code: '23503' });
    await expect(db('assets').where({ tenant, asset_id: assetId }).update({ asset_tag_managed: false }))
      .rejects.toMatchObject({ code: '23503' });
    await expect(db('assets').insert({ ...raw, asset_id: randomUUID(), asset_tag: 'UNCLAIMED',
      asset_tag_normalized: 'UNCLAIMED', asset_tag_managed: true })).rejects.toMatchObject({ code: '23503' });
    await expect(db('assets').where({ tenant, asset_id: assetId }).update({ asset_tag_normalized: 'WRONG' }))
      .rejects.toMatchObject({ code: '23514' });
    await expect(createBareAsset(tenant, client1, 'CLAIMED-43')).resolves.toBeTruthy();
  });

  it('refuses activation for N-1 duplicates or reservation collisions created after migration', async () => {
    const { tenant, client1 } = await fixture();
    const ids = [randomUUID(), randomUUID()];
    const raw = { tenant, client_id: client1, asset_type: 'unknown', name: 'Old release', status: 'active' };
    await db('assets').insert(ids.map((asset_id) => ({ ...raw, asset_id, asset_tag: ' Duplicate-1 ' })));
    const activate = () => inTenant(tenant, (trx) => activateAssetTagUniquenessForTenant(trx, tenant, randomUUID()));
    await expect(activate()).resolves.toMatchObject({ success: false });
    const reserved = await inTenant(tenant, (trx) => reserveAssetNumber(trx, { tenant, clientId: client1 }));
    await db('assets').where({ tenant, asset_id: ids[1] }).update({ asset_tag: reserved.assetTag });
    await expect(activate()).resolves.toMatchObject({ success: false });
    expect(await db('tenants').where({ tenant }).first('asset_tag_claims_required'))
      .toEqual({ asset_tag_claims_required: false });
    await db('assets').where({ tenant, asset_id: ids[1] }).update({ asset_tag: 'RECONCILED-2' });
    await expect(activate()).resolves.toEqual({ success: true });
  });

  it('waits for an in-flight N-1 insert before closing the tenant write policy', async () => {
    const { tenant, client1 } = await fixture();
    const assetId = randomUUID();
    const oldWriter = await db.transaction();
    const { rows: [{ pid }] } = await oldWriter.raw('SELECT pg_backend_pid() AS pid');
    await oldWriter('assets').insert({ tenant, asset_id: assetId, client_id: client1,
      asset_type: 'unknown', name: 'Concurrent old release', status: 'active', asset_tag: 'IN-FLIGHT-1' });
    const activating = inTenant(tenant, (trx) => activateAssetTagUniquenessForTenant(trx, tenant, randomUUID()));
    try {
      await vi.waitFor(async () => {
        const blocked = await db.raw('SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))) AS blocked', [pid]);
        expect(blocked.rows[0].blocked).toBe(true);
      }, { timeout: 5_000 });
      await oldWriter.commit();
      await expect(activating).resolves.toEqual({ success: true });
    } finally {
      if (!oldWriter.isCompleted()) await oldWriter.rollback();
      await activating;
    }
    expect(await db('assets').where({ tenant, asset_id: assetId }).first())
      .toMatchObject({ asset_tag_normalized: 'IN-FLIGHT-1', asset_tag_managed: true });
  });

  it('keeps the policy stable between new-code identity preparation and asset persistence', async () => {
    const { tenant, client1 } = await fixture();
    const creating = await db.transaction();
    const identity = await prepareAssetIdentity(creating, { tenant, clientId: client1, assetTag: 'PREPARED-1' });
    const { rows: [{ pid }] } = await creating.raw('SELECT pg_backend_pid() AS pid');
    const activating = inTenant(tenant, (trx) => activateAssetTagUniquenessForTenant(trx, tenant, randomUUID()));
    try {
      await vi.waitFor(async () => {
        const blocked = await db.raw('SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))) AS blocked', [pid]);
        expect(blocked.rows[0].blocked).toBe(true);
      }, { timeout: 5_000 });
      await creating('assets').insert({ tenant, ...identity, client_id: client1,
        asset_type: 'unknown', name: 'Prepared before activation', status: 'active' });
      await creating.commit();
      await expect(activating).resolves.toEqual({ success: true });
    } finally {
      if (!creating.isCompleted()) await creating.rollback();
      await activating;
    }
    expect(await db('assets').where({ tenant, asset_id: identity.asset_id }).first())
      .toMatchObject({ asset_tag: 'PREPARED-1', asset_tag_managed: true });
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

  it('does not let a concurrent settings save rewind issuance across client prefixes', async () => {
    const { tenant, client1, client2 } = await fixture();
    settingsActor.tenant = tenant;
    expect(await inTenant(tenant, (trx) => nextAssetTag(trx, tenant, client1))).toBe('NW00001');
    const allocation = await db.transaction();
    await allocation.raw("SELECT set_config('app.current_tenant', ?, true)", [tenant]);
    const { rows: [{ pid }] } = await allocation.raw('SELECT pg_backend_pid() AS pid');
    expect(await nextAssetTag(allocation, tenant, client1)).toBe('NW00002');
    const saving = updateNumberSettings('ASSET', { last_number: 1, padding_length: 6 });
    try {
      // Wait for real lock contention, rather than relying on a timing delay.
      await vi.waitFor(async () => {
        const blocked = await db.raw('SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))) AS blocked', [pid]);
        expect(blocked.rows[0].blocked).toBe(true);
      }, { timeout: 5_000 });
      await allocation.commit();
      await expect(saving).resolves.toMatchObject({ success: false, error: 'New number must be greater than the current last number' });
    } finally {
      if (!allocation.isCompleted()) await allocation.rollback();
      await saving;
    }
    expect(await inTenant(tenant, (trx) => nextAssetTag(trx, tenant, client2))).toBe('CT00003');
  });

  it('initializes settings safely beside first issuance and accepts a no-op save', async () => {
    const { tenant, client1 } = await fixture();
    settingsActor.tenant = tenant;
    const [saved, tag] = await Promise.all([
      updateNumberSettings('ASSET', { last_number: 40, padding_length: 6 }),
      inTenant(tenant, (trx) => nextAssetTag(trx, tenant, client1)),
    ]);
    expect(saved.success).toBe(true);
    expect(['NW00001', 'NW000041']).toContain(tag);
    const before = await db('next_number').where({ tenant, entity_type: 'ASSET' }).first();
    await expect(updateNumberSettings('ASSET', {})).resolves.toMatchObject({ success: true });
    expect(await db('next_number').where({ tenant, entity_type: 'ASSET' }).first()).toEqual(before);
    const next = await inTenant(tenant, (trx) => nextAssetTag(trx, tenant, client1));
    expect(next).toBe(`NW${String(Number(before.last_number) + 1).padStart(6, '0')}`);
  });

  it('keeps other entity settings and counters independent from asset numbering', async () => {
    const { tenant, client1 } = await fixture();
    settingsActor.tenant = tenant;
    const number = () => inTenant(tenant, (trx) => SharedNumberingService.getNextNumber('TICKET', { knex: trx, tenant }));
    expect(await number()).toBe('TIC1000');
    await expect(updateNumberSettings('TICKET', { last_number: 2000, prefix: 'HELP-', padding_length: 4 }))
      .resolves.toMatchObject({ success: true });
    expect(await number()).toBe('HELP-2001');
    expect(await inTenant(tenant, (trx) => nextAssetTag(trx, tenant, client1))).toBe('NW00001');
    expect(await number()).toBe('HELP-2002');
  });

  it.each(['tenant', 'entity_type'])('rejects a caller-supplied %s without relocating the counter', async (field) => {
    const first = await fixture();
    const other = await fixture();
    settingsActor.tenant = first.tenant;
    await inTenant(first.tenant, (trx) => nextAssetTag(trx, first.tenant, first.client1));
    await inTenant(other.tenant, (trx) => nextAssetTag(trx, other.tenant, other.client1));
    const values = { tenant: other.tenant, entity_type: 'TICKET' };
    await expect(updateNumberSettings('ASSET', { [field]: values[field as keyof typeof values], last_number: 10 } as any))
      .resolves.toMatchObject({ success: false, error: 'Unknown number setting' });
    expect(await db('next_number').whereIn('tenant', [first.tenant, other.tenant]).count('* as count').first())
      .toMatchObject({ count: '2' });
    expect(await inTenant(first.tenant, (trx) => nextAssetTag(trx, first.tenant, first.client1))).toBe('NW00002');
    expect(await inTenant(other.tenant, (trx) => nextAssetTag(trx, other.tenant, other.client1))).toBe('NW00002');
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
    const commits = await Promise.allSettled(assetIds.map((assetId) => inTenant(tenant, async (trx) => {
      await commitAssetReservation(trx, { tenant, reservationId: reservation.reservationId, assetId, assetTag: reservation.assetTag });
      await tenantDb(trx, tenant).table('assets').insert({
        tenant, asset_id: assetId, client_id: client1, asset_type: 'unknown', status: 'active',
        name: 'Committed intake', asset_tag: reservation.assetTag, asset_tag_normalized: normalizeAssetTag(reservation.assetTag),
      });
    })));
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
    const duplicate1 = await createBareAsset(legacy.tenant, legacy.client1, 'DUP-9', true);
    const duplicate2 = await createBareAsset(legacy.tenant, legacy.client2, ' dup-9 ', true);
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

  it('requires an owned claim for inserts and edits even when the writer omits the helper after activation', async () => {
    const fx = await fixture();
    const assetId = await createBareAsset(fx.tenant, fx.client1, 'BOUND-01');
    const secondId = await createBareAsset(fx.tenant, fx.client1, 'BOUND-02');
    await inTenant(fx.tenant, (trx) => activateAssetTagUniquenessForTenant(trx, fx.tenant, randomUUID()));
    const raw = { tenant: fx.tenant, asset_id: randomUUID(), asset_type: 'unknown', client_id: fx.client1,
      asset_tag: ' bound-01 ', asset_tag_normalized: 'BOUND-01', asset_tag_managed: true, name: 'Unclaimed duplicate', status: 'active' };
    await expect(db('assets').insert(raw)).rejects.toMatchObject({ code: '23503' });
    await expect(db('assets').insert({ ...raw, asset_tag_legacy_exempt: true })).rejects.toMatchObject({ code: '23503' });
    await expect(db('assets').where({ tenant: fx.tenant, asset_id: secondId })
      .update({ asset_tag: 'BOUND-01', asset_tag_normalized: 'BOUND-01' })).rejects.toMatchObject({ code: '23503' });
    expect(await db('assets').where({ tenant: fx.tenant, asset_id: assetId }).first('asset_tag')).toMatchObject({ asset_tag: 'BOUND-01' });
  });

  it('promotes reconciled legacy tags to mandatory claims while retaining an intentionally blank legacy record', async () => {
    const fx = await fixture();
    const retained = await createBareAsset(fx.tenant, fx.client1, 'Legacy-0042', true);
    const changed = await createBareAsset(fx.tenant, fx.client2, ' legacy-0042 ', true);
    const blank = await createBareAsset(fx.tenant, fx.client1, '', true);
    await db('asset_tag_audit').insert([
      { tenant: fx.tenant, asset_id: retained, asset_tag: 'Legacy-0042', normalized_tag: 'LEGACY-0042', reason: 'duplicate' },
      { tenant: fx.tenant, asset_id: changed, asset_tag: ' legacy-0042 ', normalized_tag: 'LEGACY-0042', reason: 'duplicate' },
    ]);
    const ctx = { tenant: fx.tenant, userId: randomUUID(), db } as any;
    await new AssetService().update(changed, { asset_tag: 'Legacy-0043' }, ctx);
    expect((await inTenant(fx.tenant, (trx) => activateAssetTagUniquenessForTenant(trx, fx.tenant, ctx.userId))).success).toBe(false);
    await db('asset_tag_audit').where({ tenant: fx.tenant }).update({ resolved_at: db.fn.now(), resolution_note: 'Reviewed physical equipment; second tag changed with customer approval.' });
    expect(await inTenant(fx.tenant, (trx) => activateAssetTagUniquenessForTenant(trx, fx.tenant, ctx.userId))).toEqual({ success: true });
    const rows = await db('assets').where({ tenant: fx.tenant });
    expect(rows.find((row) => row.asset_id === retained)).toMatchObject({ asset_tag: 'Legacy-0042', asset_tag_legacy_exempt: false });
    expect(rows.find((row) => row.asset_id === changed)).toMatchObject({ asset_tag: 'Legacy-0043', asset_tag_legacy_exempt: false });
    expect(rows.find((row) => row.asset_id === blank)).toMatchObject({ asset_tag: '', asset_tag_legacy_exempt: true });
    await expect(db('assets').where({ tenant: fx.tenant, asset_id: changed }).update({ asset_tag_legacy_exempt: true }))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('creates the minimal label-first asset through the UI write core with a committed durable tag', async () => {
    const fx = await fixture();
    const actor = randomUUID();
    await db('users').insert({ tenant: fx.tenant, user_id: actor, username: `intake-${actor}`, hashed_password: 'fixture-only', first_name: 'Ryan', last_name: 'Tester', email: `${actor}@example.test`, user_type: 'internal' });
    const result = await inTenant(fx.tenant, async (trx) => {
      const reservation = await reserveAssetNumber(trx, { tenant: fx.tenant, clientId: fx.client1, createdBy: actor });
      const asset = await createAssetInTransaction(trx, fx.tenant, actor, {
        client_id: fx.client1, asset_type: 'unknown', status: 'active', name: 'Box awaiting intake',
        asset_tag: reservation.assetTag, asset_number_reservation_id: reservation.reservationId,
      });
      return { asset, reservation };
    });
    expect(result.asset.asset_tag).toBe(result.reservation.assetTag);
    expect(await db('asset_number_reservations').where({ tenant: fx.tenant, reservation_id: result.reservation.reservationId }).first())
      .toMatchObject({ state: 'committed', asset_id: result.asset.asset_id });
    expect(await db('asset_tag_claims').where({ tenant: fx.tenant, normalized_tag: normalizeAssetTag(result.asset.asset_tag) }).first())
      .toMatchObject({ owner_kind: 'asset', owner_id: result.asset.asset_id });
    expect(await db('asset_history').where({ tenant: fx.tenant, asset_id: result.asset.asset_id }).first()).toMatchObject({ changed_by: actor });
  });

  it('returns a REST conflict for a normalized manual/import collision without persisting another asset', async () => {
    const fx = await fixture();
    await createBareAsset(fx.tenant, fx.client1, 'FTS-Printed-71');
    await expect(new AssetService().create({
      client_id: fx.client1, asset_type: 'unknown', status: 'active', name: 'Duplicate import', asset_tag: ' fts-printed-71 ',
    }, { tenant: fx.tenant, userId: randomUUID(), db } as any)).rejects.toMatchObject({ statusCode: 409, code: 'ASSET_TAG_CONFLICT' });
    expect(Number((await db('assets').where({ tenant: fx.tenant }).count('* as count').first())?.count)).toBe(1);
  });

  it.each(['reserved', 'expired', 'released'])('completes a %s reservation through REST without allocating again', async (state) => {
    const fx = await fixture();
    const reserved = await inTenant(fx.tenant, (trx) => reserveAssetNumber(trx, { tenant: fx.tenant, clientId: fx.client1 }));
    await db('asset_number_reservations').where({ tenant: fx.tenant, reservation_id: reserved.reservationId }).update({ state });
    const before = await db('next_number').where({ tenant: fx.tenant, entity_type: 'ASSET' }).first('last_number');
    const asset = await new AssetService().create({
      client_id: fx.client1, asset_type: 'unknown', name: 'Label-first REST equipment', status: 'active',
      asset_number_reservation_id: reserved.reservationId,
    }, { tenant: fx.tenant, userId: randomUUID(), db } as any);
    expect(asset.asset_tag).toBe(reserved.assetTag);
    expect(await db('asset_number_reservations').where({ tenant: fx.tenant, reservation_id: reserved.reservationId }).first())
      .toMatchObject({ state: 'committed', asset_id: asset.asset_id });
    expect(await db('next_number').where({ tenant: fx.tenant, entity_type: 'ASSET' }).first('last_number')).toEqual(before);
    await inTenant(fx.tenant, (trx) => commitAssetReservation(trx, {
      tenant: fx.tenant, reservationId: reserved.reservationId, assetId: asset.asset_id, assetTag: reserved.assetTag,
    }));
  });

  it('rolls REST reservation ownership back if the asset write fails and permits retry', async () => {
    const fx = await fixture();
    const reserved = await inTenant(fx.tenant, (trx) => reserveAssetNumber(trx, { tenant: fx.tenant, clientId: fx.client1 }));
    const service = new AssetService();
    const context = { tenant: fx.tenant, userId: randomUUID(), db } as any;
    const payload = { client_id: fx.client1, asset_type: 'unknown', name: 'Retry intake', status: 'active', asset_number_reservation_id: reserved.reservationId };
    // A null name violates the real table constraint after ownership transfers.
    await expect(service.create({ ...payload, name: null } as any, context)).rejects.toMatchObject({ code: '23502' });
    expect(await db('asset_number_reservations').where({ tenant: fx.tenant, reservation_id: reserved.reservationId }).first())
      .toMatchObject({ state: 'reserved', asset_id: null });
    expect(await db('asset_tag_claims').where({ tenant: fx.tenant, normalized_tag: normalizeAssetTag(reserved.assetTag) }).first())
      .toMatchObject({ owner_kind: 'reservation', owner_id: reserved.reservationId });
    const asset = await service.create(payload, context);
    expect(asset.asset_tag).toBe(reserved.assetTag);
  });

  it('allows only one concurrent REST completion of a reservation', async () => {
    const fx = await fixture();
    const reserved = await inTenant(fx.tenant, (trx) => reserveAssetNumber(trx, { tenant: fx.tenant, clientId: fx.client1 }));
    const payload = { client_id: fx.client1, asset_type: 'unknown', name: 'Concurrent intake', status: 'active', asset_number_reservation_id: reserved.reservationId };
    const results = await Promise.allSettled(Array.from({ length: 2 }, () => new AssetService().create(payload, { tenant: fx.tenant, userId: randomUUID(), db } as any)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    expect(Number((await db('assets').where({ tenant: fx.tenant, asset_tag_normalized: normalizeAssetTag(reserved.assetTag) }).count('* as count').first())?.count)).toBe(1);
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
