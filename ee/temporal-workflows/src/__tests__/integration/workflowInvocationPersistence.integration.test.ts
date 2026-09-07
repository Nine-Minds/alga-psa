import { buildWorkflowDiagnosticSnapshot } from '@alga-psa/workflows/runtime/utils/redactionUtils';
import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';
import WorkflowDefinition from '@alga-psa/workflows/persistence/workflowDefinitionModelV2';
import WorkflowRun from '@alga-psa/workflows/persistence/workflowRunModelV2';
import Invocation, { type WorkflowActionInvocationRecord } from '@alga-psa/workflows/persistence/workflowActionInvocationModelV2';

const actionHandler = vi.hoisted(() => vi.fn());
const registeredAction = vi.hoisted(() => ({ current: null as any }));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<any>(),
  withAdminTransaction: async (fn: any) => db.transaction(fn),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => db,
  retryOnAdminReadOnly: async (fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@alga-psa/workflows/runtime/core', async (importOriginal) => ({
  ...await importOriginal<any>(),
  initializeWorkflowRuntimeV2: () => {},
  getActionRegistryV2: () => ({ get: () => registeredAction.current ?? ({
    inputSchema: { parse: (value: unknown) => value },
    outputSchema: { parse: (value: unknown) => value },
    handler: actionHandler,
  }) }),
}));

let db: Knex;
beforeEach(() => { actionHandler.mockReset(); registeredAction.current = null; });
it('stores redacted bounded step snapshots with idempotent writes and retention', async () => {
  const Step = (await import('@alga-psa/workflows/persistence/workflowRunStepModelV2')).default;
  const Snapshot = (await import('@alga-psa/workflows/persistence/workflowRunSnapshotModelV2')).default;
  const { projectWorkflowRuntimeV2StepCompletion: complete } = await import('../../activities/workflow-runtime-v2-activities');
  const tenant = randomUUID();
  const definition = await WorkflowDefinition.create(db, tenant, { name: 'Snapshots', payload_schema_ref: 'payload.EmailWorkflowPayload.v1', draft_definition: {} as any, draft_version: 1 });
  const run = await WorkflowRun.create(db, { workflow_id: definition.workflow_id, workflow_version: 1, tenant, status: 'RUNNING' });
  const scopes: any = { payload: { secretRef: 'private', nested: [{ $secret: 'private' }], token: 'resolved', public: 'visible' }, workflow: {}, lexical: [], meta: { redactions: ['/payload/token'] } };
  const original = structuredClone(scopes);
  const step = await Step.create(db, { tenant, run_id: run.run_id, step_path: 'first', definition_step_id: 'first', status: 'STARTED', attempt: 1 });
  const completion = { runId: run.run_id, stepId: step.step_id, stepPath: step.step_path, status: 'SUCCEEDED' as const, snapshot: buildWorkflowDiagnosticSnapshot(scopes) };
  await complete(completion);
  await complete(completion);
  const [snapshot] = await Snapshot.listByRun(db, run.run_id, tenant);
  expect(await Snapshot.listByRun(db, run.run_id, tenant)).toHaveLength(1);
  expect(snapshot.envelope_json).toMatchObject({ payload: { secretRef: '[REDACTED]', nested: [{ $secret: '[SECRET:REDACTED]' }], token: '[REDACTED]', public: 'visible' } });
  expect(snapshot.size_bytes).toBe(Buffer.byteLength(JSON.stringify(snapshot.envelope_json)));
  expect((await Step.listByRun(db, run.run_id, tenant))[0].snapshot_id).toBe(snapshot.snapshot_id);
  expect(scopes).toEqual(original);
  await db('workflow_run_snapshots').where({ tenant, snapshot_id: snapshot.snapshot_id }).update({ created_at: new Date(Date.now() - 40 * 86400000) });
  const otherRun = await WorkflowRun.create(db, { workflow_id: definition.workflow_id, workflow_version: 1, tenant, status: 'RUNNING' });
  const unrelated = await Snapshot.create(db, { tenant, run_id: otherRun.run_id, step_path: 'old', envelope_json: {}, size_bytes: 2, created_at: new Date(Date.now() - 40 * 86400000).toISOString() });
  const next = await Step.create(db, { tenant, run_id: run.run_id, step_path: 'second', definition_step_id: 'second', status: 'STARTED', attempt: 1 });
  await complete({ ...completion, stepId: next.step_id, stepPath: next.step_path, snapshot: undefined, scopes: { ...scopes, payload: { big: '💡'.repeat(100000) } } });
  const remaining = await Snapshot.listByRun(db, run.run_id, tenant);
  expect(remaining).toHaveLength(1);
  expect((await Snapshot.listByRun(db, otherRun.run_id, tenant)).map(row => row.snapshot_id)).toEqual([unrelated.snapshot_id]);
  expect((await Step.listByRun(db, run.run_id, tenant)).find(row => row.step_id === step.step_id)?.snapshot_id).toBeNull();
  expect(remaining[0].snapshot_id).not.toBe(snapshot.snapshot_id);
  expect(remaining[0].envelope_json).toMatchObject({ truncated: true, max: 256 * 1024 });
  expect(remaining[0].envelope_json.size).toBeGreaterThan(256 * 1024);
  expect(JSON.parse(JSON.stringify(remaining[0].envelope_json))).toEqual(remaining[0].envelope_json);
});
beforeAll(async () => { db = await createTestDbConnection(); }, 180_000);
afterAll(async () => { await db?.destroy(); });
it('persists one concurrent invocation per tenant key and isolates lookup and updates', async () => {
  const tenants = [randomUUID(), randomUUID()];
  const records: Array<Pick<WorkflowActionInvocationRecord, 'tenant' | 'run_id' | 'step_path' | 'action_id' | 'action_version' | 'idempotency_key' | 'status' | 'attempt' | 'input_json'>> = [];
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
  const { executeWorkflowRuntimeV2ActionStep } = await import('../../activities/workflow-runtime-v2-activities');
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
    input_json: { messageId: 'message-retry' }, output_json: { commentId: 'comment-recovered' }, error_json: null, error_message: null });
  expect(actionHandler).toHaveBeenCalledTimes(2);
  expect(actionHandler).toHaveBeenLastCalledWith({ messageId: 'message-retry' }, expect.objectContaining({ attempt: 2, idempotencyKey: `${tenant}:message-retry` }));
});

