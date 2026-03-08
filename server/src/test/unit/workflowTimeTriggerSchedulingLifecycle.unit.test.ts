import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildWorkflowDefinition,
  ensureWorkflowRuntimeV2TestRegistrations,
  stateSetStep,
  TEST_SCHEMA_REF
} from '../helpers/workflowRuntimeV2TestHelpers';
import { initializeWorkflowRuntimeV2 } from '@shared/workflow/runtime';

type WorkflowRecord = Record<string, any>;
type VersionRecord = Record<string, any>;
type ScheduleRecord = Record<string, any> | null;

let workflowRecord: WorkflowRecord | null = null;
let scheduleRecord: ScheduleRecord = null;
const versionRecords = new Map<number, VersionRecord>();
let scheduleSequence = 0;

const runnerMock = {
  scheduleJobAt: vi.fn(),
  scheduleRecurringJob: vi.fn(),
  cancelJob: vi.fn()
};

const knexMock: any = vi.fn((table: string) => {
  if (table === 'workflow_definition_versions') {
    return {
      where: vi.fn().mockReturnThis(),
      max: vi.fn().mockReturnThis(),
      del: vi.fn().mockImplementation(async () => {
        const deleted = versionRecords.size;
        versionRecords.clear();
        return deleted;
      }),
      first: vi.fn().mockResolvedValue({
        max_version: versionRecords.size > 0 ? Math.max(...versionRecords.keys()) : null
      })
    };
  }
  if (table === 'workflow_runs') {
    return {
      where: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      count: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ count: '0' }),
      pluck: vi.fn().mockResolvedValue([])
    };
  }
  if (table === 'tenant_workflow_schedule') {
    const query = {
      where: vi.fn(() => query),
      del: vi.fn().mockImplementation(async () => {
        const deleted = scheduleRecord ? 1 : 0;
        scheduleRecord = null;
        return deleted;
      })
    };
    return query;
  }
  if (
    table === 'workflow_run_logs' ||
    table === 'workflow_action_invocations' ||
    table === 'workflow_run_snapshots' ||
    table === 'workflow_run_waits' ||
    table === 'workflow_run_steps' ||
    table === 'workflow_registration_versions' ||
    table === 'workflow_definitions'
  ) {
    return {
      where: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      del: vi.fn().mockResolvedValue(0)
    };
  }
  throw new Error(`Unexpected table access: ${table}`);
});

vi.mock('@alga-psa/core', () => ({
  deleteEntityWithValidation: vi.fn(async (_entity: string, _id: string, _knex: unknown, _tenant: string | null, callback: (trx: unknown) => Promise<void>) => {
    await callback(knexMock);
    return { deleted: true, canDelete: true, dependencies: [], alternatives: [] };
  })
}));

vi.mock('@alga-psa/analytics', () => ({
  analytics: {
    capture: vi.fn()
  }
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock, tenant: 'tenant-1' })),
  auditLog: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (input: unknown) => fn({ user_id: 'user-1', user_type: 'internal', roles: [] }, { tenant: 'tenant-1' }, input),
  hasPermission: vi.fn().mockResolvedValue(true),
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1', user_type: 'internal', roles: [] }),
  preCheckDeletion: vi.fn(async () => ({ canDelete: true, dependencies: [], alternatives: [] }))
}));

vi.mock('server/src/lib/jobs/JobRunnerFactory', () => ({
  getJobRunner: vi.fn(async () => runnerMock)
}));

