import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import {
  registerWorkflowScheduleJobRunner,
  resetWorkflowScheduleJobRunner
} from '@alga-psa/workflows/lib/jobRunnerProvider';
import { getSchemaRegistry, initializeWorkflowRuntimeV2 } from '@alga-psa/workflows/runtime';
import {
  buildWorkflowDefinition,
  ensureWorkflowRuntimeV2TestRegistrations,
  stateSetStep
} from '../helpers/workflowRuntimeV2TestHelpers';

type WorkflowRecord = Record<string, any>;
type VersionRecord = Record<string, any>;
type ScheduleRecord = Record<string, any>;

let workflowRecord: WorkflowRecord | null = null;
const versionRecords = new Map<number, VersionRecord>();
const scheduleRecords = new Map<string, ScheduleRecord>();

const hasPermissionMock = vi.fn(async () => true);
const runner = {
  scheduleJobAt: vi.fn(async () => ({ jobId: uuidv4(), externalId: `one-${uuidv4()}` })),
  scheduleRecurringJob: vi.fn(async () => ({ jobId: uuidv4(), externalId: `rec-${uuidv4()}` })),
  cancelJob: vi.fn(async () => true),
  getJobStatus: vi.fn(async () => ({ status: 'cancelled' }))
};

const knexMock: any = vi.fn((table: string) => {
  if (table === 'workflow_definition_versions') {
    return {
      where: vi.fn().mockReturnThis(),
      max: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        max_version: versionRecords.size > 0 ? Math.max(...versionRecords.keys()) : null
      })
    };
  }
  throw new Error(`Unexpected table access: ${table}`);
});

vi.mock('@alga-psa/core', () => ({
  deleteEntityWithValidation: vi.fn()
}));

vi.mock('@alga-psa/analytics', () => ({
  analytics: {
    capture: vi.fn()
  }
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock, tenant: 'tenant-1' })),
  auditLog: vi.fn(async () => undefined)
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (input: unknown) => fn(
    { user_id: 'user-1', user_type: 'internal', roles: [] },
    { tenant: 'tenant-1' },
    input
  ),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
  getCurrentUser: vi.fn(async () => ({ user_id: 'user-1', user_type: 'internal', roles: [] })),
  preCheckDeletion: vi.fn()
}));

vi.mock('@alga-psa/workflows/persistence/workflowDefinitionModelV2', () => ({
  default: {
    create: vi.fn(async (_knex: unknown, data: WorkflowRecord) => {
      workflowRecord = { ...data };
      return workflowRecord;
    }),
    getById: vi.fn(async () => workflowRecord),
    update: vi.fn(async (_knex: unknown, _workflowId: string, data: WorkflowRecord) => {
      workflowRecord = { ...(workflowRecord ?? {}), ...data };
      return workflowRecord;
    }),
    list: vi.fn(async () => (workflowRecord ? [workflowRecord] : []))
  }
}));

vi.mock('@alga-psa/workflows/persistence/workflowDefinitionVersionModelV2', () => ({
  default: {
    create: vi.fn(async (_knex: unknown, data: VersionRecord) => {
      const record = { ...data };
      versionRecords.set(Number(record.version), record);
      return record;
    }),
    getByWorkflowAndVersion: vi.fn(async (_knex: unknown, _workflowId: string, version: number) =>
      versionRecords.get(Number(version)) ?? null),
    listByWorkflow: vi.fn(async () => Array.from(versionRecords.values()).sort((a, b) => Number(b.version) - Number(a.version)))
  }
}));

vi.mock('@alga-psa/workflows/persistence/workflowScheduleStateModel', () => ({
  default: {
    create: vi.fn(async (_knex: unknown, data: ScheduleRecord) => {
      const record = {
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...data
      };
      scheduleRecords.set(String(record.id), record);
      return record;
    }),
    update: vi.fn(async (_knex: unknown, scheduleId: string, data: ScheduleRecord) => {
      const existing = scheduleRecords.get(scheduleId);
      if (!existing) {
        throw new Error(`Missing schedule ${scheduleId}`);
      }
      const updated = {
        ...existing,
        ...data,
        updated_at: new Date().toISOString()
      };
      scheduleRecords.set(scheduleId, updated);
      return updated;
    }),
    getById: vi.fn(async (_knex: unknown, scheduleId: string) => scheduleRecords.get(scheduleId) ?? null),
    getByWorkflowId: vi.fn(async (_knex: unknown, workflowId: string) =>
      Array.from(scheduleRecords.values()).find((row) => row.workflow_id === workflowId) ?? null),
    listByWorkflowId: vi.fn(async (_knex: unknown, workflowId: string) =>
      Array.from(scheduleRecords.values()).filter((row) => row.workflow_id === workflowId)),
    listByWorkflowIds: vi.fn(async (_knex: unknown, workflowIds: string[]) =>
      Array.from(scheduleRecords.values()).filter((row) => workflowIds.includes(String(row.workflow_id)))),
    deleteById: vi.fn(async (_knex: unknown, scheduleId: string) => Number(scheduleRecords.delete(scheduleId))),
    deleteByWorkflowId: vi.fn(async (_knex: unknown, workflowId: string) => {
      let count = 0;
      for (const [scheduleId, row] of scheduleRecords.entries()) {
        if (row.workflow_id === workflowId) {
          scheduleRecords.delete(scheduleId);
          count += 1;
        }
      }
      return count;
    })
  }
}));

