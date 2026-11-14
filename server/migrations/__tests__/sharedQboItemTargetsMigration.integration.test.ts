import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { isSharedMappingTarget } from '@alga-psa/types';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

// Behavioral DB test for alga-2026-0002899 (many-to-one QBO item mappings).
// Runs the real migration against the real unique indexes of an isolated test
// database. The suite changes a GLOBAL index, so teardown always restores the
// LATEST schema (this migration's `up`), even when a test fails.

const require = createRequire(import.meta.url);
const MIGRATIONS = path.resolve(__dirname, '..');
const migration = require(path.join(MIGRATIONS, '20261029170000_allow_shared_quickbooks_online_item_targets.cjs')) as Migration;
const tombstoneMigration = require(
  path.join(MIGRATIONS, '20261027130000_exclude_tombstones_from_external_mapping_unique_indexes.cjs')
) as Migration;

type Migration = { up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> };

const MAPPINGS = 'tenant_external_entity_mappings';
const CANONICAL = 'idx_unique_external_mapping';
const GUARD = 'idx_unique_external_mapping_qbo_guard';
const ALGA_INDEX = 'idx_unique_alga_mapping';

let db: Knex;
const tenantIds: string[] = [];

async function makeTenant(label: string): Promise<string> {
  const tenant = randomUUID();
  await db('tenants').insert({
    tenant,
    client_name: `Shared QBO ${label}`,
    email: `shared-qbo-${tenant.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  tenantIds.push(tenant);
  return tenant;
}

type Insert = {
  integration?: string;
  type?: string;
  entityId?: string;
  target: string;
  realm?: string | null;
  metadata?: Record<string, unknown> | null;
  deleted?: boolean;
};

async function insertMapping(tenant: string, o: Insert): Promise<string> {
  const id = randomUUID();
  await db(MAPPINGS).insert({
    id,
    tenant,
    integration_type: o.integration ?? 'quickbooks_online',
    alga_entity_type: o.type ?? 'service',
    alga_entity_id: o.entityId ?? randomUUID(),
    external_entity_id: o.target,
    external_realm_id: o.realm === undefined ? 'realm-1' : o.realm,
    sync_status: o.deleted ? 'unlinked' : 'manual_link',
    metadata: o.metadata === undefined ? null : o.metadata,
    deleted_at: o.deleted ? db.fn.now() : null,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return id;
}

async function indexRow(name: string) {
  const r = await db.raw(
    `SELECT i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS def
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = ? AND i.indrelid = 'public.${MAPPINGS}'::regclass`,
    [name]
  );
  return r.rows[0] as { valid: boolean; def: string } | undefined;
}

async function expectFinalIndexState(kind: 'new' | 'old') {
  const canonical = await indexRow(CANONICAL);
  expect(canonical?.valid).toBe(true);
  const afterOnline = canonical!.def.split("'quickbooks_online'")[1] ?? '';
  expect(afterOnline.includes('discount')).toBe(kind === 'new');
  expect(await indexRow(GUARD)).toBeUndefined();
  expect(await indexRow(ALGA_INDEX)).toBeDefined();
}

async function liveDuplicateGroupsUnderOldPredicates(): Promise<number> {
  const r = await db.raw(`
    SELECT COUNT(*)::int AS n FROM (
      SELECT 1 FROM ${MAPPINGS}
      WHERE (integration_type <> 'xero' OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account')
        AND (integration_type <> 'quickbooks_desktop' OR alga_entity_type NOT IN ('service', 'discount', 'tax_code'))
        AND deleted_at IS NULL
        AND (integration_type <> 'quickbooks_online' OR alga_entity_type <> 'tax_code')
      GROUP BY tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, '')
      HAVING COUNT(*) > 1) d`);
  return r.rows[0].n;
}

const unique = { code: '23505' };

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  await migration.up(db); // the bootstrap already applied it; up must be idempotent
}, 300_000);

afterAll(async () => {
  if (!db) return;
  try {
    // Restore the latest schema whatever state a failed test left behind. A
    // leftover guard or old-shaped canonical index is repaired by `up` itself.
    await db.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${GUARD}`);
    await migration.up(db);
  } finally {
    for (const tenant of tenantIds) {
      await db(MAPPINGS).where({ tenant }).del();
      await db('tenants').where({ tenant }).del();
    }
    await db.destroy().catch(() => undefined);
  }
});