vi.mock('@shared/workflow/persistence/workflowDefinitionModelV2', () => ({
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

vi.mock('@shared/workflow/persistence/workflowDefinitionVersionModelV2', () => ({
  default: {
    create: vi.fn(async (_knex: unknown, data: VersionRecord) => {
      const record = { ...data };
      versionRecords.set(Number(record.version), record);
      return record;
    }),
    getByWorkflowAndVersion: vi.fn(async (_knex: unknown, _workflowId: string, version: number) => versionRecords.get(Number(version)) ?? null),
    listByWorkflow: vi.fn(async () =>
      Array.from(versionRecords.values()).sort((a, b) => Number(b.version) - Number(a.version))
    ),
    update: vi.fn(async (_knex: unknown, _workflowId: string, version: number, data: VersionRecord) => {
      const current = versionRecords.get(Number(version));
      const next = { ...(current ?? {}), ...data };
      versionRecords.set(Number(version), next);
      return next;
    })
  }
}));

vi.mock('@shared/workflow/persistence/workflowScheduleStateModel', () => ({
  default: {
    create: vi.fn(async (_knex: unknown, data: Record<string, any>) => {
      scheduleRecord = {
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      return scheduleRecord;
    }),
    update: vi.fn(async (_knex: unknown, scheduleId: string, data: Record<string, any>) => {
      if (!scheduleRecord || scheduleRecord.id !== scheduleId) {
        throw new Error('Schedule not found');
      }
      scheduleRecord = {
        ...scheduleRecord,
        ...data,
        updated_at: new Date().toISOString()
      };
      return scheduleRecord;
    }),
    getById: vi.fn(async (_knex: unknown, scheduleId: string) => (scheduleRecord?.id === scheduleId ? scheduleRecord : null)),
    getByWorkflowId: vi.fn(async (_knex: unknown, workflowId: string) => (scheduleRecord?.workflow_id === workflowId ? scheduleRecord : null)),
    list: vi.fn(async () => (scheduleRecord ? [scheduleRecord] : [])),
    deleteByWorkflowId: vi.fn(async (_knex: unknown, workflowId: string) => {
      if (scheduleRecord?.workflow_id === workflowId) {
        scheduleRecord = null;
        return 1;
      }
      return 0;
    })
  }
}));

vi.mock('../../../../packages/workflows/src/models/eventCatalog', () => ({
  EventCatalogModel: {
    getByEventType: vi.fn(async () => null)
  }
}));

import {
  createWorkflowDefinitionAction,
  deleteWorkflowDefinitionAction,
  publishWorkflowDefinitionAction,
  updateWorkflowDefinitionMetadataAction
} from '../../../../packages/workflows/src/actions/workflow-runtime-v2-actions';

const buildDraftDefinition = (trigger: Record<string, unknown>) => ({
  id: 'draft-workflow',
  ...buildWorkflowDefinition({
    steps: [stateSetStep('state-1', 'READY')],
    payloadSchemaRef: TEST_SCHEMA_REF,
    trigger: trigger as any
  })
});

describe('Workflow time trigger schedule lifecycle unit tests', () => {
  beforeEach(() => {
    workflowRecord = null;
    scheduleRecord = null;
    versionRecords.clear();
    scheduleSequence = 0;
    runnerMock.scheduleJobAt.mockReset();
    runnerMock.scheduleRecurringJob.mockReset();
    runnerMock.cancelJob.mockReset();
    runnerMock.scheduleJobAt.mockImplementation(async () => {
      scheduleSequence += 1;
      return { jobId: `job-${scheduleSequence}`, externalId: `runner-${scheduleSequence}` };
    });
    runnerMock.scheduleRecurringJob.mockImplementation(async () => {
      scheduleSequence += 1;
      return { jobId: `job-${scheduleSequence}`, externalId: `runner-${scheduleSequence}` };
    });
    runnerMock.cancelJob.mockResolvedValue(true);
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    initializeWorkflowRuntimeV2();
    ensureWorkflowRuntimeV2TestRegistrations();
  });

  it('T022/T024/T028: publishing a one-time scheduled workflow creates schedule state and registers scheduleJobAt', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'schedule',
        runAt: '2026-03-08T14:00:00.000Z'
      }),
      payloadSchemaMode: 'pinned',
      pinnedPayloadSchemaRef: TEST_SCHEMA_REF
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1
    });

    expect(publishResult.ok).toBe(true);
    expect(runnerMock.scheduleJobAt).toHaveBeenCalledTimes(1);
    expect(runnerMock.scheduleJobAt.mock.calls[0]?.[0]).toBe('workflow-time-trigger-once');
    expect(scheduleRecord).toMatchObject({
      workflow_id: createResult.workflowId,
      workflow_version: 1,
      trigger_type: 'schedule',
      run_at: '2026-03-08T14:00:00.000Z',
      enabled: true,
      status: 'scheduled',
      job_id: 'job-1',
      runner_schedule_id: 'runner-1'
    });
  });

  it('T023/T024/T029: publishing a recurring scheduled workflow creates schedule state and registers scheduleRecurringJob', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'recurring',
        cron: '15 9 * * 1-5',
        timezone: 'America/New_York'
      }),
      payloadSchemaMode: 'pinned',
      pinnedPayloadSchemaRef: TEST_SCHEMA_REF
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1
    });

    expect(publishResult.ok).toBe(true);
    expect(runnerMock.scheduleRecurringJob).toHaveBeenCalledTimes(1);
    expect(runnerMock.scheduleRecurringJob.mock.calls[0]?.[0]).toBe('workflow-time-trigger-recurring');
    expect(runnerMock.scheduleRecurringJob.mock.calls[0]?.[2]).toBe('15 9 * * 1-5');
    expect(runnerMock.scheduleRecurringJob.mock.calls[0]?.[3]?.metadata?.timezone).toBe('America/New_York');
    expect(scheduleRecord).toMatchObject({
      workflow_id: createResult.workflowId,
      workflow_version: 1,
      trigger_type: 'recurring',
      cron: '15 9 * * 1-5',
      timezone: 'America/New_York',
      enabled: true,
      status: 'scheduled',
      job_id: 'job-1',
      runner_schedule_id: 'runner-1'
    });
  });

  it('T030: pausing a published time-triggered workflow disables its registered schedule', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'schedule',
        runAt: '2026-03-08T14:00:00.000Z'
      }),
      payloadSchemaMode: 'pinned',
      pinnedPayloadSchemaRef: TEST_SCHEMA_REF
    });
    await publishWorkflowDefinitionAction({ workflowId: createResult.workflowId, version: 1 });

    await updateWorkflowDefinitionMetadataAction({
      workflowId: createResult.workflowId,
      isPaused: true
    });

    expect(runnerMock.cancelJob).toHaveBeenCalledWith('job-1', 'tenant-1');
    expect(scheduleRecord).toMatchObject({
      workflow_id: createResult.workflowId,
      enabled: false,
      status: 'paused',
      job_id: null,
      runner_schedule_id: null
    });
  });

  it('T031: deleting a published time-triggered workflow cancels its registered schedule', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'recurring',
        cron: '0 9 * * *',
        timezone: 'UTC'
      }),
      payloadSchemaMode: 'pinned',
      pinnedPayloadSchemaRef: TEST_SCHEMA_REF
    });
    await publishWorkflowDefinitionAction({ workflowId: createResult.workflowId, version: 1 });

    const result = await deleteWorkflowDefinitionAction({
      workflowId: createResult.workflowId
    });

    expect(result.success).toBe(true);
    expect(runnerMock.cancelJob).toHaveBeenCalledWith('job-1', 'tenant-1');
    expect(scheduleRecord).toBeNull();
  });

  it('T032: changing a published workflow from time trigger to event trigger removes the registered schedule', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'schedule',
        runAt: '2026-03-08T14:00:00.000Z'
      }),
      payloadSchemaMode: 'pinned',
      pinnedPayloadSchemaRef: TEST_SCHEMA_REF
    });
    await publishWorkflowDefinitionAction({ workflowId: createResult.workflowId, version: 1 });

    await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 2,
      definition: {
        ...buildDraftDefinition({
          type: 'event',
          eventName: 'TEST_EVENT',
          sourcePayloadSchemaRef: TEST_SCHEMA_REF
        }),
        id: createResult.workflowId,
        version: 2
      }
    });

    expect(runnerMock.cancelJob).toHaveBeenCalledWith('job-1', 'tenant-1');
    expect(scheduleRecord).toMatchObject({
      workflow_id: createResult.workflowId,
      enabled: false,
      status: 'disabled',
      job_id: null,
      runner_schedule_id: null
    });
  });

  it('T033: updating a published one-time trigger cancels the old registration and stores the replacement', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'schedule',
        runAt: '2026-03-08T14:00:00.000Z'
      }),
      payloadSchemaMode: 'pinned',
      pinnedPayloadSchemaRef: TEST_SCHEMA_REF
    });
    await publishWorkflowDefinitionAction({ workflowId: createResult.workflowId, version: 1 });

    await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 2,
      definition: {
        ...buildDraftDefinition({
          type: 'schedule',
          runAt: '2026-03-09T15:30:00.000Z'
        }),
        id: createResult.workflowId,
        version: 2
      }
    });

    expect(runnerMock.cancelJob).toHaveBeenCalledWith('job-1', 'tenant-1');
    expect(scheduleRecord).toMatchObject({
      workflow_id: createResult.workflowId,
      workflow_version: 2,
      trigger_type: 'schedule',
      run_at: '2026-03-09T15:30:00.000Z',
      job_id: 'job-2',
      runner_schedule_id: 'runner-2'
    });
  });

  it('T034: updating a published recurring trigger cancels the old registration and stores the replacement', async () => {
    const createResult = await createWorkflowDefinitionAction({
      definition: buildDraftDefinition({
        type: 'recurring',
        cron: '0 9 * * *',
        timezone: 'UTC'
      }),
      payloadSchemaMode: 'pinned',
      pinnedPayloadSchemaRef: TEST_SCHEMA_REF
    });
    await publishWorkflowDefinitionAction({ workflowId: createResult.workflowId, version: 1 });

    await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 2,
      definition: {
        ...buildDraftDefinition({
          type: 'recurring',
          cron: '30 14 * * 1-5',
          timezone: 'America/New_York'
        }),
        id: createResult.workflowId,
        version: 2
      }
    });

    expect(runnerMock.cancelJob).toHaveBeenCalledWith('job-1', 'tenant-1');
    expect(scheduleRecord).toMatchObject({
      workflow_id: createResult.workflowId,
      workflow_version: 2,
      trigger_type: 'recurring',
      cron: '30 14 * * 1-5',
      timezone: 'America/New_York',
      job_id: 'job-2',
      runner_schedule_id: 'runner-2'
    });
  });
});