it('persists one real email comment and ticket response state across activity replay', async () => {
  const { createTestEnvironment } = await import('../../../../../server/test-utils/testDataFactory');
  const env = await createTestEnvironment(db);
  const tenant = env.tenantId;
  const ticketId = randomUUID();
  await db('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: 'EMAIL-REPLAY', title: 'Email reply', client_id: env.clientId, entered_at: db.fn.now(), updated_at: db.fn.now() });
  const { registerEmailWorkflowActionsV2 } = await import('@alga-psa/shared/workflow/runtime/actions/registerEmailWorkflowActions');
  const { getActionRegistryV2 } = await import('@alga-psa/shared/workflow/runtime/registries/actionRegistry');
  if (!getActionRegistryV2().get('create_comment_from_parsed_email', 1)) registerEmailWorkflowActionsV2();
  registeredAction.current = getActionRegistryV2().get('create_comment_from_parsed_email', 1);
  expect(registeredAction.current).toBeDefined();
  try {
    const workflow = await WorkflowDefinition.create(db, tenant, { name: 'Real email reply', payload_schema_ref: 'payload.EmailWorkflowPayload.v1', draft_definition: {} as any, draft_version: 1 });
    const run = await WorkflowRun.create(db, { workflow_id: workflow.workflow_id, workflow_version: 1, tenant, status: 'RUNNING' });
    const { executeWorkflowRuntimeV2ActionStep } = await import('../../activities/workflow-runtime-v2-activities');
    const input: any = {
      runId: run.run_id, stepId: randomUUID(), stepPath: 'root.steps[0]', tenantId: tenant,
      step: { type: 'action.call', config: { actionId: 'create_comment_from_parsed_email', version: 1,
        inputMapping: { ticketId, emailData: { id: 'persisted-email', subject: 'Re: Email reply', from: { email: 'sender@example.com' }, body: { text: 'Customer reply' } },
          parsedEmail: { sanitizedText: 'Customer reply' }, author_type: 'contact', source: 'email' },
        idempotencyKey: { $expr: 'payload.messageId' } } },
      scopes: { payload: { messageId: 'persisted-email' }, workflow: {}, lexical: [], meta: {}, error: null,
        system: { runId: run.run_id, workflowId: workflow.workflow_id, workflowVersion: 1, tenantId: tenant } },
    };
    const first = await executeWorkflowRuntimeV2ActionStep(input);
    expect(await executeWorkflowRuntimeV2ActionStep(input)).toEqual(first);
    const comments = await db('comments').where({ tenant, ticket_id: ticketId });
    expect(comments).toHaveLength(1);
    expect(first.output).toEqual({ comment_id: comments[0].comment_id });
    expect(comments[0].note).toContain('Customer reply');
    expect((await db('tickets').where({ tenant, ticket_id: ticketId }).first()).response_state).toBe('awaiting_internal');
    expect(await Invocation.listByRun(db, run.run_id, tenant)).toHaveLength(1);
  } finally { registeredAction.current = null; }
});

it('creates one real ticket and initial comment across activity replay', async () => {
  const { createTestEnvironment, createClientLocation } = await import('../../../../../server/test-utils/testDataFactory');
  const env = await createTestEnvironment(db);
  const tenant = env.tenantId;
  const locationId = await createClientLocation(db, env.clientId, tenant);
  const boardId = randomUUID();
  const statusId = randomUUID();
  const priorityId = randomUUID();
  await db('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Normal', item_type: 'ticket', order_number: 1, color: '#888888', created_by: env.userId });
  await db('boards').insert({ tenant, board_id: boardId, board_name: 'Email intake', is_default: true, display_order: 1 });
  await db('statuses').insert({ tenant, status_id: statusId, name: 'New', status_type: 'ticket', item_type: 'ticket', board_id: boardId, order_number: 1, is_closed: false, is_default: true });
  const { registerEmailWorkflowActionsV2 } = await import('@alga-psa/shared/workflow/runtime/actions/registerEmailWorkflowActions');
  const { getActionRegistryV2 } = await import('@alga-psa/shared/workflow/runtime/registries/actionRegistry');
  if (!getActionRegistryV2().get('create_ticket_with_initial_comment', 1)) registerEmailWorkflowActionsV2();
  registeredAction.current = getActionRegistryV2().get('create_ticket_with_initial_comment', 1);
  try {
    const workflow = await WorkflowDefinition.create(db, tenant, { name: 'Real inbound ticket', payload_schema_ref: 'payload.EmailWorkflowPayload.v1', draft_definition: {} as any, draft_version: 1 });
    const run = await WorkflowRun.create(db, { workflow_id: workflow.workflow_id, workflow_version: 1, tenant, status: 'RUNNING' });
    const { executeWorkflowRuntimeV2ActionStep } = await import('../../activities/workflow-runtime-v2-activities');
    const input: any = {
      runId: run.run_id, stepId: randomUUID(), stepPath: 'root.steps[0]', tenantId: tenant,
      step: { type: 'action.call', config: { actionId: 'create_ticket_with_initial_comment', version: 1,
        inputMapping: { emailData: { id: 'new-email', subject: 'Printer offline', from: { email: 'sender@example.com' }, body: { text: 'Please repair printer' } },
          parsedEmail: { sanitizedText: 'Please repair printer' }, ticketDefaults: { board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: env.userId },
          targetClientId: env.clientId, targetContactId: null, targetAuthorUserId: null, targetLocationId: locationId },
        idempotencyKey: { $expr: 'payload.messageId' } } },
      scopes: { payload: { messageId: 'new-email' }, workflow: {}, lexical: [], meta: {}, error: null,
        system: { runId: run.run_id, workflowId: workflow.workflow_id, workflowVersion: 1, tenantId: tenant } },
    };
    const first = await executeWorkflowRuntimeV2ActionStep(input);
    expect(await executeWorkflowRuntimeV2ActionStep(input)).toEqual(first);
    const tickets = await db('tickets').where({ tenant });
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ title: 'Printer offline', client_id: env.clientId, board_id: boardId, status_id: statusId, location_id: locationId });
    const comments = await db('comments').where({ tenant, ticket_id: tickets[0].ticket_id });
    expect(comments).toHaveLength(1);
    expect(comments[0].note).toContain('Please repair printer');
    expect(first.output).toMatchObject({ ticket_id: tickets[0].ticket_id, comment_id: comments[0].comment_id });
    expect(await Invocation.listByRun(db, run.run_id, tenant)).toHaveLength(1);
  } finally { registeredAction.current = null; }
});

