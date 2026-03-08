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
  publishWorkflowDefinitionAction
} from '@alga-psa/workflows/actions';
import WorkflowScheduleStateModel from '@shared/workflow/persistence/workflowScheduleStateModel';
import {
  buildWorkflowDefinition,
  ensureWorkflowRuntimeV2TestRegistrations,
  stateSetStep
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
let jobSequence = 0;

async function createDraftWorkflow(trigger: Parameters<typeof buildWorkflowDefinition>[0]['trigger']) {
  const definition = {
    id: uuidv4(),
    ...buildWorkflowDefinition({
      steps: [stateSetStep('state-1', 'READY')],
      trigger
    })
  };

  return createWorkflowDefinitionAction({
    definition
  });
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
  jobSequence = 0;

  runnerMock.scheduleJobAt.mockReset();
  runnerMock.scheduleRecurringJob.mockReset();
  runnerMock.cancelJob.mockReset();

  runnerMock.scheduleJobAt.mockImplementation(async () => {
    jobSequence += 1;
    return {
      jobId: `00000000-0000-4000-8000-${String(jobSequence).padStart(12, '0')}`,
      externalId: `runner-once-${jobSequence}`
    };
  });
  runnerMock.scheduleRecurringJob.mockImplementation(async () => {
    jobSequence += 1;
    return {
      jobId: `10000000-0000-4000-8000-${String(jobSequence).padStart(12, '0')}`,
      externalId: `runner-recurring-${jobSequence}`
    };
  });
  runnerMock.cancelJob.mockResolvedValue(true);

  mockedCreateTenantKnex.mockResolvedValue({ knex: db, tenant: tenantId });

  process.env.EDITION = 'ee';
  process.env.NEXT_PUBLIC_EDITION = 'enterprise';
});

afterAll(async () => {
  await db.destroy();
});

describe('workflow time trigger scheduling integration tests', () => {
  it('T022: publishing a one-time scheduled workflow creates a workflow schedule state row', async () => {
    const createResult = await createDraftWorkflow({
      type: 'schedule',
      runAt: '2026-03-09T15:30:00.000Z'
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1
    });

    expect(publishResult.ok).toBe(true);

    const schedule = await WorkflowScheduleStateModel.getByWorkflowId(db, createResult.workflowId);
    expect(schedule).toMatchObject({
      tenant_id: tenantId,
      workflow_id: createResult.workflowId,
      workflow_version: 1,
      trigger_type: 'schedule',
      cron: null,
      timezone: null,
      enabled: true,
      status: 'scheduled'
    });
    expect(new Date(String(schedule?.run_at)).toISOString()).toBe('2026-03-09T15:30:00.000Z');
  });

  it('T023: publishing a recurring scheduled workflow creates a workflow schedule state row', async () => {
    const createResult = await createDraftWorkflow({
      type: 'recurring',
      cron: '15 9 * * 1-5',
      timezone: 'America/New_York'
    });

    const publishResult = await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1
    });

    expect(publishResult.ok).toBe(true);

    const schedule = await WorkflowScheduleStateModel.getByWorkflowId(db, createResult.workflowId);
    expect(schedule).toMatchObject({
      tenant_id: tenantId,
      workflow_id: createResult.workflowId,
      workflow_version: 1,
      trigger_type: 'recurring',
      run_at: null,
      cron: '15 9 * * 1-5',
      timezone: 'America/New_York',
      enabled: true,
      status: 'scheduled'
    });
  });

  it('T024: workflow schedule state row persists runner job identifiers after registration', async () => {
    const createResult = await createDraftWorkflow({
      type: 'recurring',
      cron: '0 6 * * *',
      timezone: 'UTC'
    });

    await publishWorkflowDefinitionAction({
      workflowId: createResult.workflowId,
      version: 1
    });

    expect(runnerMock.scheduleRecurringJob).toHaveBeenCalledTimes(1);

    const schedule = await WorkflowScheduleStateModel.getByWorkflowId(db, createResult.workflowId);
    expect(schedule?.job_id).toBe('10000000-0000-4000-8000-000000000001');
    expect(schedule?.runner_schedule_id).toBe('runner-recurring-1');
  });
});
