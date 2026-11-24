import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';
import { buildMergedEeMigrationsDir } from '../../../../../server/test-utils/eeMigrations';

const connection = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: connection.db })),
  runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<unknown>) => fn()),
}));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTenantTierAccess: vi.fn(async () => undefined),
}));

import { createAgent } from '@ee/lib/mcp/agents';

let db: Knex;
let migrationsDir: string;

async function addTenant(servicePrincipalLimit: number): Promise<string> {
  const tenant = randomUUID();
  await db('tenants').insert({
    tenant,
    client_name: 'MCP service principal test',
    email: `${tenant}@example.test`,
    plan: 'pro',
    service_principal_limit: servicePrincipalLimit,
  });
  return tenant;
}

describe('MCP agent service principal admission', () => {
  beforeAll(async () => {
    migrationsDir = buildMergedEeMigrationsDir();
    db = await createTestDbConnection({
      databaseName: `mcp_agent_principal_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      migrationsDir,
    });
    connection.db = db;
  }, 600_000);

  afterAll(async () => {
    connection.db = null;
    await db?.destroy();
    if (migrationsDir) rmSync(migrationsDir, { recursive: true, force: true });
  });

  it('creates the agent and backing service principal when capacity exists', async () => {
    const tenant = await addTenant(1);

    const agent = await createAgent({ tenant, name: 'Capacity available' });
    const principal = await db('service_principals').where({ tenant, user_id: agent.service_user_id }).first();
    const user = await db('users').where({ tenant, user_id: agent.service_user_id }).first();

    expect(agent.active).toBe(true);
    expect(principal).toMatchObject({ kind: 'mcp_agent', name: 'Capacity available' });
    expect(user).toMatchObject({ user_type: 'service', is_inactive: false });
  });

  it('rejects a full service principal allowance without creating provisioning rows', async () => {
    const tenant = await addTenant(1);
    await createAgent({ tenant, name: 'First agent' });

    await expect(createAgent({ tenant, name: 'Rejected at admission' })).rejects.toMatchObject({
      name: 'ServicePrincipalLimitReachedError',
      code: 'SERVICE_PRINCIPAL_LIMIT_REACHED',
      statusCode: 409,
    });

    expect(await db('agents').where({ tenant })).toHaveLength(1);
    expect(await db('service_principals').where({ tenant, kind: 'mcp_agent' })).toHaveLength(1);
    expect(await db('users').where({ tenant, user_type: 'service' })).toHaveLength(1);
  });

  it('rolls back the service principal and backing user when agent insertion fails', async () => {
    const tenant = await addTenant(1);
    await db.raw(`CREATE FUNCTION fail_mcp_agent_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.name = 'force rollback' THEN RAISE EXCEPTION 'forced MCP agent insert failure'; END IF;
        RETURN NEW;
      END $$`);
    await db.raw(`CREATE TRIGGER fail_mcp_agent_insert BEFORE INSERT ON agents
      FOR EACH ROW EXECUTE FUNCTION fail_mcp_agent_insert()`);

    await expect(createAgent({ tenant, name: 'force rollback' })).rejects.toThrow('forced MCP agent insert failure');

    expect(await db('agents').where({ tenant })).toHaveLength(0);
    expect(await db('service_principals').where({ tenant })).toHaveLength(0);
    expect(await db('users').where({ tenant, user_type: 'service' })).toHaveLength(0);
    await db.raw('DROP TRIGGER fail_mcp_agent_insert ON agents');
    await db.raw('DROP FUNCTION fail_mcp_agent_insert()');
  });
});
