/**
 * T001 — marketing migrations.
 *
 * Asserts the marketing schema applies cleanly on the standard test database
 * (createTestDbConnection drops/recreates it and runs ALL migrations + dev
 * seeds): all 13 marketing tables exist, every one carries `tenant` in its
 * primary key, and the seed migrations install the 5 marketing interaction
 * types (globally, in system_interaction_types) plus the marketing
 * read/manage permissions for a tenant.
 *
 * The permission seed migration enumerates the tenants that exist when
 * migrate.latest() runs. On a fresh test DB that is zero tenants (the
 * dev-seed tenant is created afterwards, by the seeds), so the permission
 * suite re-runs that idempotent seed migration against a tenant created
 * here — which is exactly the behavior being verified. Interaction types
 * need no re-run: they are global system types.
 *
 * Requires the standard test DB (DB_HOST/DB_PORT et al.); skipped
 * automatically when no database is reachable unless REQUIRE_DB=1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createTenant } from '../../../test-utils/testDataFactory';

const describeDb = await describeWithDb();
const requireCjs = createRequire(import.meta.url);

const MARKETING_TABLES = [
  'marketing_campaigns',
  'marketing_content',
  'marketing_channels',
  'marketing_capture_forms',
  'social_posts',
  'social_post_targets',
  'marketing_sequences',
  'marketing_sequence_steps',
  'marketing_sequence_enrollments',
  'marketing_sequence_sends',
  'marketing_contact_state',
  'marketing_suppressions',
  'marketing_engagements',
] as const;

const MARKETING_INTERACTION_TYPES = [
  'Marketing: Post Published',
  'Marketing: Email Sent',
  'Marketing: Email Opened',
  'Marketing: Email Clicked',
  'Marketing: Form Submitted',
] as const;

let db: Knex;

describeDb('T001: marketing migrations', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: true });
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('creates all 13 marketing tables', async () => {
    const rows = await db('information_schema.tables')
      .where({ table_schema: 'public' })
      .whereIn('table_name', MARKETING_TABLES as unknown as string[])
      .pluck('table_name');

    expect(rows.sort()).toEqual([...MARKETING_TABLES].sort());
  });

  it('gives every marketing table a composite primary key that includes tenant', async () => {
    const pkColumns = await db.raw(
      `SELECT tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_catalog = tc.constraint_catalog
        AND kcu.constraint_schema = tc.constraint_schema
        AND kcu.constraint_name = tc.constraint_name
        AND kcu.table_name = tc.table_name
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = 'public'
         AND tc.table_name = ANY(?)`,
      [MARKETING_TABLES as unknown as string[]],
    );

    const byTable = new Map<string, string[]>();
    for (const row of pkColumns.rows as Array<{ table_name: string; column_name: string }>) {
      byTable.set(row.table_name, [...(byTable.get(row.table_name) ?? []), row.column_name]);
    }

    for (const table of MARKETING_TABLES) {
      const columns = byTable.get(table) ?? [];
      expect(columns.length, `${table} should have a composite primary key`).toBeGreaterThanOrEqual(2);
      expect(columns, `${table} primary key should include tenant`).toContain('tenant');
    }
  });

  it('seeds the 5 marketing interaction types as global system types', async () => {
    // Marketing types live in system_interaction_types (opportunities' 'Note'
    // precedent): seeded once, globally, by migrate.latest() — no per-tenant
    // seed, so tenants created after the migration still resolve them.
    const types = await db('system_interaction_types')
      .whereIn('type_name', MARKETING_INTERACTION_TYPES as unknown as string[])
      .pluck('type_name');

    expect(types.sort()).toEqual([...MARKETING_INTERACTION_TYPES].sort());
  });

  it('seeds marketing read/manage permissions and grants them to the Admin role', async () => {
    const tenantId = await createTenant(db, 'Marketing Seed Tenant (permissions)');

    // The permission migration grants to msp Admin roles; create one so the
    // grant path is exercised for this tenant.
    const roleId = uuidv4();
    const roleValues: Record<string, unknown> = {
      tenant: tenantId,
      role_id: roleId,
      role_name: 'Admin',
      description: 'Test admin role',
    };
    if (await db.schema.hasColumn('roles', 'msp')) roleValues.msp = true;
    if (await db.schema.hasColumn('roles', 'client')) roleValues.client = false;
    await tenantDb(db, tenantId).table('roles').insert(roleValues);

    const migration = requireCjs('../../../migrations/20260719102000_add_marketing_permissions.cjs');
    await migration.up(db);

    const permissions = await tenantDb(db, tenantId).table('permissions')
      .where({ tenant: tenantId, resource: 'marketing' })
      .whereIn('action', ['read', 'manage'])
      .select('permission_id', 'action', 'msp', 'client');

    expect(permissions.map((p: { action: string }) => p.action).sort()).toEqual(['manage', 'read']);
    for (const permission of permissions) {
      expect(permission.msp).toBe(true);
      expect(permission.client).toBe(false);
    }

    const grants = await tenantDb(db, tenantId).table('role_permissions')
      .where({ tenant: tenantId, role_id: roleId })
      .whereIn('permission_id', permissions.map((p: { permission_id: string }) => p.permission_id))
      .pluck('permission_id');

    expect(grants.sort()).toEqual(permissions.map((p: { permission_id: string }) => p.permission_id).sort());
  });
});