vi.mock('@alga-psa/workflows/models/eventCatalog', () => ({
  EventCatalogModel: {
    getByEventType: vi.fn(async () => null)
  }
}));

import {
  createWorkflowDefinitionAction,
  publishWorkflowDefinitionAction
} from '@alga-psa/workflows/actions-psa/workflows-runtime-v2-actions';

const SCHEDULE_PUBLISH_V1_REF = 'payload.SchedulePublish.v1';
const SCHEDULE_PUBLISH_V2_REF = 'payload.SchedulePublish.v2';

const buildDefinition = (workflowId: string, name: string, version: number, payloadSchemaRef: string) => ({
  id: workflowId,
  ...buildWorkflowDefinition({
    name,
    version,
    payloadSchemaRef,
    steps: [stateSetStep('state-1', 'READY')]
  })
});

async function createPublishedWorkflow(name: string, payloadSchemaRef: string): Promise<string> {
  const workflowId = uuidv4();
  const createResult = await createWorkflowDefinitionAction({
    definition: buildDefinition(workflowId, name, 1, payloadSchemaRef),
    payloadSchemaMode: 'pinned',
    pinnedPayloadSchemaRef: payloadSchemaRef
  });

  const publishResult = await publishWorkflowDefinitionAction({
    workflowId: createResult.workflowId,
    version: 1
  });
  expect(publishResult.ok).toBe(true);
  return createResult.workflowId;
}

