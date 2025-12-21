import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { resetWorkflowRuntimeTables } from '../helpers/workflowRuntimeV2TestUtils';
import { createTenantKnex, getCurrentTenantId } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import {
  createWorkflowDefinitionAction,
  publishWorkflowDefinitionAction,
  startWorkflowRunAction,
  submitWorkflowEventAction,
  listWorkflowRunStepsAction
} from 'server/src/lib/actions/workflow-runtime-v2-actions';
import WorkflowRunSnapshotModelV2 from '@shared/workflow/persistence/workflowRunSnapshotModelV2';
import {
  ensureWorkflowRuntimeV2TestRegistrations,
  buildWorkflowDefinition,
  actionCallStep,
  stateSetStep,
  eventWaitStep
} from '../helpers/workflowRuntimeV2TestHelpers';

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(),
  getCurrentTenantId: vi.fn()
}));

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn()
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn().mockResolvedValue(true)
}));

const mockedCreateTenantKnex = vi.mocked(createTenantKnex);
const mockedGetCurrentTenantId = vi.mocked(getCurrentTenantId);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);

let db: Knex;
let tenantId: string;
let userId: string;

async function createDraftWorkflow(params: { steps: any[]; payloadSchemaRef?: string; name?: string }) {
  const definition = {
    id: uuidv4(),
    ...buildWorkflowDefinition({
      steps: params.steps,
      payloadSchemaRef: params.payloadSchemaRef,
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
  mockedGetCurrentTenantId.mockReturnValue(tenantId);
  mockedGetCurrentUser.mockResolvedValue({ user_id: userId, roles: [] } as any);
});

afterAll(async () => {
  await db.destroy();
});

describe('workflow runtime v2 redaction + snapshot integration tests', () => {
  it('Envelope snapshots stored with redacted secretRef fields. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);

    const run = await startWorkflowRunAction({
      workflowId,
      workflowVersion: 1,
      payload: { secretRef: 'super-secret', nested: { secretRef: 'nested' } }
    });

    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    const payload = (snapshots[snapshots.length - 1].envelope_json as any).payload;
    expect(payload.secretRef).toBe('[REDACTED]');
    expect(payload.nested.secretRef).toBe('[REDACTED]');
  });

  it('Action invocation logs store redacted input/output JSON. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [actionCallStep({ id: 'action-1', actionId: 'test.echo', args: { value: { secretRef: 'token' } }, saveAs: 'payload.output' })]
    });
    await publishWorkflow(workflowId, 1);

    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const invocation = await db('workflow_action_invocations').where({ run_id: run.runId }).first();
    expect(invocation?.input_json?.value?.secretRef).toBe('[REDACTED]');
    expect(invocation?.output_json?.value?.secretRef).toBe('[REDACTED]');
  });

  it('Snapshot size truncation preserves JSON validity. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')]
    });
    await publishWorkflow(workflowId, 1);

    const big = 'x'.repeat(300 * 1024);
    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { big } });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    const envelope = snapshots[snapshots.length - 1].envelope_json as any;
    expect(envelope.truncated).toBe(true);
    expect(() => JSON.stringify(envelope)).not.toThrow();
  });

  it('Snapshot retention prunes snapshots older than the configured retention window (defaults to 30 days). Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        stateSetStep('state-1', 'FIRST'),
        eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } }),
        stateSetStep('state-2', 'SECOND')
      ]
    });
    await publishWorkflow(workflowId, 1);

    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    const oldSnapshot = snapshots[0];

    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    await db('workflow_run_snapshots').where({ snapshot_id: oldSnapshot.snapshot_id }).update({ created_at: oldDate });

    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });

    const updated = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    const ids = updated.map((snap) => snap.snapshot_id);
    expect(ids).not.toContain(oldSnapshot.snapshot_id);
  });

  it('Run steps response includes snapshot references without exposing raw secrets. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);

    const run = await startWorkflowRunAction({
      workflowId,
      workflowVersion: 1,
      payload: { secretRef: 'super-secret' }
    });

    const result = await listWorkflowRunStepsAction({ runId: run.runId });
    const lastSnapshot = result.snapshots[result.snapshots.length - 1] as any;
    expect(lastSnapshot.envelope_json.payload.secretRef).toBe('[REDACTED]');
  });
});
