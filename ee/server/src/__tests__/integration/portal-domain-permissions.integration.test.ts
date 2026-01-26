import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '@main-test-utils/dbConfig';
import { computeCanonicalHost } from 'server/src/models/PortalDomainModel';
import type { PortalDomainRecord } from 'server/src/models/PortalDomainModel';

let db: Knex;
let tenantId: string;

const enqueueWorkflow = vi.fn(async () => ({ enqueued: true }));
const analyticsCapture = vi.fn();

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('@ee/lib/portal-domains/workflowClient', () => ({
  enqueuePortalDomainWorkflow: vi.fn((args) => enqueueWorkflow(args)),
}));

vi.mock('@/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn((...args) => analyticsCapture(...args)),
  },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? 'test_password'),
  },
}));

vi.mock('@alga-psa/core', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
}));

vi.mock('@alga-psa/auth', async () => {
  const modulePath = path.resolve(process.cwd(), '..', '..', 'server', 'src', 'lib', 'auth', 'rbac.ts');
  const actual = await import(pathToFileURL(modulePath).href);
  return actual;
});

vi.mock('@alga-psa/db/admin', async () => {
  const modulePath = path.resolve(process.cwd(), '..', '..', 'shared', 'db', 'admin.ts');
  const actual = await import(pathToFileURL(modulePath).href);
  return actual;
});

vi.mock('@alga-psa/core', async () => {
  const modulePath = path.resolve(process.cwd(), '..', '..', 'shared', 'core', 'index.ts');
  const actual = await import(pathToFileURL(modulePath).href);
  return actual;
});

vi.mock('@alga-psa/core/logger', async () => {
  const modulePath = path.resolve(process.cwd(), '..', '..', 'shared', 'core', 'logger.ts');
  const actual = await import(pathToFileURL(modulePath).href);
  return actual;
});

vi.mock('@shared/utils/encryption', async () => {
  const modulePath = path.resolve(process.cwd(), '..', '..', 'shared', 'utils', 'encryption.ts');
  const actual = await import(pathToFileURL(modulePath).href);
  return actual;
});

const { getCurrentUser } = await import('@alga-psa/users/actions');
const { requestPortalDomainRegistrationAction } = await import('@/lib/actions/tenant-actions/portalDomainActions');
const { runWithTenant } = await import('server/src/lib/db');

describe('Portal domain permissions', () => {
  const HOOK_TIMEOUT = 180_000;
  let mspAdmin: { user_id: string; tenant: string; user_type: string | null } | null = null;
  let clientPortalAdmin: { user_id: string; tenant: string; user_type: string | null } | null = null;

  beforeAll(async () => {
    db = await createTestDbConnection();
    await runMigrationsAndSeeds(db);
    tenantId = await ensureTenant(db);

    mspAdmin = await findMspUserByRole(db, 'Admin');

    if (!mspAdmin) {
      throw new Error('Unable to locate seeded MSP Admin user for tests');
    }

    clientPortalAdmin = await ensureClientPortalAdmin(db, tenantId);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await db('portal_domains').where({ tenant: tenantId }).delete();
    enqueueWorkflow.mockClear();
    analyticsCapture.mockClear();
    vi.mocked(getCurrentUser).mockReset();
  });

  it('allows MSP Admin users to register a custom portal domain', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      ...mspAdmin!,
      user_type: mspAdmin!.user_type || 'internal',
    });

    await ensureMspSettingsPermission(db, tenantId, mspAdmin!.user_id);

    const result = await runWithTenant(tenantId, async () =>
      requestPortalDomainRegistrationAction({ domain: 'admin-allowed.example.com' })
    );

    expect(result.status.domain).toBe('admin-allowed.example.com');
    expect(result.status.status).toBe('pending_dns');

    const record = await db<PortalDomainRecord>('portal_domains')
      .where({ tenant: tenantId })
      .first();

    expect(record).toBeTruthy();
    expect(record?.domain).toBe('admin-allowed.example.com');
    expect(enqueueWorkflow).toHaveBeenCalled();
  });

  it('rejects client portal users attempting to register a custom domain', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      ...clientPortalAdmin!,
      user_type: clientPortalAdmin!.user_type || 'client',
    });

    await expect(
      runWithTenant(tenantId, async () =>
        requestPortalDomainRegistrationAction({ domain: 'not-allowed.example.com' })
      )
    ).rejects.toThrow('Client portal users cannot manage custom domains.');

    const existing = await db<PortalDomainRecord>('portal_domains')
      .where({ tenant: tenantId })
      .first();

    expect(existing).toBeFalsy();
    expect(enqueueWorkflow).not.toHaveBeenCalled();
  });
});

