import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '@main-test-utils/dbConfig';

const require = createRequire(import.meta.url);

let db: Knex;
let tenantId: string;

const runner = {
  cancelJob: vi.fn(async () => true),
  scheduleRecurringJob: vi.fn(async () => ({ jobId: uuidv4(), externalId: `ext-${uuidv4()}` })),
};

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user-1', user_type: 'internal' })),
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

describe('Extension schedules – uninstall/toggle cleanup', () => {
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

  it('Cleanup: uninstall cancels schedule jobs, deletes schedules, then deletes install', async () => {
    const { registryId, versionId, installId, scheduleId, jobId } = await seedInstallWithSchedule(db, tenantId);

    const { uninstallExtensionV2 } = await import('@/lib/actions/extRegistryV2Actions');
    const result = await uninstallExtensionV2(registryId);
    expect(result.success).toBe(true);

    expect(runner.cancelJob).toHaveBeenCalledWith(jobId, tenantId);

    const schedules = await db('tenant_extension_schedule').where({ tenant_id: tenantId, install_id: installId });
    expect(schedules).toHaveLength(0);

    const install = await db('tenant_extension_install').where({ tenant_id: tenantId, registry_id: registryId }).first();
    expect(install).toBeFalsy();

    // Registry/version remain (uninstall removes tenant install + schedule configuration).
    const version = await db('extension_version').where({ id: versionId }).first();
    expect(version).toBeTruthy();

    // Deleted schedule id should be gone.
    const deleted = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(deleted).toBeFalsy();
  });

  it('Cleanup: disabling an extension pauses schedules; enabling re-creates missing runner schedules', async () => {
    const { registryId, installId, scheduleId, jobId } = await seedInstallWithSchedule(db, tenantId);

    const { toggleExtensionV2 } = await import('@/lib/actions/extRegistryV2Actions');

    // Disable
    const disabled = await toggleExtensionV2(registryId);
    expect(disabled.success).toBe(true);
    expect(runner.cancelJob).toHaveBeenCalledWith(jobId, tenantId);

    const scheduleAfterDisable = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(scheduleAfterDisable?.enabled).toBe(true);
    expect(scheduleAfterDisable?.job_id).toBeNull();
    expect(scheduleAfterDisable?.runner_schedule_id).toBeNull();

    // Enable again -> should recreate runner schedule for enabled schedule (job_id was cleared).
    const enabled = await toggleExtensionV2(registryId);
    expect(enabled.success).toBe(true);
    expect(runner.scheduleRecurringJob).toHaveBeenCalledTimes(1);

    const scheduleAfterEnable = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(scheduleAfterEnable?.install_id).toBe(installId);
    expect(scheduleAfterEnable?.job_id).toBeTruthy();
    expect(scheduleAfterEnable?.runner_schedule_id).toBeTruthy();
  });
});

async function seedInstallWithSchedule(
  db: Knex,
  tenantId: string
): Promise<{
  registryId: string;
  versionId: string;
  installId: string;
  endpointId: string;
  scheduleId: string;
  jobId: string;
}> {
  const registryId = uuidv4();
  const versionId = uuidv4();
  const installId = uuidv4();
  const endpointId = uuidv4();
  const scheduleId = uuidv4();
  const jobId = uuidv4();

  await db('extension_registry').insert({
    id: registryId,
    publisher: 'vitest',
    name: `ext-${registryId.slice(0, 8)}`,
    display_name: 'Vitest Cleanup',
    description: 'Vitest cleanup test extension',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('extension_version').insert({
    id: versionId,
    registry_id: registryId,
    version: '1.0.0',
    runtime: 'node',
    main_entry: 'index.js',
    api: JSON.stringify({}),
    ui: null,
    capabilities: JSON.stringify([]),
    api_endpoints: JSON.stringify([{ method: 'POST', path: '/scheduled', handler: 'h' }]),
    created_at: db.fn.now(),
  });

  await db('tenant_extension_install').insert({
    id: installId,
    tenant_id: tenantId,
    registry_id: registryId,
    version_id: versionId,
    granted_caps: JSON.stringify([]),
    config: JSON.stringify({}),
    is_enabled: true,
    status: 'enabled',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('extension_api_endpoint').insert({
    id: endpointId,
    version_id: versionId,
    method: 'POST',
    path: '/scheduled',
    handler: 'h',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('tenant_extension_schedule').insert({
    id: scheduleId,
    tenant_id: tenantId,
    install_id: installId,
    endpoint_id: endpointId,
    enabled: true,
    cron: '0 1 * * *',
    timezone: 'UTC',
    payload_json: { hello: 'world' },
    job_id: jobId,
    runner_schedule_id: `ext-${uuidv4()}`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { registryId, versionId, installId, endpointId, scheduleId, jobId };
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
