import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '@main-test-utils/dbConfig';
import { ExtensionUpdateBlockedError } from '@/lib/actions/extRegistryV2Errors';

const require = createRequire(import.meta.url);

let db: Knex;
let tenantId: string;

const runner = {
  scheduleRecurringJob: vi.fn(async () => ({ jobId: uuidv4(), externalId: `ext-${uuidv4()}` })),
  cancelJob: vi.fn(async () => true),
};

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user-1', user_type: 'internal' })),
}));
vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user-1', user_type: 'internal' })),
}));

vi.mock('@alga-psa/auth', () => ({
  hasPermission: vi.fn(async () => true),
}));
vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
}));

vi.mock('server/src/lib/jobs/initializeJobRunner', () => ({
  getJobRunnerInstance: vi.fn(() => runner),
  initializeJobRunner: vi.fn(async () => runner),
}));

describe('Extension v2 update schedule remap – DB integration', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.APP_ENV = process.env.APP_ENV || 'test';

    db = await createTestDbConnection();
    await applyEeMigrationsForExtensionSchedules(db);
    tenantId = uuidv4();
    await ensureTenantRow(db, tenantId);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    runner.cancelJob.mockClear();
    runner.scheduleRecurringJob.mockClear();

    await db('tenant_extension_schedule').delete().catch(() => undefined);
    await db('extension_api_endpoint').delete().catch(() => undefined);
    await db('tenant_extension_install').delete().catch(() => undefined);
    await db('extension_version').delete().catch(() => undefined);
    await db('extension_registry').delete().catch(() => undefined);
  });

  it('remaps schedules when endpoints exist and recreates missing runner schedule handle', async () => {
    const registryId = uuidv4();
    const v1 = uuidv4();
    const v2 = uuidv4();
    const installId = uuidv4();
    const scheduleId = uuidv4();
    const endpointV1 = uuidv4();
    const endpointV2 = uuidv4();

    await seedRegistry(db, { registryId });

    await db('extension_version').insert([
      {
        id: v1,
        registry_id: registryId,
        version: '1.0.0',
        runtime: 'node',
        main_entry: 'index.js',
        api: JSON.stringify({}),
        ui: null,
        capabilities: JSON.stringify([]),
        api_endpoints: JSON.stringify([{ method: 'POST', path: '/scheduled', handler: 'h1' }]),
        created_at: db.fn.now(),
      },
      {
        id: v2,
        registry_id: registryId,
        version: '2.0.0',
        runtime: 'node',
        main_entry: 'index.js',
        api: JSON.stringify({}),
        ui: null,
        capabilities: JSON.stringify([]),
        api_endpoints: JSON.stringify([{ method: 'POST', path: '/scheduled', handler: 'h2' }]),
        created_at: db.fn.now(),
      },
    ]);

    await seedInstall(db, tenantId, { registryId, installId, versionId: v1 });

    await db('extension_api_endpoint').insert([
      {
        id: endpointV1,
        version_id: v1,
        method: 'POST',
        path: '/scheduled',
        handler: 'h1',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
      {
        id: endpointV2,
        version_id: v2,
        method: 'POST',
        path: '/scheduled',
        handler: 'h2',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
    ]);

    await db('tenant_extension_schedule').insert({
      id: scheduleId,
      tenant_id: tenantId,
      install_id: installId,
      endpoint_id: endpointV1,
      enabled: true,
      cron: '0 1 * * *',
      timezone: 'UTC',
      payload_json: { hello: 'world' },
      // No durable runner schedule yet (simulate legacy state).
      job_id: null,
      runner_schedule_id: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const { updateExtensionForCurrentTenantV2 } = await import('@/lib/actions/extRegistryV2Actions');

    const result = await updateExtensionForCurrentTenantV2({ registryId, version: '2.0.0' });
    expect(result.success).toBe(true);

    const schedule = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(schedule?.endpoint_id).toBe(endpointV2);
    expect(schedule?.job_id).toBeTruthy();
    expect(schedule?.runner_schedule_id).toBeTruthy();

    const install = await db('tenant_extension_install').where({ id: installId, tenant_id: tenantId }).first();
    expect(install?.version_id).toBe(v2);
    expect(runner.scheduleRecurringJob).toHaveBeenCalledTimes(1);
  });

  it('blocks update when any scheduled endpoint missing in target version', async () => {
    const registryId = uuidv4();
    const v1 = uuidv4();
    const v2 = uuidv4();
    const installId = uuidv4();
    const scheduleId = uuidv4();
    const endpointV1 = uuidv4();

    await seedRegistry(db, { registryId });

    await db('extension_version').insert([
      {
        id: v1,
        registry_id: registryId,
        version: '1.0.0',
        runtime: 'node',
        main_entry: 'index.js',
        api: JSON.stringify({}),
        ui: null,
        capabilities: JSON.stringify([]),
        api_endpoints: JSON.stringify([{ method: 'POST', path: '/scheduled', handler: 'h1' }]),
        created_at: db.fn.now(),
      },
      {
        id: v2,
        registry_id: registryId,
        version: '2.0.0',
        runtime: 'node',
        main_entry: 'index.js',
        api: JSON.stringify({}),
        ui: null,
        capabilities: JSON.stringify([]),
        // Target has no endpoints; remap should block.
        api_endpoints: JSON.stringify([]),
        created_at: db.fn.now(),
      },
    ]);

    await seedInstall(db, tenantId, { registryId, installId, versionId: v1 });

    await db('extension_api_endpoint').insert({
      id: endpointV1,
      version_id: v1,
      method: 'POST',
      path: '/scheduled',
      handler: 'h1',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('tenant_extension_schedule').insert({
      id: scheduleId,
      tenant_id: tenantId,
      install_id: installId,
      endpoint_id: endpointV1,
      enabled: true,
      cron: '0 1 * * *',
      timezone: 'UTC',
      payload_json: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const { updateExtensionForCurrentTenantV2 } = await import('@/lib/actions/extRegistryV2Actions');

    await expect(updateExtensionForCurrentTenantV2({ registryId, version: '2.0.0' })).rejects.toBeInstanceOf(
      ExtensionUpdateBlockedError
    );

    try {
      await updateExtensionForCurrentTenantV2({ registryId, version: '2.0.0' });
    } catch (e: any) {
      expect(e).toBeInstanceOf(ExtensionUpdateBlockedError);
      expect(e.code).toBe('SCHEDULE_REMAP_FAILED');
      expect(e.missing).toEqual([{ scheduleId, method: 'POST', path: '/scheduled' }]);
    }

    // Transactional: install version should remain unchanged after a blocked update.
    const install = await db('tenant_extension_install').where({ id: installId, tenant_id: tenantId }).first();
    expect(install?.version_id).toBe(v1);
  });

  it('override disables only missing schedules and proceeds with update', async () => {
    const registryId = uuidv4();
    const v1 = uuidv4();
    const v2 = uuidv4();
    const installId = uuidv4();
    const scheduleMissingId = uuidv4();
    const scheduleOkId = uuidv4();
    const endpointMissingV1 = uuidv4();
    const endpointOkV1 = uuidv4();
    const endpointOkV2 = uuidv4();

    await seedRegistry(db, { registryId });

    await db('extension_version').insert([
      {
        id: v1,
        registry_id: registryId,
        version: '1.0.0',
        runtime: 'node',
        main_entry: 'index.js',
        api: JSON.stringify({}),
        ui: null,
        capabilities: JSON.stringify([]),
        api_endpoints: JSON.stringify([
          { method: 'POST', path: '/scheduled', handler: 'h1' },
          { method: 'GET', path: '/ok', handler: 'h2' },
        ]),
        created_at: db.fn.now(),
      },
      {
        id: v2,
        registry_id: registryId,
        version: '2.0.0',
        runtime: 'node',
        main_entry: 'index.js',
        api: JSON.stringify({}),
        ui: null,
        capabilities: JSON.stringify([]),
        // Target only keeps /ok.
        api_endpoints: JSON.stringify([{ method: 'GET', path: '/ok', handler: 'h2' }]),
        created_at: db.fn.now(),
      },
    ]);

    await seedInstall(db, tenantId, { registryId, installId, versionId: v1 });

    await db('extension_api_endpoint').insert({
      id: endpointMissingV1,
      version_id: v1,
      method: 'POST',
      path: '/scheduled',
      handler: 'h1',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('extension_api_endpoint').insert({
      id: endpointOkV1,
      version_id: v1,
      method: 'GET',
      path: '/ok',
      handler: 'h2',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('extension_api_endpoint').insert({
      id: endpointOkV2,
      version_id: v2,
      method: 'GET',
      path: '/ok',
      handler: 'h2',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('tenant_extension_schedule').insert({
      id: scheduleMissingId,
      tenant_id: tenantId,
      install_id: installId,
      endpoint_id: endpointMissingV1,
      enabled: true,
      cron: '0 1 * * *',
      timezone: 'UTC',
      payload_json: null,
      job_id: uuidv4(),
      runner_schedule_id: `ext-${uuidv4()}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('tenant_extension_schedule').insert({
      id: scheduleOkId,
      tenant_id: tenantId,
      install_id: installId,
      endpoint_id: endpointOkV1,
      enabled: true,
      cron: '0 2 * * *',
      timezone: 'UTC',
      payload_json: null,
      // Missing durable runner schedule handle; update should recreate it.
      job_id: null,
      runner_schedule_id: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const { updateExtensionForCurrentTenantV2 } = await import('@/lib/actions/extRegistryV2Actions');

    const result = await updateExtensionForCurrentTenantV2({ registryId, version: '2.0.0', disableMissingSchedules: true });
    expect(result.success).toBe(true);

    expect(runner.cancelJob).toHaveBeenCalledTimes(1);

    const missing = await db('tenant_extension_schedule').where({ id: scheduleMissingId, tenant_id: tenantId }).first();
    expect(missing?.enabled).toBe(false);
    expect(missing?.job_id).toBeNull();
    expect(missing?.runner_schedule_id).toBeNull();
    expect(String(missing?.last_error)).toMatch(/missing endpoint/i);

    const ok = await db('tenant_extension_schedule').where({ id: scheduleOkId, tenant_id: tenantId }).first();
    expect(ok?.enabled).toBe(true);
    expect(ok?.endpoint_id).toBe(endpointOkV2);
    expect(ok?.job_id).toBeTruthy();
    expect(ok?.runner_schedule_id).toBeTruthy();

    const install = await db('tenant_extension_install').where({ id: installId, tenant_id: tenantId }).first();
    expect(install?.version_id).toBe(v2);
  });
});

async function seedRegistry(db: Knex, params: { registryId: string }): Promise<void> {
  await db('extension_registry').insert({
    id: params.registryId,
    publisher: 'vitest',
    name: `ext-${params.registryId.slice(0, 8)}`,
    display_name: 'Vitest Remap',
    description: 'Vitest remap test extension',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function seedInstall(
  db: Knex,
  tenantId: string,
  params: { registryId: string; installId: string; versionId: string }
): Promise<void> {
  await db('tenant_extension_install').insert({
    id: params.installId,
    tenant_id: tenantId,
    registry_id: params.registryId,
    version_id: params.versionId,
    granted_caps: JSON.stringify([]),
    config: JSON.stringify({}),
    is_enabled: true,
    status: 'enabled',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function ensureTenantRow(db: Knex, id: string): Promise<void> {
  const existing = await db('tenants').where({ tenant: id }).first();
  if (existing) return;
  await db('tenants').insert({
    tenant: id,
    client_name: `Test Co ${id.slice(0, 6)}`,
    email: `test-${id.slice(0, 6)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function applyEeMigrationsForExtensionSchedules(connection: Knex): Promise<void> {
  const eeMigrations = [
    '2025080801_create_extension_registry.cjs',
    '2025080802_create_extension_version.cjs',
    '2025080803_create_extension_bundle.cjs',
    '2025080804_create_tenant_extension_install.cjs',
    '20250810140000_align_registry_v2_schema.cjs',
    '20251031130000_create_install_config_tables.cjs',
    '20260101120000_create_extension_schedule_tables.cjs',
  ];

  const repoRoot = path.resolve(process.cwd(), '..', '..');
  for (const name of eeMigrations) {
    const full = path.resolve(repoRoot, 'ee', 'server', 'migrations', name);
    const mod = require(full);
    await mod.up(connection);
  }
}
