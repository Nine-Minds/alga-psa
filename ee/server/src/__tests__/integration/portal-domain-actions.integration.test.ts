import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '@main-test-utils/dbConfig';
import type { PortalDomainRecord } from 'server/src/models/PortalDomainModel';
import { computeCanonicalHost } from 'server/src/models/PortalDomainModel';

let db: Knex;
let tenantId: string | undefined;

const enqueueWorkflow = vi.fn(async () => ({ enqueued: true }));
const analyticsCapture = vi.fn();

vi.mock('@/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user-1' })),
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@ee/lib/portal-domains/workflowClient', () => ({
  enqueuePortalDomainWorkflow: vi.fn((args) => enqueueWorkflow(args)),
}));

vi.mock('@/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn((...args) => analyticsCapture(...args)),
  },
}));

vi.mock('@alga-psa/shared/core/secretProvider', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? 'test_password'),
  },
}));

vi.mock('@alga-psa/shared/core', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/shared/core/logger', () => ({
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

type PortalDomainActionsModule = typeof import('@/lib/actions/tenant-actions/portalDomainActions');
let requestPortalDomainRegistrationAction: PortalDomainActionsModule['requestPortalDomainRegistrationAction'];

describe('Portal domain actions – DB integration', () => {
  const HOOK_TIMEOUT = 120_000;

  beforeAll(async () => {
    ({ requestPortalDomainRegistrationAction } =
      await import('@/lib/actions/tenant-actions/portalDomainActions'));
    db = await createTestDbConnection();
    await runMigrationsAndSeeds(db);
    tenantId = await ensureTenant(db);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    enqueueWorkflow.mockClear();
    analyticsCapture.mockClear();
    if (tenantId) {
      await db('portal_domains').where({ tenant: tenantId }).delete();
    }
  }, HOOK_TIMEOUT);

  it('persists a new portal domain and enqueues initial workflow', async () => {
    const result = await requestPortalDomainRegistrationAction({ domain: 'first.example.com' });

    expect(result.status.domain).toBe('first.example.com');
    expect(result.status.status).toBe('pending_dns');

    const record = await db<PortalDomainRecord>('portal_domains')
      .where({ tenant: tenantId })
      .first();

    expect(record).toBeTruthy();
    expect(record?.domain).toBe('first.example.com');
    expect(record?.status).toBe('pending_dns');
    expect(record?.certificate_secret_name).toBeNull();
    expect(record?.verification_details).toMatchObject({
      expected_cname: record?.canonical_host,
      requested_domain: 'first.example.com',
    });

    expect(enqueueWorkflow).toHaveBeenCalledWith({
      tenantId: tenantId!,
      portalDomainId: record?.id,
      trigger: 'register',
    });
  });

  it('updates an existing portal domain when the domain changes', async () => {
    const existingId = uuidv4();
    const canonicalHost = computeCanonicalHost(tenantId);

    await db<PortalDomainRecord>('portal_domains').insert({
      id: existingId,
      tenant: tenantId,
      domain: 'old.example.com',
      canonical_host: canonicalHost,
      status: 'active',
      status_message: 'Active',
      verification_method: 'cname',
      verification_details: { expected_cname: canonicalHost, requested_domain: 'old.example.com' },
      last_checked_at: new Date().toISOString(),
      certificate_secret_name: 'portal-domain-tenant1234',
      last_synced_resource_version: 'rv-123',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const result = await requestPortalDomainRegistrationAction({ domain: 'new.example.com' });

    expect(result.status.domain).toBe('new.example.com');
    expect(result.status.status).toBe('pending_dns');
    expect(result.status.statusMessage).toContain('Updating custom domain');

    const updated = await db<PortalDomainRecord>('portal_domains')
      .where({ tenant: tenantId })
      .first();

    expect(updated?.domain).toBe('new.example.com');
    expect(updated?.status).toBe('pending_dns');
    expect(updated?.certificate_secret_name).toBeNull();
    expect(updated?.last_synced_resource_version).toBeNull();

    expect(updated?.verification_details).toMatchObject({
      expected_cname: canonicalHost,
      requested_domain: 'new.example.com',
      previous_domain: 'old.example.com',
    });

    expect(enqueueWorkflow).toHaveBeenCalledWith({
      tenantId: tenantId!,
      portalDomainId: updated?.id,
      trigger: 'refresh',
    });
  });
});

async function runMigrationsAndSeeds(connection: Knex): Promise<void> {
  const dbUserServer = process.env.DB_USER_SERVER || 'app_user';
  const dbPasswordServer = process.env.DB_PASSWORD_SERVER || 'test_password';
  const dbNameServer = process.env.DB_NAME_SERVER || 'sebastian_test';

  process.env.DB_USER_SERVER = dbUserServer;
  process.env.DB_PASSWORD_SERVER = dbPasswordServer;
  process.env.DB_NAME_SERVER = dbNameServer;
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';

  await connection.raw(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${dbUserServer}') THEN
        CREATE ROLE ${dbUserServer} LOGIN PASSWORD '${dbPasswordServer}';
      ELSE
        ALTER ROLE ${dbUserServer} WITH LOGIN PASSWORD '${dbPasswordServer}';
      END IF;
    END
  $$;`);

  await connection.raw('DROP SCHEMA IF EXISTS public CASCADE');
  await connection.raw('CREATE SCHEMA public');
  await connection.raw('GRANT ALL ON SCHEMA public TO public');
  await connection.raw(`GRANT ALL ON SCHEMA public TO ${process.env.DB_USER_ADMIN || 'postgres'}`);
  await connection.raw(`GRANT ALL ON SCHEMA public TO ${dbUserServer}`);

  await connection.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await connection.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  try {
    await connection.raw('CREATE EXTENSION IF NOT EXISTS "vector"');
  } catch (error) {
    console.warn('[portal-domain-actions.integration] pgvector extension unavailable:', error);
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
