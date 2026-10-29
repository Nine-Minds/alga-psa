import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

// Behavioral DB test for the tombstone partial-index migration (ticket
// alga-2026-0002886). `up` is called on a DB that may already be migrated; it
// is idempotent and preserves uniqueness during concurrent replacement. The
// suite leaves the index in its migrated (partial) state.

const require = createRequire(import.meta.url);
const MIGRATION_PATH = path.resolve(
  __dirname,
  '../20261027130000_exclude_tombstones_from_external_mapping_unique_indexes.cjs'
);

const MAPPINGS = 'tenant_external_entity_mappings';
const EXTERNAL_INDEX = 'idx_unique_external_mapping';
const ALGA_INDEX = 'idx_unique_alga_mapping';

let db: Knex;
let migration: { up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> };
const tenantIds: string[] = [];

async function makeTenant(label: string): Promise<string> {
  const tenant = randomUUID();
  await db('tenants').insert({
    tenant,
    client_name: `Tombstone Index ${label}`,
    email: `tombstone-index-${tenant.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  tenantIds.push(tenant);
  return tenant;
}

async function insertMapping(
  tenant: string,
  opts: {
    entityId?: string;
    target: string;
    type?: string;
    unlinked?: boolean;
    realm?: string | null;
  }
): Promise<string> {
  const id = randomUUID();
  await db(MAPPINGS).insert({
    id,
    tenant,
    integration_type: 'quickbooks_online',
    alga_entity_type: opts.type ?? 'tax_code',
    alga_entity_id: opts.entityId ?? randomUUID(),
    external_entity_id: opts.target,
    external_realm_id: opts.realm === undefined ? 'realm-1' : opts.realm,
    sync_status: opts.unlinked ? 'unlinked' : 'manual_link',
    metadata: null,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
    deleted_at: opts.unlinked ? db.fn.now() : null,
  });
  return id;
}

async function indexDef(name: string): Promise<string> {
  const r = await db.raw('SELECT indexdef FROM pg_indexes WHERE tablename = ? AND indexname = ?', [
    MAPPINGS,
    name,
  ]);
  return r.rows[0]?.indexdef ?? '';
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  migration = require(MIGRATION_PATH);
}, 300_000);

afterAll(async () => {
  if (!db) return;
  // Leave the DB in the migrated state even if a test failed mid-way.
  await migration.up(db).catch(() => undefined);
  for (const tenant of tenantIds) {
    await db(MAPPINGS).where({ tenant }).del();
    await db('tenants').where({ tenant }).del();
  }
  await db.destroy().catch(() => undefined);
});

describe('external mapping tombstone partial index (DB-backed)', () => {
  it('keeps writes available and targets unique during an interrupted build, then retries safely', async () => {
    const tenant = await makeTenant('online-rebuild');
    await insertMapping(tenant, { target: 'RESERVED' });
    await insertMapping(tenant, { target: 'BLOCKER' });
    const blocker = await db.transaction();
    await blocker(MAPPINGS).where({ tenant, external_entity_id: 'BLOCKER' })
      .update({ updated_at: db.fn.now() });
    const blockerPid = (await blocker.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    // Handle cancellation immediately so the rejection cannot escape while
    // the test inspects the database from another connection.
    const upgrading = migration.up(db).then(() => null, (error: unknown) => error);
    try {
      let migrationPid: number | undefined;
      await expect.poll(async () => {
        const waiting = await db.raw(
          'SELECT pid FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))',
          [blockerPid]
        );
        migrationPid = waiting.rows[0]?.pid;
        return migrationPid !== undefined;
      }, { timeout: 10_000 }).toBe(true);

      await db.transaction(async (writer) => {
        await writer.raw("SET LOCAL lock_timeout = '500ms'");
        await writer(MAPPINGS).insert({
          id: randomUUID(), tenant, integration_type: 'quickbooks_online',
          alga_entity_type: 'tax_code', alga_entity_id: randomUUID(),
          external_entity_id: 'AVAILABLE', external_realm_id: 'realm-1',
          sync_status: 'manual_link',
        });
      });
      await expect(insertMapping(tenant, { target: 'RESERVED' }))
        .rejects.toMatchObject({ code: '23505' });

      await db.raw('SELECT pg_cancel_backend(?)', [migrationPid]);
      expect(await upgrading).toMatchObject({ code: '57014' });
      const invalid = await db.raw(
        'SELECT indexrelid FROM pg_index WHERE indrelid = ?::regclass AND NOT indisvalid',
        [MAPPINGS]
      );
      expect(invalid.rows).toHaveLength(1);
      await expect(insertMapping(tenant, { target: 'RESERVED' }))
        .rejects.toMatchObject({ code: '23505' });
    } finally {
      await blocker.rollback();
      await upgrading;
    }

    // A cancelled concurrent build leaves an invalid index behind. The retry
    // must rebuild it, rather than treating IF NOT EXISTS as proof of validity.
    await migration.up(db);
    const invalid = await db.raw(
      'SELECT indexrelid FROM pg_index WHERE indrelid = ?::regclass AND NOT indisvalid',
      [MAPPINGS]
    );
    expect(invalid.rows).toHaveLength(0);
    await insertMapping(tenant, { target: 'RESERVED', unlinked: true });
    await expect(insertMapping(tenant, { target: 'RESERVED' }))
      .rejects.toMatchObject({ code: '23505' });
  }, 30_000);
  it('keeps writes available while an existing reader delays the index rebuild', async () => {
    await migration.up(db);
    const reader = await db.transaction();
    const connection = await db.client.acquireConnection();
    let rebuilding: Promise<unknown> | undefined;
    try {
      await reader(MAPPINGS).select('id').limit(1);
      const { rows: [{ pid }] } = await db.raw('SELECT pg_backend_pid() AS pid').connection(connection);
      // Pin both migration statements to one session so we can observe its
      // lock wait without timing assumptions about when DROP INDEX starts.
      rebuilding = migration.up({
        raw: (sql: string, bindings?: readonly unknown[]) => db.raw(sql, bindings as any).connection(connection),
      } as Knex);
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        const { rows } = await db.raw(
          'SELECT 1 FROM pg_locks WHERE pid = ? AND NOT granted', [pid]
        );
        if (rows.length) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await db.transaction(async (writer) => {
        await writer.raw("SET LOCAL lock_timeout = '500ms'");
        // Even an empty UPDATE takes the same table lock as an app write.
        await writer(MAPPINGS).where({ tenant: randomUUID() }).update({ sync_status: 'manual_link' });
      });
    } finally {
      await reader.rollback();
      try {
        await rebuilding;
      } finally {
        await db.client.releaseConnection(connection);
      }
    }
  }, 15_000);

  it('up: an unlinked row no longer reserves its target, live rows still do', async () => {
    await migration.up(db);
    expect(await indexDef(EXTERNAL_INDEX)).toMatch(/deleted_at IS NULL/i);

    const tenant = await makeTenant('up');

    // The unlinked holder of TAX no longer blocks another region.
    await insertMapping(tenant, { target: 'TAX', unlinked: true });
    await insertMapping(tenant, { target: 'TAX' });
    // Two tombstones may even share one target.
    await insertMapping(tenant, { target: 'TAX', unlinked: true });
    // A second LIVE row on the same target is still rejected.
    await expect(insertMapping(tenant, { target: 'TAX' })).rejects.toMatchObject({ code: '23505' });

    // Carried forward verbatim: a Xero account target stays shareable.
    await db(MAPPINGS).insert({
      id: randomUUID(),
      tenant,
      integration_type: 'xero',
      alga_entity_type: 'service',
      alga_entity_id: randomUUID(),
      external_entity_id: '200',
      external_realm_id: 'realm-1',
      sync_status: 'manual_link',
      metadata: { xeroTargetKind: 'account' },
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db(MAPPINGS).insert({
      id: randomUUID(),
      tenant,
      integration_type: 'xero',
      alga_entity_type: 'service',
      alga_entity_id: randomUUID(),
      external_entity_id: '200',
      external_realm_id: 'realm-1',
      sync_status: 'manual_link',
      metadata: { xeroTargetKind: 'account' },
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // NULL and '' realms remain one group for live rows.
    await insertMapping(tenant, { target: 'CSV-1', realm: null });
    await expect(insertMapping(tenant, { target: 'CSV-1', realm: '' })).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('up permits inserts while the index build waits for an older writer', async () => {
    const tenant = await makeTenant('concurrent-build');
    // Start with no external index so the older writer holds up CREATE, not DROP.
    await db.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_unique_external_mapping');
    const writer = await db.transaction();
    let build: Promise<unknown> | undefined;
    try {
      await writer(MAPPINGS).insert({
        id: randomUUID(), tenant, integration_type: 'quickbooks_online',
        alga_entity_type: 'tax_code', alga_entity_id: randomUUID(),
        external_entity_id: 'OLDER-WRITER', external_realm_id: 'realm-1',
      });
      // Attach rejection handling immediately so cleanup can always release the writer.
      build = migration.up(db).then(() => null, (error) => error);
      await expect.poll(async () => {
        const waiting = await db.raw(`
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND query ILIKE '%CREATE UNIQUE INDEX%idx_unique_external_mapping%'
            AND wait_event_type = 'Lock'
        `);
        return waiting.rows.length;
      }, { timeout: 5000 }).toBeGreaterThan(0);

      // A regular CREATE INDEX queues a ShareLock and blocks this INSERT.
      // CONCURRENTLY lets it finish while still waiting for the older writer.
      await db.transaction(async (inserter) => {
        await inserter.raw("SET LOCAL lock_timeout = '1s'");
        await inserter(MAPPINGS).insert({
          id: randomUUID(), tenant, integration_type: 'quickbooks_online',
          alga_entity_type: 'tax_code', alga_entity_id: randomUUID(),
          external_entity_id: 'NEW-WRITER', external_realm_id: 'realm-1',
        });
      });
    } finally {
      await writer.rollback();
      if (build) expect(await build).toBeNull();
    }
    expect(await indexDef(EXTERNAL_INDEX)).toMatch(/deleted_at IS NULL/i);
    // Reapplying the migration must also leave a usable unique index.
    await migration.up(db);
    await expect(insertMapping(tenant, { target: 'NEW-WRITER' })).rejects.toMatchObject({ code: '23505' });
  }, 15000);

  it('leaves idx_unique_alga_mapping total, so ON CONFLICT on its key still infers it', async () => {
    await migration.up(db);
    // Partial-index inference is impossible from `ON CONFLICT (cols)`, and the
    // invoice-mapping upserts in packages/billing use exactly this key — a
    // partial index here would fail accounting export with 42P10.
    const def = await indexDef(ALGA_INDEX);
    expect(def).toMatch(/UNIQUE/i);
    expect(def).not.toMatch(/WHERE/i);

    const tenant = await makeTenant('alga-total');
    const region = randomUUID();
    await insertMapping(tenant, { entityId: region, target: 'NON', unlinked: true });
    // One row per entity per realm, tombstoned or not: the create path relinks
    // that row in place instead of adding a second one.
    await expect(
      insertMapping(tenant, { entityId: region, target: 'EXEMPT' })
    ).rejects.toMatchObject({ code: '23505' });

    await db.raw(
      `INSERT INTO ${MAPPINGS}
         (id, tenant, integration_type, alga_entity_type, alga_entity_id, external_entity_id,
          external_realm_id, sync_status, created_at, updated_at)
       VALUES (gen_random_uuid(), ?, 'quickbooks_online', 'invoice', ?, 'qbo-1', 'realm-1', 'synced', now(), now())
       ON CONFLICT (tenant, integration_type, alga_entity_type, alga_entity_id, COALESCE(external_realm_id, ''))
       DO UPDATE SET external_entity_id = 'qbo-2'`,
      [tenant, randomUUID()]
    );
  });

  it('down: refuses while tombstone duplicates exist, leaving the data and the partial index', async () => {
    await migration.up(db);
    const tenant = await makeTenant('down-refuse');
    await insertMapping(tenant, { target: 'TAX', unlinked: true });
    await insertMapping(tenant, { target: 'TAX' });

    await expect(migration.down(db)).rejects.toThrow(/No mappings were deleted/);

    expect(await indexDef(EXTERNAL_INDEX)).toMatch(/deleted_at IS NULL/i);
    expect(await db(MAPPINGS).where({ tenant })).toHaveLength(2);
  });

  it('down: restores the tombstone-including index on clean data, and up re-applies', async () => {
    await migration.up(db);
    for (const tenant of tenantIds) {
      await db(MAPPINGS).where({ tenant }).del();
    }
    const dupes = await db.raw(
      `SELECT COUNT(*)::int AS n FROM (SELECT 1 FROM ${MAPPINGS}
       WHERE (integration_type <> 'xero' OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account')
         AND (integration_type <> 'quickbooks_desktop' OR alga_entity_type NOT IN ('service', 'discount', 'tax_code'))
       GROUP BY tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, '')
       HAVING COUNT(*) > 1) d`
    );
    if (dupes.rows[0].n > 0) {
      // Pre-existing tombstone duplicates in a shared dev DB: the refusal path
      // is covered above.
      return;
    }

    await migration.down(db);
    expect(await indexDef(EXTERNAL_INDEX)).not.toMatch(/deleted_at IS NULL/i);

    // The restored index counts tombstones again — the old, broken behaviour.
    const tenant = await makeTenant('down-clean');
    await insertMapping(tenant, { target: 'TAX', unlinked: true });
    await expect(insertMapping(tenant, { target: 'TAX' })).rejects.toMatchObject({ code: '23505' });

    await migration.up(db);
    expect(await indexDef(EXTERNAL_INDEX)).toMatch(/deleted_at IS NULL/i);
    await insertMapping(tenant, { target: 'TAX' });
  });
});
