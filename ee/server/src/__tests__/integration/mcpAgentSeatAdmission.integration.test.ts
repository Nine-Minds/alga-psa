import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import knexFactory from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '@main-test-utils/dbConfig';

let db: Knex;
vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: db })),
  runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<unknown>) => fn()),
}));

import { createAgent } from '@ee/lib/mcp/agents';

const timeout = 600_000;
const dbName = `mcp_agent_seat_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
let migrationsDir: string;

async function addTenant(options: { product?: string; limit?: number | null; plan?: string } = {}): Promise<string> {
  const id = randomUUID();
  await db('tenants').insert({
    tenant: id, client_name: 'MCP seat test', email: `${id}@example.test`,
    product_code: options.product ?? 'psa', plan: options.plan ?? 'pro',
    licensed_user_count: options.limit ?? null,
  });
  return id;
}

async function activeInternals(tenantId: string): Promise<number> {
  const row = await db('users').where({ tenant: tenantId, user_type: 'internal', is_inactive: false })
    .count('* as count').first();
  return Number(row?.count ?? 0);
}

async function installAgentFailureTrigger(): Promise<void> {
  await db.raw(`CREATE FUNCTION fail_mcp_agent_seat_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.name = 'force post-insert rollback' THEN RAISE EXCEPTION 'forced MCP agent insert failure'; END IF;
      RETURN NEW;
    END $$`);
  await db.raw(`CREATE TRIGGER fail_mcp_agent_seat_test BEFORE INSERT ON agents
    FOR EACH ROW EXECUTE FUNCTION fail_mcp_agent_seat_test()`);
}

async function installSeatOverflowTrigger(tenantId: string): Promise<void> {
  await db.raw(`CREATE FUNCTION add_mcp_agent_seat_overflow() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.username LIKE 'mcp-agent-%' THEN
        INSERT INTO users (tenant, user_id, username, email, first_name, last_name, user_type, is_inactive, hashed_password)
        VALUES (NEW.tenant, gen_random_uuid(), 'concurrent-seat-consumer', 'concurrent-seat@example.test',
          'Concurrent', 'User', 'internal', false, 'unused');
      END IF;
      RETURN NEW;
    END $$`);
  await db.raw(`CREATE TRIGGER add_mcp_agent_seat_overflow AFTER INSERT ON users
    FOR EACH ROW WHEN (NEW.tenant = '${tenantId}') EXECUTE FUNCTION add_mcp_agent_seat_overflow()`);
}

describe('MCP agent seat admission', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    if (!process.env.CI) {
      process.env.DB_HOST = '127.0.0.1';
      process.env.DB_PORT = '5472';
    }
    process.env.TEST_DB_NAME = dbName;
    migrationsDir = mkdtempSync(path.resolve(process.cwd(), '../../server/.ee-agent-seat-test-migrations-'));
    cpSync(path.resolve(process.cwd(), '../../server/migrations'), migrationsDir, { recursive: true });
    cpSync(path.resolve(process.cwd(), 'migrations'), migrationsDir, { recursive: true, force: true });
    process.env.TEST_MIGRATIONS_DIR = migrationsDir;
    db = await createTestDbConnection({ databaseName: dbName, migrationsDir, runSeeds: false, recreate: true });
  }, timeout);

  afterAll(async () => {
    await db?.destroy();
    if (!db) {
      if (migrationsDir) rmSync(migrationsDir, { recursive: true, force: true });
      return;
    }
    const admin = knexFactory({ client: 'pg', connection: {
      host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER_ADMIN,
      password: process.env.DB_PASSWORD_ADMIN, database: 'postgres',
    }, pool: { min: 0, max: 1 } });
    try {
      await admin.raw('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()', [dbName]);
      await admin.raw(`DROP DATABASE IF EXISTS "${dbName}"`);
    } finally {
      await admin.destroy();
      if (migrationsDir) rmSync(migrationsDir, { recursive: true, force: true });
    }
  }, timeout);

  it('admits the backing user and creates the active agent when capacity exists', async () => {
    const tenantId = await addTenant({ limit: 2 });
    const agent = await createAgent({ tenant: tenantId, name: 'Seat available' });
    const backingUserId = (agent.metadata as { backing_user_id: string }).backing_user_id;
    const user = await db('users').where({ tenant: tenantId, user_id: backingUserId }).first();

    expect(agent.active).toBe(true);
    expect(user).toMatchObject({ user_type: 'internal', is_inactive: false });
    expect(await activeInternals(tenantId)).toBe(1);
  });

  it('rejects an already-full tenant without creating any provisioning rows', async () => {
    const tenantId = await addTenant({ limit: 1 });
    await db('users').insert({
      tenant: tenantId, user_id: randomUUID(), username: 'existing', email: 'existing@example.test',
      first_name: 'Existing', last_name: 'User', user_type: 'internal', is_inactive: false,
      hashed_password: 'unused',
    });

    await expect(createAgent({ tenant: tenantId, name: 'Rejected at admission' }))
      .rejects.toMatchObject({ name: 'LicenseLimitError', code: 'LICENSE_LIMIT_REACHED', statusCode: 403 });

    expect(await db('agents').where({ tenant: tenantId })).toHaveLength(0);
    expect(await db('users').where({ tenant: tenantId }).whereLike('username', 'mcp-agent-%')).toHaveLength(0);
    expect(await db('user_roles').where({ tenant: tenantId })).toHaveLength(0);
    expect(await db('agent_roles').where({ tenant: tenantId })).toHaveLength(0);
  });

  it('rolls back the backing user and role rows when agent insertion fails after admission', async () => {
    const tenantId = await addTenant({ limit: 2 });
    const roleId = randomUUID();
    await db('roles').insert({ tenant: tenantId, role_id: roleId, role_name: 'Agent role', msp: true, client: false });
    await installAgentFailureTrigger();

    await expect(createAgent({ tenant: tenantId, name: 'force post-insert rollback', roleIds: [roleId] }))
      .rejects.toThrow('forced MCP agent insert failure');

    expect(await activeInternals(tenantId)).toBe(0);
    expect(await db('users').where({ tenant: tenantId }).whereLike('username', 'mcp-agent-%')).toHaveLength(0);
    expect(await db('user_roles').where({ tenant: tenantId })).toHaveLength(0);
    expect(await db('agent_roles').where({ tenant: tenantId })).toHaveLength(0);
    expect(await db('agents').where({ tenant: tenantId })).toHaveLength(0);
    await db.raw('DROP TRIGGER fail_mcp_agent_seat_test ON agents');
    await db.raw('DROP FUNCTION fail_mcp_agent_seat_test()');
  });

  it('rolls back all provisioning writes when the post-insert occupancy assertion rejects', async () => {
    const tenantId = await addTenant({ limit: 1 });
    await installSeatOverflowTrigger(tenantId);

    await expect(createAgent({ tenant: tenantId, name: 'Post-insert occupancy rejection' }))
      .rejects.toMatchObject({ name: 'InternalUserSeatOverflowError', code: 'LICENSE_LIMIT_REACHED', statusCode: 403 });

    expect(await activeInternals(tenantId)).toBe(0);
    expect(await db('users').where({ tenant: tenantId }).whereLike('username', 'mcp-agent-%')).toHaveLength(0);
    expect(await db('users').where({ tenant: tenantId, username: 'concurrent-seat-consumer' })).toHaveLength(0);
    expect(await db('user_roles').where({ tenant: tenantId })).toHaveLength(0);
    expect(await db('agent_roles').where({ tenant: tenantId })).toHaveLength(0);
    expect(await db('agents').where({ tenant: tenantId })).toHaveLength(0);
    await db.raw('DROP TRIGGER add_mcp_agent_seat_overflow ON users');
    await db.raw('DROP FUNCTION add_mcp_agent_seat_overflow()');
  });

  it('serializes concurrent attempts for the final licensed seat', async () => {
    const tenantId = await addTenant({ limit: 2 });
    await db('users').insert({
      tenant: tenantId, user_id: randomUUID(), username: 'existing-race', email: 'race-existing@example.test',
      first_name: 'Existing', last_name: 'User', user_type: 'internal', is_inactive: false,
      hashed_password: 'unused',
    });

    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, i) =>
      createAgent({ tenant: tenantId, name: `Final seat racer ${i}` })));
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(7);
    expect(await activeInternals(tenantId)).toBe(2);
    expect(await db('agents').where({ tenant: tenantId })).toHaveLength(1);
  }, 60_000);

  it('uses co-managed admission instead of native seat limits', async () => {
    const sponsor = await addTenant({ limit: 1, plan: 'pro' });
    const customer = await addTenant({ product: 'co_managed', limit: 1 });
    const relationshipId = randomUUID();
    const operationId = randomUUID();
    const allocationId = randomUUID();
    const boardId = randomUUID();
    const clientId = randomUUID();
    const adminInvitationId = randomUUID();
    const requestFingerprint = 'a'.repeat(64);
    const now = new Date();
    const expiry = new Date(now.getTime() + 86_400_000);

    await db('co_management_relationships').insert({
      tenant: customer, relationship_id: relationshipId, sponsor_tenant: sponsor,
      sponsor_client_id: randomUUID(), state: 'active', accepted_by: randomUUID(), accepted_at: now,
    });
    await db('co_managed_entitlements').insert({
      tenant: sponsor, source: 'admin_grant', source_reference: 'test', capacity: 10,
      verified_at: now, valid_until: expiry,
    });
    await db('co_managed_provisioning_operations').insert({
      tenant: sponsor, operation_id: operationId, allocation_id: allocationId, customer_tenant: customer,
      relationship_id: relationshipId, requested_by: randomUUID(), escalation_board_id: boardId,
      customer_board_id: boardId, customer_client_id: clientId, administrator_invitation_id: adminInvitationId,
      request_fingerprint: requestFingerprint, request: JSON.stringify({}), state: 'pending_acceptance',
    });
    await db('co_managed_allocations').insert({
      tenant: sponsor, allocation_id: allocationId, operation_id: operationId,
      request_fingerprint: requestFingerprint, customer_tenant: customer, relationship_id: relationshipId,
      seats: 2, state: 'active',
    });
    // The customer's native licensed count is full, but the sponsor allocated capacity.
    await db('users').insert({
      tenant: customer, user_id: randomUUID(), username: 'existing-customer', email: 'customer-existing@example.test',
      first_name: 'Existing', last_name: 'User', user_type: 'internal', is_inactive: false, hashed_password: 'unused',
    });
    const roleId = randomUUID();
    await db('roles').insert({ tenant: customer, role_id: roleId, role_name: 'Agent role', msp: true, client: false });

    const agent = await createAgent({ tenant: customer, name: 'Co-managed admission', roleIds: [roleId] });
    const backingUserId = (agent.metadata as { backing_user_id: string }).backing_user_id;
    expect(agent.active).toBe(true);
    expect(await activeInternals(customer)).toBe(2);
    expect(await db('user_roles').where({ tenant: customer, user_id: backingUserId, role_id: roleId })).toHaveLength(1);
    expect(await db('agent_roles').where({ tenant: customer, agent_id: agent.agent_id, role_id: roleId })).toHaveLength(1);
  });

  it('rolls back co-managed provisioning when post-insert occupancy exceeds the allocation', async () => {
    const sponsor = await addTenant({ limit: 1, plan: 'pro' });
    const customer = await addTenant({ product: 'co_managed', limit: 1 });
    const relationshipId = randomUUID();
    const operationId = randomUUID();
    const allocationId = randomUUID();
    const boardId = randomUUID();
    const clientId = randomUUID();
    const adminInvitationId = randomUUID();
    const requestFingerprint = 'b'.repeat(64);
    const now = new Date();
    const expiry = new Date(now.getTime() + 86_400_000);

    await db('co_management_relationships').insert({
      tenant: customer, relationship_id: relationshipId, sponsor_tenant: sponsor,
      sponsor_client_id: randomUUID(), state: 'active', accepted_by: randomUUID(), accepted_at: now,
    });
    await db('co_managed_entitlements').insert({
      tenant: sponsor, source: 'admin_grant', source_reference: 'test', capacity: 10,
      verified_at: now, valid_until: expiry,
    });
    await db('co_managed_provisioning_operations').insert({
      tenant: sponsor, operation_id: operationId, allocation_id: allocationId, customer_tenant: customer,
      relationship_id: relationshipId, requested_by: randomUUID(), escalation_board_id: boardId,
      customer_board_id: boardId, customer_client_id: clientId, administrator_invitation_id: adminInvitationId,
      request_fingerprint: requestFingerprint, request: JSON.stringify({}), state: 'pending_acceptance',
    });
    await db('co_managed_allocations').insert({
      tenant: sponsor, allocation_id: allocationId, operation_id: operationId,
      request_fingerprint: requestFingerprint, customer_tenant: customer, relationship_id: relationshipId,
      seats: 2, state: 'active',
    });
    await db('users').insert({
      tenant: customer, user_id: randomUUID(), username: 'existing-overflow-customer', email: 'overflow-existing@example.test',
      first_name: 'Existing', last_name: 'User', user_type: 'internal', is_inactive: false, hashed_password: 'unused',
    });
    await installSeatOverflowTrigger(customer);

    await expect(createAgent({ tenant: customer, name: 'Co-managed post-insert overflow' }))
      .rejects.toMatchObject({ name: 'CoManagedAdmissionError', code: 'CO_MANAGED_SEAT_LIMIT' });

    expect(await activeInternals(customer)).toBe(1);
    expect(await db('users').where({ tenant: customer }).whereLike('username', 'mcp-agent-%')).toHaveLength(0);
    expect(await db('users').where({ tenant: customer, username: 'concurrent-seat-consumer' })).toHaveLength(0);
    expect(await db('user_roles').where({ tenant: customer })).toHaveLength(0);
    expect(await db('agent_roles').where({ tenant: customer })).toHaveLength(0);
    expect(await db('agents').where({ tenant: customer })).toHaveLength(0);
    await db.raw('DROP TRIGGER add_mcp_agent_seat_overflow ON users');
    await db.raw('DROP FUNCTION add_mcp_agent_seat_overflow()');
  });
});
