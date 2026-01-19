import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '@main-test-utils/dbConfig';

let db: Knex;
let tenantId: string;

const require = createRequire(import.meta.url);

const runner = {
  scheduleRecurringJob: vi.fn(async () => ({ jobId: uuidv4(), externalId: `ext-${uuidv4()}` })),
  cancelJob: vi.fn(async () => true),
  scheduleJob: vi.fn(async () => ({ jobId: uuidv4() })),
};

vi.mock('@alga-psa/users/actions', () => ({
  // Some EE code imports `getCurrentUser` via `server/src/...`.
  // This mock is kept for any EE-local imports that still use `@/lib/...`.
  getCurrentUser: vi.fn(async () => ({ id: 'user-1', user_type: 'internal' })),
}));

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
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

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => db),
}));

vi.mock('server/src/lib/jobs/initializeJobRunner', () => ({
  getJobRunnerInstance: vi.fn(() => runner),
  initializeJobRunner: vi.fn(async () => runner),
}));

type ExtensionActionsModule = typeof import('@/lib/actions/extensionActions');
type ExtensionSchedulesModule = typeof import('@ee/lib/actions/extensionScheduleActions');
type EndpointsModule = typeof import('@ee/lib/extensions/endpoints');

let getExtensionApiEndpoints: ExtensionActionsModule['getExtensionApiEndpoints'];
let createExtensionSchedule: ExtensionSchedulesModule['createExtensionSchedule'];
let listExtensionSchedules: ExtensionSchedulesModule['listExtensionSchedules'];
let updateExtensionSchedule: ExtensionSchedulesModule['updateExtensionSchedule'];
let deleteExtensionSchedule: ExtensionSchedulesModule['deleteExtensionSchedule'];
let runExtensionScheduleNow: ExtensionSchedulesModule['runExtensionScheduleNow'];
let listOrMaterializeEndpointsForVersion: EndpointsModule['listOrMaterializeEndpointsForVersion'];
let listEndpointsForVersion: EndpointsModule['listEndpointsForVersion'];

