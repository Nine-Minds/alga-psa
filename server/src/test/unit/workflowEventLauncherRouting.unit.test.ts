import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildWorkflowDefinition,
  ensureWorkflowRuntimeV2TestRegistrations,
  stateSetStep,
  TEST_SCHEMA_REF
} from '../helpers/workflowRuntimeV2TestHelpers';
import { initializeWorkflowRuntimeV2 } from '@alga-psa/workflows/runtime';

const {
  launchPublishedWorkflowRun,
  signalWorkflowRuntimeV2Event,
  workflowEvents,
  workflowWaits,
  workflowRuns,
  knexMock
} = vi.hoisted(() => {
  const trxMock: Record<string, unknown> = {};
  const knexMock = {
    transaction: async (callback: (trx: unknown) => Promise<void>) => callback(trxMock)
  };

  return {
    launchPublishedWorkflowRun: vi.fn(),
    signalWorkflowRuntimeV2Event: vi.fn(),
    workflowEvents: {
      create: vi.fn(async (_trx: unknown, data: Record<string, unknown>) => ({
        event_id: 'event-1',
        ...data
      })),
      update: vi.fn(async () => undefined),
      list: vi.fn(),
      getById: vi.fn()
    },
    workflowWaits: {
      listEventWaitCandidates: vi.fn(async () => []),
      listByRun: vi.fn(),
      update: vi.fn()
    },
    workflowRuns: {
      getById: vi.fn(async () => null),
      update: vi.fn()
    },
    knexMock
  };
});

vi.mock('@alga-psa/analytics', () => ({
  analytics: {
    capture: vi.fn()
  }
}));

vi.mock('@alga-psa/auth', () => {
  const wrap = (fn: any) => (input: unknown) => fn(
    { user_id: 'user-1', user_type: 'internal', roles: [] },
    { tenant: 'tenant-1' },
    input
  );

  return {
    withAuth: wrap,
    withOptionalAuth: wrap,
    hasPermission: vi.fn(async () => true),
    preCheckDeletion: vi.fn(async () => ({ canDelete: true, dependencies: [], alternatives: [] })),
    getCurrentUser: vi.fn(async () => ({ user_id: 'user-1', user_type: 'internal', roles: [] }))
  };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock, tenant: 'tenant-1' })),
  auditLog: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowDefinitionModelV2: {
    list: vi.fn(async () => [
      {
        workflow_id: 'workflow-1',
        status: 'published',
        trigger: {
          type: 'event',
          eventName: 'PING',
          sourcePayloadSchemaRef: TEST_SCHEMA_REF
        },
        payload_schema_ref: TEST_SCHEMA_REF
      }
    ])
  },
  WorkflowDefinitionVersionModelV2: {
    listByWorkflow: vi.fn(async () => [
      {
        workflow_id: 'workflow-1',
        version: 3,
        definition_json: buildWorkflowDefinition({
          steps: [stateSetStep('state-1', 'READY')],
          payloadSchemaRef: TEST_SCHEMA_REF,
          trigger: {
            type: 'event',
            eventName: 'PING',
            sourcePayloadSchemaRef: TEST_SCHEMA_REF
          }
        })
      }
    ])
  },
  WorkflowRuntimeEventModelV2: workflowEvents,
  WorkflowRunWaitModelV2: workflowWaits,
  WorkflowRunModelV2: workflowRuns,
  WorkflowActionInvocationModelV2: {},
  WorkflowRunLogModelV2: {},
  WorkflowRunSnapshotModelV2: {},
  WorkflowRunStepModelV2: {}
}));

vi.mock('@alga-psa/workflows/models/eventCatalog', () => ({
  EventCatalogModel: {
    getByEventType: vi.fn(async () => null)
  }
}));

vi.mock('@alga-psa/workflows/lib/workflowRunLauncher', () => ({
  launchPublishedWorkflowRun: (...args: unknown[]) => launchPublishedWorkflowRun(...args)
}));

vi.mock('@alga-psa/workflows/lib/workflowRuntimeV2Temporal', () => ({
  signalWorkflowRuntimeV2Event: (...args: unknown[]) => signalWorkflowRuntimeV2Event(...args),
  signalWorkflowRuntimeV2HumanTask: vi.fn(),
  cancelWorkflowRuntimeV2TemporalRun: vi.fn()
}));

