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
  startWorkflowRunAction,
  submitWorkflowEventAction,
  listWorkflowEventsAction,
  resumeWorkflowRunFromQuotaPauseAction,
  cancelWorkflowRunAction
} from '@alga-psa/workflows/actions';
import { workflowStepQuotaService } from '@alga-psa/workflows/runtime';
import WorkflowRunModelV2 from '@alga-psa/workflows/persistence/workflowRunModelV2';
import WorkflowRunWaitModelV2 from '@alga-psa/workflows/persistence/workflowRunWaitModelV2';
import {
  ensureWorkflowRuntimeV2TestRegistrations,
  buildWorkflowDefinition,
  stateSetStep,
  TEST_SCHEMA_REF
} from '../helpers/workflowRuntimeV2TestHelpers';

const startWorkflowRuntimeV2TemporalRunMock = vi.hoisted(() => vi.fn());
const cancelWorkflowRuntimeV2TemporalRunMock = vi.hoisted(() => vi.fn());
const signalWorkflowRuntimeV2EventMock = vi.hoisted(() => vi.fn());
const signalWorkflowRuntimeV2HumanTaskMock = vi.hoisted(() => vi.fn());
const signalWorkflowRuntimeV2QuotaResumeMock = vi.hoisted(() => vi.fn());

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
  startWorkflowRuntimeV2TemporalRun: (...args: unknown[]) => startWorkflowRuntimeV2TemporalRunMock(...args),
  cancelWorkflowRuntimeV2TemporalRun: (...args: unknown[]) => cancelWorkflowRuntimeV2TemporalRunMock(...args),
  signalWorkflowRuntimeV2Event: (...args: unknown[]) => signalWorkflowRuntimeV2EventMock(...args),
  signalWorkflowRuntimeV2HumanTask: (...args: unknown[]) => signalWorkflowRuntimeV2HumanTaskMock(...args),
  signalWorkflowRuntimeV2QuotaResume: (...args: unknown[]) => signalWorkflowRuntimeV2QuotaResumeMock(...args)
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

async function publishSimpleWorkflow(): Promise<string> {
  const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
  await publishWorkflow(workflowId, 1);
  return workflowId;
}

async function startTemporalRun(workflowId: string, payload: Record<string, unknown> = {}): Promise<string> {
  const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload });
  return run.runId as string;
}

