/**
 * Service principals C/4 repair round, EE service against real Postgres.
 *
 *  - F024: updateServicePrincipal replaces user_roles (and agent_roles for mcp_agents) transactionally.
 *  - F029: listServicePrincipals returns roles and last_used_at (max across keys, null if never used).
 *  - F034: mintAgentSessionKey refuses an inactive user or agent and inserts no key.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { rmSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';
import { buildMergedEeMigrationsDir } from '../../../../../server/test-utils/eeMigrations';

const conn = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  getConnection: vi.fn(async () => conn.db),
}));
vi.mock('@/lib/db', () => ({
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
  createTenantKnex: async () => ({ knex: conn.db }),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: async () => conn.db }));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTenantTierAccess: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/licensing', () => ({
  getLicenseStateRow: vi.fn(async () => null),
  verifyLicense: vi.fn(() => ({ valid: false })),
}));

import {
  createServicePrincipal,
  listServicePrincipals,
  setServicePrincipalActive,
  updateServicePrincipal,
} from '../../lib/service-principals/service';
import { mintAgentSessionKey } from '../../lib/mcp/agents';

let db: Knex;
let mergedDir: string;
let tenant: string;

async function newTenant(): Promise<string> {
  const id = uuidv4();
  await db('tenants').insert({
    tenant: id,
    client_name: `RLM ${id.slice(0, 8)}`,
    email: `rlm-${id.slice(0, 8)}@example.com`,
    service_principal_limit: 10,
  });
  return id;
}

async function addRole(t: string, name: string, msp: boolean): Promise<string> {
  const role_id = uuidv4();
  await db('roles').insert({ tenant: t, role_id, role_name: name, msp, client: !msp, description: name });
  return role_id;
}

const userRoleIds = async (userId: string) =>
  (await tenantDb(db, tenant).table('user_roles').where({ user_id: userId }).pluck('role_id')).sort();

async function addAgent(userId: string, roleIds: string[] = []): Promise<string> {
  const agent_id = uuidv4();
  const scoped = tenantDb(db, tenant);
  await scoped.table('agents').insert({
    agent_id, tenant, name: 'agent', active: true, service_user_id: userId, metadata: JSON.stringify({}),
  });
  for (const role_id of roleIds) await scoped.table('agent_roles').insert({ tenant, agent_id, role_id });
  return agent_id;
}

beforeAll(async () => {
  mergedDir = buildMergedEeMigrationsDir();
  db = await createTestDbConnection({ databaseName: 'sp_c4_roles_list_mint_test', migrationsDir: mergedDir });
  conn.db = db;
}, 600_000);

afterAll(async () => {
  await db?.destroy();
  if (mergedDir) rmSync(mergedDir, { recursive: true, force: true });
});

beforeEach(async () => {
  tenant = await newTenant();
});

describe('updateServicePrincipal roles (F024)', () => {
  it('replaces user_roles rather than appending, and clears with an empty list', async () => {
    const a = await addRole(tenant, 'A', true);
    const b = await addRole(tenant, 'B', true);
    const c = await addRole(tenant, 'C', true);
    const sp = await createServicePrincipal(db, tenant, { kind: 'api', name: 'r', roleIds: [a, b] });
    expect(await userRoleIds(sp.user_id)).toEqual([a, b].sort());

    await updateServicePrincipal(db, tenant, sp.user_id, { roleIds: [b, c] });
    expect(await userRoleIds(sp.user_id)).toEqual([b, c].sort());

    await updateServicePrincipal(db, tenant, sp.user_id, { name: 'renamed' });
    expect(await userRoleIds(sp.user_id)).toEqual([b, c].sort()); // omitted = untouched

    await updateServicePrincipal(db, tenant, sp.user_id, { roleIds: [] });
    expect(await userRoleIds(sp.user_id)).toEqual([]);
  });

  it('also replaces agent_roles for an mcp_agent', async () => {
    const a = await addRole(tenant, 'A', true);
    const b = await addRole(tenant, 'B', true);
    const sp = await createServicePrincipal(db, tenant, { kind: 'mcp_agent', name: 'agent', roleIds: [a] });
    const agentId = await addAgent(sp.user_id, [a]);

    await updateServicePrincipal(db, tenant, sp.user_id, { roleIds: [b] });
    expect(await userRoleIds(sp.user_id)).toEqual([b]);
    expect(await tenantDb(db, tenant).table('agent_roles').where({ agent_id: agentId }).pluck('role_id')).toEqual([b]);
  });

  it('rejects a client role or a foreign-tenant role and changes nothing', async () => {
    const a = await addRole(tenant, 'A', true);
    const clientRole = await addRole(tenant, 'Client', false);
    const other = await newTenant();
    const foreign = await addRole(other, 'Foreign', true);
    const sp = await createServicePrincipal(db, tenant, { kind: 'mcp_agent', name: 'agent', roleIds: [a] });
    const agentId = await addAgent(sp.user_id, [a]);

    for (const bad of [clientRole, foreign]) {
      await expect(
        updateServicePrincipal(db, tenant, sp.user_id, { name: 'should-not-stick', roleIds: [a, bad] }),
      ).rejects.toMatchObject({ code: 'SERVICE_PRINCIPAL_ROLE_INVALID', statusCode: 422 });
    }
    expect(await userRoleIds(sp.user_id)).toEqual([a]);
    expect(await tenantDb(db, tenant).table('agent_roles').where({ agent_id: agentId }).pluck('role_id')).toEqual([a]);
    const row = await tenantDb(db, tenant).table('service_principals').where({ user_id: sp.user_id }).first('name');
    expect(row.name).toBe('agent');
  });
});

describe('listServicePrincipals roles and last used (F029)', () => {
  it('returns role id+name and max(last_used_at), null when never used', async () => {
    const a = await addRole(tenant, 'Alpha', true);
    const b = await addRole(tenant, 'Beta', true);
    const used = await createServicePrincipal(db, tenant, { kind: 'api', name: 'used', roleIds: [b, a] });
    const unused = await createServicePrincipal(db, tenant, { kind: 'api', name: 'unused' });

    const early = new Date('2026-01-01T00:00:00Z');
    const late = new Date('2026-03-05T12:00:00Z');
    const mid = new Date('2026-02-01T00:00:00Z');
    let n = 0;
    for (const [last, active] of [[early, true], [late, false], [mid, true], [null, true]] as const) {
      n += 1;
      await tenantDb(db, tenant).table('api_keys').insert({
        api_key: `hash-${uuidv4()}-${n}`, user_id: used.user_id, tenant, description: 'k', purpose: 'service',
        active, last_used_at: last,
      });
    }
    await tenantDb(db, tenant).table('api_keys').insert({
      api_key: `hash-${uuidv4()}`, user_id: unused.user_id, tenant, description: 'k', purpose: 'service', active: true,
    });

    const items = await listServicePrincipals(db, tenant);
    const u = items.find((i) => i.user_id === used.user_id)!;
    const nu = items.find((i) => i.user_id === unused.user_id)!;
    expect(u.roles).toEqual([
      { role_id: a, role_name: 'Alpha' },
      { role_id: b, role_name: 'Beta' },
    ]);
    expect(new Date(u.last_used_at as string).toISOString()).toBe(late.toISOString());
    expect(u.active_key_count).toBe(3);
    expect(nu.roles).toEqual([]);
    expect(nu.last_used_at).toBeNull();
  });
});

describe('mintAgentSessionKey refuses inactive principals (F034)', () => {
  const keyCount = async (userId: string) =>
    (await tenantDb(db, tenant).table('api_keys').where({ user_id: userId, purpose: 'mcp_agent' })).length;

  it('mints for an active agent', async () => {
    const sp = await createServicePrincipal(db, tenant, { kind: 'mcp_agent', name: 'ok' });
    const agentId = await addAgent(sp.user_id);
    const token = await mintAgentSessionKey({ tenant, agentId, backingUserId: sp.user_id });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await keyCount(sp.user_id)).toBe(1);
  });

  it('throws a 403 AGENT_INACTIVE error and inserts nothing when the user is inactive', async () => {
    const sp = await createServicePrincipal(db, tenant, { kind: 'mcp_agent', name: 'u' });
    const agentId = await addAgent(sp.user_id);
    await tenantDb(db, tenant).table('users').where({ user_id: sp.user_id }).update({ is_inactive: true });
    await expect(mintAgentSessionKey({ tenant, agentId, backingUserId: sp.user_id })).rejects.toMatchObject({
      name: 'AgentInactiveError', code: 'AGENT_INACTIVE', statusCode: 403,
    });
    expect(await keyCount(sp.user_id)).toBe(0);
  });

  it('throws and inserts nothing when only the agent row is inactive, or the agent is missing', async () => {
    const sp = await createServicePrincipal(db, tenant, { kind: 'mcp_agent', name: 'a' });
    const agentId = await addAgent(sp.user_id);
    await tenantDb(db, tenant).table('agents').where({ agent_id: agentId }).update({ active: false });
    await expect(mintAgentSessionKey({ tenant, agentId, backingUserId: sp.user_id })).rejects.toMatchObject({ code: 'AGENT_INACTIVE' });
    await expect(mintAgentSessionKey({ tenant, agentId: uuidv4(), backingUserId: sp.user_id })).rejects.toMatchObject({ code: 'AGENT_INACTIVE' });
    expect(await keyCount(sp.user_id)).toBe(0);
  });

  it('refuses after setServicePrincipalActive(false) deactivates the principal', async () => {
    const sp = await createServicePrincipal(db, tenant, { kind: 'mcp_agent', name: 'd' });
    const agentId = await addAgent(sp.user_id);
    await setServicePrincipalActive(db, tenant, sp.user_id, false);
    await expect(mintAgentSessionKey({ tenant, agentId, backingUserId: sp.user_id })).rejects.toMatchObject({ statusCode: 403 });
    expect(await keyCount(sp.user_id)).toBe(0);
  });
});
