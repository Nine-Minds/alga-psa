/**
 * Service principals C/4, EE service against real Postgres (merged CE+EE migrations).
 *
 *  - T003 (F023/F031/F070/F072/F030): flat limit, independent of seats; nothing inserted at the limit.
 *  - T005 (F025/F026/F032/F034): deactivate deactivates keys; reactivation is limit-checked; old keys stay off.
 *  - T006 (F027/F029/F033/F072): archive when referenced, hard delete otherwise; archived does not count.
 *  - T012 (F028/F041): EE issuer writes an active purpose='service' key that validates.
 *  - T035 (F092/F093/F094): Essentials tenant: create refused, existing keys still validate, reactivate/issue refused.
 *
 * The tier gate is the only mocked collaborator (it reads the admin tier tables).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import crypto from 'node:crypto';
import { rmSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';
import { buildMergedEeMigrationsDir } from '../../../../../server/test-utils/eeMigrations';

const tier = vi.hoisted(() => ({ value: 'pro' as 'pro' | 'essentials' }));
const conn = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  getConnection: vi.fn(async () => conn.db),
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTenantTierAccess: vi.fn(async () => {
    if (tier.value !== 'pro') {
      throw Object.assign(new Error('requires Pro'), { code: 'TIER_ACCESS_DENIED', statusCode: 403 });
    }
  }),
}));
vi.mock('@alga-psa/licensing', () => ({
  getLicenseStateRow: vi.fn(async () => null),
  verifyLicense: vi.fn(() => ({ valid: false })),
}));

import {
  archiveOrDeleteServicePrincipal,
  createServicePrincipal,
  issueServicePrincipalKey,
  listServicePrincipals,
  setServicePrincipalActive,
} from '../../lib/service-principals/service';
import { getServicePrincipalUsage } from '../../lib/service-principals/usage';
import { servicePrincipalKeyGate } from '../../lib/service-principals/boundary';

let db: Knex;
let mergedDir: string;
let tenant: string;

async function newTenant(limit: number | null = null): Promise<string> {
  const id = uuidv4();
  await db('tenants').insert({
    tenant: id,
    client_name: `T003 ${id.slice(0, 8)}`,
    email: `t003-${id.slice(0, 8)}@example.com`,
    service_principal_limit: limit,
  });
  return id;
}

async function insertInternal(t: string): Promise<string> {
  const user_id = uuidv4();
  await tenantDb(db, t).table('users').insert({
    tenant: t,
    user_id,
    username: `h-${user_id.slice(0, 8)}`,
    email: `h-${user_id.slice(0, 8)}@example.com`,
    hashed_password: 'x',
    user_type: 'internal',
  });
  return user_id;
}

const hash = (k: string) => crypto.createHash('sha256').update(k).digest('hex');

beforeAll(async () => {
  mergedDir = buildMergedEeMigrationsDir();
  db = await createTestDbConnection({ databaseName: 'sp_c4_service_test', migrationsDir: mergedDir });
  conn.db = db;
}, 600_000);

afterAll(async () => {
  await db?.destroy();
  if (mergedDir) rmSync(mergedDir, { recursive: true, force: true });
});

beforeEach(async () => {
  tier.value = 'pro';
  tenant = await newTenant(2);
});

describe('limit (T003)', () => {
  it('is flat, independent of internal users, and inserts nothing past the limit', async () => {
    for (let i = 0; i < 5; i += 1) await insertInternal(tenant); // seats irrelevant
    await createServicePrincipal(db, tenant, { kind: 'api', name: 'one' });
    await createServicePrincipal(db, tenant, { kind: 'mcp_agent', name: 'two' });
    const before = await db('users').where({ tenant, user_type: 'service' }).count<{ count: string }[]>('* as count');

    await expect(createServicePrincipal(db, tenant, { kind: 'api', name: 'three' })).rejects.toMatchObject({
      code: 'SERVICE_PRINCIPAL_LIMIT_REACHED',
    });
    await expect(createServicePrincipal(db, tenant, { kind: 'mcp_agent', name: 'four' })).rejects.toMatchObject({
      code: 'SERVICE_PRINCIPAL_LIMIT_REACHED',
    });
    const after = await db('users').where({ tenant, user_type: 'service' }).count<{ count: string }[]>('* as count');
    expect(after[0].count).toBe(before[0].count);
    expect(await getServicePrincipalUsage(db, tenant)).toEqual({ limit: 2, used: 2, remaining: 0 });
    const internal = await db('users').where({ tenant, user_type: 'internal' }).count<{ count: string }[]>('* as count');
    expect(internal[0].count).toBe('5');
  });

  it('defaults to 10 when tenants.service_principal_limit is null', async () => {
    const t = await newTenant(null);
    expect((await getServicePrincipalUsage(db, t)).limit).toBe(10);
  });
});

describe('lifecycle (T005)', () => {
  it('deactivation switches the user and keys off; reactivation is limit-checked and keys stay off', async () => {
    const sp = await createServicePrincipal(db, tenant, { kind: 'api', name: 'lifecycle' });
    const key = await issueServicePrincipalKey(db, tenant, sp.user_id);
    expect(await servicePrincipalKeyGate({ tenant, user_id: sp.user_id, user_type: 'service', is_inactive: false } as never)).toBe(true);

    await setServicePrincipalActive(db, tenant, sp.user_id, false);
    const user = await tenantDb(db, tenant).table('users').where({ user_id: sp.user_id }).first('is_inactive');
    expect(user.is_inactive).toBe(true);
    const keyRow = await tenantDb(db, tenant).table('api_keys').where({ api_key_id: key.api_key_id }).first('active');
    expect(keyRow.active).toBe(false);
    expect(await servicePrincipalKeyGate({ tenant, user_id: sp.user_id, user_type: 'service', is_inactive: true } as never)).toBe(false);

    // fill the remaining slots, then reactivation must be refused
    await createServicePrincipal(db, tenant, { kind: 'api', name: 'fill-1' });
    await createServicePrincipal(db, tenant, { kind: 'api', name: 'fill-2' });
    await expect(setServicePrincipalActive(db, tenant, sp.user_id, true)).rejects.toMatchObject({
      code: 'SERVICE_PRINCIPAL_LIMIT_REACHED',
    });
  });

  it('reactivation succeeds with room and does not revive keys', async () => {
    const sp = await createServicePrincipal(db, tenant, { kind: 'api', name: 'revive' });
    const key = await issueServicePrincipalKey(db, tenant, sp.user_id);
    await setServicePrincipalActive(db, tenant, sp.user_id, false);
    await setServicePrincipalActive(db, tenant, sp.user_id, true);
    const keyRow = await tenantDb(db, tenant).table('api_keys').where({ api_key_id: key.api_key_id }).first('active');
    expect(keyRow.active).toBe(false);
  });
});

describe('delete vs archive (T006)', () => {
  it('archives a referenced agent principal, frees its slot, hides it and frees the IdP subject', async () => {
    const sp = await createServicePrincipal(db, tenant, { kind: 'mcp_agent', name: 'referenced-agent' });
    const [agent] = await tenantDb(db, tenant)
      .table('agents')
      .insert({
        tenant,
        name: 'referenced-agent',
        idp_issuer: 'https://idp.example',
        idp_subject: 'subject-1',
        active: true,
        service_user_id: sp.user_id,
      })
      .returning('agent_id');
    await tenantDb(db, tenant)
      .table('mcp_agent_audit')
      .insert({ tenant, agent_id: agent.agent_id, tool: 'call_api_endpoint', ok: true });
    const usedBefore = (await getServicePrincipalUsage(db, tenant)).used;

    expect(await archiveOrDeleteServicePrincipal(db, tenant, sp.user_id)).toBe('archived');

    expect((await getServicePrincipalUsage(db, tenant)).used).toBe(usedBefore - 1);
    expect((await listServicePrincipals(db, tenant)).map((p) => p.user_id)).not.toContain(sp.user_id);
    expect(await tenantDb(db, tenant).table('mcp_agent_audit').where({ agent_id: agent.agent_id }).first()).toBeTruthy();
    const archivedAgent = await tenantDb(db, tenant).table('agents').where({ agent_id: agent.agent_id }).first();
    expect(archivedAgent).toMatchObject({ idp_issuer: null, idp_subject: null, active: false });
    const user = await tenantDb(db, tenant).table('users').where({ user_id: sp.user_id }).first('is_inactive');
    expect(user.is_inactive).toBe(true);

    // the subject is rebindable to a brand new agent
    const next = await createServicePrincipal(db, tenant, { kind: 'mcp_agent', name: 'replacement' });
    await expect(
      tenantDb(db, tenant)
        .table('agents')
        .insert({
          tenant,
          name: 'replacement',
          idp_issuer: 'https://idp.example',
          idp_subject: 'subject-1',
          service_user_id: next.user_id,
        }),
    ).resolves.toBeDefined();
  });

  it('hard-deletes an unreferenced principal', async () => {
    const unused = await createServicePrincipal(db, tenant, { kind: 'api', name: 'unused' });
    await issueServicePrincipalKey(db, tenant, unused.user_id);
    expect(await archiveOrDeleteServicePrincipal(db, tenant, unused.user_id)).toBe('deleted');
    expect(await db('users').where({ tenant, user_id: unused.user_id }).first()).toBeUndefined();
    expect(await db('service_principals').where({ tenant, user_id: unused.user_id }).first()).toBeUndefined();
    expect(await db('api_keys').where({ tenant, user_id: unused.user_id }).first()).toBeUndefined();
  });
});

describe('key issuance (T012)', () => {
  it('writes an active purpose=service key whose hash validates', async () => {
    const sp = await createServicePrincipal(db, tenant, { kind: 'api', name: 'keys' });
    const key = await issueServicePrincipalKey(db, tenant, sp.user_id, { description: 'ci' });
    const row = await tenantDb(db, tenant).table('api_keys').where({ api_key_id: key.api_key_id }).first();
    expect(row).toMatchObject({ purpose: 'service', active: true, user_id: sp.user_id, api_key: hash(key.api_key) });
    expect(key.api_key).toHaveLength(64);
  });
});

describe('Essentials tenant (T035)', () => {
  it('refuses create, keeps existing keys working, refuses reactivate and issue', async () => {
    const sp = await createServicePrincipal(db, tenant, { kind: 'api', name: 'grandfathered' });
    const key = await issueServicePrincipalKey(db, tenant, sp.user_id);
    const other = await createServicePrincipal(db, tenant, { kind: 'api', name: 'to-deactivate' });
    await setServicePrincipalActive(db, tenant, other.user_id, false);

    tier.value = 'essentials';
    const before = (await listServicePrincipals(db, tenant)).length;
    await expect(createServicePrincipal(db, tenant, { kind: 'api', name: 'new' })).rejects.toMatchObject({
      code: 'TIER_ACCESS_DENIED',
    });
    await expect(createServicePrincipal(db, tenant, { kind: 'mcp_agent', name: 'new-agent' })).rejects.toMatchObject({
      code: 'TIER_ACCESS_DENIED',
    });
    expect((await listServicePrincipals(db, tenant)).length).toBe(before);

    // grandfathered: gate still passes and the stored key row is still active
    expect(await servicePrincipalKeyGate({ tenant, user_id: sp.user_id, user_type: 'service', is_inactive: false } as never)).toBe(true);
    const row = await tenantDb(db, tenant).table('api_keys').where({ api_key_id: key.api_key_id }).first('active');
    expect(row.active).toBe(true);

    await expect(setServicePrincipalActive(db, tenant, other.user_id, true)).rejects.toMatchObject({ code: 'TIER_ACCESS_DENIED' });
    await expect(issueServicePrincipalKey(db, tenant, sp.user_id)).rejects.toMatchObject({ code: 'TIER_ACCESS_DENIED' });
  });
});
