import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

// Behavioral DB test for the shared QuickBooks Online tax-code migration
// (ticket alga-2026-0002886, second report). `up` is called on a DB that may
// already be migrated; it is idempotent. The suite leaves the index in its
// migrated state.

const require = createRequire(import.meta.url);
const MIGRATION_PATH = path.resolve(
  __dirname,
  '../20261029160000_allow_shared_quickbooks_online_tax_code_targets.cjs'
);

const MAPPINGS = 'tenant_external_entity_mappings';

let db: Knex;
let migration: { up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> };
const tenantIds: string[] = [];

async function makeTenant(label: string): Promise<string> {
  const tenant = randomUUID();
  await db('tenants').insert({
    tenant,
    client_name: `Shared QBO Tax Code ${label}`,
    email: `shared-qbo-tax-${tenant.slice(0, 8)}@example.com`,
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
    type?: string;
    target: string;
    unlinked?: boolean;
    realm?: string | null;
  }
): Promise<string> {
  const id = randomUUID();
  await db(MAPPINGS).insert({
    id,
    tenant,
    integration_type: opts.integration ?? 'quickbooks_online',
    alga_entity_type: opts.type ?? 'tax_code',
    alga_entity_id: randomUUID(),
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

async function indexDef(): Promise<string> {
  const r = await db.raw(
    "SELECT indexdef FROM pg_indexes WHERE tablename = ? AND indexname = 'idx_unique_external_mapping'",
    [MAPPINGS]
  );
  return r.rows[0]?.indexdef ?? '';
}

const unique = { code: '23505' };

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

describe('shared QuickBooks Online tax-code targets migration (DB-backed)', () => {
  it('up: several regions share one QuickBooks Online tax code, everything else stays one-to-one', async () => {
    await migration.up(db);
    const def = await indexDef();
    expect(def).toMatch(/quickbooks_online/i);
    expect(def).toMatch(/deleted_at IS NULL/i);

    const tenant = await makeTenant('up');

    // The prod case: DEFAULT, GA-FUL and GA-FOR all on TAX, US and an exempt region on NON.
    await insertMapping(tenant, { target: 'TAX' });
    await insertMapping(tenant, { target: 'TAX' });
    await insertMapping(tenant, { target: 'TAX' });
    await insertMapping(tenant, { target: 'NON' });
    await insertMapping(tenant, { target: 'NON' });
    // Catalog codes on non-AST companies share the same way.
    await insertMapping(tenant, { target: '7' });
    await insertMapping(tenant, { target: '7' });

    // QuickBooks Online items, customers and payment terms are still unique.
    await insertMapping(tenant, { type: 'service', target: '163' });
    await expect(insertMapping(tenant, { type: 'service', target: '163' })).rejects.toMatchObject(unique);
    await insertMapping(tenant, { type: 'client', target: '291' });
    await expect(insertMapping(tenant, { type: 'client', target: '291' })).rejects.toMatchObject(unique);
    await insertMapping(tenant, { type: 'payment_term', target: '3' });
    await expect(insertMapping(tenant, { type: 'payment_term', target: '3' })).rejects.toMatchObject(unique);

    // Carried forward: Xero and CSV tax codes keep their behaviour, Desktop ones stay shared.
    await insertMapping(tenant, { integration: 'xero', target: 'OUTPUT2' });
    await expect(insertMapping(tenant, { integration: 'xero', target: 'OUTPUT2' })).rejects.toMatchObject(unique);
    await insertMapping(tenant, { integration: 'quickbooks_csv', target: 'GA Tax' });
    await expect(insertMapping(tenant, { integration: 'quickbooks_csv', target: 'GA Tax' })).rejects.toMatchObject(unique);
    await insertMapping(tenant, { integration: 'quickbooks_desktop', target: 'Sales Tax Payable' });
    await insertMapping(tenant, { integration: 'quickbooks_desktop', target: 'Sales Tax Payable' });

    // Carried forward: a tombstone reserves nothing, a live item still does.
    await insertMapping(tenant, { type: 'service', target: '164', unlinked: true });
    await insertMapping(tenant, { type: 'service', target: '164' });
    await expect(insertMapping(tenant, { type: 'service', target: '164' })).rejects.toMatchObject(unique);
  });

  it('down: refuses while regions share a code, leaving the data and the looser index', async () => {
    await migration.up(db);
    const tenant = await makeTenant('down-refuse');
    await insertMapping(tenant, { target: 'TAX' });
    await insertMapping(tenant, { target: 'TAX' });

    await expect(migration.down(db)).rejects.toThrow(/duplicate target group/);

    expect(await indexDef()).toMatch(/quickbooks_online/i);
    expect(await db(MAPPINGS).where({ tenant })).toHaveLength(2);
  });

  it('down: restores the one-to-one index on clean data, and up re-applies', async () => {
    await migration.up(db);
    await db(MAPPINGS).whereIn('tenant', tenantIds).del();
    const dupes = await db.raw(
      `SELECT COUNT(*)::int AS n FROM (SELECT 1 FROM ${MAPPINGS}
       WHERE integration_type = 'quickbooks_online' AND alga_entity_type = 'tax_code' AND deleted_at IS NULL
       GROUP BY tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, '')
       HAVING COUNT(*) > 1) d`
    );
    if (dupes.rows[0].n > 0) {
      // Pre-existing shared data in a shared dev DB: the refusal path is covered above.
      return;
    }
    await migration.down(db);
    expect(await indexDef()).not.toMatch(/quickbooks_online/i);

    const tenant = await makeTenant('down-clean');
    await insertMapping(tenant, { target: 'TAX' });
    await expect(insertMapping(tenant, { target: 'TAX' })).rejects.toMatchObject(unique);

    await migration.up(db);
    expect(await indexDef()).toMatch(/quickbooks_online/i);
    await insertMapping(tenant, { target: 'TAX' });
  });
});
