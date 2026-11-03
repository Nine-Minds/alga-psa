/**
 * Client picker perf E: projects and assets lists carry `client_logo_url`, batched for the
 * distinct clients on the page, so the screens no longer fetch every client for logos.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

const context = vi.hoisted(() => ({
  tenant: '',
  userId: '',
  db: null as any,
  allowed: true,
  logoCalls: [] as string[][],
}));

vi.mock('@alga-psa/auth', () => {
  const authed = (fn: any) => (...args: any[]) =>
    fn({ user_id: context.userId, tenant: context.tenant, user_type: 'internal' }, { tenant: context.tenant }, ...args);
  return {
  withAuth: authed,
  withOptionalAuth: authed,
  withAuthCheck: (fn: any) => fn,
  hasPermission: vi.fn(async () => context.allowed),
  preCheckDeletion: vi.fn(),
  localizeActionError: async (error: any) => error,
  AuthenticationError: class AuthenticationError extends Error {},
  };
});
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => context.allowed),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));
vi.mock('@alga-psa/formatting/avatarUtils', () => {
  const logos = async (ids: string[]) => {
    context.logoCalls.push(ids);
    return new Map(ids.map((id) => [id, `/logo/${id}`]));
  };
  return {
    getClientLogoUrlsBatch: logos,
    getContactAvatarUrlsBatch: async () => new Map(),
    getClientLogoUrl: async (id: string) => `/logo/${id}`,
    getEntityImageUrl: async () => null,
  };
});

import { getProjects } from '@alga-psa/projects/actions/projectActions';
import { listAssets } from '@alga-psa/assets/actions/assetActions';

let db: Knex;
const databaseName = `client_picker_perf_e_lists_${randomUUID().replaceAll('-', '')}`;
const otherTenant = randomUUID();
const ids: Record<string, string> = {};

async function seedTenant(tenant: string) {
  await db('tenants').insert({ tenant, client_name: `T ${tenant}`, email: `${tenant}@example.test`, product_code: 'psa' });
}
async function seedClient(tenant: string, name: string) {
  const client_id = randomUUID();
  await db('clients').insert({ tenant, client_id, client_name: name, client_type: 'company', is_inactive: false });
  return client_id;
}
async function seedProject(tenant: string, clientId: string, name: string, statusId: string, n: number) {
  await db('projects').insert({
    tenant, project_id: randomUUID(), project_name: name, client_id: clientId, status: statusId,
    wbs_code: String(n), project_number: `P-${tenant.slice(0, 4)}-${n}`, is_inactive: false,
  });
}
async function seedAsset(tenant: string, clientId: string, name: string) {
  await db('assets').insert({
    tenant, asset_id: randomUUID(), asset_tag: `TAG-${randomUUID().slice(0, 8)}`, name,
    status: 'active', client_id: clientId, asset_type: 'workstation',
  });
}

beforeAll(async () => {
  db = await createTestDbConnection({ databaseName, runSeeds: false });
  context.db = db;
  context.tenant = randomUUID();
  context.userId = randomUUID();
  await seedTenant(context.tenant);
  await seedTenant(otherTenant);
  await db('users').insert({
    tenant: context.tenant, user_id: context.userId, username: context.userId,
    email: `${context.userId}@example.test`, first_name: 'Test', last_name: 'Admin',
    user_type: 'internal', hashed_password: 'unused',
  });

  ids.acme = await seedClient(context.tenant, 'Acme Widgets');
  ids.bravo = await seedClient(context.tenant, 'Bravo Logistics');
  ids.foreign = await seedClient(otherTenant, 'Foreign Co');

  const statusFor = async (tenant: string) => {
    const status_id = randomUUID();
    await db('statuses').insert({ tenant, status_id, name: 'Open', status_type: 'project', order_number: 1, is_closed: false });
    return status_id;
  };
  const status = await statusFor(context.tenant);
  const foreignStatus = await statusFor(otherTenant);
  await seedProject(context.tenant, ids.acme, 'Acme Rollout', status, 1);
  await seedProject(context.tenant, ids.acme, 'Acme Refresh', status, 2);
  await seedProject(context.tenant, ids.bravo, 'Bravo Migration', status, 3);
  await seedProject(otherTenant, ids.foreign, 'Foreign Project', foreignStatus, 1);

  await seedAsset(context.tenant, ids.acme, 'Acme PC 1');
  await seedAsset(context.tenant, ids.acme, 'Acme PC 2');
  await seedAsset(context.tenant, ids.bravo, 'Bravo PC');
  await seedAsset(otherTenant, ids.foreign, 'Foreign PC');
}, 180_000);

afterAll(async () => {
  await db?.destroy();
  const admin = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123'), database: 'postgres',
  }, pool: { min: 0, max: 1 } });
  try { await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]); }
  finally { await admin.destroy(); }
});

describe('client_logo_url on project and asset lists', () => {
  it('getProjects attaches logos from one batched lookup of distinct clients, tenant scoped', async () => {
    context.logoCalls.length = 0;
    const projects: any[] = await getProjects();
    expect(projects.map((p) => p.project_name).sort()).toEqual(['Acme Refresh', 'Acme Rollout', 'Bravo Migration']);
    for (const project of projects) {
      expect(project.client_logo_url).toBe(`/logo/${project.client_id}`);
      expect(project.client_name).toBeTruthy();
    }
    expect(context.logoCalls).toHaveLength(1);
    expect(context.logoCalls[0].sort()).toEqual([ids.acme, ids.bravo].sort());
    expect(context.logoCalls[0]).not.toContain(ids.foreign);
  });

  it('listAssets attaches logos on asset.client from one batched lookup, tenant scoped', async () => {
    context.logoCalls.length = 0;
    const result: any = await listAssets({ page: 1, limit: 25 } as any);
    expect(result.assets.map((a: any) => a.name).sort()).toEqual(['Acme PC 1', 'Acme PC 2', 'Bravo PC']);
    for (const asset of result.assets) {
      expect(asset.client.client_logo_url).toBe(`/logo/${asset.client_id}`);
    }
    expect(context.logoCalls).toHaveLength(1);
    expect(context.logoCalls[0].sort()).toEqual([ids.acme, ids.bravo].sort());
  });
});
