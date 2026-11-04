/**
 * alga-2026-0002672 — asset group schema guarantees (FR-E1).
 *
 * T090: the invariants that live in the database rather than in
 * packages/assets/src/lib/assetGroups.ts. One group per asset is a UNIQUE on
 * the member table, and the two vocabularies (group kind, contact role) are
 * CHECKs — so a second group for the same asset, an invented kind or an
 * invented role has to be refused even when the write bypasses the helper.
 *
 * asset_id and contact_name_id carry no foreign key of their own in
 * 20261009124000 (only tenant/group_id does), so these cases use plain UUIDs:
 * the subject here is the constraint, not the referenced row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

const HOOK_TIMEOUT = 180_000;
const columns: Record<string, Record<string, unknown>> = {};
const cleanupTenants = new Set<string>();

let db: Knex;

function hasColumn(name: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns[name] ?? {}, column);
}
function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}
function unscoped(name: string) {
  return tenantDb(db, '__asset_group_fixture__').unscoped(name, 'asset group integration fixture');
}

type Fixture = { tenantId: string; clientId: string };

async function seedTenant(): Promise<Fixture> {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  await unscoped('tenants').insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: 'Group PSA' } : { client_name: 'Group PSA' }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const clientId = randomUUID();
  await table(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Acme Corp',
    ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return { tenantId, clientId };
}

async function cleanupTenant(tenant: string): Promise<void> {
  const del = async (name: string) => table(tenant, name).del().catch(() => undefined);
  for (const name of ['asset_group_contacts', 'asset_group_members', 'asset_groups', 'clients']) {
    await del(name);
  }
  await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
}

async function makeGroup(
  fixture: Fixture,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const groupId = randomUUID();
  await table(fixture.tenantId, 'asset_groups').insert({
    tenant: fixture.tenantId,
    group_id: groupId,
    client_id: fixture.clientId,
    name: `Group ${groupId.slice(0, 8)}`,
    kind: 'bundle',
    ...overrides,
  });
  return groupId;
}

describe('asset group schema guarantees', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'clients']) {
      columns[name] = await tenantDb(db, '__asset_group_schema__')
        .unscoped(name, 'schema introspection')
        .columnInfo();
    }
    fixture = await seedTenant();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  // T090: one group per asset, enforced by the database.
  it('refuses a second group for an asset that already belongs to one', async () => {
    const first = await makeGroup(fixture);
    const second = await makeGroup(fixture);
    const assetId = randomUUID();

    await table(fixture.tenantId, 'asset_group_members')
      .insert({ tenant: fixture.tenantId, group_id: first, asset_id: assetId });

    await expect(
      table(fixture.tenantId, 'asset_group_members')
        .insert({ tenant: fixture.tenantId, group_id: second, asset_id: assetId }),
    ).rejects.toThrow(/asset_group_members_tenant_asset_uk/);

    // The first membership is untouched by the refused write.
    const rows = await table(fixture.tenantId, 'asset_group_members').where({ asset_id: assetId });
    expect(rows).toHaveLength(1);
    expect(rows[0].group_id).toBe(first);
  });

  // T090: re-adding the same asset to the same group is the primary key's job.
  it('refuses the same asset twice in one group', async () => {
    const groupId = await makeGroup(fixture);
    const assetId = randomUUID();
    const row = { tenant: fixture.tenantId, group_id: groupId, asset_id: assetId };

    await table(fixture.tenantId, 'asset_group_members').insert(row);
    await expect(
      table(fixture.tenantId, 'asset_group_members').insert(row),
    ).rejects.toThrow(/asset_group_members_pkey|asset_group_members_tenant_asset_uk/);
  });

  // T090: the kind vocabulary is a CHECK, not a convention.
  it('accepts both group kinds and rejects anything else', async () => {
    await expect(makeGroup(fixture, { kind: 'bundle' })).resolves.toBeTruthy();
    await expect(makeGroup(fixture, { kind: 'shared_workspace' })).resolves.toBeTruthy();

    await expect(makeGroup(fixture, { kind: 'workspace' }))
      .rejects.toThrow(/asset_groups_kind_check/);
    await expect(makeGroup(fixture, { kind: '' }))
      .rejects.toThrow(/asset_groups_kind_check/);
  });

  // T090: the contact role vocabulary is a CHECK too.
  it('accepts owner and user roles and rejects anything else', async () => {
    const groupId = await makeGroup(fixture);
    const insertContact = (role: string) =>
      table(fixture.tenantId, 'asset_group_contacts').insert({
        tenant: fixture.tenantId,
        group_id: groupId,
        contact_name_id: randomUUID(),
        role,
      });

    await expect(insertContact('owner')).resolves.toBeTruthy();
    await expect(insertContact('user')).resolves.toBeTruthy();
    await expect(insertContact('viewer')).rejects.toThrow(/asset_group_contacts_role_check/);
  });

  // Deleting a group must not leave orphaned membership or people rows behind.
  it('cascades membership and contact rows when a group is deleted', async () => {
    const groupId = await makeGroup(fixture);
    const assetId = randomUUID();
    await table(fixture.tenantId, 'asset_group_members')
      .insert({ tenant: fixture.tenantId, group_id: groupId, asset_id: assetId });
    await table(fixture.tenantId, 'asset_group_contacts')
      .insert({ tenant: fixture.tenantId, group_id: groupId, contact_name_id: randomUUID(), role: 'user' });

    await table(fixture.tenantId, 'asset_groups').where({ group_id: groupId }).del();

    expect(await table(fixture.tenantId, 'asset_group_members').where({ group_id: groupId })).toHaveLength(0);
    expect(await table(fixture.tenantId, 'asset_group_contacts').where({ group_id: groupId })).toHaveLength(0);
  });
});
