import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import {
  registerWorkflowScheduleJobRunner,
  resetWorkflowScheduleJobRunner
} from '@alga-psa/workflows/lib/jobRunnerProvider';
import { resolveWorkflowBusinessDaySettings } from '@alga-psa/workflows/lib/workflowBusinessDayScheduling';
import { createTestDbConnection } from '@main-test-utils/dbConfig';

const require = createRequire(import.meta.url);

let db: Knex;
let tenantId = 'tenant-workflow-schedules';

const hasPermissionMock = vi.fn(async () => true);
const runner = {
  scheduleJobAt: vi.fn(async () => ({ jobId: uuidv4(), externalId: `one-${uuidv4()}` })),
  scheduleRecurringJob: vi.fn(async () => ({ jobId: uuidv4(), externalId: `rec-${uuidv4()}` })),
  cancelJob: vi.fn(async () => true),
  getJobStatus: vi.fn(async () => ({ status: 'cancelled' }))
};

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action(
    { user_id: 'user-1', tenant: tenantId, roles: [] },
    { tenant: tenantId },
    ...args
  ),
  hasPermission: (...args: any[]) => hasPermissionMock(...args)
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId }))
}));

type WorkflowScheduleActionsModule = typeof import('@alga-psa/workflows/actions/workflow-schedule-v2-actions');
let listWorkflowSchedulesAction: WorkflowScheduleActionsModule['listWorkflowSchedulesAction'];
let getWorkflowScheduleAction: WorkflowScheduleActionsModule['getWorkflowScheduleAction'];
let createWorkflowScheduleAction: WorkflowScheduleActionsModule['createWorkflowScheduleAction'];
let updateWorkflowScheduleAction: WorkflowScheduleActionsModule['updateWorkflowScheduleAction'];
let pauseWorkflowScheduleAction: WorkflowScheduleActionsModule['pauseWorkflowScheduleAction'];
let resumeWorkflowScheduleAction: WorkflowScheduleActionsModule['resumeWorkflowScheduleAction'];
let deleteWorkflowScheduleAction: WorkflowScheduleActionsModule['deleteWorkflowScheduleAction'];

async function applyWorkflowScheduleMigrations(connection: Knex): Promise<void> {
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  for (const migrationName of [
    '20260307200000_create_workflow_schedule_tables.cjs',
    '20260308130000_expand_workflow_schedule_for_external_schedules.cjs',
    '20260410120000_add_workflow_schedule_business_day_fields.cjs'
  ]) {
    const migration = require(path.resolve(repoRoot, 'ee', 'server', 'migrations', migrationName));
    await migration.up(connection);
  }
}

