import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import WorkflowDefinition from '@alga-psa/workflows/persistence/workflowDefinitionModelV2';
import WorkflowRun from '@alga-psa/workflows/persistence/workflowRunModelV2';
import Invocation from '@alga-psa/workflows/persistence/workflowActionInvocationModelV2';

const actionHandler = vi.hoisted(() => vi.fn());
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => db,
  retryOnAdminReadOnly: async (fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@alga-psa/workflows/runtime/core', async (importOriginal) => ({
  ...await importOriginal<any>(),
  initializeWorkflowRuntimeV2: () => {},
  getActionRegistryV2: () => ({ get: () => ({
    inputSchema: { parse: (value: unknown) => value },
    outputSchema: { parse: (value: unknown) => value },
    handler: actionHandler,
  }) }),
}));

let db: Knex;
beforeAll(async () => { db = await createTestDbConnection(); }, 180_000);
afterAll(async () => { await db?.destroy(); });
it('persists one concurrent invocation per tenant key and isolates lookup and updates', async () => {
  const tenants = [randomUUID(), randomUUID()];
  const records = [];
  for (const tenant of tenants) {
    const workflow = await WorkflowDefinition.create(db, tenant, {
      name: 'Invocation persistence regression', payload_schema_ref: 'payload.EmailWorkflowPayload.v1',
      draft_definition: {} as any, draft_version: 1,
    });
    const run = await WorkflowRun.create(db, { workflow_id: workflow.workflow_id, workflow_version: 1, tenant, status: 'RUNNING' });
    records.push({ tenant, run_id: run.run_id, step_path: 'root.steps[0]', action_id: 'create_comment_from_parsed_email',
      action_version: 1, idempotency_key: `${tenant}:message-1:ticket-1`, status: 'STARTED', attempt: 1,
      input_json: { ticketId: 'ticket-1' } });
  }
  const contenders = await Promise.allSettled([Invocation.create(db, records[0]), Invocation.create(db, records[0])]);
  expect(contenders.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = contenders.find(result => result.status === 'rejected') as PromiseRejectedResult;
  expect(rejected.reason.code).toBe('23505');
  const winner = (contenders.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
  await Invocation.create(db, records[1]);
  await Invocation.update(db, winner.invocation_id, { status: 'SUCCEEDED', output_json: { commentId: 'comment-1' } }, tenants[0]);
  const saved = await Invocation.findByIdempotency(db, records[0].action_id, 1, records[0].idempotency_key, tenants[0]);
  expect(saved).toMatchObject({ status: 'SUCCEEDED', input_json: { ticketId: 'ticket-1' }, output_json: { commentId: 'comment-1' } });
  expect(await Invocation.findByIdempotency(db, records[0].action_id, 1, records[0].idempotency_key, tenants[1])).toBeNull();
  await Invocation.update(db, winner.invocation_id, { status: 'FAILED' }, tenants[1]);
  expect((await Invocation.findByIdempotency(db, records[0].action_id, 1, records[0].idempotency_key, tenants[0]))?.status).toBe('SUCCEEDED');
  expect(await Invocation.listByRun(db, records[0].run_id, tenants[0])).toHaveLength(1);
  expect(await Invocation.listByRun(db, records[0].run_id, tenants[1])).toEqual([]);
  await Invocation.update(db, winner.invocation_id, { status: 'FAILED', error_message: 'Temporary provider failure' }, tenants[0]);
  expect(await Invocation.claimFailed(db, winner.invocation_id, tenants[1])).toBeNull();
  const claims = await Promise.all([Invocation.claimFailed(db, winner.invocation_id, tenants[0]), Invocation.claimFailed(db, winner.invocation_id, tenants[0])]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(claims.find(Boolean)).toMatchObject({ invocation_id: winner.invocation_id, status: 'STARTED', attempt: 2, error_message: null, completed_at: null });
  expect(await Invocation.claimFailed(db, winner.invocation_id, tenants[0])).toBeNull();

});

it('retries a failed activity on its persisted row and replays success without another action', async () => {
  const tenant = randomUUID();
  const workflow = await WorkflowDefinition.create(db, tenant, {
    name: 'Activity retry regression', payload_schema_ref: 'payload.EmailWorkflowPayload.v1', draft_definition: {} as any, draft_version: 1,
  });
  const run = await WorkflowRun.create(db, { workflow_id: workflow.workflow_id, workflow_version: 1, tenant, status: 'RUNNING' });
  const { executeWorkflowRuntimeV2ActionStep } = await import('../../../../ee/temporal-workflows/src/activities/workflow-runtime-v2-activities');
  const input: any = {
    runId: run.run_id, stepId: randomUUID(), stepPath: 'root.steps[0]', tenantId: tenant,
    step: { type: 'action.call', config: { actionId: 'email-retry-regression', version: 1,
      inputMapping: { messageId: { $expr: 'payload.messageId' } }, idempotencyKey: { $expr: 'payload.messageId' } } },
    scopes: { payload: { messageId: 'message-retry' }, workflow: {}, lexical: [], meta: {}, error: null,
      system: { runId: run.run_id, workflowId: workflow.workflow_id, workflowVersion: 1, tenantId: tenant } },
  };
  actionHandler.mockRejectedValueOnce(new Error('Temporary delivery failure')).mockResolvedValue({ commentId: 'comment-recovered' });
  await expect(executeWorkflowRuntimeV2ActionStep(input)).rejects.toMatchObject({ message: 'Temporary delivery failure' });
  const failed = await Invocation.findByIdempotency(db, 'email-retry-regression', 1, `${tenant}:message-retry`, tenant);
  expect(failed).toMatchObject({ status: 'FAILED', attempt: 1 });
  expect((await executeWorkflowRuntimeV2ActionStep(input)).output).toEqual({ commentId: 'comment-recovered' });
  expect((await executeWorkflowRuntimeV2ActionStep(input)).output).toEqual({ commentId: 'comment-recovered' });
  const rows = await Invocation.listByRun(db, run.run_id, tenant);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ invocation_id: failed?.invocation_id, status: 'SUCCEEDED', attempt: 2,
    input_json: { messageId: 'message-retry' }, output_json: { commentId: 'comment-recovered' } });
  expect(actionHandler).toHaveBeenCalledTimes(2);
  expect(actionHandler).toHaveBeenLastCalledWith({ messageId: 'message-retry' }, expect.objectContaining({ attempt: 2, idempotencyKey: `${tenant}:message-retry` }));
});
