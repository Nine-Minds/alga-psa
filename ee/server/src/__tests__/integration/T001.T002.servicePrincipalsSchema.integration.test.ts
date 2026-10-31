/**
 * Service principals C/4, real Postgres.
 *
 *  - T001 (F001/F002/F004/F006/F007): EE migrations on a migrated schema accept user_type='service',
 *    reject 'robot', create service_principals / via columns / service_principal_limit /
 *    permission rows; on a CE-only schema user_type='service' fails the CHECK.
 *  - T002 (F087/F088/F003): the R9.2 agent -> service-user migration mirrors agents.active into
 *    users.is_inactive, backfills agents.service_user_id, creates service_principals rows, is
 *    idempotent, and lowers licensed-user usage by the agent count.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';
import { buildMergedEeMigrationsDir } from '../../../../../server/test-utils/eeMigrations';

const requireCjs = createRequire(import.meta.url);
const AGENT_MIGRATION = path.resolve(
  __dirname,
  '../../../migrations/20261018100200_migrate_agent_users_to_service.cjs'
);

const PERMISSION_MIGRATION = path.resolve(
  __dirname,
  '../../../migrations/20261018100100_add_service_principal_permissions.cjs'
);

let eeDb: Knex;
let ceDb: Knex;
let mergedDir: string;

async function insertTenant(db: Knex): Promise<string> {
  const tenant = uuidv4();
  await db('tenants').insert({
    tenant,
    client_name: `T001 ${tenant.slice(0, 8)}`,
    email: `t001-${tenant.slice(0, 8)}@example.com`,
  });
  return tenant;
}

async function insertUser(db: Knex, tenant: string, userType: string, extra: Record<string, unknown> = {}) {
  const user_id = uuidv4();
  await db('users').insert({
    tenant,
    user_id,
    username: `u-${user_id.slice(0, 8)}`,
    email: `${user_id.slice(0, 8)}@example.com`,
    hashed_password: 'x',
    user_type: userType,
    ...extra,
  });
  return user_id;
}

beforeAll(async () => {
  mergedDir = buildMergedEeMigrationsDir();
  eeDb = await createTestDbConnection({ databaseName: 'sp_c4_ee_schema_test', migrationsDir: mergedDir });
  ceDb = await createTestDbConnection({ databaseName: 'sp_c4_ce_schema_test' });
}, 600_000);

afterAll(async () => {
  await eeDb?.destroy();
  await ceDb?.destroy();
  if (mergedDir) rmSync(mergedDir, { recursive: true, force: true });
});

describe('service principals schema (T001)', () => {
  it("EE: accepts user_type='service', rejects 'robot'", async () => {
    const tenant = await insertTenant(eeDb);
    await expect(insertUser(eeDb, tenant, 'service')).resolves.toBeTruthy();
    await expect(insertUser(eeDb, tenant, 'robot')).rejects.toThrow(/check/i);
  });

  it('EE: creates service_principals, via columns, limit column and permissions', async () => {
    expect(await eeDb.schema.hasTable('service_principals')).toBe(true);
    for (const [table, column] of [
      ['time_entries', 'created_via_principal_id'],
      ['time_entries', 'updated_via_principal_id'],
      ['time_sheets', 'approved_via_principal_id'],
      ['schedule_entries', 'created_via_principal_id'],
      ['interactions', 'created_via_principal_id'],
      ['comments', 'created_via_principal_id'],
      ['tickets', 'entered_via_principal_id'],
      ['project_tasks', 'created_via_principal_id'],
      ['ticket_audit_logs', 'via_principal_user_id'],
      ['mcp_agent_audit', 'act_as_user_id'],
      ['agents', 'service_user_id'],
      ['tenants', 'service_principal_limit'],
    ]) {
      expect(await eeDb.schema.hasColumn(table, column), `${table}.${column}`).toBe(true);
    }
  });

  it('EE: permission migration seeds service_principal permissions for the Admin role, idempotently, and rolls back', async () => {
    // Permission rows are per tenant, so they exist only for tenants present when the
    // migration runs. Create a tenant with an MSP Admin role, then (re)run the migration.
    const tenant = await insertTenant(eeDb);
    const role_id = uuidv4();
    await eeDb('roles').insert({ tenant, role_id, role_name: 'Admin', msp: true, client: false, description: 'Admin' });
    const migration = requireCjs(PERMISSION_MIGRATION);
    await migration.up(eeDb);
    await migration.up(eeDb);
    const perms = await eeDb('permissions').where({ tenant, resource: 'service_principal' }).select('action', 'msp', 'client');
    expect(perms.map((p) => p.action).sort()).toEqual(['create', 'delete', 'read', 'update']);
    expect(perms.every((p) => p.msp === true && p.client === false)).toBe(true);
    const granted = await eeDb('role_permissions').where({ tenant, role_id }).count<{ count: string }>('* as count').first();
    expect(Number(granted?.count)).toBe(4);
    await migration.down(eeDb);
    expect(await eeDb('permissions').where({ tenant, resource: 'service_principal' }).count<{ count: string }>('* as count').first())
      .toMatchObject({ count: '0' });
  });

  it("CE-only: user_type='service' fails the CHECK and no EE schema exists", async () => {
    const tenant = await insertTenant(ceDb);
    await expect(insertUser(ceDb, tenant, 'service')).rejects.toThrow(/check/i);
    expect(await ceDb.schema.hasTable('service_principals')).toBe(false);
  });
});

describe('agent -> service user data migration (T002)', () => {
  let tenant: string;
  let activeAgent: string;
  let inactiveAgent: string;

  async function licensedUsers(): Promise<number> {
    const row = await eeDb('users')
      .where({ tenant, is_inactive: false })
      .whereNot({ user_type: 'service' })
      .count<{ count: string }>('* as count')
      .first();
    return Number(row?.count ?? 0);
  }

  it('mirrors active, backfills service_user_id, is idempotent, and drops licensed usage', async () => {
    tenant = await insertTenant(eeDb);
    const backing1 = await insertUser(eeDb, tenant, 'internal', { is_inactive: false });
    const backing2 = await insertUser(eeDb, tenant, 'internal', { is_inactive: false });
    activeAgent = uuidv4();
    inactiveAgent = uuidv4();
    const base = { tenant, kind: 'mcp', created_at: eeDb.fn.now() } as Record<string, unknown>;
    const cols = await eeDb('agents').columnInfo();
    const mk = (id: string, backing: string, active: boolean, name: string) => {
      const row: Record<string, unknown> = { tenant, agent_id: id, name, metadata: JSON.stringify({ backing_user_id: backing }), active };
      for (const [k, v] of Object.entries(base)) if (k in cols && !(k in row)) row[k] = v;
      return row;
    };
    await eeDb('agents').insert([
      mk(activeAgent, backing1, true, 'active-agent'),
      mk(inactiveAgent, backing2, false, 'inactive-agent'),
    ]);

    const before = await licensedUsers();
    const migration = requireCjs(AGENT_MIGRATION);
    await migration.up(eeDb);

    const agents = await eeDb('agents').where({ tenant }).select('agent_id', 'active', 'service_user_id');
    for (const a of agents) {
      expect(a.service_user_id).toBeTruthy();
      const u = await eeDb('users').where({ tenant, user_id: a.service_user_id }).first();
      expect(u.user_type).toBe('service');
      expect(u.is_inactive).toBe(!a.active);
      const sp = await eeDb('service_principals').where({ tenant, user_id: a.service_user_id }).first();
      expect(sp.kind).toBe('mcp_agent');
    }
    expect(await licensedUsers()).toBe(before - 2);

    const snapshot = await eeDb('agents').where({ tenant }).select('agent_id', 'service_user_id').orderBy('agent_id');
    await migration.up(eeDb);
    const again = await eeDb('agents').where({ tenant }).select('agent_id', 'service_user_id').orderBy('agent_id');
    expect(again).toEqual(snapshot);
    const spCount = await eeDb('service_principals').where({ tenant }).count<{ count: string }>('* as count').first();
    expect(Number(spCount?.count)).toBe(2);
  });
});