describe('Extension schedules (actions) – DB integration', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.APP_ENV = process.env.APP_ENV || 'test';

    db = await createTestDbConnection();
    await applyEeMigrationsForExtensionSchedules(db);
    tenantId = await ensureTenant(db);

    ({ getExtensionApiEndpoints } = await import('@/lib/actions/extensionActions'));
    ({
      createExtensionSchedule,
      listExtensionSchedules,
      updateExtensionSchedule,
      deleteExtensionSchedule,
      runExtensionScheduleNow,
    } = await import('@ee/lib/actions/extensionScheduleActions'));
    ({ listOrMaterializeEndpointsForVersion, listEndpointsForVersion } = await import('@ee/lib/extensions/endpoints'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    runner.scheduleRecurringJob.mockClear();
    runner.cancelJob.mockClear();
    runner.scheduleJob.mockClear();

    // Best-effort cleanup for isolation.
    await db('tenant_extension_schedule').delete().catch(() => undefined);
    await db('extension_api_endpoint').delete().catch(() => undefined);
    await db('tenant_extension_install').delete().catch(() => undefined);
    await db('extension_bundle').delete().catch(() => undefined);
    await db('extension_version').delete().catch(() => undefined);
    await db('extension_registry').delete().catch(() => undefined);
    await db('jobs').delete().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('DB: migrations create endpoint + schedule tables and indexes', async () => {
    expect(await db.schema.hasTable('extension_api_endpoint')).toBe(true);
    expect(await db.schema.hasTable('tenant_extension_schedule')).toBe(true);

    const idx = await db('pg_indexes')
      .where({ schemaname: 'public', tablename: 'tenant_extension_schedule' })
      .select(['indexname']);
    const names = new Set(idx.map((r: any) => r.indexname));
    expect(names.has('tenant_extension_schedule_tenant_install_idx')).toBe(true);
    expect(names.has('tenant_extension_schedule_tenant_endpoint_idx')).toBe(true);
  });

  it('DB: unique constraint enforced for (version_id, method, path)', async () => {
    const versionId = uuidv4();
    await db('extension_api_endpoint').insert({
      id: uuidv4(),
      version_id: versionId,
      method: 'POST',
      path: '/scheduled',
      handler: 'h',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await expect(
      db('extension_api_endpoint').insert({
        id: uuidv4(),
        version_id: versionId,
        method: 'POST',
        path: '/scheduled',
        handler: 'h2',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
    ).rejects.toThrow();
  });

  it('Citus constraints: new tables do not use ON DELETE CASCADE', async () => {
    const rows = await db.raw(
      `
      SELECT c.conname, c.confdeltype, rel.relname
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      WHERE c.contype = 'f'
        AND rel.relname IN ('tenant_extension_schedule', 'extension_api_endpoint')
        AND c.confdeltype = 'c'
      `
    );

    const found = rows?.rows ?? [];
    expect(found).toHaveLength(0);
  });

  it('Registry: listOrMaterializeEndpointsForVersion normalizes and dedupes endpoints (idempotent)', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [
        { method: 'post', path: 'scheduled', handler: 'h1' },
        { method: 'POST', path: '/scheduled', handler: 'h2' },
      ],
    });

    const first = await listOrMaterializeEndpointsForVersion(versionId);
    expect(first).toHaveLength(1);
    expect(first[0].method).toBe('POST');
    expect(first[0].path).toBe('/scheduled');
    expect(first[0].handler).toBe('h2');

    const second = await listOrMaterializeEndpointsForVersion(versionId);
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].handler).toBe('h2');

    // Still only one row in DB.
    const rows = await listEndpointsForVersion(versionId);
    expect(rows).toHaveLength(1);

    // Sanity: extension is installed (exercise the seed helper).
    const install = await db('tenant_extension_install').where({ tenant_id: tenantId, registry_id: registryId }).first();
    expect(install).toBeTruthy();
  });

  it('Endpoints: List endpoints excludes endpoints with invalid method/path (sanitized on ingest)', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [
        { method: 'POST', path: '/scheduled', handler: 'h1' },
        { method: '', path: '/no-method', handler: 'h2' },
        { method: 'POST', path: '', handler: 'h3' },
      ],
    });

    const materialized = await listOrMaterializeEndpointsForVersion(versionId);
    expect(materialized.map((e) => `${e.method} ${e.path}`)).toEqual(['POST /scheduled']);

    const endpoints = await getExtensionApiEndpoints(registryId);
    expect(endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(['POST /scheduled']);
  });

  it('API: endpoint list returns only endpoints for installed version and is tenant-scoped', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });

    const materialized = await listOrMaterializeEndpointsForVersion(versionId);
    expect(materialized).toHaveLength(1);

    const endpoints = await getExtensionApiEndpoints(registryId);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].id).toBe(materialized[0].id);
    expect(endpoints[0].method).toBe('POST');
    expect(endpoints[0].path).toBe('/scheduled');
    expect(endpoints[0].handler).toBe('h');

    // Cross-tenant install should not leak endpoints.
    const otherTenantId = uuidv4();
    await ensureTenantRow(db, otherTenantId);
    const originalTenant = tenantId;
    try {
      tenantId = otherTenantId;
      const otherTenantEndpoints = await getExtensionApiEndpoints(registryId);
      expect(otherTenantEndpoints).toEqual([]);
    } finally {
      tenantId = originalTenant;
    }
  });

  it('API: create schedule with valid endpoint_id succeeds and creates runner schedule', async () => {
    const { registryId, versionId, installId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const ep = await listOrMaterializeEndpointsForVersion(versionId);
    const endpointId = ep[0].id;

    const result = await createExtensionSchedule(registryId, {
      endpointId,
      cron: '0 1 * * *',
      timezone: 'UTC',
      payloadJson: { hello: 'world' },
    });

    expect(result.success).toBe(true);
    expect(runner.scheduleRecurringJob).toHaveBeenCalledTimes(1);
    expect(runner.scheduleRecurringJob.mock.calls[0][3]?.singletonKey).toBe(`extsched:${installId}:${result.scheduleId}`);

    const row = await db('tenant_extension_schedule').where({ tenant_id: tenantId }).first();
    expect(row).toBeTruthy();
    expect(row.endpoint_id).toBe(endpointId);
    expect(String(row.cron)).toBe('0 1 * * *');
    expect(String(row.timezone)).toBe('UTC');
    expect(row.payload_json).toEqual({ hello: 'world' });
    expect(row.job_id).toBeTruthy();
    expect(row.runner_schedule_id).toBeTruthy();
    expect(row.last_run_at).toBeNull();
    expect(row.last_error).toBeNull();
  });

  it('Jobs: create schedule is atomic when runner schedule creation fails (no DB row)', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    runner.scheduleRecurringJob.mockRejectedValueOnce(new Error('runner down'));

    const out = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'UTC' });
    expect(out.success).toBe(false);
    expect(String(out.message)).toMatch(/runner down/i);

    const rows = await db('tenant_extension_schedule').where({ tenant_id: tenantId });
    expect(rows).toHaveLength(0);
  });

  it('API: create schedule rejects endpoint_id not belonging to installed version', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const otherVersionId = uuidv4();
    await db('extension_version').insert({
      id: otherVersionId,
      registry_id: registryId,
      version: '9.9.9',
      runtime: 'node',
      main_entry: 'index.js',
      api: JSON.stringify({}),
      ui: null,
      capabilities: JSON.stringify([]),
      api_endpoints: JSON.stringify([{ method: 'POST', path: '/other', handler: 'h' }]),
      created_at: db.fn.now(),
    });
    const otherEndpoints = await listOrMaterializeEndpointsForVersion(otherVersionId);
    expect(otherEndpoints).toHaveLength(1);

    // Use endpoint from a different version.
    const result = await createExtensionSchedule(registryId, {
      endpointId: otherEndpoints[0].id,
      cron: '0 1 * * *',
      timezone: 'UTC',
    });

    expect(result.success).toBe(false);
    expect(result.fieldErrors?.endpointId).toBeTruthy();
  });

  it('Security: create schedule rejects endpoints with path parameters', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/clients/:id', handler: 'h' }],
    });
    const endpoints = await listOrMaterializeEndpointsForVersion(versionId);
    expect(endpoints).toHaveLength(1);

    const result = await createExtensionSchedule(registryId, {
      endpointId: endpoints[0].id,
      cron: '0 1 * * *',
      timezone: 'UTC',
    });

    expect(result.success).toBe(false);
    expect(String(result.fieldErrors?.endpointId || '')).toMatch(/path parameter/i);
  });

  it('API: create schedule rejects invalid cron / seconds field / empty', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    const bad1 = await createExtensionSchedule(registryId, { endpointId, cron: '', timezone: 'UTC' });
    expect(bad1.success).toBe(false);
    expect(bad1.fieldErrors?.cron).toBeTruthy();

    const bad2 = await createExtensionSchedule(registryId, { endpointId, cron: '0 0 1 * * *', timezone: 'UTC' });
    expect(bad2.success).toBe(false);
    expect(bad2.fieldErrors?.cron).toBeTruthy();
  });

  it('API: create schedule rejects invalid timezone and accepts UTC', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    const bad = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'Not/AZone' });
    expect(bad.success).toBe(false);
    expect(bad.fieldErrors?.timezone).toBeTruthy();

    const ok = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'UTC' });
    expect(ok.success).toBe(true);
  });

  it('API: create schedule enforces max schedules per install', async () => {
    const { registryId, versionId, installId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    const now = db.fn.now();
    const rows = Array.from({ length: 50 }, () => ({
      id: uuidv4(),
      tenant_id: tenantId,
      install_id: installId,
      endpoint_id: endpointId,
      cron: '0 2 * * *',
      timezone: 'UTC',
      enabled: false,
      created_at: now,
      updated_at: now,
    }));
    await db('tenant_extension_schedule').insert(rows);

    const result = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'UTC' });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Too many schedules/i);
  });

  it('API: create schedule enforces min frequency guardrails', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    const tooFast = await createExtensionSchedule(registryId, { endpointId, cron: '* * * * *', timezone: 'UTC' });
    expect(tooFast.success).toBe(false);
    expect(tooFast.fieldErrors?.cron).toBeTruthy();
  });

  it('API: create schedule rejects cron when both day-of-month and day-of-week are set', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    const bad = await createExtensionSchedule(registryId, {
      endpointId,
      cron: '0 1 1 * 1',
      timezone: 'UTC',
    });
    expect(bad.success).toBe(false);
    expect(bad.fieldErrors?.cron).toBeTruthy();
  });

  it('API: create schedule stores timezone exactly as provided', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    const tz = 'America/New_York';
    const result = await createExtensionSchedule(registryId, {
      endpointId,
      cron: '0 1 * * *',
      timezone: tz,
      payloadJson: { ok: true },
    });

    expect(result.success).toBe(true);
    const row = await db('tenant_extension_schedule').where({ id: result.scheduleId, tenant_id: tenantId }).first();
    expect(String(row?.timezone)).toBe(tz);
  });

  it('API: create schedule rejects payload_json that is not a JSON object/array', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    const bad = await createExtensionSchedule(registryId, {
      endpointId,
      cron: '0 1 * * *',
      timezone: 'UTC',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payloadJson: 'not-an-object' as any,
    });
    expect(bad.success).toBe(false);
    expect(bad.fieldErrors?.payloadJson).toBeTruthy();
  });

  it('API: create schedule rejects payload_json larger than max', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    const big = { data: 'a'.repeat(120_000) };
    const bad = await createExtensionSchedule(registryId, {
      endpointId,
      cron: '0 1 * * *',
      timezone: 'UTC',
      payloadJson: big,
    });
    expect(bad.success).toBe(false);
    expect(bad.fieldErrors?.payloadJson).toBeTruthy();
  });

  it('API: create schedule rejects name longer than max length and enforces uniqueness per install', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    const tooLong = await createExtensionSchedule(registryId, {
      endpointId,
      cron: '0 1 * * *',
      timezone: 'UTC',
      name: 'a'.repeat(129),
    });
    expect(tooLong.success).toBe(false);
    expect(tooLong.fieldErrors?.name).toBeTruthy();

    const first = await createExtensionSchedule(registryId, {
      endpointId,
      cron: '0 1 * * *',
      timezone: 'UTC',
      name: 'My Schedule',
    });
    expect(first.success).toBe(true);

    const second = await createExtensionSchedule(registryId, {
      endpointId,
      cron: '0 2 * * *',
      timezone: 'UTC',
      name: 'My Schedule',
    });
    expect(second.success).toBe(false);
    expect(second.fieldErrors?.name).toBeTruthy();
  });

  it('API: update schedule rejects invalid cron/timezone and can clear payload_json', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    const created = await createExtensionSchedule(registryId, {
      endpointId,
      cron: '0 1 * * *',
      timezone: 'UTC',
      payloadJson: { hello: 'world' },
      name: 'Unique Name',
    });
    expect(created.success).toBe(true);
    const scheduleId = String(created.scheduleId);

    const badCron = await updateExtensionSchedule(registryId, scheduleId, { cron: 'invalid' });
    expect(badCron.success).toBe(false);
    expect(badCron.fieldErrors?.cron).toBeTruthy();

    const badTz = await updateExtensionSchedule(registryId, scheduleId, { timezone: 'Not/AZone' });
    expect(badTz.success).toBe(false);
    expect(badTz.fieldErrors?.timezone).toBeTruthy();

    const cleared = await updateExtensionSchedule(registryId, scheduleId, { payloadJson: null });
    expect(cleared.success).toBe(true);

    const row = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(row?.payload_json).toBeNull();
  });

  it('API: update schedule to conflicting name fails', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    const a = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'UTC', name: 'A' });
    const b = await createExtensionSchedule(registryId, { endpointId, cron: '0 2 * * *', timezone: 'UTC', name: 'B' });
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);

    const out = await updateExtensionSchedule(registryId, String(b.scheduleId), { name: 'A' });
    expect(out.success).toBe(false);
    expect(out.fieldErrors?.name).toBeTruthy();
  });

  it('API: create schedule fails when extension is installed but disabled', async () => {
    const { registryId, versionId, installId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    await db('tenant_extension_install').where({ id: installId, tenant_id: tenantId }).update({ is_enabled: false });

    const out = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'UTC' });
    expect(out.success).toBe(false);
    expect(String(out.message)).toMatch(/disabled/i);
  });

  it('API: list schedules returns schedules for the extension install', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;
    const create = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'UTC' });
    expect(create.success).toBe(true);

    const list = await listExtensionSchedules(registryId);
    expect(list.length).toBe(1);
    expect(list[0].endpoint_id).toBe(endpointId);
    expect(list[0].endpoint_method).toBe('POST');
    expect(list[0].endpoint_path).toBe('/scheduled');
  });

  it('API: list/update/delete schedules are tenant-scoped and return not-found cross-tenant', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    const created = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'UTC' });
    expect(created.success).toBe(true);
    const scheduleId = String(created.scheduleId);

    const otherTenantId = uuidv4();
    await ensureTenantRow(db, otherTenantId);

    const originalTenant = tenantId;
    try {
      tenantId = otherTenantId;
      const schedules = await listExtensionSchedules(registryId);
      expect(schedules).toEqual([]);

      const upd = await updateExtensionSchedule(registryId, scheduleId, { cron: '0 2 * * *' });
      expect(upd.success).toBe(false);
      expect(String(upd.message)).toMatch(/not found/i);

      const del = await deleteExtensionSchedule(registryId, scheduleId);
      expect(del.success).toBe(false);
      expect(String(del.message)).toMatch(/not found/i);
    } finally {
      tenantId = originalTenant;
    }
  });

  it('API: update/delete schedule return not-found for unknown schedule id', async () => {
    const { registryId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });

    const missingId = uuidv4();
    const upd = await updateExtensionSchedule(registryId, missingId, { cron: '0 2 * * *' });
    expect(upd.success).toBe(false);
    expect(String(upd.message)).toMatch(/not found/i);

    const del = await deleteExtensionSchedule(registryId, missingId);
    expect(del.success).toBe(false);
    expect(String(del.message)).toMatch(/not found/i);
  });

  it('API: create schedule fails when extension is not installed', async () => {
    const out = await createExtensionSchedule(uuidv4(), {
      endpointId: uuidv4(),
      cron: '0 1 * * *',
      timezone: 'UTC',
    });
    expect(out.success).toBe(false);
    expect(String(out.message)).toMatch(/install not found/i);
  });

  it('API: update schedule cron/timezone persists changes and reschedules job', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;
    const created = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'UTC' });
    expect(created.success).toBe(true);
    const scheduleId = created.scheduleId!;

    runner.scheduleRecurringJob.mockClear();
    const upd = await updateExtensionSchedule(registryId, scheduleId, { cron: '0 3 * * *', timezone: 'America/Los_Angeles' });
    expect(upd.success).toBe(true);
    expect(runner.cancelJob).toHaveBeenCalledTimes(1);
    expect(runner.scheduleRecurringJob).toHaveBeenCalledTimes(1);

    const row = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(String(row.cron)).toBe('0 3 * * *');
    expect(String(row.timezone)).toBe('America/Los_Angeles');
  });

  it('Jobs: update schedule is atomic when reschedule operation fails (cron/timezone unchanged)', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;
    const created = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'UTC' });
    expect(created.success).toBe(true);
    const scheduleId = created.scheduleId!;

    const before = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first(['cron', 'timezone', 'job_id', 'runner_schedule_id', 'enabled']);
    expect(before?.job_id).toBeTruthy();
    expect(before?.enabled).toBe(true);

    runner.cancelJob.mockResolvedValueOnce(true);
    runner.scheduleRecurringJob.mockRejectedValueOnce(new Error('reschedule failed'));
    runner.scheduleRecurringJob.mockResolvedValueOnce({ jobId: uuidv4(), externalId: `ext-${uuidv4()}` }); // restore

    const out = await updateExtensionSchedule(registryId, scheduleId, { cron: '0 3 * * *', timezone: 'America/Los_Angeles' });
    expect(out.success).toBe(false);
    expect(String(out.message)).toMatch(/reschedule failed/i);

    const after = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first(['cron', 'timezone', 'enabled']);
    expect(String(after?.cron)).toBe(String(before?.cron));
    expect(String(after?.timezone)).toBe(String(before?.timezone));
    expect(Boolean(after?.enabled)).toBe(true);
  });

  it('Jobs: enable/disable toggles schedule execution without losing config', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;

    const created = await createExtensionSchedule(registryId, {
      endpointId,
      cron: '0 1 * * *',
      timezone: 'UTC',
      payloadJson: { hello: 'world' },
      name: 'Toggle Test',
    });
    expect(created.success).toBe(true);

    const before = await db('tenant_extension_schedule').where({ id: created.scheduleId, tenant_id: tenantId }).first();
    expect(before?.enabled).toBe(true);
    expect(before?.job_id).toBeTruthy();

    runner.cancelJob.mockClear();
    const disabled = await updateExtensionSchedule(registryId, String(created.scheduleId), { enabled: false });
    expect(disabled.success).toBe(true);
    expect(runner.cancelJob).toHaveBeenCalledTimes(1);

    const afterDisable = await db('tenant_extension_schedule').where({ id: created.scheduleId, tenant_id: tenantId }).first();
    expect(afterDisable?.enabled).toBe(false);
    expect(afterDisable?.job_id).toBeNull();
    expect(afterDisable?.runner_schedule_id).toBeNull();
    expect(String(afterDisable?.cron)).toBe('0 1 * * *');
    expect(String(afterDisable?.timezone)).toBe('UTC');
    expect(afterDisable?.payload_json).toEqual({ hello: 'world' });
    expect(String(afterDisable?.name)).toBe('Toggle Test');

    runner.scheduleRecurringJob.mockClear();
    const enabled = await updateExtensionSchedule(registryId, String(created.scheduleId), { enabled: true });
    expect(enabled.success).toBe(true);
    expect(runner.scheduleRecurringJob).toHaveBeenCalledTimes(1);

    const afterEnable = await db('tenant_extension_schedule').where({ id: created.scheduleId, tenant_id: tenantId }).first();
    expect(afterEnable?.enabled).toBe(true);
    expect(afterEnable?.job_id).toBeTruthy();
    expect(afterEnable?.runner_schedule_id).toBeTruthy();
    expect(String(afterEnable?.cron)).toBe('0 1 * * *');
    expect(String(afterEnable?.timezone)).toBe('UTC');
  });

  it('API: update schedule can change endpoint_id to another endpoint in same version', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [
        { method: 'POST', path: '/scheduled', handler: 'h1' },
        { method: 'GET', path: '/scheduled2', handler: 'h2' },
      ],
    });
    const eps = await listOrMaterializeEndpointsForVersion(versionId);
    const endpoint1 = eps.find((e: any) => e.path === '/scheduled')!.id;
    const endpoint2 = eps.find((e: any) => e.path === '/scheduled2')!.id;

    const created = await createExtensionSchedule(registryId, { endpointId: endpoint1, cron: '0 1 * * *', timezone: 'UTC' });
    expect(created.success).toBe(true);

    const upd = await updateExtensionSchedule(registryId, created.scheduleId!, { endpointId: endpoint2 });
    expect(upd.success).toBe(true);

    const row = await db('tenant_extension_schedule').where({ id: created.scheduleId!, tenant_id: tenantId }).first();
    expect(row.endpoint_id).toBe(endpoint2);
  });

  it('API: delete schedule removes DB row and cancels underlying runner schedule', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;
    const created = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'UTC' });
    expect(created.success).toBe(true);

    const del = await deleteExtensionSchedule(registryId, created.scheduleId!);
    expect(del.success).toBe(true);
    expect(runner.cancelJob).toHaveBeenCalledTimes(1);

    const row = await db('tenant_extension_schedule').where({ id: created.scheduleId!, tenant_id: tenantId }).first();
    expect(row).toBeFalsy();
  });

  it('Jobs: delete schedule fails and does not delete row when runner cancellation fails', async () => {
    const { registryId, versionId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;
    const created = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'UTC' });
    expect(created.success).toBe(true);

    runner.cancelJob.mockRejectedValueOnce(new Error('missing'));
    const del = await deleteExtensionSchedule(registryId, created.scheduleId!);
    expect(del.success).toBe(false);
    expect(String(del.message)).toMatch(/cancel/i);

    const row = await db('tenant_extension_schedule').where({ id: created.scheduleId!, tenant_id: tenantId }).first();
    expect(row).toBeTruthy();
  });

  it('API: run-now triggers an immediate invocation and rate limit is enforced', async () => {
    const { registryId, versionId, installId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;
    const created = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'UTC', enabled: false });
    expect(created.success).toBe(true);

    // createExtensionSchedule disables schedule when enabled=false; run-now should still work (policy: install enabled).
    const ok = await runExtensionScheduleNow(registryId, created.scheduleId!);
    expect(ok.success).toBe(true);
    expect(runner.scheduleJob).toHaveBeenCalledTimes(1);
    const scheduleJobOpts = runner.scheduleJob.mock.calls[0][2];
    expect(scheduleJobOpts?.singletonKey).toMatch(new RegExp(`^extsched-run:${installId}:${created.scheduleId}:\\d{12}$`));

    // Rate limit: 5 run-now jobs per minute.
    const userRow = await db('users').where({ tenant: tenantId }).first(['user_id']);
    expect(userRow?.user_id).toBeTruthy();
    await db('jobs').insert(
      Array.from({ length: 5 }, () => ({
        tenant: tenantId,
        job_id: uuidv4(),
        type: 'extension-scheduled-invocation',
        status: 'pending',
        user_id: userRow.user_id,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
        metadata: { kind: 'extension_schedule_run_now', scheduleId: created.scheduleId! },
      }))
    );

    const limited = await runExtensionScheduleNow(registryId, created.scheduleId!);
    expect(limited.success).toBe(false);
    expect(limited.message).toMatch(/rate limit/i);
  });

  it('API: run-now fails when extension install disabled (policy)', async () => {
    const { registryId, versionId, installId } = await seedInstalledExtension(db, tenantId, {
      apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
    });
    const endpointId = (await listOrMaterializeEndpointsForVersion(versionId))[0].id;
    const created = await createExtensionSchedule(registryId, { endpointId, cron: '0 1 * * *', timezone: 'UTC', enabled: false });
    expect(created.success).toBe(true);

    await db('tenant_extension_install').where({ id: installId, tenant_id: tenantId }).update({ is_enabled: false });

    runner.scheduleJob.mockClear();
    const out = await runExtensionScheduleNow(registryId, created.scheduleId!);
    expect(out.success).toBe(false);
    expect(String(out.message)).toMatch(/disabled/i);
    expect(runner.scheduleJob).toHaveBeenCalledTimes(0);
  });

  it('Security: schedule CRUD rejects user without extension permission', async () => {
    const { hasPermission: hasPermissionCore } = await import('server/src/lib/auth/rbac');
    const { hasPermission: hasPermissionEe } = await import('@alga-psa/auth');

    const core = hasPermissionCore as any;
    const ee = hasPermissionEe as any;

    core.mockResolvedValue(false);
    ee.mockResolvedValue(false);

    await expect(listExtensionSchedules(uuidv4())).rejects.toThrow(/insufficient permissions/i);
    await expect(createExtensionSchedule(uuidv4(), { endpointId: uuidv4(), cron: '0 1 * * *' })).rejects.toThrow(/insufficient permissions/i);
    await expect(updateExtensionSchedule(uuidv4(), uuidv4(), { cron: '0 2 * * *' })).rejects.toThrow(/insufficient permissions/i);
    await expect(deleteExtensionSchedule(uuidv4(), uuidv4())).rejects.toThrow(/insufficient permissions/i);
    await expect(runExtensionScheduleNow(uuidv4(), uuidv4())).rejects.toThrow(/insufficient permissions/i);

    core.mockResolvedValue(true);
    ee.mockResolvedValue(true);
  });
});

async function ensureTenant(db: Knex): Promise<string> {
  const row = await db('tenants').first<{ tenant: string }>('tenant');
  if (row?.tenant) return row.tenant;
  const id = uuidv4();
  await ensureTenantRow(db, id);
  return id;
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

async function seedInstalledExtension(
  db: Knex,
  tenantId: string,
  params: {
    apiEndpoints: Array<{ method: string; path: string; handler: string }>;
  }
): Promise<{ registryId: string; versionId: string; installId: string }> {
  const registryId = uuidv4();
  const versionId = uuidv4();
  const installId = uuidv4();

  await db('extension_registry').insert({
    id: registryId,
    publisher: 'vitest',
    name: `ext-${registryId.slice(0, 8)}`,
    display_name: 'Vitest Scheduled Tasks',
    description: 'Vitest test extension',
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
    api_endpoints: JSON.stringify(params.apiEndpoints),
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

  return { registryId, versionId, installId };
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