async function seedWorkflow(params?: {
  name?: string;
  payloadSchemaMode?: 'pinned' | 'inferred';
  payloadSchemaRef?: string;
  published?: boolean;
}): Promise<{ workflowId: string; publishedVersion: number | null }> {
  const workflowId = uuidv4();
  const name = params?.name ?? 'Workflow';
  const payloadSchemaRef = params?.payloadSchemaRef ?? 'payload.Empty.v1';
  const payloadSchemaMode = params?.payloadSchemaMode ?? 'pinned';
  const published = params?.published ?? true;
  const publishedVersion = published ? 1 : null;

  await db('workflow_definitions').insert({
    workflow_id: workflowId,
    name,
    description: null,
    payload_schema_ref: payloadSchemaRef,
    payload_schema_mode: payloadSchemaMode,
    pinned_payload_schema_ref: payloadSchemaMode === 'pinned' ? payloadSchemaRef : null,
    payload_schema_provenance: payloadSchemaMode,
    trigger: null,
    draft_definition: {
      id: workflowId,
      name,
      version: published ? 2 : 1,
      payloadSchemaRef,
      steps: []
    },
    draft_version: published ? 2 : 1,
    status: published ? 'published' : 'draft',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  if (published && publishedVersion) {
    await db('workflow_definition_versions').insert({
      version_id: uuidv4(),
      workflow_id: workflowId,
      version: publishedVersion,
      definition_json: {
        id: workflowId,
        name,
        version: publishedVersion,
        payloadSchemaRef,
        steps: []
      },
      payload_schema_json: {},
      published_at: db.fn.now(),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
  }

  return { workflowId, publishedVersion };
}

async function seedBusinessHoursSchedule(params: {
  tenant: string;
  name: string;
  isDefault?: boolean;
  is24x7?: boolean;
  enabledWeekdays?: number[];
}): Promise<string> {
  const scheduleId = uuidv4();
  await db('business_hours_schedules').insert({
    tenant: params.tenant,
    schedule_id: scheduleId,
    schedule_name: params.name,
    timezone: 'UTC',
    is_default: Boolean(params.isDefault),
    is_24x7: Boolean(params.is24x7),
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  const weekdays = params.enabledWeekdays ?? [1, 2, 3, 4, 5];
  if (weekdays.length > 0) {
    await db('business_hours_entries').insert(
      weekdays.map((day) => ({
        tenant: params.tenant,
        entry_id: uuidv4(),
        schedule_id: scheduleId,
        day_of_week: day,
        start_time: '09:00',
        end_time: '17:00',
        is_enabled: true
      }))
    );
  }

  return scheduleId;
}

describe('Workflow external schedules actions – DB integration', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection();
    await applyWorkflowScheduleMigrations(db);

    ({
      listWorkflowSchedulesAction,
      getWorkflowScheduleAction,
      createWorkflowScheduleAction,
      updateWorkflowScheduleAction,
      pauseWorkflowScheduleAction,
      resumeWorkflowScheduleAction,
      deleteWorkflowScheduleAction
    } = await import('@alga-psa/workflows/actions/workflow-schedule-v2-actions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    resetWorkflowScheduleJobRunner();
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    tenantId = 'tenant-workflow-schedules';
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    runner.scheduleJobAt.mockClear();
    runner.scheduleRecurringJob.mockClear();
    runner.cancelJob.mockClear();
    runner.getJobStatus.mockClear();
    registerWorkflowScheduleJobRunner(async () => runner);

    await db('tenant_workflow_schedule').delete().catch(() => undefined);
    await db('holidays').delete().catch(() => undefined);
    await db('business_hours_entries').delete().catch(() => undefined);
    await db('business_hours_schedules').delete().catch(() => undefined);
    await db('workflow_definition_versions').delete().catch(() => undefined);
    await db('workflow_definitions').delete().catch(() => undefined);
  });

  it('T003/T005/T009: create persists required name and payload_json for a published one-time schedule', async () => {
    const { workflowId } = await seedWorkflow({ name: 'One-time workflow' });

    const result = await createWorkflowScheduleAction({
      workflowId,
      name: 'Quarterly kickoff',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: {},
      enabled: true
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await db('tenant_workflow_schedule').where({ id: result.schedule.id }).first();
    expect(row.name).toBe('Quarterly kickoff');
    expect(row.payload_json).toEqual({});
    expect(row.workflow_version).toBe(1);
    expect(row.trigger_type).toBe('schedule');
    expect(runner.scheduleJobAt).toHaveBeenCalledTimes(1);
  });

  it('T004: create rejects an empty schedule name', async () => {
    const { workflowId } = await seedWorkflow();

    await expect(createWorkflowScheduleAction({
      workflowId,
      name: '   ',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: {},
      enabled: true
    })).rejects.toThrow();

    const rows = await db('tenant_workflow_schedule').select('*');
    expect(rows).toHaveLength(0);
  });

  it('T007/T054: global list returns schedules across workflows for the tenant only', async () => {
    const a = await seedWorkflow({ name: 'Workflow A' });
    const b = await seedWorkflow({ name: 'Workflow B' });

    await createWorkflowScheduleAction({
      workflowId: a.workflowId,
      name: 'A schedule',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: {},
      enabled: true
    });
    await createWorkflowScheduleAction({
      workflowId: b.workflowId,
      name: 'B schedule',
      triggerType: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      payload: {},
      enabled: true
    });

    await db('tenant_workflow_schedule').insert({
      id: uuidv4(),
      tenant_id: 'other-tenant',
      workflow_id: a.workflowId,
      workflow_version: 1,
      name: 'Foreign schedule',
      trigger_type: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      payload_json: {},
      enabled: true,
      status: 'scheduled',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    const result = await listWorkflowSchedulesAction({});
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item: any) => item.workflow_name).sort()).toEqual(['Workflow A', 'Workflow B']);
    expect(result.items.some((item: any) => item.name === 'Foreign schedule')).toBe(false);
  });

  it('T008: get schedule returns payload and timing data for editing', async () => {
    const { workflowId } = await seedWorkflow({ name: 'Editable workflow' });
    const created = await createWorkflowScheduleAction({
      workflowId,
      name: 'Nightly sync',
      triggerType: 'recurring',
      cron: '0 2 * * *',
      timezone: 'UTC',
      payload: {},
      enabled: true
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await getWorkflowScheduleAction({ scheduleId: created.schedule.id });
    expect(result.workflow_name).toBe('Editable workflow');
    expect(result.payload_json).toEqual({});
    expect(result.cron).toBe('0 2 * * *');
    expect(result.timezone).toBe('UTC');
    expect(result.day_type_filter).toBe('any');
    expect(result.business_hours_schedule_id).toBeNull();
  });

  it('T005: business-hours resolution prefers explicit override, otherwise tenant default, and includes global + schedule-specific holidays', async () => {
    const defaultScheduleId = await seedBusinessHoursSchedule({
      tenant: tenantId,
      name: 'Default calendar',
      isDefault: true,
      enabledWeekdays: [1, 2, 3, 4, 5]
    });
    const overrideScheduleId = await seedBusinessHoursSchedule({
      tenant: tenantId,
      name: 'Override calendar',
      enabledWeekdays: [1, 2, 3, 4, 5]
    });

    await db('holidays').insert([
      {
        tenant: tenantId,
        holiday_id: uuidv4(),
        schedule_id: null,
        holiday_name: 'Global holiday',
        holiday_date: '2026-12-25',
        is_recurring: false,
        created_at: db.fn.now()
      },
      {
        tenant: tenantId,
        holiday_id: uuidv4(),
        schedule_id: overrideScheduleId,
        holiday_name: 'Override holiday',
        holiday_date: '2026-12-26',
        is_recurring: false,
        created_at: db.fn.now()
      }
    ]);

    const overrideResolution = await resolveWorkflowBusinessDaySettings(db, {
      tenantId,
      dayTypeFilter: 'business',
      businessHoursScheduleId: overrideScheduleId
    });
    expect(overrideResolution.ok).toBe(true);
    if (overrideResolution.ok) {
      expect(overrideResolution.value?.scheduleId).toBe(overrideScheduleId);
      expect(overrideResolution.value?.source).toBe('override');
      expect(overrideResolution.value?.holidays.map((holiday) => holiday.holiday_date).sort()).toEqual([
        '2026-12-25',
        '2026-12-26'
      ]);
    }

    const defaultResolution = await resolveWorkflowBusinessDaySettings(db, {
      tenantId,
      dayTypeFilter: 'business',
      businessHoursScheduleId: null
    });
    expect(defaultResolution.ok).toBe(true);
    if (defaultResolution.ok) {
      expect(defaultResolution.value?.scheduleId).toBe(defaultScheduleId);
      expect(defaultResolution.value?.source).toBe('tenant_default');
      expect(defaultResolution.value?.holidays.map((holiday) => holiday.holiday_date)).toEqual(['2026-12-25']);
    }
  });

  it('T014: list/get include day-filter and business-hours override fields for schedule round-trips', async () => {
    const overrideScheduleId = await seedBusinessHoursSchedule({
      tenant: tenantId,
      name: 'Roundtrip schedule',
      enabledWeekdays: [1, 2, 3, 4, 5]
    });

    const { workflowId } = await seedWorkflow({ name: 'Business day workflow' });
    const created = await createWorkflowScheduleAction({
      workflowId,
      name: 'Business day recurring',
      triggerType: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      dayTypeFilter: 'business',
      businessHoursScheduleId: overrideScheduleId,
      payload: {},
      enabled: true
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const fetched = await getWorkflowScheduleAction({ scheduleId: created.schedule.id });
    expect(fetched.day_type_filter).toBe('business');
    expect(fetched.business_hours_schedule_id).toBe(overrideScheduleId);
    expect(fetched.effective_business_hours_schedule_id).toBe(overrideScheduleId);
    expect(fetched.business_hours_schedule_source).toBe('override');

    const listed = await listWorkflowSchedulesAction({ workflowId });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].day_type_filter).toBe('business');
    expect(listed.items[0].business_hours_schedule_id).toBe(overrideScheduleId);
    expect(listed.items[0].effective_business_hours_schedule_id).toBe(overrideScheduleId);
  });

  it('T010: create succeeds for a published workflow with pinned schema and valid recurring payload', async () => {
    const { workflowId } = await seedWorkflow();

    const result = await createWorkflowScheduleAction({
      workflowId,
      name: 'Daily digest',
      triggerType: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      payload: {},
      enabled: true
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await db('tenant_workflow_schedule').where({ id: result.schedule.id }).first();
    expect(row.trigger_type).toBe('recurring');
    expect(row.cron).toBe('0 9 * * *');
    expect(row.timezone).toBe('UTC');
    expect(runner.scheduleRecurringJob).toHaveBeenCalledTimes(1);
  });

  it('T006/T011: edit updates runAt and payload for a one-time schedule', async () => {
    const { workflowId } = await seedWorkflow();
    const created = await createWorkflowScheduleAction({
      workflowId,
      name: 'Initial launch',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: {},
      enabled: true
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateWorkflowScheduleAction({
      scheduleId: created.schedule.id,
      workflowId,
      name: 'Initial launch',
      triggerType: 'schedule',
      runAt: '2099-01-02T12:30:00.000Z',
      payload: {},
      enabled: true
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await db('tenant_workflow_schedule').where({ id: created.schedule.id }).first();
    expect(new Date(row.run_at).toISOString()).toBe('2099-01-02T12:30:00.000Z');
    expect(row.payload_json).toEqual({});
    expect(runner.cancelJob).toHaveBeenCalledTimes(1);
    expect(runner.scheduleJobAt).toHaveBeenCalledTimes(2);
  });

  it('T012: edit updates cron, timezone, and payload for a recurring schedule', async () => {
    const { workflowId } = await seedWorkflow();
    const created = await createWorkflowScheduleAction({
      workflowId,
      name: 'Recurring launch',
      triggerType: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      payload: {},
      enabled: true
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateWorkflowScheduleAction({
      scheduleId: created.schedule.id,
      workflowId,
      name: 'Recurring launch',
      triggerType: 'recurring',
      cron: '15 10 * * *',
      timezone: 'America/New_York',
      payload: {},
      enabled: true
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await db('tenant_workflow_schedule').where({ id: created.schedule.id }).first();
    expect(row.cron).toBe('15 10 * * *');
    expect(row.timezone).toBe('America/New_York');
    expect(row.payload_json).toEqual({});
    expect(runner.scheduleRecurringJob).toHaveBeenCalledTimes(2);
  });

  it('T013: pause disables runner registration without deleting the record', async () => {
    const { workflowId } = await seedWorkflow();
    const created = await createWorkflowScheduleAction({
      workflowId,
      name: 'Pause me',
      triggerType: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      payload: {},
      enabled: true
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await pauseWorkflowScheduleAction({ scheduleId: created.schedule.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await db('tenant_workflow_schedule').where({ id: created.schedule.id }).first();
    expect(row.enabled).toBe(false);
    expect(row.status).toBe('paused');
    expect(row.job_id).toBeNull();
    expect(row.runner_schedule_id).toBeNull();
    expect(runner.cancelJob).toHaveBeenCalledTimes(1);
  });

  it('T014: resume re-registers the runner using current timing and payload', async () => {
    const { workflowId } = await seedWorkflow();
    const created = await createWorkflowScheduleAction({
      workflowId,
      name: 'Resume me',
      triggerType: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      payload: {},
      enabled: true
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await pauseWorkflowScheduleAction({ scheduleId: created.schedule.id });
    runner.scheduleRecurringJob.mockClear();

    const result = await resumeWorkflowScheduleAction({ scheduleId: created.schedule.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await db('tenant_workflow_schedule').where({ id: created.schedule.id }).first();
    expect(row.enabled).toBe(true);
    expect(row.status).toBe('scheduled');
    expect(row.cron).toBe('0 9 * * *');
    expect(row.payload_json).toEqual({});
    expect(runner.scheduleRecurringJob).toHaveBeenCalledTimes(1);
    expect(runner.scheduleRecurringJob.mock.calls[0][2]).toBe('0 9 * * *');
  });

  it('T015: delete removes the schedule record and associated runner registration', async () => {
    const { workflowId } = await seedWorkflow();
    const created = await createWorkflowScheduleAction({
      workflowId,
      name: 'Delete me',
      triggerType: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      payload: {},
      enabled: true
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await deleteWorkflowScheduleAction({ scheduleId: created.schedule.id });
    expect(result.ok).toBe(true);
    const row = await db('tenant_workflow_schedule').where({ id: created.schedule.id }).first();
    expect(row).toBeUndefined();
    expect(runner.cancelJob).toHaveBeenCalledTimes(1);
  });

  it('T016: create fails when the workflow has no published version', async () => {
    const { workflowId } = await seedWorkflow({ published: false });

    const result = await createWorkflowScheduleAction({
      workflowId,
      name: 'Draft only',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: {},
      enabled: true
    });

    expect(result).toEqual({
      ok: false,
      code: 'WORKFLOW_NOT_PUBLISHED',
      message: 'Schedules can only be created for workflows with a published version.'
    });
  });

  it('T017: create fails when the workflow payload schema mode is inferred', async () => {
    const { workflowId } = await seedWorkflow({ payloadSchemaMode: 'inferred' });

    const result = await createWorkflowScheduleAction({
      workflowId,
      name: 'Inferred schema',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: {},
      enabled: true
    });

    expect(result).toEqual({
      ok: false,
      code: 'WORKFLOW_PAYLOAD_SCHEMA_NOT_PINNED',
      message: 'Schedules are only supported for workflows with a pinned payload schema.'
    });
  });

  it('T018: edit fails when the target workflow uses inferred schema mode', async () => {
    const source = await seedWorkflow({ name: 'Source workflow' });
    const inferred = await seedWorkflow({ name: 'Inferred workflow', payloadSchemaMode: 'inferred' });

    const created = await createWorkflowScheduleAction({
      workflowId: source.workflowId,
      name: 'Move me',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: {},
      enabled: true
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateWorkflowScheduleAction({
      scheduleId: created.schedule.id,
      workflowId: inferred.workflowId,
      name: 'Move me',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: {},
      enabled: true
    });

    expect(result).toEqual({
      ok: false,
      code: 'WORKFLOW_PAYLOAD_SCHEMA_NOT_PINNED',
      message: 'Schedules are only supported for workflows with a pinned payload schema.'
    });
  });

  it('T019: create returns schema issues for invalid payload_json', async () => {
    const { workflowId } = await seedWorkflow();

    const result = await createWorkflowScheduleAction({
      workflowId,
      name: 'Invalid payload',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: { unexpected: true },
      enabled: true
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected schedule creation to fail validation');
    }
    const failure = result as { ok: false; code: string; issues?: unknown[] };
    expect(failure.code).toBe('SCHEDULE_PAYLOAD_INVALID');
    expect(Array.isArray(failure.issues)).toBe(true);
    expect(failure.issues?.length).toBeGreaterThan(0);
  });

  it('T020: edit returns schema issues for invalid payload_json', async () => {
    const { workflowId } = await seedWorkflow();
    const created = await createWorkflowScheduleAction({
      workflowId,
      name: 'Valid payload first',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: {},
      enabled: true
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateWorkflowScheduleAction({
      scheduleId: created.schedule.id,
      workflowId,
      name: 'Valid payload first',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: { unexpected: true },
      enabled: true
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected schedule update to fail validation');
    }
    const failure = result as { ok: false; code: string; issues?: unknown[] };
    expect(failure.code).toBe('SCHEDULE_PAYLOAD_INVALID');
    expect(Array.isArray(failure.issues)).toBe(true);
    expect(failure.issues?.length).toBeGreaterThan(0);
  });

  it('T052: users without workflow manage permission cannot create schedules', async () => {
    const { workflowId } = await seedWorkflow();
    hasPermissionMock.mockResolvedValue(false);

    await expect(createWorkflowScheduleAction({
      workflowId,
      name: 'Forbidden create',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: {},
      enabled: true
    })).rejects.toThrow('Forbidden');
  });

  it('T053: users without workflow manage permission cannot edit, pause, resume, or delete schedules', async () => {
    const { workflowId } = await seedWorkflow();
    const created = await createWorkflowScheduleAction({
      workflowId,
      name: 'Protected schedule',
      triggerType: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      payload: {},
      enabled: true
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    hasPermissionMock.mockResolvedValue(false);

    await expect(updateWorkflowScheduleAction({
      scheduleId: created.schedule.id,
      workflowId,
      name: 'Protected schedule',
      triggerType: 'recurring',
      cron: '15 9 * * *',
      timezone: 'UTC',
      payload: {},
      enabled: true
    })).rejects.toThrow('Forbidden');

    await expect(pauseWorkflowScheduleAction({ scheduleId: created.schedule.id })).rejects.toThrow('Forbidden');
    await expect(resumeWorkflowScheduleAction({ scheduleId: created.schedule.id })).rejects.toThrow('Forbidden');
    await expect(deleteWorkflowScheduleAction({ scheduleId: created.schedule.id })).rejects.toThrow('Forbidden');
  });

  it('T055: creates a recurring schedule row with payload_json and runner identifiers in the migrated database', async () => {
    const { workflowId } = await seedWorkflow({ name: 'Recurring workflow' });

    const result = await createWorkflowScheduleAction({
      workflowId,
      name: 'DB recurring schedule',
      triggerType: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      payload: {},
      enabled: true
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await db('tenant_workflow_schedule').where({ id: result.schedule.id }).first();
    expect(row).toBeDefined();
    expect(row.trigger_type).toBe('recurring');
    expect(row.payload_json).toEqual({});
    expect(row.job_id).toBeTruthy();
    expect(row.runner_schedule_id).toBeTruthy();
  });

  it('T056: invalid payload_json leaves no row behind in the migrated database', async () => {
    const { workflowId } = await seedWorkflow();

    const result = await createWorkflowScheduleAction({
      workflowId,
      name: 'Rollback invalid payload',
      triggerType: 'schedule',
      runAt: '2099-01-01T10:00:00.000Z',
      payload: { unexpected: true },
      enabled: true
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected schedule creation to fail validation');
    }

    const rows = await db('tenant_workflow_schedule')
      .where({ tenant_id: tenantId, name: 'Rollback invalid payload' })
      .select('*');
    expect(rows).toHaveLength(0);
  });

  it('T015: bounded next-eligible preview returns the next qualifying occurrence or null when none exists within the cap', async () => {
    const eligibleScheduleId = await seedBusinessHoursSchedule({
      tenant: tenantId,
      name: 'Eligible weekdays',
      isDefault: true,
      enabledWeekdays: [1]
    });
    const impossibleScheduleId = await seedBusinessHoursSchedule({
      tenant: tenantId,
      name: 'Never eligible',
      enabledWeekdays: []
    });
    const { workflowId } = await seedWorkflow({ name: 'Bounded preview workflow' });

    const eligible = await createWorkflowScheduleAction({
      workflowId,
      name: 'Monday-only business day',
      triggerType: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      dayTypeFilter: 'business',
      businessHoursScheduleId: eligibleScheduleId,
      payload: {},
      enabled: true
    });
    expect(eligible.ok).toBe(true);
    if (!eligible.ok) return;

    const impossible = await createWorkflowScheduleAction({
      workflowId,
      name: 'No enabled weekdays',
      triggerType: 'recurring',
      cron: '0 9 * * *',
      timezone: 'UTC',
      dayTypeFilter: 'business',
      businessHoursScheduleId: impossibleScheduleId,
      payload: {},
      enabled: true
    });
    expect(impossible.ok).toBe(true);
    if (!impossible.ok) return;

    const listResult = await listWorkflowSchedulesAction({ workflowId });
    const eligibleRow = listResult.items.find((item: any) => item.id === eligible.schedule.id);
    const impossibleRow = listResult.items.find((item: any) => item.id === impossible.schedule.id);

    expect(typeof eligibleRow?.next_eligible_fire_at).toBe('string');
    expect(impossibleRow?.next_eligible_fire_at).toBeNull();
  });
});
