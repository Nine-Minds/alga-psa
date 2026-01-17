/**
 * Integration Tests for Extension Scheduler Host API
 *
 * Tests for the internal scheduler host API that extensions call via the runner.
 * These tests cover the schedulerHostApi.ts functions with database integration.
 *
 * Test IDs covered:
 * - T026-T045: Runner bindings and list/get/create tests
 * - T053-T054: Default values
 * - T058-T092: Quota, validation, update, delete, security, logging, metrics
 * - T099-T104, T109-T115: Sample extension, internal API security, misc
 */

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

// Mock database connection
vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => db),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => db),
}));

vi.mock('server/src/lib/jobs/initializeJobRunner', () => ({
  getJobRunnerInstance: vi.fn(() => runner),
  initializeJobRunner: vi.fn(async () => runner),
}));

// Import types after mocks
type SchedulerHostApiModule = typeof import('@ee/lib/extensions/schedulerHostApi');

let listSchedules: SchedulerHostApiModule['listSchedules'];
let getSchedule: SchedulerHostApiModule['getSchedule'];
let createSchedule: SchedulerHostApiModule['createSchedule'];
let updateSchedule: SchedulerHostApiModule['updateSchedule'];
let deleteSchedule: SchedulerHostApiModule['deleteSchedule'];
let getEndpoints: SchedulerHostApiModule['getEndpoints'];

