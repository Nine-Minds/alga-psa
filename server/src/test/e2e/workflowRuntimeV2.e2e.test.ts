import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
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
import {
  ensureWorkflowRuntimeV2TestRegistrations,
  buildWorkflowDefinition,
  TEST_SCHEMA_REF,
  TEST_SOURCE_SCHEMA_REF,
  TEST_REQUIRED_SCHEMA_REF,
  stateSetStep,
  timeWaitStep
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

vi.mock('@alga-psa/auth', () => {
  const withAuth = (action: (user: any, ctx: { tenant: string }, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(
      {
        user_id: userId,
        tenant: tenantId,
        roles: []
      },
      { tenant: tenantId },
      ...args
    );
  const withOptionalAuth = (action: (user: any, ctx: { tenant: string }, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(
      {
        user_id: userId,
        tenant: tenantId,
        roles: []
      },
      { tenant: tenantId },
      ...args
    );
  const withAuthCheck = (action: (user: any, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(
      {
        user_id: userId,
        tenant: tenantId,
        roles: []
      },
      ...args
    );

  return {
    withAuth,
    withOptionalAuth,
    withAuthCheck,
    AuthenticationError: class AuthenticationError extends Error {},
    hasPermission: vi.fn().mockResolvedValue(true),
    checkMultiplePermissions: vi.fn().mockResolvedValue(true),
    getCurrentUser: vi.fn(),
    preCheckDeletion: vi.fn()
  };
});

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
  mockedCreateTenantKnex.mockResolvedValue({ knex: db, tenant: tenantId });
  mockedGetCurrentTenantId.mockReturnValue(tenantId);
  mockedGetCurrentUser.mockResolvedValue({ user_id: userId, tenant: tenantId, roles: [] } as any);
  startWorkflowRuntimeV2TemporalRunMock.mockReset();
  startWorkflowRuntimeV2TemporalRunMock.mockResolvedValue({
    workflowId: 'workflow-runtime-v2:run:run-e2e',
    firstExecutionRunId: 'temporal-run-e2e'
  });
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Workflow E2E ${tenantId}`,
    email: `workflow-e2e+${tenantId}@example.com`,
    created_at: new Date(),
    updated_at: new Date()
  });
});

afterAll(async () => {
  await db.destroy();
});

describe('workflow runtime v2 trigger validation + launch E2E tests', () => {
  it('Validation: schemaRef mismatch requires trigger mapping (publish blocked).', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      payloadSchemaRef: TEST_SCHEMA_REF,
      trigger: { type: 'event', eventName: 'PING_MISMATCH', sourcePayloadSchemaRef: TEST_SOURCE_SCHEMA_REF }
    });

    const publish = await publishWorkflow(workflowId, 1);
    expect((publish as any)?.ok).toBe(false);
    expect(((publish as any)?.errors ?? []).some((e: any) => e.code === 'TRIGGER_MAPPING_REQUIRED')).toBe(true);
  });

  it('Validation: trigger mapping expressions must use event.payload (payload.* is rejected).', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      payloadSchemaRef: TEST_SCHEMA_REF,
      trigger: {
        type: 'event',
        eventName: 'PING_BAD_ROOT',
        sourcePayloadSchemaRef: TEST_SCHEMA_REF,
        payloadMapping: { foo: { $expr: 'payload.foo' } }
      }
    });

    const publish = await publishWorkflow(workflowId, 1);
    expect((publish as any)?.ok).toBe(false);
    expect(((publish as any)?.errors ?? []).some((e: any) => e.code === 'TRIGGER_MAPPING_INVALID_ROOT')).toBe(true);
  });

  it('Validation: trigger mapping must provide required payload fields (deep required validation).', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      payloadSchemaRef: TEST_REQUIRED_SCHEMA_REF,
      trigger: {
        type: 'event',
        eventName: 'PING_REQUIRED',
        sourcePayloadSchemaRef: TEST_SOURCE_SCHEMA_REF,
        payloadMapping: { bar: { $expr: 'event.payload.bar' } }
      }
    });

    const publish = await publishWorkflow(workflowId, 1);
    expect((publish as any)?.ok).toBe(false);
    expect(((publish as any)?.errors ?? []).some((e: any) => e.code === 'TRIGGER_MAPPING_MISSING_REQUIRED_FIELDS')).toBe(true);
  });

  it('Validation: time.wait until mode rejects malformed config at publish time and accepts a valid until expression.', async () => {
    const invalidWorkflowId = await createDraftWorkflow({
      steps: [timeWaitStep('wait-1', { mode: 'until' })]
    });
    const invalidPublish = await publishWorkflow(invalidWorkflowId, 1);
    expect((invalidPublish as any)?.ok).toBe(false);
    expect(((invalidPublish as any)?.errors ?? []).some((err: any) => err.code === 'INVALID_CONFIG')).toBe(true);

    const workflowId = await createDraftWorkflow({
      steps: [timeWaitStep('wait-1', { mode: 'until', untilExpr: { $expr: '"2099-01-01T00:00:00.000Z"' } }), stateSetStep('state-1', 'DONE')]
    });
    const publish = await publishWorkflow(workflowId, 1);
    expect((publish as any)?.ok).toBe(true);
  });

  it('Runtime: when trigger mapping exists, event payload is mapped into workflow payload and provenance is persisted on the launched Temporal run.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      payloadSchemaRef: TEST_SCHEMA_REF,
      trigger: {
        type: 'event',
        eventName: 'PING_MAP',
        sourcePayloadSchemaRef: TEST_SOURCE_SCHEMA_REF,
        payloadMapping: { foo: { $expr: 'event.payload.foo' } }
      }
    });
    const publish = await publishWorkflow(workflowId, 1);
    expect((publish as any)?.ok).toBe(true);

    const result = await submitWorkflowEventAction({
      eventName: 'PING_MAP',
      correlationKey: 'k-map',
      payload: { foo: 'hello' },
      payloadSchemaRef: TEST_SOURCE_SCHEMA_REF
    });

    const runId = result.startedRuns[0];
    const run = await WorkflowRunModelV2.getById(db, runId);
    expect((run as any)?.input_json?.foo).toBe('hello');
    expect((run as any)?.source_payload_schema_ref).toBe(TEST_SOURCE_SCHEMA_REF);
    expect((run as any)?.trigger_mapping_applied).toBe(true);
    expect(run?.engine).toBe('temporal');
    expect(run?.status).toBe('RUNNING');
    expect(startWorkflowRuntimeV2TemporalRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId, workflowId })
    );
  });

  it('Ingestion: submission payloadSchemaRef takes precedence over catalog, with conflict persisted as warning data.', async () => {
    await db('event_catalog').insert({
      event_id: uuidv4(),
      event_type: 'PING_CONFLICT',
      name: 'Ping Conflict',
      description: 'test',
      category: 'Test',
      payload_schema: {},
      payload_schema_ref: TEST_SOURCE_SCHEMA_REF,
      tenant: tenantId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await submitWorkflowEventAction({
      eventName: 'PING_CONFLICT',
      correlationKey: 'k-conflict',
      payload: { foo: 'bar' },
      payloadSchemaRef: TEST_SCHEMA_REF
    });

    const row = await db('workflow_runtime_events')
      .where({ tenant: tenantId, event_name: 'PING_CONFLICT', correlation_key: 'k-conflict' })
      .first();

    expect(row?.payload_schema_ref).toBe(TEST_SCHEMA_REF);
    expect(row?.schema_ref_conflict).toEqual({ submission: TEST_SCHEMA_REF, catalog: TEST_SOURCE_SCHEMA_REF });
  });
});