async function runMigrationsAndSeeds(connection: Knex): Promise<void> {
  await connection.raw('DROP SCHEMA IF EXISTS public CASCADE');
  await connection.raw('CREATE SCHEMA public');
  await connection.raw('GRANT ALL ON SCHEMA public TO public');
  await connection.raw(`GRANT ALL ON SCHEMA public TO ${process.env.DB_USER_ADMIN || 'postgres'}`);

  await connection.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await connection.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  try {
    await connection.raw('CREATE EXTENSION IF NOT EXISTS "vector"');
  } catch (error) {
    console.warn('[portal-domain-permissions.integration] pgvector extension unavailable:', error);
  }

  const migrationsDir = path.resolve(process.cwd(), '..', '..', 'server', 'migrations');
  const seedsDir = path.resolve(process.cwd(), '..', '..', 'server', 'seeds', 'dev');

  await connection.migrate.rollback({ directory: migrationsDir, loadExtensions: ['.cjs', '.js'] }, true);
  await connection.migrate.latest({ directory: migrationsDir, loadExtensions: ['.cjs', '.js'] });
  await connection.seed.run({ directory: seedsDir, loadExtensions: ['.cjs', '.js'] });
}

async function ensureTenant(connection: Knex): Promise<string> {
  const row = await connection('tenants').first<{ tenant: string }>('tenant');
  if (row?.tenant) {
    return row.tenant;
  }

  const newTenantId = uuidv4();
  await connection('tenants').insert({
    tenant: newTenantId,
    client_name: 'Portal Domain Test Co',
    email: 'portal@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  return newTenantId;
}

async function findClientUserByRole(connection: Knex, roleName: string): Promise<{ user_id: string; tenant: string; user_type: string } | null> {
  const row = await connection('users as u')
    .select<{ user_id: string; tenant: string; user_type: string }>('u.user_id', 'u.tenant', 'u.user_type')
    .join('user_roles as ur', 'u.user_id', 'ur.user_id')
    .join('roles as r', 'ur.role_id', 'r.role_id')
    .where('r.role_name', roleName)
    .andWhere('r.client', true)
    .andWhere('u.tenant', tenantId)
    .first();

  return row ?? null;
}

async function findMspUserByRole(connection: Knex, roleName: string): Promise<{ user_id: string; tenant: string; user_type: string | null } | null> {
  const row = await connection('users as u')
    .select<{ user_id: string; tenant: string; user_type: string | null }>('u.user_id', 'u.tenant', 'u.user_type')
    .join('user_roles as ur', 'u.user_id', 'ur.user_id')
    .join('roles as r', 'ur.role_id', 'r.role_id')
    .where('r.role_name', roleName)
    .andWhere('r.msp', true)
    .andWhere('u.tenant', tenantId)
    .first();

  return row ?? null;
}

async function ensureClientPortalAdmin(
  connection: Knex,
  tenant: string
): Promise<{ user_id: string; tenant: string; user_type: string | null }> {
  const existing = await findClientUserByRole(connection, 'Admin');
  if (existing) {
    return existing;
  }

  const clientAdminRole = await connection('roles')
    .where({ tenant, role_name: 'Admin', client: true })
    .first('role_id');

  if (!clientAdminRole) {
    throw new Error('Unable to locate client portal Admin role for tests');
  }

  const email = `portal-admin-${uuidv4()}@example.com`;

  const [insertedUser] = await connection('users')
    .insert({
      tenant,
      username: email,
      hashed_password: 'test_password',
      first_name: 'Portal',
      last_name: 'Admin',
      email,
      auth_method: 'password',
      user_type: 'client',
      created_at: connection.fn.now(),
      updated_at: connection.fn.now(),
    })
    .returning<{ user_id: string; tenant: string; user_type: string | null }[]>(['user_id', 'tenant', 'user_type']);

  await connection('user_roles').insert({
    tenant,
    user_id: insertedUser.user_id,
    role_id: clientAdminRole.role_id,
    created_at: new Date(),
  });

  return insertedUser;
}

async function ensureMspSettingsPermission(
  connection: Knex,
  tenant: string,
  userId: string
): Promise<void> {
  const adminRole = await connection('user_roles as ur')
    .select('ur.role_id')
    .join('roles as r', 'r.role_id', 'ur.role_id')
    .where('ur.user_id', userId)
    .andWhere('r.msp', true)
    .andWhere('r.role_name', 'Admin')
    .first();

  if (!adminRole) {
    throw new Error('MSP Admin user does not have an Admin role');
  }

  const existingPermission = await connection('permissions')
    .select('permission_id')
    .where({ tenant, resource: 'settings', action: 'update', msp: true })
    .first();

  if (!existingPermission) {
    throw new Error('Expected MSP settings:update permission to be seeded for tenant');
  }

  const existingAssignment = await connection('role_permissions')
    .where({ tenant, role_id: adminRole.role_id, permission_id: existingPermission.permission_id })
    .first();

  if (!existingAssignment) {
    throw new Error('MSP Admin role missing settings:update permission assignment');
  }
}