describe('Scheduler Host API – DB integration', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.APP_ENV = process.env.APP_ENV || 'test';

    db = await createTestDbConnection();
    await applyEeMigrationsForExtensionSchedules(db);
    tenantId = await ensureTenant(db);

    // Import after mocks are set up
    ({
      listSchedules,
      getSchedule,
      createSchedule,
      updateSchedule,
      deleteSchedule,
      getEndpoints,
    } = await import('@ee/lib/extensions/schedulerHostApi'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    runner.scheduleRecurringJob.mockClear();
    runner.cancelJob.mockClear();
    runner.scheduleJob.mockClear();

    // Best-effort cleanup for isolation
    await db('tenant_extension_schedule').delete().catch(() => undefined);
    await db('extension_api_endpoint').delete().catch(() => undefined);
    await db('tenant_extension_install').delete().catch(() => undefined);
    await db('extension_bundle').delete().catch(() => undefined);
    await db('extension_version').delete().catch(() => undefined);
    await db('extension_registry').delete().catch(() => undefined);
    await db('jobs').delete().catch(() => undefined);
  }, HOOK_TIMEOUT);

  // ============================================================================
  // T028-T032: list() tests
  // ============================================================================

  describe('list() tests (T028-T032)', () => {
    it('T028: list() returns 200 for valid install context', async () => {
      const { installId, versionId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId: uuidv4() };
      const result = await listSchedules(ctx);
      expect(Array.isArray(result)).toBe(true);
    });

    it('T029: list() returns schedules array for install with schedules', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });
      expect(created.success).toBe(true);

      const result = await listSchedules(ctx);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(created.scheduleId);
    });

    it('T030: list() returns empty array for install without schedules', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await listSchedules(ctx);
      expect(result).toEqual([]);
    });

    it('T031-T032: list() only returns schedules for the requesting install', async () => {
      const { installId: install1, versionId: v1, registryId: r1 } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });
      const { installId: install2, versionId: v2, registryId: r2 } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/other', handler: 'h' }],
      });

      const ctx1 = { tenantId, installId: install1, versionId: v1, registryId: r1 };
      const ctx2 = { tenantId, installId: install2, versionId: v2, registryId: r2 };

      await createSchedule(ctx1, { endpoint: '/scheduled', cron: '0 1 * * *' });
      await createSchedule(ctx2, { endpoint: '/other', cron: '0 2 * * *' });

      const list1 = await listSchedules(ctx1);
      const list2 = await listSchedules(ctx2);

      expect(list1.length).toBe(1);
      expect(list1[0].endpointPath).toBe('/scheduled');

      expect(list2.length).toBe(1);
      expect(list2[0].endpointPath).toBe('/other');
    });

    it('T109: list() returns schedules sorted by created_at ascending', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };

      // Create schedules with slight delay to ensure different timestamps
      await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *', name: 'First' });
      await new Promise((r) => setTimeout(r, 10));
      await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 2 * * *', name: 'Second' });

      const result = await listSchedules(ctx);
      expect(result.length).toBe(2);
      expect(result[0].name).toBe('First');
      expect(result[1].name).toBe('Second');
    });

    it('T113: list() response format matches ScheduleInfo type', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *', name: 'Test' });

      const result = await listSchedules(ctx);
      expect(result.length).toBe(1);
      const schedule = result[0];

      // Verify required fields
      expect(typeof schedule.id).toBe('string');
      expect(typeof schedule.endpointPath).toBe('string');
      expect(typeof schedule.endpointMethod).toBe('string');
      expect(typeof schedule.cron).toBe('string');
      expect(typeof schedule.timezone).toBe('string');
      expect(typeof schedule.enabled).toBe('boolean');
    });
  });

  // ============================================================================
  // T033-T035: get() tests
  // ============================================================================

  describe('get() tests (T033-T035)', () => {
    it('T033: get() returns schedule for valid ID belonging to install', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const result = await getSchedule(ctx, created.scheduleId!);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.scheduleId);
    });

    it('T034: get() returns null for non-existent schedule ID', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await getSchedule(ctx, uuidv4());
      expect(result).toBeNull();
    });

    it('T035: get() returns null for schedule belonging to different install', async () => {
      const { installId: install1, versionId: v1, registryId: r1 } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });
      const { installId: install2, versionId: v2, registryId: r2 } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/other', handler: 'h' }],
      });

      const ctx1 = { tenantId, installId: install1, versionId: v1, registryId: r1 };
      const ctx2 = { tenantId, installId: install2, versionId: v2, registryId: r2 };

      const created = await createSchedule(ctx1, { endpoint: '/scheduled', cron: '0 1 * * *' });
      expect(created.success).toBe(true);

      // Different install should not see it
      const result = await getSchedule(ctx2, created.scheduleId!);
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // T036-T045: create() tests
  // ============================================================================

  describe('create() tests (T036-T045)', () => {
    it('T036: create() with valid input returns success=true', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });
      expect(result.success).toBe(true);
    });

    it('T037: create() returns scheduleId in response', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });
      expect(result.scheduleId).toBeDefined();
      expect(typeof result.scheduleId).toBe('string');
    });

    it('T038: create() persists schedule to database', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const row = await db('tenant_extension_schedule').where({ id: result.scheduleId }).first();
      expect(row).toBeDefined();
      expect(row.tenant_id).toBe(tenantId);
      expect(row.install_id).toBe(installId);
    });

    it('T039: create() resolves endpoint path to endpoint_id', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const row = await db('tenant_extension_schedule').where({ id: result.scheduleId }).first();
      expect(row.endpoint_id).toBeDefined();

      const endpoint = await db('extension_api_endpoint').where({ id: row.endpoint_id }).first();
      expect(endpoint.path).toBe('/scheduled');
    });

    it('T040: create() rejects non-existent endpoint path', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/nonexistent', cron: '0 1 * * *' });
      expect(result.success).toBe(false);
      expect(result.fieldErrors?.endpoint).toBeDefined();
    });

    it('T041: create() rejects endpoint path with path parameters', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/items/:id', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/items/:id', cron: '0 1 * * *' });
      expect(result.success).toBe(false);
      expect(result.fieldErrors?.endpoint).toBeDefined();
    });

    it('T042-T043: create() rejects DELETE and PUT method endpoints', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [
          { method: 'DELETE', path: '/delete-endpoint', handler: 'h' },
          { method: 'PUT', path: '/put-endpoint', handler: 'h' },
        ],
      });

      const ctx = { tenantId, installId, versionId, registryId };

      const del = await createSchedule(ctx, { endpoint: '/delete-endpoint', cron: '0 1 * * *' });
      expect(del.success).toBe(false);

      const put = await createSchedule(ctx, { endpoint: '/put-endpoint', cron: '0 1 * * *' });
      expect(put.success).toBe(false);
    });

    it('T044: create() accepts GET method endpoints', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'GET', path: '/status', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/status', cron: '0 1 * * *' });
      expect(result.success).toBe(true);
    });

    it('T045: create() accepts POST method endpoints', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/sync', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/sync', cron: '0 1 * * *' });
      expect(result.success).toBe(true);
    });

    it('T114: create() associates schedule with correct install_id', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const row = await db('tenant_extension_schedule').where({ id: result.scheduleId }).first();
      expect(row.install_id).toBe(installId);
    });
  });

  // ============================================================================
  // T053-T054: Default values tests
  // ============================================================================

  describe('Default values tests (T053-T054)', () => {
    it('T053: create() defaults timezone to UTC when not provided', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const row = await db('tenant_extension_schedule').where({ id: result.scheduleId }).first();
      expect(String(row.timezone)).toBe('UTC');
    });

    it('T054: create() defaults enabled to true when not provided', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const row = await db('tenant_extension_schedule').where({ id: result.scheduleId }).first();
      expect(row.enabled).toBe(true);
    });
  });

  // ============================================================================
  // T058-T066: Quota, validation, and error handling tests
  // ============================================================================

  describe('Quota and error handling tests (T058-T066)', () => {
    it('T058-T059: create() enforces max 50 schedules per install and returns error', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ep = await db('extension_api_endpoint').where({ version_id: versionId }).first();
      const now = db.fn.now();

      const rows = Array.from({ length: 50 }, () => ({
        id: uuidv4(),
        tenant_id: tenantId,
        install_id: installId,
        endpoint_id: ep.id,
        cron: '0 2 * * *',
        timezone: 'UTC',
        enabled: false,
        created_at: now,
        updated_at: now,
      }));
      await db('tenant_extension_schedule').insert(rows);

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Too many schedules/i);
    });

    it('T060: create() returns field-level error for invalid cron', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/scheduled', cron: 'invalid' });
      expect(result.success).toBe(false);
      expect(result.fieldErrors?.cron).toBeDefined();
    });

    it('T061: create() returns field-level error for invalid timezone', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *', timezone: 'Invalid/Zone' });
      expect(result.success).toBe(false);
      expect(result.fieldErrors?.timezone).toBeDefined();
    });

    it('T062: create() creates job runner schedule when enabled=true', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *', enabled: true });
      expect(runner.scheduleRecurringJob).toHaveBeenCalledTimes(1);
    });

    it('T063: create() does not create job runner schedule when enabled=false', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *', enabled: false });
      expect(runner.scheduleRecurringJob).not.toHaveBeenCalled();
    });

    it('T110: create() with enabled=false still persists schedule', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *', enabled: false });
      expect(result.success).toBe(true);

      const row = await db('tenant_extension_schedule').where({ id: result.scheduleId }).first();
      expect(row).toBeDefined();
      expect(row.enabled).toBe(false);
    });

    it('T064: create() handles duplicate name with descriptive error', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const first = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *', name: 'My Schedule' });
      expect(first.success).toBe(true);

      const second = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 2 * * *', name: 'My Schedule' });
      expect(second.success).toBe(false);
      expect(second.fieldErrors?.name).toBeDefined();
    });

    it('T065: create() rolls back if job runner schedule creation fails', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      runner.scheduleRecurringJob.mockRejectedValueOnce(new Error('runner down'));

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });
      expect(result.success).toBe(false);

      const rows = await db('tenant_extension_schedule').where({ install_id: installId });
      expect(rows).toHaveLength(0);
    });

    it('T090: Created schedules have trigger=host_api in metadata', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      expect(runner.scheduleRecurringJob).toHaveBeenCalledTimes(1);
      const metadata = runner.scheduleRecurringJob.mock.calls[0][3]?.metadata;
      expect(metadata?.trigger).toBe('host_api');
    });
  });

  // ============================================================================
  // T067-T078: update() tests
  // ============================================================================

  describe('update() tests (T067-T078)', () => {
    it('T067: update() with valid input returns success=true', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const result = await updateSchedule(ctx, created.scheduleId!, { cron: '0 2 * * *' });
      expect(result.success).toBe(true);
    });

    it('T068: update() persists changes to database', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      await updateSchedule(ctx, created.scheduleId!, { cron: '0 3 * * *' });

      const row = await db('tenant_extension_schedule').where({ id: created.scheduleId }).first();
      expect(String(row.cron)).toBe('0 3 * * *');
    });

    it('T069: update() validates new cron expression', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const result = await updateSchedule(ctx, created.scheduleId!, { cron: 'invalid' });
      expect(result.success).toBe(false);
      expect(result.fieldErrors?.cron).toBeDefined();
    });

    it('T070: update() validates new timezone', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const result = await updateSchedule(ctx, created.scheduleId!, { timezone: 'Invalid/Zone' });
      expect(result.success).toBe(false);
      expect(result.fieldErrors?.timezone).toBeDefined();
    });

    it('T071: update() reschedules job when cron changes', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      runner.scheduleRecurringJob.mockClear();
      runner.cancelJob.mockClear();

      await updateSchedule(ctx, created.scheduleId!, { cron: '0 3 * * *' });

      expect(runner.cancelJob).toHaveBeenCalledTimes(1);
      expect(runner.scheduleRecurringJob).toHaveBeenCalledTimes(1);
    });

    it('T072: update() reschedules job when timezone changes', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *', timezone: 'UTC' });

      runner.scheduleRecurringJob.mockClear();
      runner.cancelJob.mockClear();

      await updateSchedule(ctx, created.scheduleId!, { timezone: 'America/New_York' });

      expect(runner.cancelJob).toHaveBeenCalledTimes(1);
      expect(runner.scheduleRecurringJob).toHaveBeenCalledTimes(1);
    });

    it('T073: update() cancels job when enabled changes to false', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *', enabled: true });

      runner.cancelJob.mockClear();

      await updateSchedule(ctx, created.scheduleId!, { enabled: false });

      expect(runner.cancelJob).toHaveBeenCalledTimes(1);

      const row = await db('tenant_extension_schedule').where({ id: created.scheduleId }).first();
      expect(row.enabled).toBe(false);
      expect(row.job_id).toBeNull();
    });

    it('T074: update() creates job when enabled changes to true', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *', enabled: false });

      runner.scheduleRecurringJob.mockClear();

      await updateSchedule(ctx, created.scheduleId!, { enabled: true });

      expect(runner.scheduleRecurringJob).toHaveBeenCalledTimes(1);

      const row = await db('tenant_extension_schedule').where({ id: created.scheduleId }).first();
      expect(row.enabled).toBe(true);
      expect(row.job_id).toBeTruthy();
    });

    it('T075: update() returns error for non-existent schedule', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await updateSchedule(ctx, uuidv4(), { cron: '0 2 * * *' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('T076: update() returns error for schedule from different install', async () => {
      const { installId: install1, versionId: v1, registryId: r1 } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });
      const { installId: install2, versionId: v2, registryId: r2 } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/other', handler: 'h' }],
      });

      const ctx1 = { tenantId, installId: install1, versionId: v1, registryId: r1 };
      const ctx2 = { tenantId, installId: install2, versionId: v2, registryId: r2 };

      const created = await createSchedule(ctx1, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const result = await updateSchedule(ctx2, created.scheduleId!, { cron: '0 2 * * *' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('T077: update() can change endpoint by path', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [
          { method: 'POST', path: '/scheduled', handler: 'h1' },
          { method: 'GET', path: '/status', handler: 'h2' },
        ],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const result = await updateSchedule(ctx, created.scheduleId!, { endpoint: '/status' });
      expect(result.success).toBe(true);

      const schedule = await getSchedule(ctx, created.scheduleId!);
      expect(schedule?.endpointPath).toBe('/status');
    });

    it('T078: update() rejects invalid endpoint path', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const result = await updateSchedule(ctx, created.scheduleId!, { endpoint: '/nonexistent' });
      expect(result.success).toBe(false);
      expect(result.fieldErrors?.endpoint).toBeDefined();
    });
  });

  // ============================================================================
  // T079-T084: delete() tests
  // ============================================================================

  describe('delete() tests (T079-T084)', () => {
    it('T079: delete() removes schedule from database', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      await deleteSchedule(ctx, created.scheduleId!);

      const row = await db('tenant_extension_schedule').where({ id: created.scheduleId }).first();
      expect(row).toBeUndefined();
    });

    it('T080: delete() cancels underlying job runner schedule', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      runner.cancelJob.mockClear();

      await deleteSchedule(ctx, created.scheduleId!);

      expect(runner.cancelJob).toHaveBeenCalledTimes(1);
    });

    it('T081: delete() returns success for valid schedule', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const result = await deleteSchedule(ctx, created.scheduleId!);
      expect(result.success).toBe(true);
    });

    it('T082: delete() returns error for non-existent schedule', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await deleteSchedule(ctx, uuidv4());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('T083: delete() returns error for schedule from different install', async () => {
      const { installId: install1, versionId: v1, registryId: r1 } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });
      const { installId: install2, versionId: v2, registryId: r2 } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/other', handler: 'h' }],
      });

      const ctx1 = { tenantId, installId: install1, versionId: v1, registryId: r1 };
      const ctx2 = { tenantId, installId: install2, versionId: v2, registryId: r2 };

      const created = await createSchedule(ctx1, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const result = await deleteSchedule(ctx2, created.scheduleId!);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('T084: delete() succeeds even if job runner schedule already cancelled', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      // Create a disabled schedule (no job runner schedule)
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *', enabled: false });

      const result = await deleteSchedule(ctx, created.scheduleId!);
      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // getEndpoints() tests
  // ============================================================================

  describe('getEndpoints() tests', () => {
    it('getEndpoints() returns endpoints for install version', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [
          { method: 'POST', path: '/scheduled', handler: 'h1' },
          { method: 'GET', path: '/status', handler: 'h2' },
        ],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await getEndpoints(ctx);
      expect(result.length).toBe(2);
    });

    it('getEndpoints() marks endpoints with path parameters as non-schedulable', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [
          { method: 'POST', path: '/scheduled', handler: 'h1' },
          { method: 'GET', path: '/items/:id', handler: 'h2' },
        ],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await getEndpoints(ctx);

      const scheduled = result.find((e) => e.path === '/scheduled');
      const parameterized = result.find((e) => e.path === '/items/:id');

      expect(scheduled?.schedulable).toBe(true);
      expect(parameterized?.schedulable).toBe(false);
    });

    it('getEndpoints() marks DELETE/PUT endpoints as non-schedulable', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [
          { method: 'DELETE', path: '/delete', handler: 'h1' },
          { method: 'PUT', path: '/put', handler: 'h2' },
          { method: 'POST', path: '/post', handler: 'h3' },
        ],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const result = await getEndpoints(ctx);

      const del = result.find((e) => e.path === '/delete');
      const put = result.find((e) => e.path === '/put');
      const post = result.find((e) => e.path === '/post');

      expect(del?.schedulable).toBe(false);
      expect(put?.schedulable).toBe(false);
      expect(post?.schedulable).toBe(true);
    });
  });

  // ============================================================================
  // T115: Endpoint resolution tests
  // ============================================================================

  describe('Endpoint resolution tests (T115)', () => {
    it('T115: Endpoint resolution uses version_id from install config', async () => {
      const { installId, versionId, registryId } = await seedInstalledExtension(db, tenantId, {
        apiEndpoints: [{ method: 'POST', path: '/scheduled', handler: 'h' }],
      });

      const ctx = { tenantId, installId, versionId, registryId };
      const created = await createSchedule(ctx, { endpoint: '/scheduled', cron: '0 1 * * *' });

      const row = await db('tenant_extension_schedule').where({ id: created.scheduleId }).first();
      const endpoint = await db('extension_api_endpoint').where({ id: row.endpoint_id }).first();

      // Verify endpoint belongs to the correct version
      expect(endpoint.version_id).toBe(versionId);
    });
  });
});

// ============================================================================
// Helper functions
// ============================================================================

async function ensureTenant(db: Knex): Promise<string> {
  const row = await db('tenants').first<{ tenant: string }>('tenant');
  if (row?.tenant) return row.tenant;
  const id = uuidv4();
  await db('tenants').insert({
    tenant: id,
    client_name: `Test Co ${id.slice(0, 6)}`,
    email: `test-${id.slice(0, 6)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return id;
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

  // Insert endpoints directly (materialize them)
  for (const ep of params.apiEndpoints) {
    const normalizedPath = ep.path.startsWith('/') ? ep.path : `/${ep.path}`;
    const normalizedMethod = String(ep.method).toUpperCase();
    await db('extension_api_endpoint').insert({
      id: uuidv4(),
      version_id: versionId,
      method: normalizedMethod,
      path: normalizedPath,
      handler: ep.handler,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  }

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
