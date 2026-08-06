import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF } from '@alga-psa/workflows/runtime';
import { workflowClockTriggerPayloadSchema } from '@alga-psa/workflows/runtime/core';

type ScheduleRow = Record<string, any>;

const scheduleState = new Map<string, ScheduleRow>();
const versionsByNumber = new Map<number, Record<string, any>>();
const workflowById = new Map<string, Record<string, any>>();

const runner = {
  scheduleJobAt: vi.fn(async () => ({ jobId: uuidv4(), externalId: `one-${uuidv4()}` })),
  scheduleRecurringJob: vi.fn(async () => ({ jobId: uuidv4(), externalId: `rec-${uuidv4()}` })),
  cancelJob: vi.fn(async () => true),
  getJobStatus: vi.fn(async () => ({ status: 'cancelled' }))
};

vi.mock('@alga-psa/workflows/persistence', async () => {
  const { WorkflowScheduleStateModel } = await vi.importActual<typeof import('@alga-psa/workflows/persistence')>(
    '@alga-psa/workflows/persistence'
  );
  return {
    ...(await vi.importActual<typeof import('@alga-psa/workflows/persistence')>(
      '@alga-psa/workflows/persistence'
    )),
    WorkflowScheduleStateModel: {
      ...WorkflowScheduleStateModel,
      getByWorkflowId: vi.fn(async (_knex: unknown, workflowId: string) =>
        Array.from(scheduleState.values()).find((row) => row.workflow_id === workflowId) ?? null),
      create: vi.fn(async (_knex: unknown, data: ScheduleRow) => {
        const record: ScheduleRow = {
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...data
        };
        scheduleState.set(String(record.id), record);
        return record;
      })
    },
    WorkflowDefinitionVersionModelV2: {
      getByWorkflowAndVersion: vi.fn(async (_knex: unknown, _workflowId: string, version: number) =>
        versionsByNumber.get(Number(version)) ?? null)
    },
    WorkflowDefinitionModelV2: {
      getById: vi.fn(async (_knex: unknown, _tenant: string, workflowId: string) =>
        workflowById.get(workflowId) ?? null)
    }
  };
});

import { WorkflowDefinitionVersionModelV2, WorkflowScheduleStateModel } from '@alga-psa/workflows/persistence';
import { registerWorkflowScheduleJobRunner, resetWorkflowScheduleJobRunner } from '@alga-psa/workflows/lib/jobRunnerProvider';
import { syncWorkflowScheduleState } from '@alga-psa/workflows/lib/workflowScheduleLifecycle';

const knex = {} as any;

describe('workflowScheduleLifecycle inline schedule creation', () => {
  beforeEach(() => {
    scheduleState.clear();
    versionsByNumber.clear();
    workflowById.clear();
    registerWorkflowScheduleJobRunner(async () => runner);
  });

  afterEach(() => {
    resetWorkflowScheduleJobRunner();
    vi.restoreAllMocks();
  });

  it('creates a schedule holding a strict-valid clock payload for a clock-pinned time-triggered workflow', async () => {
    const workflowId = uuidv4();
    versionsByNumber.set(3, {
      version: 3,
      definition_json: { id: workflowId, version: 3, payloadSchemaRef: WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF }
    });

    const schedule = await syncWorkflowScheduleState(knex, {
      tenantId: 'tenant-1',
      workflowId,
      desired: {
        triggerType: 'recurring',
        workflowVersion: 3,
        dayTypeFilter: 'any',
        cron: '0 6 * * *',
        timezone: 'UTC',
        enabled: true,
        status: 'scheduled'
      }
    });

    expect(schedule).not.toBeNull();
    expect(schedule?.payload_json).not.toBeNull();
    expect(schedule?.payload_json).toMatchObject({
      triggerType: 'recurring',
      workflowId,
      workflowVersion: 3,
      timezone: 'UTC',
      cron: '0 6 * * *'
    });
    expect((schedule?.payload_json as Record<string, unknown>)?.scheduleName).toBeUndefined();
    expect(workflowClockTriggerPayloadSchema.safeParse(schedule?.payload_json).success).toBe(true);
  });

  it('keeps the legacy `{}` payload for non-clock time-triggered workflows', async () => {
    const workflowId = uuidv4();
    versionsByNumber.set(1, {
      version: 1,
      definition_json: { id: workflowId, version: 1, payloadSchemaRef: 'payload.OpportunityStalled.v1' }
    });

    const schedule = await syncWorkflowScheduleState(knex, {
      tenantId: 'tenant-1',
      workflowId,
      desired: {
        triggerType: 'schedule',
        workflowVersion: 1,
        dayTypeFilter: 'any',
        runAt: '2099-01-01T10:00:00.000Z',
        enabled: true,
        status: 'scheduled'
      }
    });

    expect(schedule?.payload_json).toEqual({});
  });

  it('falls back to the workflow payload_schema_ref when the version lacks a def ref', async () => {
    const workflowId = uuidv4();
    // Version has no definition_json.payloadSchemaRef; only the workflow row does.
    versionsByNumber.set(2, { version: 2, definition_json: { id: workflowId, version: 2 } });
    workflowById.set(workflowId, { workflow_id: workflowId, payload_schema_ref: WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF });

    const schedule = await syncWorkflowScheduleState(knex, {
      tenantId: 'tenant-1',
      workflowId,
      desired: {
        triggerType: 'recurring',
        workflowVersion: 2,
        dayTypeFilter: 'any',
        cron: '0 6 * * *',
        timezone: 'UTC',
        enabled: true,
        status: 'scheduled'
      }
    });

    expect(schedule?.payload_json).toMatchObject({
      triggerType: 'recurring',
      workflowId,
      workflowVersion: 2,
      timezone: 'UTC',
      cron: '0 6 * * *'
    });
    expect(workflowClockTriggerPayloadSchema.safeParse(schedule?.payload_json).success).toBe(true);
  });

  it('leaves no provider job registered when payload schema resolution fails before scheduling', async () => {
    const workflowId = uuidv4();
    runner.scheduleRecurringJob.mockClear();
    runner.scheduleJobAt.mockClear();
    vi.mocked(WorkflowScheduleStateModel.create).mockClear();
    vi.mocked(WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion).mockRejectedValueOnce(
      new Error('version lookup failed')
    );

    await expect(
      syncWorkflowScheduleState(knex, {
        tenantId: 'tenant-1',
        workflowId,
        desired: {
          triggerType: 'recurring',
          workflowVersion: 5,
          dayTypeFilter: 'any',
          cron: '0 6 * * *',
          timezone: 'UTC',
          enabled: true,
          status: 'scheduled'
        }
      })
    ).rejects.toThrow('version lookup failed');

    // Resolution runs before provider registration, so a resolver failure must
    // not orphan an external job or persist any schedule state.
    expect(runner.scheduleRecurringJob).not.toHaveBeenCalled();
    expect(runner.scheduleJobAt).not.toHaveBeenCalled();
    expect(WorkflowScheduleStateModel.create).not.toHaveBeenCalled();
    expect(scheduleState.size).toBe(0);
  });
});