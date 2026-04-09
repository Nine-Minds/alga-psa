import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { z } from 'zod';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  ensureWorkflowScheduleStateTable,
  resetWorkflowRuntimeTables
} from '../helpers/workflowRuntimeV2TestUtils';
import { createTenantKnex, getCurrentTenantId } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth';
import {
  createWorkflowDefinitionAction,
  publishWorkflowDefinitionAction,
  submitWorkflowEventAction
} from '@alga-psa/workflows/actions';
import WorkflowRunModelV2 from '@alga-psa/workflows/persistence/workflowRunModelV2';
import WorkflowRuntimeEventModelV2 from '@alga-psa/workflows/persistence/workflowRuntimeEventModelV2';
import { getSchemaRegistry } from '@alga-psa/workflows/runtime';
import {
  ensureWorkflowRuntimeV2TestRegistrations,
  buildWorkflowDefinition,
  stateSetStep,
  TEST_SCHEMA_REF
} from '../helpers/workflowRuntimeV2TestHelpers';

const {
  startWorkflowRuntimeV2TemporalRunMock
} = vi.hoisted(() => ({
  startWorkflowRuntimeV2TemporalRunMock: vi.fn()
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(),
    getCurrentTenantId: vi.fn(),
    auditLog: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (user: any, ctx: { tenant: string }, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(
      {
        user_id: userId,
        tenant: tenantId,
        roles: []
      },
      { tenant: tenantId },
      ...args
    ),
  withOptionalAuth: (action: (user: any, ctx: { tenant: string }, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(
      {
        user_id: userId,
        tenant: tenantId,
        roles: []
      },
      { tenant: tenantId },
      ...args
    ),
  withAuthCheck: (action: (user: any, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(
      {
        user_id: userId,
        tenant: tenantId,
        roles: []
      },
      ...args
    ),
  AuthenticationError: class AuthenticationError extends Error {},
  hasPermission: vi.fn().mockResolvedValue(true),
  checkMultiplePermissions: vi.fn().mockResolvedValue(true),
  getCurrentUser: vi.fn(),
  preCheckDeletion: vi.fn()
}));

vi.mock('@alga-psa/workflows/lib/workflowRuntimeV2Temporal', () => ({
  startWorkflowRuntimeV2TemporalRun: (...args: unknown[]) => startWorkflowRuntimeV2TemporalRunMock(...args)
}));

const mockedCreateTenantKnex = vi.mocked(createTenantKnex);
const mockedGetCurrentTenantId = vi.mocked(getCurrentTenantId);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);

let db: Knex;
let tenantId: string;
let userId: string;

async function createDraftWorkflow(params: { steps: any[]; payloadSchemaRef?: string; trigger?: any; name?: string }) {
  const definition = {
    id: uuidv4(),
    ...buildWorkflowDefinition({
      steps: params.steps,
      payloadSchemaRef: params.payloadSchemaRef,
      trigger: params.trigger,
      name: params.name
    })
  };
  const result = await createWorkflowDefinitionAction({ definition });
  return result.workflowId;
}

async function publishWorkflow(workflowId: string, version: number, definition?: any) {
  return publishWorkflowDefinitionAction({ workflowId, version, definition });
}

beforeAll(async () => {
  ensureWorkflowRuntimeV2TestRegistrations();
  db = await createTestDbConnection();
  await ensureWorkflowScheduleStateTable(db);
});

beforeEach(async () => {
  await ensureWorkflowScheduleStateTable(db);
  await resetWorkflowRuntimeTables(db);
  tenantId = uuidv4();
  userId = uuidv4();
  mockedCreateTenantKnex.mockImplementation(async () => ({ knex: db, tenant: tenantId }));
  mockedGetCurrentTenantId.mockImplementation(() => tenantId);
  mockedGetCurrentUser.mockResolvedValue({ user_id: userId, roles: [] } as any);
  startWorkflowRuntimeV2TemporalRunMock.mockReset();
  startWorkflowRuntimeV2TemporalRunMock.mockResolvedValue({
    workflowId: 'workflow-runtime-v2:run:run-replayed',
    firstExecutionRunId: 'temporal-run-replayed'
  });
});

afterAll(async () => {
  await db.destroy();
});

describe('workflow runtime v2 event trigger integration tests', () => {
  it('Event trigger starts a run for workflows with matching trigger name. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      trigger: { type: 'event', eventName: 'PING', sourcePayloadSchemaRef: TEST_SCHEMA_REF }
    });
    await publishWorkflow(workflowId, 1);

    const result = await submitWorkflowEventAction({
      eventName: 'PING',
      correlationKey: 'k1',
      payload: { foo: 'bar' },
      payloadSchemaRef: TEST_SCHEMA_REF
    });
    expect(result.startedRuns.length).toBe(1);

    const run = await WorkflowRunModelV2.getById(db, result.startedRuns[0]);
    expect(run?.workflow_id).toBe(workflowId);
    expect(run?.status).toBe('RUNNING');
    expect(run?.engine).toBe('temporal');
    expect(run?.temporal_workflow_id).toBe('workflow-runtime-v2:run:run-replayed');
    expect(run?.temporal_run_id).toBe('temporal-run-replayed');
  });

  it('Event trigger starts runs for all published workflows sharing the trigger. Mocks: non-target dependencies.', async () => {
    const workflowA = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      trigger: { type: 'event', eventName: 'ALERT', sourcePayloadSchemaRef: TEST_SCHEMA_REF }
    });
    const workflowB = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      trigger: { type: 'event', eventName: 'ALERT', sourcePayloadSchemaRef: TEST_SCHEMA_REF }
    });
    await publishWorkflow(workflowA, 1);
    await publishWorkflow(workflowB, 1);

    const result = await submitWorkflowEventAction({
      eventName: 'ALERT',
      correlationKey: 'k2',
      payload: { foo: 'bar' },
      payloadSchemaRef: TEST_SCHEMA_REF
    });
    expect(result.startedRuns.length).toBe(2);

    const runs = await db('workflow_runs').whereIn('run_id', result.startedRuns);
    const workflowIds = runs.map((row: any) => row.workflow_id);
    expect(workflowIds).toContain(workflowA);
    expect(workflowIds).toContain(workflowB);
  });

  it('Event trigger uses latest published version when no version specified. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      trigger: { type: 'event', eventName: 'LATEST', sourcePayloadSchemaRef: TEST_SCHEMA_REF }
    });
    await publishWorkflow(workflowId, 1);
    await publishWorkflow(workflowId, 2, {
      id: workflowId,
      version: 2,
      name: 'v2',
      payloadSchemaRef: TEST_SCHEMA_REF,
      trigger: { type: 'event', eventName: 'LATEST', sourcePayloadSchemaRef: TEST_SCHEMA_REF },
      steps: [stateSetStep('state-2', 'READY')]
    });

    const result = await submitWorkflowEventAction({
      eventName: 'LATEST',
      correlationKey: 'k3',
      payload: { foo: 'bar' },
      payloadSchemaRef: TEST_SCHEMA_REF
    });
    const run = await WorkflowRunModelV2.getById(db, result.startedRuns[0]);
    expect(run?.workflow_version).toBe(2);
  });

  it('T046: event-triggered workflows still publish and start correctly after launcher extraction. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      trigger: { type: 'event', eventName: 'REGRESSION', sourcePayloadSchemaRef: TEST_SCHEMA_REF }
    });

    const publishResult = await publishWorkflow(workflowId, 1);
    expect(publishResult.ok).toBe(true);

    const result = await submitWorkflowEventAction({
      eventName: 'REGRESSION',
      correlationKey: 'regression-key',
      payload: { foo: 'bar' },
      payloadSchemaRef: TEST_SCHEMA_REF
    });

    expect(result.startedRuns.length).toBe(1);

    const run = await WorkflowRunModelV2.getById(db, result.startedRuns[0]);
    expect(run?.workflow_id).toBe(workflowId);
    expect(run?.workflow_version).toBe(1);
    expect(run?.status).toBe('RUNNING');
    expect(run?.engine).toBe('temporal');
    expect(run?.trigger_type).toBe('event');
    expect(run?.trigger_metadata_json).toMatchObject({
      eventType: 'REGRESSION',
      sourcePayloadSchemaRef: TEST_SCHEMA_REF,
      triggerMappingApplied: false
    });
  });

  it('Event trigger validates event payload against workflow payload schema. Mocks: non-target dependencies.', async () => {
    const registry = getSchemaRegistry();
    const strictRef = `payload.StrictTrigger.${Date.now()}`;
    registry.register(strictRef, z.object({ foo: z.string() }));

    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      payloadSchemaRef: strictRef,
      trigger: { type: 'event', eventName: 'STRICT', sourcePayloadSchemaRef: strictRef }
    });
    await publishWorkflow(workflowId, 1);

    const result = await submitWorkflowEventAction({
      eventName: 'STRICT',
      correlationKey: 'k4',
      payload: { bar: 123 },
      payloadSchemaRef: strictRef
    });
    expect(result.status).toBe('no_wait');
    expect(result.startedRuns).toHaveLength(0);

    const runs = await db('workflow_runs').where({ workflow_id: workflowId });
    expect(runs.length).toBe(0);
  });

  it('Event trigger skips workflows that are draft-only or unpublished. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      trigger: { type: 'event', eventName: 'DRAFT' }
    });

    const result = await submitWorkflowEventAction({
      eventName: 'DRAFT',
      correlationKey: 'k5',
      payload: { foo: 'bar' },
      payloadSchemaRef: TEST_SCHEMA_REF
    });
    expect(result.startedRuns.length).toBe(0);

    const runs = await db('workflow_runs').where({ workflow_id: workflowId });
    expect(runs.length).toBe(0);
  });

  it('Event trigger records workflow_runtime_event with correlation metadata. Mocks: non-target dependencies.', async () => {
    await submitWorkflowEventAction({ eventName: 'AUDIT', correlationKey: 'audit-key', payload: { foo: 'bar' } });
    const events = await WorkflowRuntimeEventModelV2.list(db);
    expect(events.some((event) => event.event_name === 'AUDIT' && event.correlation_key === 'audit-key')).toBe(true);
  });
});
