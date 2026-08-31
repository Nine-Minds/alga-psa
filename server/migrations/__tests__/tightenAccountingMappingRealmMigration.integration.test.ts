import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

// Behavioral DB test for the realm-tightening migration. The migration must
// NOT guess which QuickBooks company a legacy null-realm mapping belongs to
// from whatever realm the tenant currently happens to show — that inference is
// silently invalidated the moment a default-realm change alters the observed
// realm. Every null-realm QBO row must instead be quarantined for manual
// reconciliation and kept null so realm-exact lookups can never consume it.
//
// These assertions read DB state after running the migration; they do not
// inspect migration source text.

const require = createRequire(import.meta.url);
const MIGRATION_PATH = path.resolve(
  __dirname,
  '../20260830120000_tighten_accounting_mapping_realm.cjs'
);

const QBO = 'quickbooks_online';
const MAPPINGS = 'tenant_external_entity_mappings';
const OPS = 'accounting_sync_operations';

let db: Knex;
let migration: { up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> };
const tenantIds: string[] = [];

async function makeTenant(label: string): Promise<string> {
  const tenant = randomUUID();
  await db('tenants').insert({
    tenant,
    client_name: `Realm Migration ${label}`,
    email: `realm-migration-${tenant.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  tenantIds.push(tenant);
  return tenant;
}

async function insertMapping(
  tenant: string,
  opts: { realm: string | null; entityId: string; syncStatus?: string }
): Promise<string> {
  const id = randomUUID();
  await db(MAPPINGS).insert({
    id,
    tenant,
    integration_type: QBO,
    alga_entity_type: 'invoice',
    alga_entity_id: opts.entityId,
    external_entity_id: `qbo-${opts.entityId}`,
    external_realm_id: opts.realm,
    sync_status: opts.syncStatus ?? 'synced',
    metadata: null,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return id;
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  migration = require(MIGRATION_PATH);
}, 300_000);

afterAll(async () => {
  if (!db) return;
  for (const tenant of tenantIds) {
    await db(OPS).where({ tenant }).del();
    await db(MAPPINGS).where({ tenant }).del();
    await db('tenants').where({ tenant }).del();
  }
  await db.destroy().catch(() => undefined);
});

describe('tighten accounting mapping realm migration (DB-backed)', () => {
  it('quarantines a null-realm mapping instead of stamping the sole observed realm', async () => {
    const tenant = await makeTenant('one-observed');
    const legacyId = await insertMapping(tenant, { realm: null, entityId: randomUUID() });
    const realmR1Id = await insertMapping(tenant, { realm: 'realm-R1', entityId: randomUUID() });

    await migration.up(db);

    const legacy = await db(MAPPINGS).where({ id: legacyId }).first();
    // The legacy row is NOT retargeted onto the one realm we can see.
    expect(legacy.external_realm_id).toBeNull();
    expect(legacy.sync_status).toBe('needs_realm_review');
    expect(legacy.metadata?.realm_backfilled).toBeUndefined();
    expect(legacy.metadata?.realm_review_reason).toBeTruthy();

    // A realm-exact lookup for the observed realm never returns the legacy row.
    const exactForR1 = await db(MAPPINGS)
      .where({ tenant, integration_type: QBO, external_realm_id: 'realm-R1' })
      .pluck('id');
    expect(exactForR1).not.toContain(legacyId);

    // The genuine realm-R1 row is untouched.
    const r1 = await db(MAPPINGS).where({ id: realmR1Id }).first();
    expect(r1.external_realm_id).toBe('realm-R1');
    expect(r1.sync_status).toBe('synced');
  });

  it('does not reinterpret a quarantined row after a later default-realm change', async () => {
    const tenant = await makeTenant('default-change');
    const legacyId = await insertMapping(tenant, { realm: null, entityId: randomUUID() });
    // Initially the only observed realm is R1.
    await insertMapping(tenant, { realm: 'realm-R1', entityId: randomUUID() });

    await migration.up(db);

    const afterFirst = await db(MAPPINGS).where({ id: legacyId }).first();
    expect(afterFirst.external_realm_id).toBeNull();
    expect(afterFirst.sync_status).toBe('needs_realm_review');

    // The tenant switches its default company: R1's mapping is removed and a
    // brand-new realm R2 becomes the sole observed realm.
    await db(MAPPINGS)
      .where({ tenant, integration_type: QBO, external_realm_id: 'realm-R1' })
      .del();
    await insertMapping(tenant, { realm: 'realm-R2', entityId: randomUUID() });

    // Re-running the migration (as would happen on redeploy) must not now
    // retarget the quarantined legacy row onto R2.
    await migration.up(db);

    const afterChange = await db(MAPPINGS).where({ id: legacyId }).first();
    expect(afterChange.external_realm_id).toBeNull();
    expect(afterChange.sync_status).toBe('needs_realm_review');
    const exactForR2 = await db(MAPPINGS)
      .where({ tenant, integration_type: QBO, external_realm_id: 'realm-R2' })
      .pluck('id');
    expect(exactForR2).not.toContain(legacyId);
  });

  it('quarantines an ambiguous null-realm row the same way when several realms are observed', async () => {
    const tenant = await makeTenant('ambiguous');
    const legacyId = await insertMapping(tenant, { realm: null, entityId: randomUUID() });
    await insertMapping(tenant, { realm: 'realm-R1', entityId: randomUUID() });
    await insertMapping(tenant, { realm: 'realm-R2', entityId: randomUUID() });

    await migration.up(db);

    const legacy = await db(MAPPINGS).where({ id: legacyId }).first();
    // Same deterministic outcome as the single-realm case: quarantined, null.
    expect(legacy.external_realm_id).toBeNull();
    expect(legacy.sync_status).toBe('needs_realm_review');
  });

  it('retires null-realm queued operations instead of guessing a target realm', async () => {
    const tenant = await makeTenant('ops');
    // Give the tenant a single observed realm, which the old migration would
    // have used to backfill the op's target.
    await insertMapping(tenant, { realm: 'realm-R1', entityId: randomUUID() });

    const pendingNullOp = randomUUID();
    const inProgressNullOp = randomUUID();
    const pendingRealmOp = randomUUID();
    const commonOp = {
      tenant,
      adapter_type: QBO,
      operation: 'void_invoice',
      alga_entity_type: 'invoice',
      created_at: db.fn.now(),
    };
    await db(OPS).insert([
      { ...commonOp, op_id: pendingNullOp, alga_entity_id: randomUUID(), target_realm: null, status: 'pending', attempts: 0 },
      { ...commonOp, op_id: inProgressNullOp, alga_entity_id: randomUUID(), target_realm: null, status: 'in_progress', attempts: 0 },
      { ...commonOp, op_id: pendingRealmOp, alga_entity_id: randomUUID(), target_realm: 'realm-R1', status: 'pending', attempts: 0 },
    ]);

    await migration.up(db);

    const pending = await db(OPS).where({ tenant, op_id: pendingNullOp }).first();
    expect(pending.status).toBe('skipped');
    expect(pending.target_realm).toBeNull(); // not guessed onto realm-R1
    expect(pending.last_error).toBeTruthy();

    const inProgress = await db(OPS).where({ tenant, op_id: inProgressNullOp }).first();
    expect(inProgress.status).toBe('skipped');
    expect(inProgress.target_realm).toBeNull();

    // A realm-scoped op is left alone.
    const realmOp = await db(OPS).where({ tenant, op_id: pendingRealmOp }).first();
    expect(realmOp.status).toBe('pending');
    expect(realmOp.target_realm).toBe('realm-R1');
  });
});