vi.mock('@alga-psa/workflows/lib/workflowScheduleLifecycle', () => ({
  buildDesiredWorkflowSchedule: vi.fn(),
  deleteWorkflowScheduleState: vi.fn(),
  syncWorkflowScheduleState: vi.fn()
}));

import { submitWorkflowEventAction } from '@alga-psa/workflows/actions-psa/workflows-runtime-v2-actions';

describe('Workflow event launcher routing', () => {
  beforeEach(() => {
    initializeWorkflowRuntimeV2();
    ensureWorkflowRuntimeV2TestRegistrations();
    launchPublishedWorkflowRun.mockReset();
    launchPublishedWorkflowRun.mockResolvedValue({ runId: 'run-1', workflowVersion: 3 });
    signalWorkflowRuntimeV2Event.mockReset();
    signalWorkflowRuntimeV2Event.mockResolvedValue(undefined);
    workflowEvents.create.mockClear();
    workflowEvents.update.mockClear();
    workflowWaits.listEventWaitCandidates.mockClear();
    workflowRuns.getById.mockClear();
  });

  it('T025: event-triggered workflow starts flow through the shared launcher', async () => {
    const result = await submitWorkflowEventAction({
      eventName: 'PING',
      correlationKey: 'corr-1',
      payload: { foo: 'bar' },
      payloadSchemaRef: TEST_SCHEMA_REF
    });

    expect(result.startedRuns).toEqual(['run-1']);
    expect(workflowEvents.create).toHaveBeenCalledTimes(1);
    expect(workflowWaits.listEventWaitCandidates).toHaveBeenCalledTimes(1);
    expect(launchPublishedWorkflowRun).toHaveBeenCalledTimes(1);
    expect(workflowEvents.update).toHaveBeenCalledWith(
      knexMock,
      'event-1',
      expect.objectContaining({
        matched_run_id: 'run-1'
      })
    );
    expect(launchPublishedWorkflowRun).toHaveBeenCalledWith(
      knexMock,
      expect.objectContaining({
        workflowId: 'workflow-1',
        workflowVersion: 3,
        tenantId: 'tenant-1',
        triggerType: 'event',
        triggerMetadata: {
          eventType: 'PING',
          sourcePayloadSchemaRef: TEST_SCHEMA_REF,
          triggerMappingApplied: false
        },
        eventType: 'PING',
        sourcePayloadSchemaRef: TEST_SCHEMA_REF,
        triggerMappingApplied: false,
        execute: true
      })
    );
  });

  it('does not mark a wait-matched run until the Temporal signal succeeds', async () => {
    workflowWaits.listEventWaitCandidates.mockResolvedValueOnce([
      { run_id: 'run-wait-1', wait_type: 'event', payload: null }
    ]);
    workflowRuns.getById.mockResolvedValueOnce({ run_id: 'run-wait-1', engine: 'temporal' });
    signalWorkflowRuntimeV2Event.mockRejectedValueOnce(new Error('signal failed'));

    await expect(submitWorkflowEventAction({
      eventName: 'PING',
      correlationKey: 'corr-wait',
      payload: { foo: 'bar' },
      payloadSchemaRef: TEST_SCHEMA_REF
    })).rejects.toMatchObject({
      status: 500,
      details: expect.objectContaining({ error: expect.stringContaining('signal failed') })
    });

    expect(workflowEvents.update).not.toHaveBeenCalledWith(
      knexMock,
      'event-1',
      expect.objectContaining({ matched_run_id: 'run-wait-1' })
    );
    expect(workflowEvents.update).toHaveBeenCalledWith(
      knexMock,
      'event-1',
      expect.objectContaining({ error_message: expect.stringContaining('signal failed') })
    );
  });

  it('persists a post-ingestion launcher failure onto the event row before surfacing the error', async () => {
    launchPublishedWorkflowRun.mockRejectedValueOnce(new Error('temporal unavailable'));

    await expect(submitWorkflowEventAction({
      eventName: 'PING',
      correlationKey: 'corr-2',
      payload: { foo: 'bar' },
      payloadSchemaRef: TEST_SCHEMA_REF
    })).rejects.toMatchObject({
      status: 500,
      details: expect.objectContaining({ error: expect.stringContaining('temporal unavailable') })
    });

    expect(workflowEvents.update).toHaveBeenCalledWith(
      knexMock,
      'event-1',
      expect.objectContaining({
        error_message: expect.stringContaining('temporal unavailable')
      })
    );
  });
});
