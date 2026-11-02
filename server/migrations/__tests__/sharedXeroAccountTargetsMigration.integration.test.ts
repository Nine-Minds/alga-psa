import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

// Behavioral DB test for the partial-index migration. `up` is called on a DB
// that may already be migrated; it is idempotent (DROP IF EXISTS + CREATE).
// The suite leaves the index in its migrated (partial) state.

const require = createRequire(import.meta.url);
const MIGRATION_PATH = path.resolve(
  __dirname,
  '../20261013120000_allow_shared_xero_account_mapping_targets.cjs'
);

const MAPPINGS = 'tenant_external_entity_mappings';

let db: Knex;
let migration: { up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> };
const tenantIds: string[] = [];

async function makeTenant(label: string): Promise<string> {
  const tenant = randomUUID();
  await db('tenants').insert({
    tenant,
    client_name: `Shared Xero ${label}`,
    email: `shared-xero-${tenant.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  tenantIds.push(tenant);
  return tenant;
}

async function insertMapping(
  tenant: string,
  opts: {
    integration?: string;
    code: string;
    metadata?: Record<string, unknown> | null;
    type?: string;
  }
) {
  await db(MAPPINGS).insert({
    id: randomUUID(),
    tenant,
    integration_type: opts.integration ?? 'xero',
    alga_entity_type: opts.type ?? 'service',
    alga_entity_id: randomUUID(),
    external_entity_id: opts.code,
    external_realm_id: 'org-1',
    sync_status: 'manual_link',
    metadata: opts.metadata === undefined ? null : opts.metadata,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function indexDef(): Promise<string> {
  const r = await db.raw(
    "SELECT indexdef FROM pg_indexes WHERE tablename = ? AND indexname = 'idx_unique_external_mapping'",
    [MAPPINGS]
  );
  return r.rows[0]?.indexdef ?? '';
}

const account = { xeroTargetKind: 'account' };
const item = { xeroTargetKind: 'item' };

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  migration = require(MIGRATION_PATH);
}, 300_000);

afterAll(async () => {
  if (!db) return;
  // Remove this suite's rows first, then restore the LATEST index definition
  // (older migrations' `up` leave an older shape behind), even if a test failed.
  for (const tenant of tenantIds) {
    await db(MAPPINGS).where({ tenant }).del();
    await db('tenants').where({ tenant }).del();
  }
  await migration.up(db).catch(() => undefined);
  await require(path.resolve(
    __dirname,
    '../20261027130000_exclude_tombstones_from_external_mapping_unique_indexes.cjs'
  )).up(db);
  await require(path.resolve(
    __dirname,
    '../20261029170000_allow_shared_quickbooks_online_item_targets.cjs'
  )).up(db);
  await db.destroy().catch(() => undefined);
});

describe('shared Xero account targets migration (DB-backed)', () => {
  it('up: shares account targets, keeps item, kind-less and non-Xero targets unique', async () => {
    await migration.up(db);
    expect(await indexDef()).toMatch(/WHERE/i);
    const tenant = await makeTenant('up');

    await insertMapping(tenant, { code: '200', metadata: account });
    await insertMapping(tenant, { code: '200', metadata: account });
    // item:200 coexists with account:200
    await insertMapping(tenant, { code: '200', metadata: item });

    await expect(insertMapping(tenant, { code: '200', metadata: item })).rejects.toMatchObject({ code: '23505' });

    // Kind-less rows (NULL metadata, and metadata without the key) are items.
    await insertMapping(tenant, { code: '300', metadata: null });
    await expect(insertMapping(tenant, { code: '300', metadata: null })).rejects.toMatchObject({ code: '23505' });
    await insertMapping(tenant, { code: '301', metadata: {} });
    await expect(insertMapping(tenant, { code: '301', metadata: null })).rejects.toMatchObject({ code: '23505' });

    // Non-Xero integrations are unaffected, even with the account metadata key.
    await insertMapping(tenant, { integration: 'quickbooks_online', code: '9' });
    await expect(insertMapping(tenant, { integration: 'quickbooks_online', code: '9' })).rejects.toMatchObject({ code: '23505' });
    await insertMapping(tenant, { integration: 'quickbooks_online', code: '8', metadata: account });
    await expect(
      insertMapping(tenant, { integration: 'quickbooks_online', code: '8', metadata: account })
    ).rejects.toMatchObject({ code: '23505' });

    // Xero tax codes keep their behaviour.
    await insertMapping(tenant, { type: 'tax_code', code: 'OUTPUT2' });
    await expect(insertMapping(tenant, { type: 'tax_code', code: 'OUTPUT2' })).rejects.toMatchObject({ code: '23505' });
  });

  it('down: refuses while an account is shared, leaving the partial index and the data', async () => {
    await migration.up(db);
    const tenant = await makeTenant('down-refuse');
    await insertMapping(tenant, { code: '200', metadata: account });
    await insertMapping(tenant, { code: '200', metadata: account });

    await expect(migration.down(db)).rejects.toThrow(/duplicate target group/);

    expect(await indexDef()).toMatch(/WHERE/i);
    expect(await db(MAPPINGS).where({ tenant })).toHaveLength(2);
  });

  it('down: restores the full index on clean data, and up re-applies', async () => {
    await migration.up(db);
    // Remove any leftover shared rows from other tests/tenants.
    await db(MAPPINGS).where({ integration_type: 'xero' }).whereRaw("metadata ->> 'xeroTargetKind' = 'account'").whereIn('tenant', tenantIds).del();
    const dupes = await db.raw(
      `SELECT COUNT(*)::int AS n FROM (SELECT 1 FROM ${MAPPINGS}
       GROUP BY tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, '')
       HAVING COUNT(*) > 1) d`
    );
    if (dupes.rows[0].n > 0) {
      // Pre-existing shared data in a shared dev DB: the refusal path is covered above.
      return;
    }
    await migration.down(db);
    const def = await indexDef();
    expect(def).toMatch(/UNIQUE/i);
    expect(def).not.toMatch(/WHERE/i);

    const tenant = await makeTenant('down-clean');
    await insertMapping(tenant, { code: '200', metadata: account });
    await expect(insertMapping(tenant, { code: '200', metadata: account })).rejects.toMatchObject({ code: '23505' });

    await migration.up(db);
    expect(await indexDef()).toMatch(/WHERE/i);
  });
});