describe('shared QBO item targets migration (DB-backed)', () => {
  it('up is idempotent and leaves exactly the canonical index', async () => {
    await migration.up(db);
    await migration.up(db);
    await expectFinalIndexState('new');
  });

  it('shares QBO service and discount targets but keeps every other QBO target exclusive', async () => {
    const tenant = await makeTenant('matrix');

    // Two services (same tenant, realm) on one item; a discount on the same item too.
    await insertMapping(tenant, { type: 'service', target: 'item-1' });
    await insertMapping(tenant, { type: 'service', target: 'item-1' });
    await insertMapping(tenant, { type: 'discount', entityId: 'automatic_discount', target: 'item-1' });
    // Tax codes are shared too (20261029160000): every taxable region maps to TAX.
    await insertMapping(tenant, { type: 'tax_code', target: 'TAX' });
    await insertMapping(tenant, { type: 'tax_code', target: 'TAX' });

    for (const type of ['client', 'invoice', 'payment', 'payment_term', 'service_category']) {
      await insertMapping(tenant, { type, target: `excl-${type}` });
      await expect(insertMapping(tenant, { type, target: `excl-${type}` })).rejects.toMatchObject(unique);
    }
  });

  it('treats NULL and empty realm as one group, and missing/NULL Xero metadata as an item', async () => {
    const tenant = await makeTenant('realm');
    await insertMapping(tenant, { type: 'client', target: 'cust-1', realm: null });
    await expect(insertMapping(tenant, { type: 'client', target: 'cust-1', realm: '' })).rejects.toMatchObject(unique);
    // QBO sharing ignores metadata entirely.
    await insertMapping(tenant, { type: 'service', target: 'item-9', metadata: null });
    await insertMapping(tenant, { type: 'service', target: 'item-9', metadata: {} });
    await insertMapping(tenant, { type: 'service', target: 'item-9', metadata: { xeroTargetKind: 'item' } });
  });

  it('isolates tenants and realms', async () => {
    const a = await makeTenant('iso-a');
    const b = await makeTenant('iso-b');
    await insertMapping(a, { type: 'client', target: 'cust-1', realm: 'r1' });
    await insertMapping(a, { type: 'client', target: 'cust-1', realm: 'r2' });
    await insertMapping(b, { type: 'client', target: 'cust-1', realm: 'r1' });
    await expect(insertMapping(a, { type: 'client', target: 'cust-1', realm: 'r1' })).rejects.toMatchObject(unique);
  });

  it('keeps one mapping per Alga entity per realm, live or tombstoned', async () => {
    const tenant = await makeTenant('alga-side');
    const serviceId = randomUUID();
    await insertMapping(tenant, { entityId: serviceId, target: 'item-1' });
    await expect(insertMapping(tenant, { entityId: serviceId, target: 'item-2' })).rejects.toMatchObject({
      ...unique,
      constraint: expect.stringContaining(ALGA_INDEX),
    });
    const tombId = randomUUID();
    await insertMapping(tenant, { entityId: tombId, target: 'item-1', deleted: true });
    await expect(insertMapping(tenant, { entityId: tombId, target: 'item-3' })).rejects.toMatchObject(unique);
    // A different realm is a different mapping for the same entity.
    await insertMapping(tenant, { entityId: serviceId, target: 'item-1', realm: 'realm-2' });
  });

  it('releases a target when its mapping is tombstoned', async () => {
    const tenant = await makeTenant('tombstone');
    const first = await insertMapping(tenant, { type: 'client', target: 'cust-1' });
    await expect(insertMapping(tenant, { type: 'client', target: 'cust-1' })).rejects.toMatchObject(unique);
    await db(MAPPINGS).where({ id: first }).update({ deleted_at: db.fn.now(), sync_status: 'unlinked' });
    await insertMapping(tenant, { type: 'client', target: 'cust-1' });
  });

  it('keeps Xero account sharing / item uniqueness and Desktop sharing', async () => {
    const tenant = await makeTenant('xero-desktop');
    await insertMapping(tenant, { integration: 'xero', target: '200', metadata: { xeroTargetKind: 'account' } });
    await insertMapping(tenant, { integration: 'xero', target: '200', metadata: { xeroTargetKind: 'account' } });
    await insertMapping(tenant, { integration: 'xero', target: '200', metadata: { xeroTargetKind: 'item' } });
    await expect(
      insertMapping(tenant, { integration: 'xero', target: '200', metadata: { xeroTargetKind: 'item' } })
    ).rejects.toMatchObject(unique);
    await expect(insertMapping(tenant, { integration: 'xero', target: '300', metadata: null })).resolves.toBeTruthy();
    await expect(insertMapping(tenant, { integration: 'xero', target: '300', metadata: null })).rejects.toMatchObject(
      unique
    );

    for (const type of ['service', 'discount', 'tax_code']) {
      await insertMapping(tenant, { integration: 'quickbooks_desktop', type, target: `acct-${type}` });
      await insertMapping(tenant, { integration: 'quickbooks_desktop', type, target: `acct-${type}` });
    }
    await insertMapping(tenant, { integration: 'quickbooks_desktop', type: 'client', target: 'cust' });
    await expect(
      insertMapping(tenant, { integration: 'quickbooks_desktop', type: 'client', target: 'cust' })
    ).rejects.toMatchObject(unique);
  });

  it('agrees with the runtime policy isSharedMappingTarget for every provider/type/kind', async () => {
    const tenant = await makeTenant('policy-parity');
    const cases: Array<[string, string, Record<string, unknown> | null]> = [];
    for (const integration of ['xero', 'quickbooks_online', 'quickbooks_desktop']) {
      for (const type of ['service', 'discount', 'tax_code', 'client', 'invoice', 'payment', 'payment_term', 'service_category']) {
        cases.push([integration, type, null]);
        if (integration === 'xero') {
          cases.push([integration, type, { xeroTargetKind: 'account' }]);
          cases.push([integration, type, { xeroTargetKind: 'item' }]);
        }
      }
    }
    let n = 0;
    for (const [integration, type, metadata] of cases) {
      const target = `parity-${n++}`;
      await insertMapping(tenant, { integration, type, target, metadata });
      let accepted = true;
      try {
        await insertMapping(tenant, { integration, type, target, metadata });
      } catch (error) {
        expect(error).toMatchObject(unique);
        accepted = false;
      }
      expect({ integration, type, metadata, accepted }).toEqual({
        integration,
        type,
        metadata,
        accepted: isSharedMappingTarget(integration, type, metadata),
      });
    }
  });

  describe('down', () => {
    it('refuses while a QBO item is shared, touching no index and no data, then rolls back cleanly and re-applies', async () => {
      const tenant = await makeTenant('down');
      const sharedA = await insertMapping(tenant, { target: 'down-item' });
      const sharedB = await insertMapping(tenant, { target: 'down-item' });
      const canonicalBefore = await indexRow(CANONICAL);
      const rowsBefore = await db(MAPPINGS).where({ tenant }).count<{ count: string }[]>('* as count');

      await expect(migration.down(db)).rejects.toThrow(/duplicate target group/);

      expect(await indexRow(CANONICAL)).toEqual(canonicalBefore);
      expect(await indexRow(GUARD)).toBeUndefined();
      expect(await db(MAPPINGS).where({ tenant }).count<{ count: string }[]>('* as count')).toEqual(rowsBefore);
      expect(await db(MAPPINGS).whereIn('id', [sharedA, sharedB])).toHaveLength(2);

      // Remove every shared live QBO group (this suite's own rows) so down is clean.
      await db(MAPPINGS)
        .where({ integration_type: 'quickbooks_online' })
        .whereIn('alga_entity_type', ['service', 'discount'])
        .whereIn('tenant', tenantIds)
        .del();
      expect(await liveDuplicateGroupsUnderOldPredicates()).toBe(0);

      await migration.down(db);
      await expectFinalIndexState('old');

      const clean = await makeTenant('down-clean');
      await insertMapping(clean, { target: 'item-1' });
      await expect(insertMapping(clean, { target: 'item-1' })).rejects.toMatchObject(unique);
      // Tombstones and already-shareable Xero/Desktop targets never block rollback.
      await insertMapping(clean, { target: 'item-1', deleted: true });

      await migration.up(db);
      await expectFinalIndexState('new');
      await insertMapping(clean, { target: 'item-2' });
      await insertMapping(clean, { target: 'item-2' });
    });
  });

  describe('interrupted replacement', () => {
    async function toOldState() {
      await db(MAPPINGS)
        .where({ integration_type: 'quickbooks_online' })
        .whereIn('alga_entity_type', ['service', 'discount'])
        .whereIn('tenant', tenantIds)
        .del();
      await migration.down(db);
      await expectFinalIndexState('old');
    }

    const newGuardSql = `
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${GUARD}
      ON ${MAPPINGS} (tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, ''))
      WHERE (integration_type <> 'xero' OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account')
        AND (integration_type <> 'quickbooks_desktop' OR alga_entity_type NOT IN ('service', 'discount', 'tax_code'))
        AND deleted_at IS NULL
        AND (integration_type <> 'quickbooks_online' OR alga_entity_type NOT IN ('service', 'discount', 'tax_code'))`;

    it('resumes after a crash between guard build and canonical drop', async () => {
      await toOldState();
      await db.raw(newGuardSql);
      await migration.up(db);
      await expectFinalIndexState('new');
    });

    it('resumes after a crash with the canonical index dropped and only the guard standing', async () => {
      await toOldState();
      await db.raw(newGuardSql);
      await db.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${CANONICAL}`);
      const tenant = await makeTenant('guard-only');
      // The guard alone still enforces exclusive targets.
      await insertMapping(tenant, { type: 'client', target: 'cust-1' });
      await expect(insertMapping(tenant, { type: 'client', target: 'cust-1' })).rejects.toMatchObject({
        ...unique,
        constraint: GUARD,
      });
      await migration.up(db);
      await expectFinalIndexState('new');
    });

    it('cleans a leftover guard once the canonical index is already at the destination', async () => {
      await migration.up(db);
      await db.raw(newGuardSql);
      await migration.up(db);
      await expectFinalIndexState('new');
    });

    it('replaces an INVALID guard instead of trusting IF NOT EXISTS', async () => {
      await toOldState();
      // A genuinely failed concurrent build leaves an INVALID index behind:
      // drop the canonical index, add duplicate clients, build the guard (fails).
      const tenant = await makeTenant('invalid-guard');
      await db.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${CANONICAL}`);
      await insertMapping(tenant, { type: 'client', target: 'dup' });
      await insertMapping(tenant, { type: 'client', target: 'dup' });
      await expect(db.raw(newGuardSql)).rejects.toMatchObject(unique);
      expect((await indexRow(GUARD))?.valid).toBe(false);
      await db(MAPPINGS).where({ tenant }).del();
      await migration.up(db);
      await expectFinalIndexState('new');
    });

    it('fails clearly, leaving the index alone, when the canonical index has an unexpected definition', async () => {
      // The pre-tombstone Xero-only definition is valid but not one of ours.
      // The legacy index knows nothing of tombstones or Desktop/QBO sharing, so
      // clear every row this suite created before installing it.
      await db(MAPPINGS).whereIn('tenant', tenantIds).del();
      const legacy = require(path.join(MIGRATIONS, '20261013120000_allow_shared_xero_account_mapping_targets.cjs')) as Migration;
      await db.transaction(async (trx) => legacy.up(trx));
      try {
        await expect(migration.up(db)).rejects.toThrow(/unexpected definition/);
        expect((await indexRow(CANONICAL))?.valid).toBe(true);
        expect(await indexRow(GUARD)).toBeUndefined();
      } finally {
        await tombstoneMigration.up(db);
        await migration.up(db);
      }
      await expectFinalIndexState('new');
    });
  });
});
