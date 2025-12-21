import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { z } from 'zod';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { resetWorkflowRuntimeTables } from '../helpers/workflowRuntimeV2TestUtils';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import {
  createWorkflowDefinitionAction,
  publishWorkflowDefinitionAction,
  submitWorkflowEventAction
} from 'server/src/lib/actions/workflow-runtime-v2-actions';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';
import WorkflowRuntimeEventModelV2 from '@shared/workflow/persistence/workflowRuntimeEventModelV2';
import { getSchemaRegistry } from '@shared/workflow/runtime';
import {
  ensureWorkflowRuntimeV2TestRegistrations,
  buildWorkflowDefinition,
  stateSetStep,
  TEST_SCHEMA_REF
} from '../helpers/workflowRuntimeV2TestHelpers';

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn()
}));

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn()
}));

const mockedCreateTenantKnex = vi.mocked(createTenantKnex);
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
});

beforeEach(async () => {
  await resetWorkflowRuntimeTables(db);
  tenantId = uuidv4();
  userId = uuidv4();
  mockedCreateTenantKnex.mockResolvedValue({ knex: db, tenant: tenantId });
  mockedGetCurrentUser.mockResolvedValue({ user_id: userId, roles: [] } as any);
});

afterAll(async () => {
  await db.destroy();
});

describe('workflow runtime v2 event trigger integration tests', () => {
  it('Event trigger starts a run for workflows with matching trigger name. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      trigger: { type: 'event', eventName: 'PING' }
    });
    await publishWorkflow(workflowId, 1);

    const result = await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'k1', payload: { foo: 'bar' } });
    expect(result.startedRuns.length).toBe(1);

    const run = await WorkflowRunModelV2.getById(db, result.startedRuns[0]);
    expect(run?.workflow_id).toBe(workflowId);
    expect(run?.status).toBe('SUCCEEDED');
  });

  it('Event trigger starts runs for all published workflows sharing the trigger. Mocks: non-target dependencies.', async () => {
    const workflowA = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      trigger: { type: 'event', eventName: 'ALERT' }
    });
    const workflowB = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      trigger: { type: 'event', eventName: 'ALERT' }
    });
    await publishWorkflow(workflowA, 1);
    await publishWorkflow(workflowB, 1);

    const result = await submitWorkflowEventAction({ eventName: 'ALERT', correlationKey: 'k2', payload: { foo: 'bar' } });
    expect(result.startedRuns.length).toBe(2);

    const runs = await db('workflow_runs').whereIn('run_id', result.startedRuns);
    const workflowIds = runs.map((row: any) => row.workflow_id);
    expect(workflowIds).toContain(workflowA);
    expect(workflowIds).toContain(workflowB);
  });

  it('Event trigger uses latest published version when no version specified. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      trigger: { type: 'event', eventName: 'LATEST' }
    });
    await publishWorkflow(workflowId, 1);
    await publishWorkflow(workflowId, 2, {
      id: workflowId,
      version: 2,
      name: 'v2',
      payloadSchemaRef: TEST_SCHEMA_REF,
      trigger: { type: 'event', eventName: 'LATEST' },
      steps: [stateSetStep('state-2', 'READY')]
    });

    const result = await submitWorkflowEventAction({ eventName: 'LATEST', correlationKey: 'k3', payload: { foo: 'bar' } });
    const run = await WorkflowRunModelV2.getById(db, result.startedRuns[0]);
    expect(run?.workflow_version).toBe(2);
  });

  it('Event trigger validates event payload against workflow payload schema. Mocks: non-target dependencies.', async () => {
    const registry = getSchemaRegistry();
    const strictRef = `payload.StrictTrigger.${Date.now()}`;
    registry.register(strictRef, z.object({ foo: z.string() }));

    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      payloadSchemaRef: strictRef,
      trigger: { type: 'event', eventName: 'STRICT' }
    });
    await publishWorkflow(workflowId, 1);

    const result = await submitWorkflowEventAction({ eventName: 'STRICT', correlationKey: 'k4', payload: { bar: 123 } });
    expect(result.startedRuns.length).toBe(0);

    const runs = await db('workflow_runs').where({ workflow_id: workflowId });
    expect(runs.length).toBe(0);
  });

  it('Event trigger skips workflows that are draft-only or unpublished. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      trigger: { type: 'event', eventName: 'DRAFT' }
    });

    const result = await submitWorkflowEventAction({ eventName: 'DRAFT', correlationKey: 'k5', payload: { foo: 'bar' } });
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