function seedSchedule(params: {
  workflowId: string;
  name: string;
  triggerType: 'schedule' | 'recurring';
  payload: Record<string, unknown>;
  enabled?: boolean;
  status?: 'scheduled' | 'paused' | 'disabled' | 'completed' | 'failed';
  workflowVersion?: number;
  runAt?: string | null;
  cron?: string | null;
  timezone?: string | null;
}) {
  const id = uuidv4();
  scheduleRecords.set(id, {
    id,
    tenant_id: 'tenant-1',
    workflow_id: params.workflowId,
    workflow_version: params.workflowVersion ?? 1,
    name: params.name,
    trigger_type: params.triggerType,
    run_at: params.runAt ?? null,
    cron: params.cron ?? null,
    timezone: params.timezone ?? null,
    payload_json: params.payload,
    enabled: params.enabled ?? true,
    status: params.status ?? 'scheduled',
    job_id: `job-${id}`,
    runner_schedule_id: `runner-${id}`,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  return id;
}

describe('workflow external schedules publish lifecycle unit tests', () => {
  afterEach(() => {
    resetWorkflowScheduleJobRunner();
  });

  beforeEach(() => {
    workflowRecord = null;
    versionRecords.clear();
    scheduleRecords.clear();
    knexMock.mockClear();
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    runner.scheduleJobAt.mockClear();
    runner.scheduleRecurringJob.mockClear();
    runner.cancelJob.mockClear();
    runner.getJobStatus.mockClear();
    registerWorkflowScheduleJobRunner(async () => runner);

    initializeWorkflowRuntimeV2();
    ensureWorkflowRuntimeV2TestRegistrations();
    const schemaRegistry = getSchemaRegistry();
    if (!schemaRegistry.has(SCHEDULE_PUBLISH_V1_REF)) {
      schemaRegistry.register(SCHEDULE_PUBLISH_V1_REF, z.object({
        accountId: z.string().min(1)
      }).passthrough());
    }
    if (!schemaRegistry.has(SCHEDULE_PUBLISH_V2_REF)) {
      schemaRegistry.register(SCHEDULE_PUBLISH_V2_REF, z.object({
        accountId: z.string().min(1),
        threshold: z.number().int().positive()
      }).passthrough());
    }
  });

  it('T021: valid schedules rebind to the newest published workflow version', async () => {
    const workflowId = await createPublishedWorkflow('Publish valid workflow', SCHEDULE_PUBLISH_V1_REF);
    const scheduleId = seedSchedule({
      workflowId,
      name: 'Valid recurring',
      triggerType: 'recurring',
      payload: { accountId: 'acct-1' },
      cron: '0 9 * * *',
      timezone: 'UTC'
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId,
      version: 2,
      definition: buildDefinition(workflowId, 'Publish valid workflow', 2, SCHEDULE_PUBLISH_V1_REF)
    });

    expect(publishResult.ok).toBe(true);
    const schedule = scheduleRecords.get(scheduleId)!;
    expect(schedule.workflow_version).toBe(2);
    expect(schedule.enabled).toBe(true);
    expect(schedule.status).toBe('scheduled');
    expect(schedule.last_error).toBeNull();
    expect(runner.cancelJob).not.toHaveBeenCalled();
  });

  it('T022: invalid schedules are preserved and marked non-runnable when the new published version rejects their payload', async () => {
    const workflowId = await createPublishedWorkflow('Invalidation workflow', SCHEDULE_PUBLISH_V1_REF);
    const scheduleId = seedSchedule({
      workflowId,
      name: 'Will become invalid',
      triggerType: 'recurring',
      payload: { accountId: 'acct-1' },
      cron: '0 9 * * *',
      timezone: 'UTC'
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId,
      version: 2,
      definition: buildDefinition(workflowId, 'Invalidation workflow', 2, SCHEDULE_PUBLISH_V2_REF)
    });

    expect(publishResult.ok).toBe(true);
    const schedule = scheduleRecords.get(scheduleId)!;
    expect(schedule.workflow_version).toBe(1);
    expect(schedule.enabled).toBe(false);
    expect(schedule.status).toBe('failed');
    expect(schedule.job_id).toBeNull();
    expect(schedule.runner_schedule_id).toBeNull();
    expect(String(schedule.last_error)).toContain('threshold');
    expect(runner.cancelJob).toHaveBeenCalledTimes(1);
  });

  it('T023: revalidation runs for every schedule attached to the workflow, not just one schedule', async () => {
    const workflowId = await createPublishedWorkflow('Many schedules workflow', SCHEDULE_PUBLISH_V1_REF);
    const firstId = seedSchedule({
      workflowId,
      name: 'First valid',
      triggerType: 'schedule',
      payload: { accountId: 'acct-1' },
      runAt: '2099-01-01T10:00:00.000Z'
    });
    const secondId = seedSchedule({
      workflowId,
      name: 'Second valid',
      triggerType: 'recurring',
      payload: { accountId: 'acct-2' },
      cron: '0 9 * * *',
      timezone: 'UTC'
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId,
      version: 2,
      definition: buildDefinition(workflowId, 'Many schedules workflow', 2, SCHEDULE_PUBLISH_V1_REF)
    });

    expect(publishResult.ok).toBe(true);
    expect(scheduleRecords.get(firstId)?.workflow_version).toBe(2);
    expect(scheduleRecords.get(secondId)?.workflow_version).toBe(2);
    expect(scheduleRecords.get(firstId)?.last_error).toBeNull();
    expect(scheduleRecords.get(secondId)?.last_error).toBeNull();
  });

  it('T024: a workflow with mixed valid and invalid schedules only rebinds the valid ones', async () => {
    const workflowId = await createPublishedWorkflow('Mixed validity workflow', SCHEDULE_PUBLISH_V1_REF);
    const validId = seedSchedule({
      workflowId,
      name: 'Valid after publish',
      triggerType: 'recurring',
      payload: { accountId: 'acct-1', threshold: 2 },
      cron: '0 9 * * *',
      timezone: 'UTC'
    });
    const invalidId = seedSchedule({
      workflowId,
      name: 'Invalid after publish',
      triggerType: 'schedule',
      payload: { accountId: 'acct-2' },
      runAt: '2099-01-01T10:00:00.000Z'
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId,
      version: 2,
      definition: buildDefinition(workflowId, 'Mixed validity workflow', 2, SCHEDULE_PUBLISH_V2_REF)
    });

    expect(publishResult.ok).toBe(true);

    const valid = scheduleRecords.get(validId)!;
    const invalid = scheduleRecords.get(invalidId)!;
    expect(valid.workflow_version).toBe(2);
    expect(valid.enabled).toBe(true);
    expect(valid.status).toBe('scheduled');
    expect(valid.last_error).toBeNull();

    expect(invalid.workflow_version).toBe(1);
    expect(invalid.enabled).toBe(false);
    expect(invalid.status).toBe('failed');
    expect(String(invalid.last_error)).toContain('threshold');
  });
});