it('redacts secret references in persisted action inputs without changing handler arguments', async () => {
  const tenant = randomUUID();
  const workflow = await WorkflowDefinition.create(db, tenant, { name: 'Input redaction', payload_schema_ref: 'payload.EmailWorkflowPayload.v1', draft_definition: {} as any, draft_version: 1 });
  const run = await WorkflowRun.create(db, { workflow_id: workflow.workflow_id, workflow_version: 1, tenant, status: 'RUNNING' });
  actionHandler.mockReset().mockResolvedValue({ accepted: true });
  const { executeWorkflowRuntimeV2ActionStep } = await import('../../activities/workflow-runtime-v2-activities');
  const args = { connection: { secretRef: 'synthetic-private-reference', label: 'Mailbox' }, values: [{ secretRef: 'nested-private-reference' }] };
  await executeWorkflowRuntimeV2ActionStep({
    runId: run.run_id, stepId: randomUUID(), stepPath: 'root.steps[0]', tenantId: tenant,
    step: { type: 'action.call', config: { actionId: 'input-redaction-regression', version: 1, inputMapping: { connection: { $expr: 'payload.arguments.connection' }, values: { $expr: 'payload.arguments.values' } } } },
    scopes: { payload: { arguments: args }, workflow: {}, lexical: [], meta: {}, error: null,
      system: { runId: run.run_id, workflowId: workflow.workflow_id, workflowVersion: 1, tenantId: tenant, definitionHash: null, runtimeSemanticsVersion: null } },
  });
  expect(actionHandler).toHaveBeenCalledWith(args, expect.anything());
  const rows = await Invocation.listByRun(db, run.run_id, tenant);
  expect(rows).toHaveLength(1);
  expect(rows[0].input_json).toEqual({ connection: { secretRef: '[REDACTED]', label: 'Mailbox' }, values: [{ secretRef: '[REDACTED]' }] });
  expect(args.connection.secretRef).toBe('synthetic-private-reference');
});


