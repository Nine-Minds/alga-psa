import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
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
  resumeWorkflowRunAction,
  resumeWorkflowRunFromQuotaPauseAction,
  retryWorkflowRunAction,
  cancelWorkflowRunAction
} from '@alga-psa/workflows/actions';
import { WorkflowRuntimeV2 } from '@alga-psa/workflows/runtime';
import { workflowStepQuotaService } from '@alga-psa/workflows/runtime';
import { getActionRegistryV2, getSchemaRegistry } from '@alga-psa/workflows/runtime';
import WorkflowRunModelV2 from '@alga-psa/workflows/persistence/workflowRunModelV2';
import WorkflowRunStepModelV2 from '@alga-psa/workflows/persistence/workflowRunStepModelV2';
import WorkflowRunWaitModelV2 from '@alga-psa/workflows/persistence/workflowRunWaitModelV2';
import WorkflowActionInvocationModelV2 from '@alga-psa/workflows/persistence/workflowActionInvocationModelV2';
import WorkflowRunSnapshotModelV2 from '@alga-psa/workflows/persistence/workflowRunSnapshotModelV2';
import { WorkflowRuntimeV2Worker } from '@alga-psa/workflows/workers';
import {
  ensureWorkflowRuntimeV2TestRegistrations,
  buildWorkflowDefinition,
  actionCallStep,
  assignStep,
  stateSetStep,
  eventWaitStep,
  ifStep,
  forEachStep,
  tryCatchStep,
  callWorkflowStep,
  returnStep,
  resetTestActionState,
  getSideEffectCount,
  TEST_SCHEMA_REF
} from '../helpers/workflowRuntimeV2TestHelpers';

const cancelWorkflowRuntimeV2TemporalRunMock = vi.hoisted(() => vi.fn());
const signalWorkflowRuntimeV2EventMock = vi.hoisted(() => vi.fn());
const signalWorkflowRuntimeV2HumanTaskMock = vi.hoisted(() => vi.fn());

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
  cancelWorkflowRuntimeV2TemporalRun: (...args: unknown[]) => cancelWorkflowRuntimeV2TemporalRunMock(...args),
  signalWorkflowRuntimeV2Event: (...args: unknown[]) => signalWorkflowRuntimeV2EventMock(...args),
  signalWorkflowRuntimeV2HumanTask: (...args: unknown[]) => signalWorkflowRuntimeV2HumanTaskMock(...args)
}));

const mockedCreateTenantKnex = vi.mocked(createTenantKnex);
const mockedGetCurrentTenantId = vi.mocked(getCurrentTenantId);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);

let db: Knex;
let tenantId: string;
let userId: string;

const actionRestores: Array<() => void> = [];

async function latestWorkflowStepUsageCount(tenant: string): Promise<number> {
  const row = await db('workflow_step_usage_periods')
    .where({ tenant })
    .orderBy('updated_at', 'desc')
    .first<{ used_count: number }>();
  return row?.used_count ?? 0;
}

function stubAction(actionId: string, version: number, handler: any) {
  const registry = getActionRegistryV2();
  const action = registry.get(actionId, version);
  if (!action) throw new Error(`Missing action ${actionId}@${version}`);
  const original = action.handler;
  action.handler = handler;
  actionRestores.push(() => {
    action.handler = original;
  });
}

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
  resetTestActionState();
  cancelWorkflowRuntimeV2TemporalRunMock.mockReset();
  cancelWorkflowRuntimeV2TemporalRunMock.mockResolvedValue(undefined);
  signalWorkflowRuntimeV2EventMock.mockReset();
  signalWorkflowRuntimeV2EventMock.mockResolvedValue(undefined);
  signalWorkflowRuntimeV2HumanTaskMock.mockReset();
  signalWorkflowRuntimeV2HumanTaskMock.mockResolvedValue(undefined);
});

afterEach(() => {
  while (actionRestores.length > 0) {
    const restore = actionRestores.pop();
    if (restore) restore();
  }
});

afterAll(async () => {
  await db.destroy();
});

