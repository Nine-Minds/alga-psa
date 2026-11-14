/** Follow verify-asset-tag-bindings.mjs in the same scratch database.
 * Run: tsx --tsconfig tsconfig.base.json scripts/verify-asset-numbering-services.ts
 * Exercises the real shared services on PostgreSQL or colocated Citus tables. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import knex from 'knex';
import {
  claimAssetTag, commitAssetReservation, normalizeAssetTag, prepareAssetIdentity,
  previewNextAssetTag, reserveAssetNumber,
} from '../shared/services/assetNumbering';
import { activateAssetTagUniquenessForTenant } from '../shared/services/assetTagActivation';
import { SharedNumberingService } from '../shared/services/numberingService';

async function main() {
  const url = process.env.ASSET_NUMBERING_VERIFY_URL;
  if (!url || !/^\/asset_numbering_test_[a-z0-9_]+$/.test(new URL(url).pathname)) {
    throw new Error('Set ASSET_NUMBERING_VERIFY_URL to the scratch database from verify-asset-tag-bindings.mjs');
  }
  const db = knex({ client: 'pg', connection: url, pool: { min: 0, max: 10 } });
  try {
    assert.equal(await db.schema.hasTable('next_number'), false, 'Use a fresh binding-verification database');
    await db.raw(`CREATE TABLE next_number (
      tenant uuid NOT NULL, entity_type text NOT NULL, last_number bigint DEFAULT 0,
      initial_value bigint DEFAULT 1, prefix text, padding_length integer, prefix_date_format text,
      PRIMARY KEY (tenant, entity_type))`);
    const citus = await db.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus'");
    if (citus.rows.length) await db.raw("SELECT create_distributed_table('next_number', 'tenant', colocate_with => 'assets')");
    const require = createRequire(import.meta.url);
    await require('../server/migrations/20250220165247_update_generate_next_number_function.cjs').up(db);

    const { tenant } = await db('asset_tag_audit').first('tenant');
    const clients = [randomUUID(), randomUUID()];
    await db('clients').insert(clients.map((client_id, index) => ({
      tenant, client_id, asset_prefix: index ? 'NORTH-' : 'FTS-', asset_prefix_normalized: index ? 'NORTH-' : 'FTS-',
    })));
    const preview = await previewNextAssetTag(db, tenant, clients[0]);
    assert.equal(preview.tag, 'FTS-00001');
    assert.equal((await db('next_number').where({ tenant, entity_type: 'ASSET' })).length, 0);
    const identities = await Promise.all(Array.from({ length: 8 }, (_, index) => db.transaction(async (trx) => {
      const identity = await prepareAssetIdentity(trx, { tenant, clientId: clients[index % 2] });
      await trx('assets').insert({ tenant, ...identity });
      return identity;
    })));
    assert.equal(new Set(identities.map((identity) => identity.asset_tag)).size, 8);
    assert.deepEqual(identities.map((identity) => Number(identity.asset_tag.match(/[0-9]+$/)?.[0])).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
    identities.forEach((identity, index) => assert.ok(identity.asset_tag.startsWith(index % 2 ? 'NORTH-' : 'FTS-')));
    console.log('PASS: real services preview without consumption and allocate one sequence concurrently across two client prefixes');

    for (const state of ['reserved', 'expired', 'released']) {
      const reserved = await db.transaction((trx) => reserveAssetNumber(trx, { tenant, clientId: clients[0] }));
      await db('asset_number_reservations').where({ tenant, reservation_id: reserved.reservationId }).update({ state });
      await assert.rejects(db.transaction((trx) => prepareAssetIdentity(trx, { tenant, clientId: clients[0], assetTag: ` ${reserved.assetTag.toLowerCase()} ` })), { code: 'ASSET_TAG_CONFLICT' });
      const before = await db('next_number').where({ tenant, entity_type: 'ASSET' }).first('last_number');
      const identity = await db.transaction(async (trx) => {
        const result = await prepareAssetIdentity(trx, { tenant, clientId: clients[0], reservationId: reserved.reservationId });
        await trx('assets').insert({ tenant, ...result });
        return result;
      });
      assert.equal(identity.asset_tag, reserved.assetTag);
      await db.transaction((trx) => commitAssetReservation(trx, { tenant, reservationId: reserved.reservationId, assetId: identity.asset_id, assetTag: identity.asset_tag }));
      assert.deepEqual(await db('next_number').where({ tenant, entity_type: 'ASSET' }).first('last_number'), before);
    }
    console.log('PASS: real services retain reserved/expired/released tags, reject manual collisions, and complete/retry without allocating');

    assert.equal((await db.transaction((trx) => activateAssetTagUniquenessForTenant(trx, tenant, randomUUID()))).success, false);
    const duplicates = await db('asset_tag_audit').where({ tenant, reason: 'duplicate' }).distinct('normalized_tag');
    for (const { normalized_tag } of duplicates) {
      const rows = await db('assets').where({ tenant, asset_tag_normalized: normalized_tag }).orderBy('asset_id');
      for (const row of rows.slice(1)) {
        const tag = `RECONCILED-${randomUUID().slice(0, 8)}`;
        await db.transaction(async (trx) => {
          await claimAssetTag(trx, { tenant, assetTag: tag, ownerKind: 'asset', ownerId: row.asset_id });
          await trx('assets').where({ tenant, asset_id: row.asset_id }).update({ asset_tag: tag, asset_tag_normalized: normalizeAssetTag(tag), asset_tag_legacy_exempt: false });
        });
      }
    }
    await db('asset_tag_audit').where({ tenant }).update({ resolved_at: db.fn.now(), resolution_note: 'Reviewed scratch inventory; duplicate labels explicitly reconciled.' });
    assert.deepEqual(await db.transaction((trx) => activateAssetTagUniquenessForTenant(trx, tenant, randomUUID())), { success: true });
    assert.deepEqual(await db.transaction((trx) => activateAssetTagUniquenessForTenant(trx, tenant, randomUUID())), { success: true });
    assert.equal((await db('asset_tag_activation').where({ tenant })).length, 1);
    const grandfathered = await db('assets').where({ tenant, asset_tag_legacy_exempt: true });
    assert.equal(grandfathered.length, 1);
    assert.equal(grandfathered[0].asset_tag, '');
    console.log('PASS: real activation requires review, promotes legacy holding claims, and preserves the intentional legacy blank');

    const firstTicket = await db.transaction((trx) => SharedNumberingService.getNextNumber('TICKET', { knex: trx, tenant }));
    assert.equal(firstTicket, 'TIC1000');
    const secondTicket = await db.transaction((trx) => SharedNumberingService.getNextNumber('TICKET', { knex: trx, tenant }));
    assert.equal(secondTicket, 'TIC1001');
    console.log('PASS: the existing ticket sequence remains independent and retains its defaults');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
