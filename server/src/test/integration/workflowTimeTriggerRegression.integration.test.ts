import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  ensureWorkflowScheduleStateTable,
  resetWorkflowRuntimeTables
} from '../helpers/workflowRuntimeV2TestUtils';
import { createTenantKnex } from '@alga-psa/db';
import {
  createWorkflowDefinitionAction,
  publishWorkflowDefinitionAction,
  startWorkflowRunAction,
  submitWorkflowEventAction
} from '@alga-psa/workflows/actions';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';
import {
  buildWorkflowDefinition,
  ensureWorkflowRuntimeV2TestRegistrations,
  stateSetStep,
  TEST_SCHEMA_REF
} from '../helpers/workflowRuntimeV2TestHelpers';

type AuthedAction = (
  user: { user_id: string; user_type: string; roles: string[] },
  ctx: { tenant: string },
  input: unknown
) => unknown;

const runnerMock = {
  scheduleJobAt: vi.fn(),
  scheduleRecurringJob: vi.fn(),
  cancelJob: vi.fn()
};
const TEST_TENANT_ID = '22222222-2222-4222-8222-222222222222';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  auditLog: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@alga-psa/auth', () => {
  const user = {
    user_id: '11111111-1111-4111-8111-111111111111',
    user_type: 'internal',
    roles: []
  };
  const wrap = (fn: AuthedAction) => (input: unknown) =>
    fn(user, { tenant: '22222222-2222-4222-8222-222222222222' }, input);
  return {
    withAuth: wrap,
    withOptionalAuth: wrap,
    hasPermission: vi.fn().mockResolvedValue(true),
    getCurrentUser: vi.fn().mockResolvedValue(user),
    preCheckDeletion: vi.fn(async () => ({ canDelete: true, dependencies: [], alternatives: [] }))
  };
});

vi.mock('server/src/lib/jobs/JobRunnerFactory', () => ({
  getJobRunner: vi.fn(async () => runnerMock)
}));

const mockedCreateTenantKnex = vi.mocked(createTenantKnex);

let db: Knex;
let tenantId: string;

async function createDraftWorkflow(params: {
  trigger?: Parameters<typeof buildWorkflowDefinition>[0]['trigger'];
  name: string;
}) {
  const definition = {
    id: uuidv4(),
    ...buildWorkflowDefinition({
      name: params.name,
      steps: [stateSetStep('state-1', 'READY')],
      trigger: params.trigger
    })
  };

  return createWorkflowDefinitionAction({ definition });
}

beforeAll(async () => {
  ensureWorkflowRuntimeV2TestRegistrations();
  db = await createTestDbConnection();
  await ensureWorkflowScheduleStateTable(db);
});

beforeEach(async () => {
  await ensureWorkflowScheduleStateTable(db);
  await resetWorkflowRuntimeTables(db);
  tenantId = TEST_TENANT_ID;
  runnerMock.scheduleJobAt.mockReset();
  runnerMock.scheduleRecurringJob.mockReset();
  runnerMock.cancelJob.mockReset();
  mockedCreateTenantKnex.mockResolvedValue({ knex: db, tenant: tenantId });
});

afterAll(async () => {
  await db.destroy();
});

describe('workflow time trigger regression integration tests', () => {
  it('T045: no-trigger workflows still publish and run correctly after time-trigger support is added', async () => {
    const createResult = await createDraftWorkflow({
      name: 'No trigger regression'
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1
    });

    expect(publishResult.ok).toBe(true);

    const runResult = await startWorkflowRunAction({
      workflowId: createResult.workflowId,
      workflowVersion: 1,
      payload: {}
    });

    const run = await WorkflowRunModelV2.getById(db, runResult.runId);
    expect(run?.workflow_id).toBe(createResult.workflowId);
    expect(run?.workflow_version).toBe(1);
    expect(run?.status).toBe('SUCCEEDED');
    expect(run?.trigger_type ?? null).toBeNull();
  });

  it('T046: event-triggered workflows still publish and start correctly after launcher extraction', async () => {
    const createResult = await createDraftWorkflow({
      name: 'Event trigger regression',
      trigger: {
        type: 'event',
        eventName: 'REGRESSION',
        sourcePayloadSchemaRef: TEST_SCHEMA_REF
      }
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1
    });

    expect(publishResult.ok).toBe(true);

    const eventResult = await submitWorkflowEventAction({
      eventName: 'REGRESSION',
      correlationKey: 'regression-key',
      payload: { foo: 'bar' },
      payloadSchemaRef: TEST_SCHEMA_REF
    });

    expect(eventResult.startedRuns.length).toBe(1);

    const run = await WorkflowRunModelV2.getById(db, eventResult.startedRuns[0]);
    expect(run?.workflow_id).toBe(createResult.workflowId);
    expect(run?.workflow_version).toBe(1);
    expect(run?.status).toBe('SUCCEEDED');
    expect(run?.trigger_type).toBe('event');
    expect(run?.trigger_metadata_json).toMatchObject({
      eventType: 'REGRESSION',
      sourcePayloadSchemaRef: TEST_SCHEMA_REF,
      triggerMappingApplied: false
    });
  });
});