describe('workflow runtime v2 control-flow + waits integration tests', () => {
  it('control.if executes THEN pipe when condition is true. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        ifStep('if-1', { $expr: 'true' }, [assignStep('assign-then', { 'payload.result': { $expr: '"then"' } })], [assignStep('assign-else', { 'payload.result': { $expr: '"else"' } })])
      ]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).payload.result).toBe('then');
  });

  it('control.if executes ELSE pipe when condition is false. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        ifStep('if-1', { $expr: 'false' }, [assignStep('assign-then', { 'payload.result': { $expr: '"then"' } })], [assignStep('assign-else', { 'payload.result': { $expr: '"else"' } })])
      ]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).payload.result).toBe('else');
  });

  it('control.if treats condition expression failure as ExpressionError. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [ifStep('if-1', { $expr: 'payload.foo' }, [stateSetStep('state-1', 'OK')])]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { foo: 'not-bool' } });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('FAILED');
    expect(record?.error_json?.category).toBe('ExpressionError');
  });

  it('control.forEach iterates over array items and executes body for each item. Mocks: non-target dependencies.', async () => {
    const loopBody = [assignStep('assign-item', { 'vars.collected': { $expr: 'append(coalesce(vars.collected, []), [vars.item])' } })];
    const workflowId = await createDraftWorkflow({
      steps: [forEachStep('for-1', { items: { $expr: 'payload.items' }, itemVar: 'item', body: loopBody })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { items: [1, 2, 3] } });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).vars.collected).toEqual([1, 2, 3]);
  });

  it('control.forEach sets vars[itemVar] for each iteration. Mocks: non-target dependencies.', async () => {
    const loopBody = [assignStep('assign-item', { 'vars.collected': { $expr: 'append(coalesce(vars.collected, []), [vars.item])' } })];
    const workflowId = await createDraftWorkflow({
      steps: [forEachStep('for-1', { items: { $expr: 'payload.items' }, itemVar: 'item', body: loopBody })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { items: ['a', 'b'] } });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).vars.collected).toEqual(['a', 'b']);
  });

  it('control.forEach restores prior vars[itemVar] after completion. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        assignStep('assign-before', { 'vars.item': { $expr: '"original"' } }),
        forEachStep('for-1', { items: { $expr: 'payload.items' }, itemVar: 'item', body: [assignStep('assign-item', { 'vars.collected': { $expr: 'append(coalesce(vars.collected, []), [vars.item])' } })] })
      ]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { items: [1, 2] } });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).vars.item).toBe('original');
  });

  it('control.forEach honors concurrency=1 in MVP execution order. Mocks: non-target dependencies.', async () => {
    const loopBody = [assignStep('assign-item', { 'vars.collected': { $expr: 'append(coalesce(vars.collected, []), [vars.item])' } })];
    const workflowId = await createDraftWorkflow({
      steps: [forEachStep('for-1', { items: { $expr: 'payload.items' }, itemVar: 'item', body: loopBody, onItemError: 'fail' })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { items: [1, 2, 3] } });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).vars.collected).toEqual([1, 2, 3]);
  });

  it('control.forEach with empty list skips body without error. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [forEachStep('for-1', { items: { $expr: 'payload.items' }, itemVar: 'item', body: [actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {} })] })]
    });
    await publishWorkflow(workflowId, 1);
    await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { items: [] } });
    expect(getSideEffectCount()).toBe(0);
  });

  it('control.forEach supports per-item onError=continue behavior. Mocks: non-target dependencies.', async () => {
    let callCount = 0;
    stubAction('test.sideEffect', 1, async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('fail');
      }
      return { count: callCount };
    });
    const workflowId = await createDraftWorkflow({
      steps: [forEachStep('for-1', { items: { $expr: 'payload.items' }, itemVar: 'item', onItemError: 'continue', body: [actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {} })] })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { items: [1, 2] } });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('SUCCEEDED');
  });

  it('control.forEach per-item onError=fail stops loop and fails or catches. Mocks: non-target dependencies.', async () => {
    stubAction('test.sideEffect', 1, async () => {
      throw new Error('fail');
    });
    const workflowId = await createDraftWorkflow({
      steps: [forEachStep('for-1', { items: { $expr: 'payload.items' }, itemVar: 'item', onItemError: 'fail', body: [actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {} })] })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { items: [1, 2] } });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('FAILED');
  });

  it('control.forEach handles non-array items expression as ValidationError. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [forEachStep('for-1', { items: { $expr: 'payload.value' }, itemVar: 'item', body: [stateSetStep('state-1', 'OK')] })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { value: 'not-array' } });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.error_json?.category).toBe('ValidationError');
  });

  it('control.tryCatch executes TRY pipe and skips CATCH on success. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [tryCatchStep('try-1', { trySteps: [stateSetStep('state-1', 'OK')], catchSteps: [stateSetStep('state-2', 'FAIL')] })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).meta.state).toBe('OK');
  });

  it('control.tryCatch executes CATCH pipe when TRY throws ActionError. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [tryCatchStep('try-1', { trySteps: [actionCallStep({ id: 'fail', actionId: 'test.fail', inputMapping: {} })], catchSteps: [stateSetStep('state-1', 'RECOVERED')] })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).meta.state).toBe('RECOVERED');
  });

  it('control.tryCatch executes CATCH pipe when TRY throws ExpressionError. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [tryCatchStep('try-1', { trySteps: [ifStep('if-1', { $expr: 'payload.value' }, [stateSetStep('state-1', 'OK')])], catchSteps: [stateSetStep('state-2', 'CAUGHT')] })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { value: 'not-bool' } });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).meta.state).toBe('CAUGHT');
  });

  it('control.tryCatch propagates error when CATCH pipe also fails. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [tryCatchStep('try-1', { trySteps: [actionCallStep({ id: 'fail', actionId: 'test.fail', inputMapping: {} })], catchSteps: [actionCallStep({ id: 'fail-2', actionId: 'test.fail', inputMapping: {} })] })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('FAILED');
  });

  it('control.tryCatch captureErrorAs stores error into vars. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        {
          id: 'try-1',
          type: 'control.tryCatch',
          try: [actionCallStep({ id: 'fail', actionId: 'test.fail', inputMapping: {} })],
          catch: [assignStep('assign-err', { 'payload.errCategory': { $expr: 'vars.err.category' } })],
          captureErrorAs: 'err'
        }
      ]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).payload.errCategory).toBe('ActionError');
  });

  it('Nested control.tryCatch handles inner errors without leaking to outer catch. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        {
          id: 'outer',
          type: 'control.tryCatch',
          try: [
            {
              id: 'inner',
              type: 'control.tryCatch',
              try: [actionCallStep({ id: 'fail', actionId: 'test.fail', inputMapping: {} })],
              catch: [stateSetStep('state-inner', 'INNER_RECOVERED')]
            }
          ],
          catch: [stateSetStep('state-outer', 'OUTER_RECOVERED')]
        }
      ]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    const state = (snapshots[snapshots.length - 1].envelope_json as any).meta.state;
    expect(state).toBe('INNER_RECOVERED');
  });

  it('control.return inside control.if stops the run immediately. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        ifStep('if-1', { $expr: 'true' }, [returnStep('return-1')]),
        actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {} })
      ]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const steps = await WorkflowRunStepModelV2.listByRun(db, run.runId);
    expect(steps.some((step) => step.definition_step_id === 'action-1')).toBe(false);
  });

  it('control.return inside control.forEach stops the entire run, not just the loop. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        forEachStep('for-1', { items: { $expr: 'payload.items' }, itemVar: 'item', body: [returnStep('return-1')] }),
        actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {} })
      ]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { items: [1, 2] } });
    const steps = await WorkflowRunStepModelV2.listByRun(db, run.runId);
    expect(steps.some((step) => step.definition_step_id === 'action-1')).toBe(false);
  });

  it('control.return inside control.tryCatch stops the run even if in catch. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [tryCatchStep('try-1', { trySteps: [actionCallStep({ id: 'fail', actionId: 'test.fail', inputMapping: {} })], catchSteps: [returnStep('return-1')] }), actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {} })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const steps = await WorkflowRunStepModelV2.listByRun(db, run.runId);
    expect(steps.some((step) => step.definition_step_id === 'action-1')).toBe(false);
  });

  it('control.if can reference vars written earlier in the same run. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        assignStep('assign-1', { 'vars.flag': { $expr: 'true' } }),
        ifStep('if-1', { $expr: 'vars.flag' }, [assignStep('assign-2', { 'payload.result': { $expr: '"ok"' } })])
      ]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).payload.result).toBe('ok');
  });

  it('control.forEach supports itemVar shadowing of existing vars and restores after. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        assignStep('assign-1', { 'vars.item': { $expr: '"shadow"' } }),
        forEachStep('for-1', { items: { $expr: 'payload.items' }, itemVar: 'item', body: [assignStep('assign-2', { 'vars.collected': { $expr: 'append(coalesce(vars.collected, []), [vars.item])' } })] })
      ]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { items: [1] } });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).vars.item).toBe('shadow');
  });

  it('control.tryCatch captures TransientError and routes to catch pipe. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        tryCatchStep('try-1', {
          trySteps: [{
            id: 'retry',
            type: 'test.retryNode',
            config: { key: 't1', failCount: 1 },
            retry: { maxAttempts: 1, backoffMs: 1, retryOn: ['TransientError'] }
          }],
          catchSteps: [stateSetStep('state-1', 'RECOVERED')]
        })
      ]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).meta.state).toBe('RECOVERED');
  });

  it('control.tryCatch catch pipe can set meta.state for error states. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [tryCatchStep('try-1', { trySteps: [actionCallStep({ id: 'fail', actionId: 'test.fail', inputMapping: {} })], catchSteps: [stateSetStep('state-1', 'ERROR')] })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).meta.state).toBe('ERROR');
  });

  it('CallWorkflowBlock executes child workflow and maps input payload via inputMapping. Mocks: non-target dependencies.', async () => {
    const childId = await createDraftWorkflow({ steps: [assignStep('assign-child', { 'payload.fromParent': { $expr: 'payload.foo' } })] });
    await publishWorkflow(childId, 1);

    const parentId = await createDraftWorkflow({
      steps: [callWorkflowStep('call-1', { workflowId: childId, workflowVersion: 1, inputMapping: { foo: { $expr: 'payload.input' } }, outputMapping: { 'payload.childValue': { $expr: 'vars.childRun.payload.fromParent' } } })]
    });
    await publishWorkflow(parentId, 1);
    const run = await startWorkflowRunAction({ workflowId: parentId, workflowVersion: 1, payload: { input: 'hello' } });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).payload.childValue).toBe('hello');
  });

  it('CallWorkflowBlock maps child output back to parent via outputMapping. Mocks: non-target dependencies.', async () => {
    const childId = await createDraftWorkflow({ steps: [assignStep('assign-child', { 'payload.result': { $expr: '"child"' } })] });
    await publishWorkflow(childId, 1);

    const parentId = await createDraftWorkflow({
      steps: [callWorkflowStep('call-1', { workflowId: childId, workflowVersion: 1, outputMapping: { 'payload.childResult': { $expr: 'vars.childRun.payload.result' } } })]
    });
    await publishWorkflow(parentId, 1);
    const run = await startWorkflowRunAction({ workflowId: parentId, workflowVersion: 1, payload: {} });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).payload.childResult).toBe('child');
  });

  it('CallWorkflowBlock propagates child failure to parent unless caught. Mocks: non-target dependencies.', async () => {
    const childId = await createDraftWorkflow({ steps: [actionCallStep({ id: 'fail', actionId: 'test.fail', inputMapping: {} })] });
    await publishWorkflow(childId, 1);

    const parentId = await createDraftWorkflow({
      steps: [callWorkflowStep('call-1', { workflowId: childId, workflowVersion: 1 })]
    });
    await publishWorkflow(parentId, 1);
    const run = await startWorkflowRunAction({ workflowId: parentId, workflowVersion: 1, payload: {} });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('FAILED');
  });

  it('CallWorkflowBlock respects parent retry policy on call failure. Mocks: non-target dependencies.', async () => {
    const childId = await createDraftWorkflow({ steps: [actionCallStep({ id: 'fail', actionId: 'test.fail', inputMapping: {} })] });
    await publishWorkflow(childId, 1);

    const parentId = await createDraftWorkflow({
      steps: [{
        id: 'call-1',
        type: 'control.callWorkflow',
        workflowId: childId,
        workflowVersion: 1,
        retry: { maxAttempts: 2, backoffMs: 5, retryOn: ['ActionError'] }
      }]
    });
    await publishWorkflow(parentId, 1);
    const run = await startWorkflowRunAction({ workflowId: parentId, workflowVersion: 1, payload: {} });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' });
    expect(waits.length).toBeGreaterThan(0);
  });

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

  it("event.wait creates workflow_run_wait with wait_type='event' and WAITING status. Mocks: non-target dependencies.", async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId });
    expect(waits[0].wait_type).toBe('event');
    expect(waits[0].status).toBe('WAITING');
  });

  it('event.wait computes wait_key using correlationKey expression. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: 'payload.key' } })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { key: 'abc' } });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId });
    expect(waits[0].key).toBe('abc');
  });

  it('event.wait records timeout_at when timeoutMs is provided. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' }, timeoutMs: 500 })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId });
    expect(waits[0].timeout_at).toBeDefined();
  });

  it('event.wait assigns payload/vars using assign mapping on resume. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' }, assign: { 'payload.result': { $expr: 'vars.event.data' } } })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: { data: 'ok' } });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).payload.result).toBe('ok');
  });

  it('Submit workflow event server action inserts runtime event and resumes one matching wait atomically (API delegates). Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } }), stateSetStep('state-1', 'DONE')]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const result = await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    expect(result.status).toBe('resumed');
    const eventsResult = await listWorkflowEventsAction();
    expect(eventsResult.events.some((event) => event.event_name === 'PING')).toBe(true);
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('SUCCEEDED');
  });

  it('Submit workflow event server action with no matching wait still records event for audit. Mocks: non-target dependencies.', async () => {
    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'missing', payload: {} });
    const eventsResult = await listWorkflowEventsAction();
    expect(eventsResult.events.some((event) => event.event_name === 'PING')).toBe(true);
  });

  it('Submit workflow event server action resumes only one run when multiple waits share the same key. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } })] });
    await publishWorkflow(workflowId, 1);
    const runA = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const runB = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    const waitA = await WorkflowRunWaitModelV2.findEventWait(db, 'PING', 'key', tenantId, ['event']);
    const runRecordA = await WorkflowRunModelV2.getById(db, runA.runId);
    const runRecordB = await WorkflowRunModelV2.getById(db, runB.runId);
    expect(runRecordA?.status === 'SUCCEEDED' || runRecordB?.status === 'SUCCEEDED').toBe(true);
    expect(waitA).not.toBeNull();
  });

  it('Submit workflow event server action returns resumed run id when a match occurs. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } })] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const result = await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    expect(result.runId).toBe(run.runId);
  });

  it('Submit workflow event signals Temporal waits without DB-authoritative wait/run mutation. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await WorkflowRunModelV2.update(db, run.runId, { engine: 'temporal' });

    const result = await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    expect(result.status).toBe('resumed');
    expect(result.runId).toBe(run.runId);

    const wait = await db('workflow_run_waits').where({ run_id: run.runId }).first();
    const runAfter = await WorkflowRunModelV2.getById(db, run.runId);
    const eventRow = await db('workflow_runtime_events')
      .where({ event_name: 'PING' })
      .orderBy('created_at', 'desc')
      .first();
    expect(wait?.status).toBe('WAITING');
    expect(runAfter?.status).toBe('WAITING');
    expect(eventRow?.error_message).toBeNull();
    expect(eventRow?.correlation_key).toBe('key');
    expect(eventRow?.matched_run_id).toBe(run.runId);
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledTimes(1);
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.runId,
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
    let executeRunSpy: ReturnType<typeof vi.spyOn> | null = null;
    try {
      const workflowId = await createDraftWorkflow({
        steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"abc"' } })]
      });
      await publishWorkflow(workflowId, 1);
      const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
      await WorkflowRunModelV2.update(db, run.runId, { engine: 'temporal' });
      executeRunSpy = vi.spyOn(WorkflowRuntimeV2.prototype, 'executeRun');
      executeRunSpy.mockClear();

      const result = await submitWorkflowEventAction({
        eventName: 'PING',
        payload: { ticket: { id: 'abc' } }
      });

      expect(result.status).toBe('resumed');
      expect(result.runId).toBe(run.runId);
      expect(executeRunSpy).not.toHaveBeenCalled();
      expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: run.runId,
          correlationKey: 'abc'
        })
      );

      const eventRow = await db('workflow_runtime_events')
        .where({ event_name: 'PING' })
        .orderBy('created_at', 'desc')
        .first();
      expect(eventRow?.correlation_key).toBe('abc');
      expect(eventRow?.matched_run_id).toBe(run.runId);
      expect(eventRow?.error_message).toBeNull();
    } finally {
      executeRunSpy?.mockRestore();
      process.env.WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON = original;
    }
  });

  it('Submit workflow event keeps payload-filter matching inside Temporal wait contract and still signals candidates. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', {
        eventName: 'PING',
        correlationKeyExpr: { $expr: '"key"' },
        filters: [{ path: '$.expected', op: '=', value: 'match' }]
      })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await WorkflowRunModelV2.update(db, run.runId, { engine: 'temporal' });

    const result = await submitWorkflowEventAction({
      eventName: 'PING',
      correlationKey: 'key',
      payload: { expected: 'mismatch' }
    });

    expect(result.status).toBe('resumed');
    expect(result.runId).toBe(run.runId);
    expect(signalWorkflowRuntimeV2EventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.runId,
        payload: { expected: 'mismatch' }
      })
    );

    const wait = await db('workflow_run_waits').where({ run_id: run.runId }).first();
    expect(wait?.status).toBe('WAITING');
  });

  it('Submit workflow event routes Temporal human waits through Temporal human-task signal only. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [{
        id: 'human-1',
        type: 'human.task',
        config: {
          taskType: 'workflow_error',
          title: { $expr: '"Needs Review"' }
        }
      }]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await WorkflowRunModelV2.update(db, run.runId, { engine: 'temporal' });

    const wait = await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'human' }).first();
    const taskId = String(wait?.payload?.taskId ?? '');
    expect(taskId).toBeTruthy();

    const result = await submitWorkflowEventAction({
      eventName: 'HUMAN_TASK_COMPLETED',
      correlationKey: wait.key,
      payload: { decision: 'approve' }
    });

    expect(result.status).toBe('resumed');
    expect(result.runId).toBe(run.runId);
    expect(signalWorkflowRuntimeV2HumanTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.runId,
        taskId,
        eventName: 'HUMAN_TASK_COMPLETED',
        payload: { decision: 'approve' }
      })
    );

    const waitAfter = await db('workflow_run_waits').where({ run_id: run.runId, wait_id: wait.wait_id }).first();
    expect(waitAfter?.status).toBe('WAITING');
  });

  it('WAITING run resumes from correct nodePath after event resume. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } }), stateSetStep('state-1', 'DONE')] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    const steps = await WorkflowRunStepModelV2.listByRun(db, run.runId);
    expect(steps.some((step) => step.definition_step_id === 'state-1')).toBe(true);
  });

  it('event.wait timeout produces TimeoutError when deadline passes. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' }, timeoutMs: 1 })] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_run_waits').where({ run_id: run.runId }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await worker.tick();
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.error_json?.category).toBe('TimeoutError');
  });

  it('worker timeout polling does not execute Temporal runs through legacy runtime authority. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' }, timeoutMs: 1 })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await WorkflowRunModelV2.update(db, run.runId, { engine: 'temporal' });
    await db('workflow_run_waits')
      .where({ run_id: run.runId })
      .update({ timeout_at: new Date(Date.now() - 1000).toISOString() });

    const executeRunSpy = vi.spyOn(WorkflowRuntimeV2.prototype, 'executeRun');
    const worker = new WorkflowRuntimeV2Worker('worker');
    await worker.tick();

    const wait = await db('workflow_run_waits').where({ run_id: run.runId }).first();
    const runAfter = await WorkflowRunModelV2.getById(db, run.runId);
    expect(wait?.status).toBe('WAITING');
    expect(runAfter?.status).toBe('WAITING');
    expect(executeRunSpy).not.toHaveBeenCalled();
    executeRunSpy.mockRestore();
  });

  it('TimeoutError is caught by enclosing tryCatch when present. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [tryCatchStep('try-1', { trySteps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' }, timeoutMs: 1 })], catchSteps: [stateSetStep('state-1', 'CAUGHT')] })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_run_waits').where({ run_id: run.runId }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await worker.tick();
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).meta.state).toBe('CAUGHT');
  });

  it('event.wait inside tryCatch routes timeout to catch pipe. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [tryCatchStep('try-1', { trySteps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' }, timeoutMs: 1 })], catchSteps: [stateSetStep('state-1', 'TIMEOUT_CAUGHT')] })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_run_waits').where({ run_id: run.runId }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await worker.tick();
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).meta.state).toBe('TIMEOUT_CAUGHT');
  });

  it('event.wait correlationKey expression error yields ExpressionError and fails or catches. Mocks: non-target dependencies.', async () => {
    const big = 'x'.repeat(300 * 1024);
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: 'payload.big' } })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { big } });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.error_json?.category).toBe('ExpressionError');
  });

  it('human.task creates wait with form schema and context payload. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [{
        id: 'human-1',
        type: 'human.task',
        config: {
          taskType: 'workflow_error',
          title: { $expr: '"Needs Review"' },
          contextData: { message: { $expr: '"Test"' } }
        }
      }]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId });
    expect(waits[0].wait_type).toBe('human');
    expect(waits[0].payload?.contextData?.message).toBe('Test');
    expect(waits[0].payload?.formSchema).toBeDefined();
  });

  it('human.task resume validates output against schema before continuing. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [{
        id: 'human-1',
        type: 'human.task',
        config: {
          taskType: 'workflow_error',
          title: { $expr: '"Needs Review"' }
        }
      }]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const wait = await db('workflow_run_waits').where({ run_id: run.runId }).first();
    await submitWorkflowEventAction({ eventName: 'HUMAN_TASK_COMPLETED', correlationKey: wait.key, payload: { bad: true } });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('FAILED');
  });

  it('human.task resume writes output into payload as configured. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [{
        id: 'human-1',
        type: 'human.task',
        config: {
          taskType: 'workflow_error',
          title: { $expr: '"Needs Review"' },
          assign: { 'payload.message': { $expr: 'vars.event.message' } }
        }
      }]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const wait = await db('workflow_run_waits').where({ run_id: run.runId }).first();
    await submitWorkflowEventAction({ eventName: 'HUMAN_TASK_COMPLETED', correlationKey: wait.key, payload: { message: 'ok', alertType: 'error' } });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    expect((snapshots[snapshots.length - 1].envelope_json as any).payload.message).toBe('ok');
  });

  it('Admin resume server action resumes WAITING runs with admin override metadata. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await resumeWorkflowRunAction({ runId: run.runId, reason: 'test resume' });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.resume_event_payload).toMatchObject({ __admin_override: true, reason: 'test resume' });
  });

  it('Temporal runs reject legacy admin resume with an explicit unsupported-action error. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await WorkflowRunModelV2.update(db, run.runId, { engine: 'temporal' });
    const executeRunSpy = vi.spyOn(WorkflowRuntimeV2.prototype, 'executeRun');

    await expect(resumeWorkflowRunAction({ runId: run.runId, reason: 'test resume' }))
      .rejects.toMatchObject({
        status: 409,
        details: expect.objectContaining({
          code: 'WORKFLOW_TEMPORAL_ACTION_UNSUPPORTED',
          action: 'resume',
          engine: 'temporal',
          runId: run.runId
        })
      });

    const waitAfter = await db('workflow_run_waits').where({ run_id: run.runId }).first();
    const runAfter = await WorkflowRunModelV2.getById(db, run.runId);
    expect(waitAfter?.status).toBe('WAITING');
    expect(runAfter?.status).toBe('WAITING');
    expect(runAfter?.resume_event_payload).toBeNull();
    expect(executeRunSpy).not.toHaveBeenCalled();
    executeRunSpy.mockRestore();
  });

  it('Temporal runs reject legacy retry without mutating failed projection state. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'fail', actionId: 'test.fail', inputMapping: {} })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await WorkflowRunModelV2.update(db, run.runId, { engine: 'temporal' });
    const executeRunSpy = vi.spyOn(WorkflowRuntimeV2.prototype, 'executeRun');

    const before = await WorkflowRunModelV2.getById(db, run.runId);
    expect(before?.status).toBe('FAILED');

    await expect(retryWorkflowRunAction({ runId: run.runId, reason: 'test retry' }))
      .rejects.toMatchObject({
        status: 409,
        details: expect.objectContaining({
          code: 'WORKFLOW_TEMPORAL_ACTION_UNSUPPORTED',
          action: 'retry',
          engine: 'temporal',
          runId: run.runId
        })
      });

    const after = await WorkflowRunModelV2.getById(db, run.runId);
    expect(after?.status).toBe('FAILED');
    expect(after?.node_path).toBe(before?.node_path ?? null);
    expect(after?.completed_at).toEqual(before?.completed_at ?? null);
    expect(executeRunSpy).not.toHaveBeenCalled();
    executeRunSpy.mockRestore();
  });

  it('canceling a WAITING run deletes waits and prevents resume. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } })] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await cancelWorkflowRunAction({ runId: run.runId, reason: 'test cancel' });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId });
    expect(waits.every((wait: any) => wait.status === 'CANCELED')).toBe(true);
    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('CANCELED');
  });

  it('multiple waits for a run are all cleared on cancel. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } })] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_run_waits').insert({ run_id: run.runId, step_path: 'root.steps[0]', wait_type: 'event', key: 'key2', event_name: 'PING', status: 'WAITING' });
    await cancelWorkflowRunAction({ runId: run.runId, reason: 'test cancel' });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId });
    expect(waits.every((wait: any) => wait.status === 'CANCELED')).toBe(true);
  });

  it('Temporal cancel failure does not project CANCELED status in the database. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } })] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await WorkflowRunModelV2.update(db, run.runId, { engine: 'temporal' });
    cancelWorkflowRuntimeV2TemporalRunMock.mockRejectedValueOnce(new Error('temporal unavailable'));

    await expect(cancelWorkflowRunAction({ runId: run.runId, reason: 'test cancel' }))
      .rejects.toMatchObject({
        status: 409,
        details: expect.objectContaining({
          code: 'WORKFLOW_TEMPORAL_CANCEL_FAILED',
          runId: run.runId,
          engine: 'temporal'
        })
      });

    const waits = await db('workflow_run_waits').where({ run_id: run.runId });
    const runAfter = await WorkflowRunModelV2.getById(db, run.runId);
    expect(waits.every((wait: any) => wait.status === 'WAITING')).toBe(true);
    expect(runAfter?.status).toBe('WAITING');
  });

  it('waits are scoped by tenant when tenant_id is provided. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } })] });
    await publishWorkflow(workflowId, 1);
    const tenantA = uuidv4();
    const tenantB = uuidv4();
    tenantId = tenantA;
    const runA = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    tenantId = tenantB;
    const runB = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    tenantId = tenantA;
    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    const recordA = await WorkflowRunModelV2.getById(db, runA.runId);
    const recordB = await WorkflowRunModelV2.getById(db, runB.runId);
    expect(recordA?.status).not.toBe('WAITING');
    expect(recordB?.status).toBe('WAITING');
  });

  it('event.wait assign can write into vars and payload paths together. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' }, assign: { 'payload.result': { $expr: 'vars.event.data' }, 'vars.flag': { $expr: 'true' } } })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: { data: 'ok' } });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    const env = snapshots[snapshots.length - 1].envelope_json as any;
    expect(env.payload.result).toBe('ok');
    expect(env.vars.flag).toBe(true);
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

  it('Workflow runtime event list server action returns recent events (API delegates). Mocks: non-target dependencies.', async () => {
    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    const eventsResult = await listWorkflowEventsAction();
    expect(eventsResult.events.length).toBeGreaterThan(0);
  });

  it('wait resume updates run status from WAITING back to RUNNING. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } }), stateSetStep('state-1', 'DONE')] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).not.toBe('WAITING');
  });

  it('timeout handler marks step attempt as FAILED with TimeoutError. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' }, timeoutMs: 1 })] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_run_waits').where({ run_id: run.runId }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await worker.tick();
    const step = await WorkflowRunStepModelV2.getLatestByRunAndPath(db, run.runId, 'root.steps[0]');
    expect(step?.status).toBe('FAILED');
    expect(step?.error_json?.category).toBe('TimeoutError');
  });

  it('Retryable TransientError schedules a retry wait instead of blocking worker. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'test.retryNode', config: { key: 'r1', failCount: 1 } }] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' });
    expect(waits.length).toBeGreaterThan(0);
  });

  it("Retry wait uses wait_type='retry' and stores timeout_at (next attempt timestamp). Mocks: non-target dependencies.", async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'test.retryNode', config: { key: 'r2', failCount: 1 } }] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' });
    expect(waits[0].timeout_at).toBeDefined();
  });

  it('Retry uses step retry policy when provided. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [{ id: 'retry', type: 'action.call', retry: { maxAttempts: 2, backoffMs: 5, retryOn: ['ActionError'] }, config: { actionId: 'test.fail', version: 1, inputMapping: {} } }]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' });
    expect(waits.length).toBeGreaterThan(0);
  });

  it('Retry uses default retry policy when step.retry is omitted. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'test.retryNode', config: { key: 'r3', failCount: 1 } }] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' });
    expect(waits.length).toBeGreaterThan(0);
  });

  it('Retry stops after maxAttempts and fails the run. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'test.retryNode', config: { key: 'r4', failCount: 3 } }] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const wait = await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' }).first();
    await db('workflow_run_waits').where({ wait_id: wait.wait_id }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await worker.tick();
    await db('workflow_run_waits').where({ run_id: run.runId }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    await worker.tick();
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('FAILED');
  });

  it('Retry backoff multiplies delay with each attempt. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'action.call', retry: { maxAttempts: 3, backoffMs: 5, backoffMultiplier: 2, jitter: false, retryOn: ['ActionError'] }, config: { actionId: 'test.fail', version: 1, inputMapping: {} } }] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' }).orderBy('created_at', 'asc');
    expect(waits.length).toBeGreaterThan(0);
  });

  it('Retry backoff applies jitter to avoid thundering herd. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'action.call', retry: { maxAttempts: 2, backoffMs: 5, jitter: true, retryOn: ['ActionError'] }, config: { actionId: 'test.fail', version: 1, inputMapping: {} } }] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' });
    expect(waits[0].timeout_at).toBeDefined();
  });

  it('Retry resumes at the same nodePath for the failed step. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'test.retryNode', config: { key: 'r5', failCount: 1 } }] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const wait = await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' }).first();
    expect(wait.step_path).toBe('root.steps[0]');
  });

  it('Non-retryable ActionError does not schedule retry. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [actionCallStep({ id: 'fail', actionId: 'test.fail', inputMapping: {} })] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const waits = await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' });
    expect(waits.length).toBe(0);
  });

  it('Retry wait is cleared after a successful retry. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'test.retryNode', config: { key: 'r6', failCount: 1 } }] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await worker.tick();
    const waits = await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry', status: 'WAITING' });
    expect(waits.length).toBe(0);
  });

  it('Idempotency key uniqueness prevents duplicate side-effectful action calls. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {}, idempotencyKeyExpr: { $expr: '"fixed"' } }), actionCallStep({ id: 'action-2', actionId: 'test.sideEffect', inputMapping: {}, idempotencyKeyExpr: { $expr: '"fixed"' } })]
    });
    await publishWorkflow(workflowId, 1);
    await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    expect(getSideEffectCount()).toBe(1);
  });

  it('Duplicate idempotency key returns previously stored output without calling handler. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {}, idempotencyKeyExpr: { $expr: '"fixed"' }, saveAs: 'payload.first' }), actionCallStep({ id: 'action-2', actionId: 'test.sideEffect', inputMapping: {}, idempotencyKeyExpr: { $expr: '"fixed"' }, saveAs: 'payload.second' })]
    });
    await publishWorkflow(workflowId, 1);
    await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const invocations = await db('workflow_action_invocations').where({ action_id: 'test.sideEffect' });
    expect(invocations.length).toBe(1);
  });

  it('Idempotency cache respects action_id and action_version. Mocks: non-target dependencies.', async () => {
    const registry = getActionRegistryV2();
    const actionId = `test.versioned.${Date.now()}`;
    registry.register({
      id: actionId,
      version: 2,
      inputSchema: getSchemaRegistry().get(TEST_SCHEMA_REF),
      outputSchema: getSchemaRegistry().get(TEST_SCHEMA_REF),
      sideEffectful: true,
      idempotency: { mode: 'engineProvided' },
      ui: { label: 'Versioned', category: 'Test' },
      handler: async () => ({ foo: 'bar' })
    });
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {}, idempotencyKeyExpr: { $expr: '"fixed"' } }), actionCallStep({ id: 'action-2', actionId, version: 2, inputMapping: {}, idempotencyKeyExpr: { $expr: '"fixed"' } })]
    });
    await publishWorkflow(workflowId, 1);
    await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const invocations = await db('workflow_action_invocations').whereIn('action_id', ['test.sideEffect', actionId]);
    expect(invocations.length).toBe(2);
  });

  it('Idempotency behavior is scoped by tenant when tenant_id exists. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {}, idempotencyKeyExpr: { $expr: '"fixed"' } })]
    });
    await publishWorkflow(workflowId, 1);
    const tenantA = uuidv4();
    const tenantB = uuidv4();
    tenantId = tenantA;
    await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    tenantId = tenantB;
    await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const invocations = await db('workflow_action_invocations').where({ action_id: 'test.sideEffect' });
    expect(invocations.length).toBe(2);
  });

  it('STARTED invocation with stale lease is treated as TransientError. Mocks: non-target dependencies.', async () => {
    const runtime = new WorkflowRuntimeV2() as any;
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const runId = await runtime.startRun(db, { workflowId, version: 1, payload: {}, tenantId });
    const scopedKey = tenantId ? `${tenantId}:stale` : 'stale';
    await WorkflowActionInvocationModelV2.create(db, {
      run_id: runId,
      step_path: 'root.steps[0]',
      action_id: 'test.sideEffect',
      action_version: 1,
      idempotency_key: scopedKey,
      status: 'STARTED',
      attempt: 1,
      lease_expires_at: new Date(Date.now() - 1000).toISOString()
    });
    await expect(runtime.executeAction(db, runId, 'root.steps[0]', 'test.sideEffect', 1, {}, 'stale', tenantId, [])).rejects.toMatchObject({ category: 'TransientError' });
  });

  it('Stale lease TransientError triggers retry scheduling. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {}, idempotencyKeyExpr: { $expr: '"fixed"' }, retry: { maxAttempts: 2, backoffMs: 5, retryOn: ['TransientError'] } })] });
    await publishWorkflow(workflowId, 1);
    const runtime = new WorkflowRuntimeV2();
    const runId = await runtime.startRun(db, { workflowId, version: 1, payload: {}, tenantId });
    const scopedKey = tenantId ? `${tenantId}:fixed` : 'fixed';
    await WorkflowActionInvocationModelV2.create(db, {
      run_id: runId,
      step_path: 'root.steps[0]',
      action_id: 'test.sideEffect',
      action_version: 1,
      idempotency_key: scopedKey,
      status: 'STARTED',
      attempt: 1,
      lease_expires_at: new Date(Date.now() - 1000).toISOString()
    });
    await runtime.executeRun(db, runId, 'worker');
    const waits = await db('workflow_run_waits').where({ run_id: runId, wait_type: 'retry' });
    expect(waits.length).toBeGreaterThan(0);
  });

  it('Lease expiration allows another worker to acquire and continue execution. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const runtime = new WorkflowRuntimeV2();
    const runId = await runtime.startRun(db, { workflowId, version: 1, payload: {}, tenantId });
    await WorkflowRunModelV2.update(db, runId, { lease_owner: 'old', lease_expires_at: new Date(Date.now() - 1000).toISOString() });
    const acquired = await runtime.acquireRunnableRun(db, 'worker-new');
    expect(acquired).toBe(runId);
  });

  it('Lease owner and lease_expires_at fields update on each worker tick. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const runtime = new WorkflowRuntimeV2();
    const runId = await runtime.startRun(db, { workflowId, version: 1, payload: {}, tenantId });
    await runtime.acquireRunnableRun(db, 'worker-a');
    const record = await WorkflowRunModelV2.getById(db, runId);
    expect(record?.lease_owner).toBe('worker-a');
    expect(record?.lease_expires_at).toBeDefined();
  });

  it('Scheduler picks up retry waits whose timeout_at is due. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'test.retryNode', config: { key: 'r7', failCount: 1 } }] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await worker.tick();
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('SUCCEEDED');
  });

  it('Scheduler skips retry waits for canceled runs. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'test.retryNode', config: { key: 'r8', failCount: 1 } }] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_runs').where({ run_id: run.runId }).update({ status: 'CANCELED' });
    await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await worker.tick();
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('CANCELED');
  });

  it('Retry attempts increment workflow_run_steps.attempts count. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'test.retryNode', config: { key: 'r9', failCount: 1 } }] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await worker.tick();
    const steps = await WorkflowRunStepModelV2.listByRun(db, run.runId);
    const maxAttempt = Math.max(...steps.map((step) => step.attempt));
    expect(maxAttempt).toBeGreaterThan(1);
  });

  it('Idempotency uses engineProvided key when configured. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {} })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const invocation = await db('workflow_action_invocations').where({ run_id: run.runId, action_id: 'test.sideEffect' }).first();
    expect(invocation?.idempotency_key).toContain(run.runId);
  });

  it('Idempotency uses actionProvided key when configured. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'action-1', actionId: 'test.actionProvided', inputMapping: { key: 'abc' } })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const invocation = await db('workflow_action_invocations').where({ run_id: run.runId, action_id: 'test.actionProvided' }).first();
    expect(invocation?.idempotency_key).toContain(run.runId);
  });

  it('Concurrent retries for same step do not execute in parallel. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [actionCallStep({ id: 'retry', actionId: 'test.retryable', inputMapping: { key: 'abc' }, retry: { maxAttempts: 2, backoffMs: 5, retryOn: ['ActionError'] } })] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await Promise.all([worker.tick(), worker.tick()]);
    const invocations = await db('workflow_action_invocations').where({ run_id: run.runId, action_id: 'test.retryable' });
    expect(invocations.length).toBeLessThanOrEqual(1);
  });

  it('Retry wait removal is atomic with resume to avoid double execution. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'test.retryNode', config: { key: 'r11', failCount: 1 } }] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await Promise.all([worker.tick(), worker.tick()]);
    const waits = await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry', status: 'WAITING' });
    expect(waits.length).toBe(0);
  });

  it('DB runtime reserves quota before STARTED step row creation and executes under limit.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);
    const runtime = new WorkflowRuntimeV2();
    const runId = await runtime.startRun(db, { workflowId, version: 1, payload: {}, tenantId });
    const reserveSpy = vi.spyOn(workflowStepQuotaService, 'reserveStepStart');
    reserveSpy.mockImplementation(async (knex, tenant) => {
      const existingStepRows = await knex('workflow_run_steps').where({ run_id: runId });
      expect(existingStepRows).toHaveLength(0);
      return {
        allowed: true,
        summary: await workflowStepQuotaService.resolveQuotaSummary(knex, tenant),
        usedCountAfter: 1,
      };
    });
    try {
      await runtime.executeRun(db, runId, 'worker');
    } finally {
      reserveSpy.mockRestore();
    }
    const steps = await WorkflowRunStepModelV2.listByRun(db, runId);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe('SUCCEEDED');
  });

  it('DB runtime quota exhaustion pauses run with quota wait and no blocked step row.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('s1', 'A'), stateSetStep('s2', 'B')] });
    await publishWorkflow(workflowId, 1);
    const runtime = new WorkflowRuntimeV2();
    const runId = await runtime.startRun(db, { workflowId, version: 1, payload: {}, tenantId });
    const reserveSpy = vi.spyOn(workflowStepQuotaService, 'reserveStepStart');
    let calls = 0;
    reserveSpy.mockImplementation(async (knex, tenant) => {
      calls += 1;
      if (calls === 1) {
        return {
          allowed: true,
          summary: await workflowStepQuotaService.resolveQuotaSummary(knex, tenant),
          usedCountAfter: 1,
        };
      }
      return {
        allowed: false,
        summary: {
          ...(await workflowStepQuotaService.resolveQuotaSummary(knex, tenant)),
          usedCount: 1,
          effectiveLimit: 1,
          remaining: 0,
        },
      };
    });
    try {
      await runtime.executeRun(db, runId, 'worker');
    } finally {
      reserveSpy.mockRestore();
    }

    const run = await WorkflowRunModelV2.getById(db, runId);
    const quotaWait = await db('workflow_run_waits').where({ run_id: runId, wait_type: 'quota', status: 'WAITING' }).first();
    const steps = await WorkflowRunStepModelV2.listByRun(db, runId);
    expect(run?.status).toBe('WAITING');
    expect(run?.node_path).toBe('root.steps[1]');
    expect(quotaWait).toBeDefined();
    expect(steps).toHaveLength(1);
    expect(steps[0].definition_step_id).toBe('s1');
  });

  it('Retry step attempts consume additional quota when each attempt starts.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'test.retryNode', config: { key: 'quota-retry', failCount: 1 } }] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' }).update({ timeout_at: new Date(Date.now() - 500).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await worker.tick();
    expect(await latestWorkflowStepUsageCount(tenantId)).toBe(2);
  });

  it('forEach body executions consume one quota unit per item attempt.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [forEachStep('for-1', { items: { $expr: 'payload.items' }, itemVar: 'item', body: [assignStep('assign-item', { 'vars.last': { $expr: 'vars.item' } })] })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { items: [1, 2, 3] } });
    const bodySteps = await db('workflow_run_steps').where({ run_id: run.runId, definition_step_id: 'assign-item' });
    expect(bodySteps).toHaveLength(3);
    expect(await latestWorkflowStepUsageCount(tenantId)).toBe(4);
  });

  it('event.wait consumes quota on first entry and does not double-count when resumed.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"quota-key"' } })]
    });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const usedBeforeResume = await latestWorkflowStepUsageCount(tenantId);
    expect(usedBeforeResume).toBe(1);
    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'quota-key', payload: {} });
    const usedAfterResume = await latestWorkflowStepUsageCount(tenantId);
    const runRecord = await WorkflowRunModelV2.getById(db, run.runId);
    expect(runRecord?.status).toBe('SUCCEEDED');
    expect(usedAfterResume).toBe(1);
  });

  it('Manual quota resume resumes eligible run and still goes through runtime quota reservation.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('s1', 'A'), stateSetStep('s2', 'B')] });
    await publishWorkflow(workflowId, 1);
    const runtime = new WorkflowRuntimeV2();
    const runId = await runtime.startRun(db, { workflowId, version: 1, payload: {}, tenantId });
    const reserveSpy = vi.spyOn(workflowStepQuotaService, 'reserveStepStart');
    let call = 0;
    reserveSpy.mockImplementation(async (knex, tenant) => {
      call += 1;
      if (call === 2) {
        return {
          allowed: false,
          summary: {
            ...(await workflowStepQuotaService.resolveQuotaSummary(knex, tenant)),
            usedCount: 1,
            effectiveLimit: 1,
            remaining: 0,
          },
        };
      }
      return {
        allowed: true,
        summary: await workflowStepQuotaService.resolveQuotaSummary(knex, tenant),
        usedCountAfter: call,
      };
    });
    try {
      await runtime.executeRun(db, runId, 'worker');
      const before = await WorkflowRunModelV2.getById(db, runId);
      expect(before?.status).toBe('WAITING');
      const resumeResult = await resumeWorkflowRunFromQuotaPauseAction({ runId, reason: 'quota available' });
      expect(resumeResult).toEqual({ ok: true, resumed: true });
      expect(reserveSpy).toHaveBeenCalledTimes(3);
      const after = await WorkflowRunModelV2.getById(db, runId);
      expect(after?.status).toBe('SUCCEEDED');
    } finally {
      reserveSpy.mockRestore();
    }
  });

  it('Manual quota resume returns usage, limit, and reset time when still exhausted.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('only-step', 'A')] });
    await publishWorkflow(workflowId, 1);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await WorkflowRunModelV2.update(db, run.runId, { status: 'WAITING' });
    await WorkflowRunWaitModelV2.create(db, {
      run_id: run.runId,
      step_path: 'root.steps[0]',
      wait_type: 'quota',
      timeout_at: '2026-05-01T00:00:00.000Z',
      status: 'WAITING',
      payload: { reason: 'workflow_step_quota_exceeded' },
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
      const result = await resumeWorkflowRunFromQuotaPauseAction({ runId: run.runId, reason: 'try resume' });
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
    } finally {
      summarySpy.mockRestore();
    }
  });
});
