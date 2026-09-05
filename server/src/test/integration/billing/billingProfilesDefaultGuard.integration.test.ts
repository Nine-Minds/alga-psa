import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

// F002 — exactly-one-default-per-client guard. The partial unique index
// (20260816000000) enforces *at most* one default; this suite proves the
// database-level guard from 20260817000000 makes *zero-default* unreachable for
// any client that has profiles, by exercising the actual trigger behavior.
//
// These are behavioral tests against the live DB, not "the index exists"
// checks: each case runs real INSERT/UPDATE/DELETE and asserts what the
// trigger does. The migration runs during createTestDbConnection (migrate.latest).

const HOOK_TIMEOUT = 300_000;

let db: Knex;
const tenantsToCleanup = new Set<string>();

function table(tenantId: string, name: string) {
  return tenantDb(db, tenantId).table(name);
}

function tenantsUnscoped() {
  return tenantDb(db, '__billing_guard_fixture__').unscoped(
    'tenants',
    'test fixture creates and removes tenant rows'
  );
}

async function seedTenantAndClient(tenantId: string, clientName: string): Promise<string> {
  await tenantsUnscoped()
    .insert({
      tenant: tenantId,
      client_name: `Tenant ${tenantId.slice(0, 8)}`,
      email: `tenant-${tenantId.slice(0, 8)}@example.test`,
    })
    .onConflict(['tenant'])
    .ignore();
  const clientId = uuidv4();
  await table(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: clientName,
    billing_cycle: 'monthly',
  });
  return clientId;
}

async function seedProfiles(
  tenantId: string,
  clientId: string,
  names: string[]
): Promise<string[]> {
  const profileIds: string[] = [];
  for (const name of names) {
    const profileId = uuidv4();
    await table(tenantId, 'client_billing_profiles').insert({
      tenant: tenantId,
      billing_profile_id: profileId,
      client_id: clientId,
      name,
      is_default: profileIds.length === 0,
      is_system_managed_default: profileIds.length === 0,
      is_active: true,
    });
    profileIds.push(profileId);
  }
  return profileIds;
}

async function defaultProfileIds(tenantId: string, clientId: string): Promise<string[]> {
  const rows = await table(tenantId, 'client_billing_profiles')
    .where({ client_id: clientId, is_default: true })
    .select('billing_profile_id');
  return rows.map((row) => String(row.billing_profile_id));
}