it('rejects missing or mismatched step completion without modifying either run', async () => {
  const Step = (await import('@alga-psa/workflows/persistence/workflowRunStepModelV2')).default;
  const { projectWorkflowRuntimeV2StepCompletion } = await import('../../activities/workflow-runtime-v2-activities');
  const tenant = randomUUID();
  const workflow = await WorkflowDefinition.create(db, tenant, {
    name: 'Step completion ownership regression', payload_schema_ref: 'payload.EmailWorkflowPayload.v1',
    draft_definition: {} as any, draft_version: 1,
  });
  const runs = await Promise.all([0, 1].map(() => WorkflowRun.create(db, {
    workflow_id: workflow.workflow_id, workflow_version: 1, tenant, status: 'RUNNING',
  })));
  const step = await Step.create(db, { tenant, run_id: runs[0].run_id, step_path: 'root.steps[0]',
    definition_step_id: 'owned-step', status: 'STARTED', attempt: 1 });
  const valid = { runId: runs[0].run_id, stepId: step.step_id, stepPath: step.step_path, status: 'FAILED' as const,
    errorMessage: 'Expected action failure' };
  for (const invalid of [
    { ...valid, stepId: randomUUID() },
    { ...valid, runId: runs[1].run_id },
    { ...valid, stepPath: 'root.steps[1]' },
  ]) {
    await expect(projectWorkflowRuntimeV2StepCompletion(invalid)).rejects.toThrow('does not belong');
    expect((await Step.listByRun(db, runs[0].run_id, tenant))[0]).toMatchObject({ status: 'STARTED', completed_at: null });
    for (const run of runs) expect((await WorkflowRun.getById(db, run.run_id))?.status).toBe('RUNNING');
  }
  await projectWorkflowRuntimeV2StepCompletion(valid);
  expect((await Step.listByRun(db, runs[0].run_id, tenant))[0]).toMatchObject({ status: 'FAILED', error_json: { message: valid.errorMessage } });
  expect((await WorkflowRun.getById(db, runs[0].run_id))?.status).toBe('FAILED');
  expect((await WorkflowRun.getById(db, runs[1].run_id))?.status).toBe('RUNNING');
});
