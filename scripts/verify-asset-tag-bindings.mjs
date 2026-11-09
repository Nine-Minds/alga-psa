/** Run against an EMPTY asset_numbering_test_* database. Citus needs the same
 * database with the Citus extension on its worker, and
 * ASSET_NUMBERING_CITUS_{COORDINATOR,WORKER}_HOST.
 * No application server or tenant inventory is used. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const url = process.env.ASSET_NUMBERING_VERIFY_URL;
if (!url || !/^\/asset_numbering_test_[a-z0-9_]+$/.test(new URL(url).pathname)) {
  throw new Error('Set ASSET_NUMBERING_VERIFY_URL to an empty asset_numbering_test_* database');
}
const db = require('knex')({ client: 'pg', connection: url, pool: { min: 0, max: 6 } });
try {
  assert.equal(await db.schema.hasTable('assets'), false, 'Refusing to modify an existing asset database');
  const worker = process.env.ASSET_NUMBERING_CITUS_WORKER_HOST;
  if (worker) {
    const coordinator = process.env.ASSET_NUMBERING_CITUS_COORDINATOR_HOST;
    assert.ok(coordinator, 'Set the coordinator hostname reachable by the worker');
    await db.raw('CREATE EXTENSION IF NOT EXISTS citus');
    await db.raw('SELECT citus_set_coordinator_host(?, 5432)', [coordinator]);
    await db.raw('SELECT citus_add_node(?, 5432)', [worker]);
    await db.raw('SET citus.shard_count = 2');
  }
  await db.raw(`CREATE TABLE tenants (tenant uuid PRIMARY KEY);
    CREATE TABLE clients (tenant uuid NOT NULL, client_id uuid NOT NULL, PRIMARY KEY (tenant, client_id));
    CREATE TABLE assets (tenant uuid NOT NULL, asset_id uuid NOT NULL, asset_tag text NOT NULL, PRIMARY KEY (tenant, asset_id))`);
  if (worker) {
    await db.raw("SELECT create_distributed_table('tenants', 'tenant')");
    await db.raw("SELECT create_distributed_table('clients', 'tenant', colocate_with => 'tenants')");
    await db.raw("SELECT create_distributed_table('assets', 'tenant', colocate_with => 'clients')");
  }
  const tenant = randomUUID();
  await db('tenants').insert({ tenant });
  const legacy = ['DUP-1', ' dup-1 ', 'LONG-PREFIX-2', 'long-prefix-2', '', 'OLD-SINGLE-90'].map((asset_tag) => ({ tenant, asset_id: randomUUID(), asset_tag }));
  await db('assets').insert(legacy);
  const migrations = [
    '20261109130000_asset_numbering_and_label_intake',
    '20261109131000_validate_asset_numbering_normalized_columns',
    '20261109132000_enforce_asset_tag_claim_bindings',
    '20261109133000_validate_asset_tag_claim_bindings',
  ].map((name) => require(`../server/migrations/${name}.cjs`));
  await migrations[0].up(db);
  await migrations[1].up(db);
  // Earlier drafts persisted reservations before recording immutable origins.
  const pendingId = randomUUID();
  const committedId = randomUUID();
  const singleton = legacy.find((row) => row.asset_tag === 'OLD-SINGLE-90');
  await db('asset_tag_claims').insert({ tenant, normalized_tag: 'UPGRADE-RESERVED-91', asset_tag: 'UPGRADE-RESERVED-91', owner_kind: 'reservation', owner_id: pendingId });
  await db('asset_number_reservations').insert([
    { tenant, reservation_id: pendingId, asset_tag: 'UPGRADE-RESERVED-91', normalized_tag: 'UPGRADE-RESERVED-91', state: 'reserved', expires_at: new Date(Date.now() + 900_000) },
    { tenant, reservation_id: committedId, asset_tag: singleton.asset_tag, normalized_tag: singleton.asset_tag, state: 'committed', asset_id: singleton.asset_id, expires_at: new Date(Date.now() + 900_000) },
  ]);
  await migrations[2].up(db);
  await migrations[3].up(db);
  await migrations[2].up(db);
  const stored = await db('assets').select('tenant', 'asset_id', 'asset_tag');
  assert.deepEqual(stored.sort((a, b) => a.asset_id.localeCompare(b.asset_id)), legacy.sort((a, b) => a.asset_id.localeCompare(b.asset_id)));
  assert.equal((await db('asset_tag_audit')).length, 5);
  console.log('PASS: migration and re-entry preserve legacy duplicates/blanks and their audit');
  assert.equal((await db('assets').where({ tenant, asset_id: singleton.asset_id }).first()).asset_tag_legacy_exempt, false);
  assert.equal((await db('asset_tag_claims').where({ tenant, normalized_tag: singleton.asset_tag }).first()).reservation_id, committedId);
  assert.equal((await db('asset_tag_claims').where({ tenant, normalized_tag: 'UPGRADE-RESERVED-91' }).first()).reservation_id, pendingId);
  console.log('PASS: legacy singleton tags keep owned claims; pending and committed reservation origins survive upgrade');

  if (!worker) {
    // PostgreSQL retains an invalid index after a failed concurrent build.
    // Exercise recovery using the existing legacy duplicates, then rebuild
    // the nonunique lookup index through the real migration helper.
    await db.raw('DROP INDEX assets_tenant_asset_tag_normalized_idx');
    await assert.rejects(db.raw('CREATE UNIQUE INDEX CONCURRENTLY assets_tenant_asset_tag_normalized_idx ON assets (tenant, asset_tag_normalized)'), { code: '23505' });
    const { ensureConcurrentIndex } = require('../server/migrations/utils/ensureConcurrentIndex.cjs');
    await ensureConcurrentIndex(db, 'assets_tenant_asset_tag_normalized_idx',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS assets_tenant_asset_tag_normalized_idx ON assets (tenant, asset_tag_normalized) WHERE asset_tag_normalized IS NOT NULL');
    const result = await db.raw("SELECT indisvalid FROM pg_index WHERE indexrelid='assets_tenant_asset_tag_normalized_idx'::regclass");
    assert.equal(result.rows[0].indisvalid, true);
    console.log('PASS: an invalid concurrent-index artifact is repaired on retry');
  }

  const rawAsset = (tag, extra = {}) => ({ tenant, asset_id: randomUUID(), asset_tag: tag, asset_tag_normalized: tag, asset_tag_managed: true, ...extra });
  const compatible = { tenant, asset_id: randomUUID(), asset_tag: 'N-1-WRITE' };
  await db('assets').insert(compatible);
  await db('assets').where({ tenant, asset_id: compatible.asset_id }).del();
  // Exercise the storage fence independently of the reviewed activation service.
  // Existing exact legacy bindings still authorize preserved duplicates/blanks.
  await db('assets').where({ tenant }).update({ asset_tag_managed: true });
  await db('tenants').where({ tenant }).update({ asset_tag_claims_required: true });
  await assert.rejects(db('assets').insert(compatible), { code: '23503' });
  console.log('PASS: N-1 writes work before the policy closes and are fenced afterwards');
  await assert.rejects(db('assets').insert(rawAsset('DUP-1')), { code: '23503' });
  await assert.rejects(db('assets').insert(rawAsset('DUP-1', { asset_tag_legacy_exempt: true })), { code: '23503' });
  await assert.rejects(db('asset_tag_claims').insert({ tenant, normalized_tag: 'DUP-1', asset_tag: 'DUP-1', owner_kind: 'asset', owner_id: randomUUID() }), { code: '23505' });
  await assert.rejects(db('assets').insert(rawAsset('UNCLAIMED')), { code: '23503' });
  await assert.rejects(db('assets').insert(rawAsset('', { asset_tag_normalized: null })), { code: '23514' });
  console.log('PASS: unclaimed inserts, duplicate inserts, blank inserts, claiming legacy duplicate tags and forged exemptions fail');

  async function claimedAsset(tag, targetTenant = tenant) {
    const row = rawAsset(tag, { tenant: targetTenant });
    await db.transaction(async (trx) => {
      await trx('asset_tag_claims').insert({ tenant: targetTenant, normalized_tag: tag, asset_tag: tag, owner_kind: 'asset', owner_id: row.asset_id });
      await trx('assets').insert(row);
    });
    return row;
  }
  const first = await claimedAsset('CLAIMED-10');
  const second = await claimedAsset('CLAIMED-11');
  await assert.rejects(db('assets').where({ tenant, asset_id: second.asset_id })
    .update({ asset_tag: first.asset_tag, asset_tag_normalized: first.asset_tag_normalized }), { code: '23503' });
  await assert.rejects(db('assets').insert(rawAsset(first.asset_tag)), { code: '23503' });
  await claimedAsset(first.asset_tag, randomUUID());
  console.log('PASS: direct edits/copying another claim fail; the same tag works in another tenant');

  const results = await Promise.allSettled(Array.from({ length: 8 }, () => db.transaction(async (trx) => {
    const row = rawAsset('RACE-20');
    await trx('asset_tag_claims').insert({ tenant, normalized_tag: row.asset_tag, asset_tag: row.asset_tag, owner_kind: 'asset', owner_id: row.asset_id })
      .onConflict(['tenant', 'normalized_tag']).ignore();
    await trx('assets').insert(row);
  })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 7);
  console.log('PASS: one of eight concurrent persisted assets wins the normalized identity');

  const reservationId = randomUUID();
  const reservation = { tenant, reservation_id: reservationId, asset_tag: 'RESERVED-30', normalized_tag: 'RESERVED-30', expires_at: new Date(Date.now() + 900_000) };
  await assert.rejects(db('asset_number_reservations').insert(reservation), { code: '23503' });
  await db.transaction(async (trx) => {
    await trx('asset_tag_claims').insert({ tenant, normalized_tag: reservation.normalized_tag, asset_tag: reservation.asset_tag, owner_kind: 'reservation', owner_id: reservationId, reservation_id: reservationId });
    await trx('asset_number_reservations').insert(reservation);
  });
  await assert.rejects(db('assets').insert(rawAsset(reservation.asset_tag)), { code: '23503' });
  await assert.rejects(db('asset_number_reservations').insert({ ...reservation, reservation_id: randomUUID() }), { code: '23503' });
  await db.transaction(async (trx) => {
    const row = rawAsset(reservation.asset_tag);
    await trx('asset_tag_claims').where({ tenant, normalized_tag: reservation.normalized_tag }).update({ owner_kind: 'asset', owner_id: row.asset_id });
    await trx('assets').insert(row);
    await trx('asset_number_reservations').where({ tenant, reservation_id: reservationId }).update({ state: 'committed', asset_id: row.asset_id });
  });
  console.log('PASS: reservations require their own claim and transfer it without invalidating the origin FK');

  const rollback = rawAsset('ROLLBACK-40');
  await assert.rejects(db.transaction(async (trx) => {
    await trx('asset_tag_claims').insert({ tenant, normalized_tag: rollback.asset_tag, asset_tag: rollback.asset_tag, owner_kind: 'asset', owner_id: rollback.asset_id });
    await trx('assets').insert(rollback);
    throw new Error('rollback intake');
  }), /rollback intake/);
  assert.equal((await db('asset_tag_claims').where({ tenant, normalized_tag: rollback.asset_tag })).length, 0);
  assert.equal((await db('assets').where({ tenant, asset_id: rollback.asset_id })).length, 0);
  console.log('PASS: rolled-back intake leaves neither a claim nor an asset');
} finally {
  await db.destroy();
}
