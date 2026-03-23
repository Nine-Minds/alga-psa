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
  workflowEvents,
  workflowWaits,
  knexMock
} = vi.hoisted(() => ({
  launchPublishedWorkflowRun: vi.fn(),
  workflowEvents: {
    create: vi.fn(async (_trx: unknown, data: Record<string, unknown>) => ({
      event_id: 'event-1',
      ...data
    })),
    update: vi.fn(async () => undefined)
  },
  workflowWaits: {
    findEventWait: vi.fn(async () => null)
  },
  knexMock: {
    transaction: async (callback: (trx: unknown) => Promise<void>) => callback({})
  }
}));

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

vi.mock('@alga-psa/workflows/persistence/workflowDefinitionModelV2', () => ({
  default: {
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
  }
}));

vi.mock('@alga-psa/workflows/persistence/workflowDefinitionVersionModelV2', () => ({
  default: {
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
  }
}));

vi.mock('@alga-psa/workflows/persistence/workflowRuntimeEventModelV2', () => ({
  default: workflowEvents
}));

vi.mock('@alga-psa/workflows/persistence/workflowRunWaitModelV2', () => ({
  default: workflowWaits
}));

vi.mock('@alga-psa/workflows/models/eventCatalog', () => ({
  EventCatalogModel: {
    getByEventType: vi.fn(async () => null)
  }
}));

vi.mock('@alga-psa/workflows/lib/workflowRunLauncher', () => ({
  launchPublishedWorkflowRun: (...args: unknown[]) => launchPublishedWorkflowRun(...args)
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
    workflowEvents.create.mockClear();
    workflowEvents.update.mockClear();
    workflowWaits.findEventWait.mockClear();
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
    expect(workflowWaits.findEventWait).toHaveBeenCalledTimes(1);
    expect(launchPublishedWorkflowRun).toHaveBeenCalledTimes(1);
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
});