describe('F002 — zero-default is unreachable for any client with profiles (DB guard)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenantId of tenantsToCleanup) {
      await table(tenantId, 'client_billing_profiles').del().catch(() => undefined);
      await table(tenantId, 'clients').del().catch(() => undefined);
      await tenantsUnscoped().where({ tenant: tenantId }).del().catch(() => undefined);
    }
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('rejects unsetting the sole default profile while siblings exist', async () => {
    const tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    const clientId = await seedTenantAndClient(tenantId, 'Guard Corp');
    const [defaultId] = await seedProfiles(tenantId, clientId, ['Main', 'Backup']);

    await expect(
      table(tenantId, 'client_billing_profiles')
        .where({ billing_profile_id: defaultId })
        .update({ is_default: false })
    ).rejects.toThrow(/no default profile/);

    // The rejected unset must not have taken effect.
    await expect(defaultProfileIds(tenantId, clientId)).resolves.toEqual([defaultId]);
  }, HOOK_TIMEOUT);

  it('rejects deleting the sole default profile while a sibling profile exists', async () => {
    const tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    const clientId = await seedTenantAndClient(tenantId, 'Guard Corp');
    const [defaultId] = await seedProfiles(tenantId, clientId, ['Main', 'Backup']);

    await expect(
      table(tenantId, 'client_billing_profiles')
        .where({ billing_profile_id: defaultId })
        .del()
    ).rejects.toThrow(/no default profile/);

    await expect(defaultProfileIds(tenantId, clientId)).resolves.toEqual([defaultId]);
  }, HOOK_TIMEOUT);

  it('rejects inserting a client’s first profile as non-default', async () => {
    const tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    const clientId = await seedTenantAndClient(tenantId, 'Guard Corp');

    await expect(
      table(tenantId, 'client_billing_profiles').insert({
        tenant: tenantId,
        billing_profile_id: uuidv4(),
        client_id: clientId,
        name: 'First But Not Default',
        is_default: false,
        is_system_managed_default: false,
        is_active: true,
      })
    ).rejects.toThrow(/no default profile/);

    // The rejected insert must not have taken effect.
    await expect(
      table(tenantId, 'client_billing_profiles').where({ client_id: clientId })
    ).resolves.toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('rejects a key-moving UPDATE that moves the default profile away from a client with siblings', async () => {
    const tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    const clientAId = await seedTenantAndClient(tenantId, 'Old Client');
    const clientBId = await seedTenantAndClient(tenantId, 'New Client');
    const [aDefaultId] = await seedProfiles(tenantId, clientAId, ['A Main', 'A Backup']);
    const [bDefaultId] = await seedProfiles(tenantId, clientBId, ['B Main']);

    // Move A's default to B as a non-default sibling. The NEW client (B) ends
    // legal (its own default untouched); only the OLD client (A) is broken —
    // siblings remain with no default. The guard must validate the OLD
    // identity of the key-moving UPDATE and reject.
    await expect(
      table(tenantId, 'client_billing_profiles')
        .where({ billing_profile_id: aDefaultId })
        .update({ client_id: clientBId, is_default: false, is_system_managed_default: false })
    ).rejects.toThrow(/no default profile/);

    // The rejected move must not have taken effect on either client.
    await expect(defaultProfileIds(tenantId, clientAId)).resolves.toEqual([aDefaultId]);
    await expect(defaultProfileIds(tenantId, clientBId)).resolves.toEqual([bDefaultId]);
  }, HOOK_TIMEOUT);

  it('accepts moving a client’s sole profile to another client and preserves both invariants', async () => {
    const tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    const clientAId = await seedTenantAndClient(tenantId, 'Emptied Client');
    const clientBId = await seedTenantAndClient(tenantId, 'Receiving Client');
    const [soleId] = await seedProfiles(tenantId, clientAId, ['A Sole']);
    const [bDefaultId] = await seedProfiles(tenantId, clientBId, ['B Main']);

    // A is left with zero profiles (legal — the guard only constrains clients
    // that HAVE profiles); B gains a non-default sibling and keeps exactly one
    // default.
    await table(tenantId, 'client_billing_profiles')
      .where({ billing_profile_id: soleId })
      .update({ client_id: clientBId, is_default: false, is_system_managed_default: false });

    await expect(
      table(tenantId, 'client_billing_profiles').where({ client_id: clientAId })
    ).resolves.toHaveLength(0);
    await expect(defaultProfileIds(tenantId, clientBId)).resolves.toEqual([bDefaultId]);
    await expect(
      table(tenantId, 'client_billing_profiles').where({ client_id: clientBId })
    ).resolves.toHaveLength(2);
  }, HOOK_TIMEOUT);

  it('accepts an atomic default switch from profile A to B and leaves exactly one default', async () => {
    const tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    const clientId = await seedTenantAndClient(tenantId, 'Guard Corp');
    const [aId, bId] = await seedProfiles(tenantId, clientId, ['A', 'B']);

    // Atomic switch inside a single transaction: unset A, set B.
    await db.transaction(async (trx) => {
      await tenantDb(trx, tenantId).table('client_billing_profiles')
        .where({ billing_profile_id: aId })
        .update({ is_default: false });
      await tenantDb(trx, tenantId).table('client_billing_profiles')
        .where({ billing_profile_id: bId })
        .update({ is_default: true });
    });

    await expect(defaultProfileIds(tenantId, clientId)).resolves.toEqual([bId]);
  }, HOOK_TIMEOUT);

  it('after the S1 backfill every client has exactly one default profile (idempotent re-run)', async () => {
    const tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    const clientIds = [];
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      clientIds.push(await seedTenantAndClient(tenantId, name));
    }

    // The migration's backfill ran during migrate.latest() against the clients
    // present at that moment; these fixture clients were created afterwards, so
    // run the same idempotent INSERT..SELECT to reach the backfilled state.
    const backfill = `
      INSERT INTO client_billing_profiles (
        tenant, billing_profile_id, client_id, name,
        is_default, is_system_managed_default, is_active,
        created_at, updated_at
      )
      SELECT
        c.tenant,
        gen_random_uuid(),
        c.client_id,
        c.client_name,
        true,
        true,
        true,
        now(),
        now()
      FROM clients c
      WHERE c.tenant = ? AND NOT EXISTS (
        SELECT 1 FROM client_billing_profiles existing
        WHERE existing.tenant = c.tenant AND existing.client_id = c.client_id
      )
    `;
    await db.raw(backfill, [tenantId]);

    for (const clientId of clientIds) {
      const defaults = await defaultProfileIds(tenantId, clientId);
      expect(defaults).toHaveLength(1);
      const profile = await table(tenantId, 'client_billing_profiles')
        .where({ billing_profile_id: defaults[0] })
        .first();
      expect(profile?.is_system_managed_default).toBe(true);
    }

    // Idempotency: re-running the backfill creates no second default.
    await db.raw(backfill, [tenantId]);
    for (const clientId of clientIds) {
      await expect(defaultProfileIds(tenantId, clientId)).resolves.toHaveLength(1);
    }
  }, HOOK_TIMEOUT);
});