// Temporal owns wait lifecycles now; tests seed the projection rows the
// Temporal activities would have written so the server actions can be
// exercised against realistic WAITING state.
async function seedWaitingRunWait(runId: string, params: {
  eventName?: string | null;
  key: string;
  waitType?: string;
  stepPath?: string;
  payload?: Record<string, unknown> | null;
  tenant?: string | null;
}) {
  await WorkflowRunModelV2.update(db, runId, { status: 'WAITING' });
  return WorkflowRunWaitModelV2.create(db, {
    run_id: runId,
    tenant: params.tenant ?? tenantId,
    step_path: params.stepPath ?? 'root.steps[0]',
    wait_type: params.waitType ?? 'event',
    key: params.key,
    event_name: params.eventName ?? null,
    status: 'WAITING',
    payload: params.payload ?? null
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
  tenantId = uuidv4();
  userId = uuidv4();
  mockedCreateTenantKnex.mockImplementation(async () => ({ knex: db, tenant: tenantId }));
  mockedGetCurrentTenantId.mockImplementation(() => tenantId);
  mockedGetCurrentUser.mockResolvedValue({ user_id: userId, roles: [] } as any);
  startWorkflowRuntimeV2TemporalRunMock.mockReset();
  startWorkflowRuntimeV2TemporalRunMock.mockResolvedValue({
    workflowId: 'workflow-runtime-v2:run:run-control',
    firstExecutionRunId: 'temporal-run-control'
  });
  cancelWorkflowRuntimeV2TemporalRunMock.mockReset();
  cancelWorkflowRuntimeV2TemporalRunMock.mockResolvedValue(undefined);
  signalWorkflowRuntimeV2EventMock.mockReset();
  signalWorkflowRuntimeV2EventMock.mockResolvedValue(undefined);
  signalWorkflowRuntimeV2HumanTaskMock.mockReset();
  signalWorkflowRuntimeV2HumanTaskMock.mockResolvedValue(undefined);
  signalWorkflowRuntimeV2QuotaResumeMock.mockReset();
  signalWorkflowRuntimeV2QuotaResumeMock.mockResolvedValue(undefined);
});

afterAll(async () => {
  await db.destroy();
});

describe('workflow runtime v2 temporal run control integration tests', () => {
  it('control.if with missing condition expression fails publish-time validation. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Missing condition',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [{ id: 'if-1', type: 'control.if', then: [] }]
    });
    expect(result.ok).toBe(false);
  });

  it('control.forEach with missing itemVar fails publish-time validation. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Missing itemVar',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [{ id: 'for-1', type: 'control.forEach', items: { $expr: 'payload.items' }, body: [] }]
    });
    expect(result.ok).toBe(false);
  });

  it('event.wait assign rejects invalid paths at publish time. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    const result = await publishWorkflow(workflowId, 1, {
      id: workflowId,
      version: 1,
      name: 'Invalid assign',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [
        {
          id: 'wait-1',
          type: 'event.wait',
          config: {
            eventName: 'PING',
            correlationKey: { $expr: '"key"' },
            assign: { 'bad.path': { $expr: '"x"' } }
          }
        }
      ]
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((err: any) => err.code === 'INVALID_ASSIGN_PATH')).toBe(true);
  });

  it('Submit workflow event server action inserts the runtime event and signals one matching Temporal wait (API delegates). Mocks: non-target dependencies.', async () => {
    const workflowId = await publishSimpleWorkflow();
    const runId = await startTemporalRun(workflowId);
    await seedWaitingRunWait(runId, { eventName: 'PING', key: 'key' });

    const result = await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    expect(result.status).toBe('resumed');

    const eventsResult = await listWorkflowEventsAction({});
    expect(eventsResult.events.some((event) => event.event_name === 'PING')).toBe(true);
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledTimes(1);
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId, eventName: 'PING', correlationKey: 'key' })
    );
  });

  it('Submit workflow event server action with no matching wait still records event for audit. Mocks: non-target dependencies.', async () => {
    const result = await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'missing', payload: {} });
    expect(result.status).toBe('no_wait');
    const eventsResult = await listWorkflowEventsAction({});
    expect(eventsResult.events.some((event) => event.event_name === 'PING')).toBe(true);
    expect(signalWorkflowRuntimeV2EventMock).not.toHaveBeenCalled();
  });

  it('Submit workflow event server action signals every matching run when multiple waits share the same key. Mocks: non-target dependencies.', async () => {
    const workflowId = await publishSimpleWorkflow();
    const runA = await startTemporalRun(workflowId);
    const runB = await startTemporalRun(workflowId);
    await seedWaitingRunWait(runA, { eventName: 'PING', key: 'key' });
    await seedWaitingRunWait(runB, { eventName: 'PING', key: 'key' });

    const result = await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });

    expect(result.status).toBe('resumed');
    // No single authoritative run id exists when several runs were signaled.
    expect(result.runId).toBeNull();
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledTimes(2);
    const signaledRunIds = signalWorkflowRuntimeV2EventMock.mock.calls.map((call) => (call[0] as any).runId);
    expect(signaledRunIds).toContain(runA);
    expect(signaledRunIds).toContain(runB);

    // Wait/run projection state is owned by Temporal and remains untouched.
    const waits = await db('workflow_run_waits').whereIn('run_id', [runA, runB]);
    expect(waits.every((wait: any) => wait.status === 'WAITING')).toBe(true);
  });

  it('Submit workflow event server action returns the signaled run id when exactly one match occurs. Mocks: non-target dependencies.', async () => {
    const workflowId = await publishSimpleWorkflow();
    const runId = await startTemporalRun(workflowId);
    await seedWaitingRunWait(runId, { eventName: 'PING', key: 'key' });

    const result = await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    expect(result.runId).toBe(runId);
  });

  it('Submit workflow event signals Temporal waits without DB-authoritative wait/run mutation. Mocks: non-target dependencies.', async () => {
    const workflowId = await publishSimpleWorkflow();
    const runId = await startTemporalRun(workflowId);
    await seedWaitingRunWait(runId, { eventName: 'PING', key: 'key' });

    const result = await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    expect(result.status).toBe('resumed');
    expect(result.runId).toBe(runId);

    const wait = await db('workflow_run_waits').where({ run_id: runId }).first();
    const runAfter = await WorkflowRunModelV2.getById(db, runId);
    const eventRow = await db('workflow_runtime_events')
      .where({ event_name: 'PING' })
      .orderBy('created_at', 'desc')
      .first();
    expect(wait?.status).toBe('WAITING');
    expect(runAfter?.status).toBe('WAITING');
    expect(eventRow?.error_message).toBeNull();
    expect(eventRow?.correlation_key).toBe('key');
    expect(eventRow?.matched_run_id).toBe(runId);
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledTimes(1);
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        eventName: 'PING',
        correlationKey: 'key',
      })
    );
  });

  it('Submit workflow event derives correlation key from configured paths and resumes Temporal waits via signal only. Mocks: non-target dependencies.', async () => {
    const original = process.env.WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON;
    process.env.WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON = JSON.stringify({
      PING: ['ticket.id']
    });
    try {
      const workflowId = await publishSimpleWorkflow();
      const runId = await startTemporalRun(workflowId);
      await seedWaitingRunWait(runId, { eventName: 'PING', key: 'abc' });

      const result = await submitWorkflowEventAction({
        eventName: 'PING',
        payload: { ticket: { id: 'abc' } }
      });

      expect(result.status).toBe('resumed');
      expect(result.runId).toBe(runId);
      expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          runId,
          correlationKey: 'abc'
        })
      );

      const eventRow = await db('workflow_runtime_events')
        .where({ event_name: 'PING' })
        .orderBy('created_at', 'desc')
        .first();
      expect(eventRow?.correlation_key).toBe('abc');
      expect(eventRow?.matched_run_id).toBe(runId);
      expect(eventRow?.error_message).toBeNull();
    } finally {
      process.env.WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON = original;
    }
  });

  it('Submit workflow event keeps payload-filter matching inside Temporal wait contract and still signals candidates. Mocks: non-target dependencies.', async () => {
    const workflowId = await publishSimpleWorkflow();
    const runId = await startTemporalRun(workflowId);
    await seedWaitingRunWait(runId, {
      eventName: 'PING',
      key: 'key',
      payload: { filters: [{ path: '$.expected', op: '=', value: 'match' }] }
    });

    const result = await submitWorkflowEventAction({
      eventName: 'PING',
      correlationKey: 'key',
      payload: { expected: 'mismatch' }
    });

    expect(result.status).toBe('resumed');
    expect(result.runId).toBe(runId);
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        payload: { expected: 'mismatch' }
      })
    );

    const wait = await db('workflow_run_waits').where({ run_id: runId }).first();
    expect(wait?.status).toBe('WAITING');
  });

  it('Submit workflow event routes Temporal human waits through Temporal human-task signal only. Mocks: non-target dependencies.', async () => {
    const workflowId = await publishSimpleWorkflow();
    const runId = await startTemporalRun(workflowId);
    const taskId = uuidv4();
    const wait = await seedWaitingRunWait(runId, {
      eventName: 'HUMAN_TASK_COMPLETED',
      key: taskId,
      waitType: 'human',
      payload: { taskId, taskType: 'workflow_error' }
    });

    const result = await submitWorkflowEventAction({
      eventName: 'HUMAN_TASK_COMPLETED',
      correlationKey: taskId,
      payload: { decision: 'approve' }
    });

    expect(result.status).toBe('resumed');
    expect(result.runId).toBe(runId);
    expect(signalWorkflowRuntimeV2EventMock).not.toHaveBeenCalled();
    expect(signalWorkflowRuntimeV2HumanTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        taskId,
        eventName: 'HUMAN_TASK_COMPLETED',
        payload: { decision: 'approve' }
      })
    );

    const waitAfter = await db('workflow_run_waits').where({ run_id: runId, wait_id: wait.wait_id }).first();
    expect(waitAfter?.status).toBe('WAITING');
  });

  it('Submit workflow event signaling is scoped by tenant when tenant_id is provided. Mocks: non-target dependencies.', async () => {
    const tenantA = uuidv4();
    const tenantB = uuidv4();

    tenantId = tenantA;
    const workflowA = await publishSimpleWorkflow();
    const runA = await startTemporalRun(workflowA);
    await seedWaitingRunWait(runA, { eventName: 'PING', key: 'key', tenant: tenantA });

    tenantId = tenantB;
    const workflowB = await publishSimpleWorkflow();
    const runB = await startTemporalRun(workflowB);
    await seedWaitingRunWait(runB, { eventName: 'PING', key: 'key', tenant: tenantB });

    tenantId = tenantA;
    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });

    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledTimes(1);
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: runA })
    );
  });

  it('canceling a WAITING run cancels its waits and later events no longer signal it. Mocks: non-target dependencies.', async () => {
    const workflowId = await publishSimpleWorkflow();
    const runId = await startTemporalRun(workflowId);
    await seedWaitingRunWait(runId, { eventName: 'PING', key: 'key' });

    await cancelWorkflowRunAction({ runId, reason: 'test cancel' });
    expect(cancelWorkflowRuntimeV2TemporalRunMock).toHaveBeenCalledWith({ runId });

    const waits = await db('workflow_run_waits').where({ run_id: runId });
    expect(waits.every((wait: any) => wait.status === 'CANCELED')).toBe(true);

    const result = await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    expect(result.status).toBe('no_wait');
    expect(signalWorkflowRuntimeV2EventMock).not.toHaveBeenCalled();

    const record = await WorkflowRunModelV2.getById(db, runId);
    expect(record?.status).toBe('CANCELED');
  });

  it('multiple waits for a run are all cleared on cancel. Mocks: non-target dependencies.', async () => {
    const workflowId = await publishSimpleWorkflow();
    const runId = await startTemporalRun(workflowId);
    await seedWaitingRunWait(runId, { eventName: 'PING', key: 'key' });
    await seedWaitingRunWait(runId, { eventName: 'PING', key: 'key2', stepPath: 'root.steps[1]' });

    await cancelWorkflowRunAction({ runId, reason: 'test cancel' });

    const waits = await db('workflow_run_waits').where({ run_id: runId });
    expect(waits.length).toBe(2);
    expect(waits.every((wait: any) => wait.status === 'CANCELED')).toBe(true);
  });

  it('Temporal cancel failure does not project CANCELED status in the database. Mocks: non-target dependencies.', async () => {
    const workflowId = await publishSimpleWorkflow();
    const runId = await startTemporalRun(workflowId);
    await seedWaitingRunWait(runId, { eventName: 'PING', key: 'key' });
    cancelWorkflowRuntimeV2TemporalRunMock.mockRejectedValueOnce(new Error('temporal unavailable'));

    await expect(cancelWorkflowRunAction({ runId, reason: 'test cancel' }))
      .rejects.toMatchObject({
        status: 409,
        details: expect.objectContaining({
          code: 'WORKFLOW_TEMPORAL_CANCEL_FAILED',
          runId,
          engine: 'temporal'
        })
      });

    const waits = await db('workflow_run_waits').where({ run_id: runId });
    const runAfter = await WorkflowRunModelV2.getById(db, runId);
    expect(waits.every((wait: any) => wait.status === 'WAITING')).toBe(true);
    expect(runAfter?.status).toBe('WAITING');
  });

  it('Workflow runtime event list server action returns recent events (API delegates). Mocks: non-target dependencies.', async () => {
    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    const eventsResult = await listWorkflowEventsAction({});
    expect(eventsResult.events.length).toBeGreaterThan(0);
  });

  it('Manual quota resume resolves the quota wait, marks the run RUNNING, and signals Temporal quota resume. Mocks: non-target dependencies.', async () => {
    const workflowId = await publishSimpleWorkflow();
    const runId = await startTemporalRun(workflowId);
    const wait = await seedWaitingRunWait(runId, {
      key: 'quota',
      waitType: 'quota',
      payload: { reason: 'workflow_step_quota_exceeded' }
    });

    const resumeResult = await resumeWorkflowRunFromQuotaPauseAction({ runId, reason: 'quota available' });
    expect(resumeResult).toEqual({ ok: true, resumed: true });

    const runAfter = await WorkflowRunModelV2.getById(db, runId);
    expect(runAfter?.status).toBe('RUNNING');

    const waitAfter = await db('workflow_run_waits').where({ wait_id: wait.wait_id }).first();
    expect(waitAfter?.status).toBe('RESOLVED');

    expect(signalWorkflowRuntimeV2QuotaResumeMock).toHaveBeenCalledTimes(1);
    expect(signalWorkflowRuntimeV2QuotaResumeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        waitId: wait.wait_id,
        reason: 'quota available'
      })
    );
  });

  it('Manual quota resume returns usage, limit, and reset time when still exhausted. Mocks: non-target dependencies.', async () => {
    const workflowId = await publishSimpleWorkflow();
    const runId = await startTemporalRun(workflowId);
    await seedWaitingRunWait(runId, {
      key: 'quota',
      waitType: 'quota',
      payload: { reason: 'workflow_step_quota_exceeded' }
    });

    const summarySpy = vi.spyOn(workflowStepQuotaService, 'resolveQuotaSummary');
    summarySpy.mockResolvedValue({
      tenant: tenantId,
      periodStart: '2026-04-01T00:00:00.000Z',
      periodEnd: '2026-05-01T00:00:00.000Z',
      periodSource: 'fallback_calendar',
      stripeSubscriptionId: null,
      effectiveLimit: 10,
      usedCount: 10,
      remaining: 0,
      tier: 'pro',
      limitSource: 'tier_default',
    });
    try {
      const result = await resumeWorkflowRunFromQuotaPauseAction({ runId, reason: 'try resume' });
      expect(result).toEqual({
        ok: false,
        resumed: false,
        reason: 'quota_exhausted',
        quota: {
          usedCount: 10,
          effectiveLimit: 10,
          periodEnd: '2026-05-01T00:00:00.000Z',
          periodStart: '2026-04-01T00:00:00.000Z',
          periodSource: 'fallback_calendar',
          limitSource: 'tier_default',
        },
      });
      expect(signalWorkflowRuntimeV2QuotaResumeMock).not.toHaveBeenCalled();
    } finally {
      summarySpy.mockRestore();
    }
  });
});
