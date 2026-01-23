import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import fs from 'fs';
import path from 'path';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { resetWorkflowRuntimeTables } from '../helpers/workflowRuntimeV2TestUtils';
import { createTenantKnex, getCurrentTenantId } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import {
  createWorkflowDefinitionAction,
  publishWorkflowDefinitionAction,
  startWorkflowRunAction,
  submitWorkflowEventAction,
  listWorkflowRunStepsAction,
  cancelWorkflowRunAction,
  resumeWorkflowRunAction
} from 'server/src/lib/actions/workflow-runtime-v2-actions';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';
import WorkflowRunSnapshotModelV2 from '@shared/workflow/persistence/workflowRunSnapshotModelV2';
import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';
import { WorkflowRuntimeV2Worker } from '../../../../services/workflow-worker/src/v2/WorkflowRuntimeV2Worker';
import { getActionRegistryV2, getSchemaRegistry } from '@shared/workflow/runtime';
import {
  ensureWorkflowRuntimeV2TestRegistrations,
  buildWorkflowDefinition,
  TEST_SCHEMA_REF,
  TEST_SOURCE_SCHEMA_REF,
  TEST_REQUIRED_SCHEMA_REF,
  actionCallStep,
  stateSetStep,
  eventWaitStep,
  tryCatchStep,
  resetTestActionState,
  getSideEffectCount
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

const EMAIL_WORKFLOW_ID = '00000000-0000-0000-0000-00000000e001';

const actionRestores: Array<() => void> = [];

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

async function seedEmailWorkflow() {
  const filePath = path.resolve(__dirname, '../../../../shared/workflow/runtime/workflows/email-processing-workflow.v2.json');
  const definition = { ...JSON.parse(fs.readFileSync(filePath, 'utf8')), id: EMAIL_WORKFLOW_ID };
  await WorkflowDefinitionModelV2.create(db, {
    workflow_id: definition.id,
    name: definition.name,
    description: definition.description,
    payload_schema_ref: definition.payloadSchemaRef,
    trigger: definition.trigger,
    draft_definition: definition,
    draft_version: definition.version,
    status: 'published'
  });
  const payloadSchemaJson = getSchemaRegistry().toJsonSchema(definition.payloadSchemaRef);
  await WorkflowDefinitionVersionModelV2.create(db, {
    workflow_id: definition.id,
    version: definition.version,
    definition_json: definition,
    payload_schema_json: payloadSchemaJson as Record<string, unknown>,
    published_by: userId,
    published_at: new Date().toISOString()
  });
  return definition.id as string;
}

const baseEmailPayload = (overrides: Partial<any> = {}) => ({
  emailData: {
    id: 'email-1',
    subject: 'Hello',
    body: { text: 'Hello', html: '<p>Hello</p>' },
    from: { email: 'sender@example.com' },
    attachments: [
      { id: 'att-1', name: 'file-1.txt', contentType: 'text/plain', size: 10 },
      { id: 'att-2', name: 'file-2.txt', contentType: 'text/plain', size: 20 }
    ],
    threadId: 'thread-1',
    inReplyTo: 'msg-1',
    references: ['msg-1']
  },
  providerId: 'provider-1',
  tenantId,
  ...overrides
});

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
  resetTestActionState();
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

describe('workflow runtime v2 E2E tests', () => {
  it('E2E: publish a workflow, start a run, and observe SUCCEEDED status with step history. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [stateSetStep('state-1', 'READY')] });
    await publishWorkflow(workflowId, 1);

    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('SUCCEEDED');

    const history = await listWorkflowRunStepsAction({ runId: run.runId });
    expect(history.steps.length).toBeGreaterThan(0);
  });

  it('E2E: event trigger starts workflow run and completes without manual wait. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [stateSetStep('state-1', 'READY')],
      trigger: { type: 'event', eventName: 'PING', sourcePayloadSchemaRef: TEST_SCHEMA_REF }
    });
    await publishWorkflow(workflowId, 1);

    const result = await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'k1', payload: { foo: 'bar' } });
    const run = await WorkflowRunModelV2.getById(db, result.startedRuns[0]);
    expect(run?.status).toBe('SUCCEEDED');
  });

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

  it('Runtime: when trigger mapping exists, event payload is mapped into workflow payload and provenance is persisted.', async () => {
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
      .where({ tenant_id: tenantId, event_name: 'PING_CONFLICT', correlation_key: 'k-conflict' })
      .first();

    expect(row?.payload_schema_ref).toBe(TEST_SCHEMA_REF);
    expect(row?.schema_ref_conflict).toEqual({ submission: TEST_SCHEMA_REF, catalog: TEST_SOURCE_SCHEMA_REF });
  });

  it('E2E: event.wait pauses run and submit workflow event (server action; API optional) resumes it to completion. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } }), stateSetStep('state-1', 'DONE')]
    });
    await publishWorkflow(workflowId, 1);

    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    const waiting = await WorkflowRunModelV2.getById(db, run.runId);
    expect(waiting?.status).toBe('WAITING');

    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });
    const resumed = await WorkflowRunModelV2.getById(db, run.runId);
    expect(resumed?.status).toBe('SUCCEEDED');
  });

  it('E2E: timeout on event.wait routes to catch pipe and completes with handled error. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [tryCatchStep('try-1', { trySteps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' }, timeoutMs: 1 })], catchSteps: [stateSetStep('state-1', 'TIMEOUT_HANDLED')] })]
    });
    await publishWorkflow(workflowId, 1);

    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_run_waits').where({ run_id: run.runId }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await worker.tick();

    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, run.runId);
    const last = snapshots[snapshots.length - 1].envelope_json as any;
    expect(last.meta.state).toBe('TIMEOUT_HANDLED');
  });

  it('E2E: retryable action failure schedules retry and eventually succeeds. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({ steps: [{ id: 'retry', type: 'test.retryNode', config: { key: 'r1', failCount: 1 } }] });
    await publishWorkflow(workflowId, 1);

    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await db('workflow_run_waits').where({ run_id: run.runId, wait_type: 'retry' }).update({ timeout_at: new Date(Date.now() - 1000).toISOString() });
    const worker = new WorkflowRuntimeV2Worker('worker');
    await worker.tick();

    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('SUCCEEDED');
  });

  it('E2E: idempotent action call returns cached output on duplicate request. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [
        actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {}, idempotencyKeyExpr: { $expr: '"fixed"' } }),
        actionCallStep({ id: 'action-2', actionId: 'test.sideEffect', inputMapping: {}, idempotencyKeyExpr: { $expr: '"fixed"' } })
      ]
    });
    await publishWorkflow(workflowId, 1);

    await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    expect(getSideEffectCount()).toBe(1);
  });

  it('E2E: canceling a running workflow stops execution and prevents further steps. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } }), actionCallStep({ id: 'action-1', actionId: 'test.sideEffect', inputMapping: {} })]
    });
    await publishWorkflow(workflowId, 1);

    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await cancelWorkflowRunAction({ runId: run.runId, reason: 'test cancel' });
    await submitWorkflowEventAction({ eventName: 'PING', correlationKey: 'key', payload: {} });

    const record = await WorkflowRunModelV2.getById(db, run.runId);
    const invocations = await db('workflow_action_invocations').where({ run_id: run.runId });
    expect(record?.status).toBe('CANCELED');
    expect(invocations.length).toBe(0);
  });

  it('E2E: resume a WAITING run via admin server action and complete remaining steps. Mocks: non-target dependencies.', async () => {
    const workflowId = await createDraftWorkflow({
      steps: [eventWaitStep('wait-1', { eventName: 'PING', correlationKeyExpr: { $expr: '"key"' } }), stateSetStep('state-1', 'DONE')]
    });
    await publishWorkflow(workflowId, 1);

    const run = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: {} });
    await resumeWorkflowRunAction({ runId: run.runId, reason: 'test resume' });

    const record = await WorkflowRunModelV2.getById(db, run.runId);
    expect(record?.status).toBe('SUCCEEDED');
  });

  it('E2E: email workflow processes new ticket path end-to-end (ticket + comment + attachments). Mocks: non-target dependencies.', async () => {
    const workflowId = await seedEmailWorkflow();

    stubAction('parse_email_reply', 1, vi.fn().mockResolvedValue({ success: true, parsed: { sanitizedText: 'Body', confidence: 'high', tokens: {} } }));
    stubAction('resolve_existing_ticket_from_email', 1, vi.fn().mockResolvedValue({ success: false, ticket: null, source: null }));
    stubAction('resolve_inbound_ticket_context', 1, vi.fn().mockResolvedValue({
      ticketDefaults: { client_id: 'client-1', board_id: 'board-1', status_id: 'status-1', priority_id: 'priority-1', category_id: 'cat-1', subcategory_id: 'sub-1', location_id: 'loc-1', entered_by: 'user-1' },
      matchedClient: { contact_id: 'contact-1', client_id: 'client-1', email: 'sender@example.com' },
      targetClientId: 'client-1',
      targetContactId: 'contact-1',
      targetLocationId: 'loc-1'
    }));
    const ticketSpy = vi.fn().mockResolvedValue({ ticket_id: 'ticket-999', ticket_number: 'T-999', comment_id: 'comment-9' });
    stubAction('create_ticket_with_initial_comment', 1, ticketSpy);
    const attachmentSpy = vi.fn().mockResolvedValue({ processed: 2, failed: 0 });
    stubAction('process_email_attachments_batch', 1, attachmentSpy);
    stubAction('send_ticket_acknowledgement_email', 1, vi.fn().mockResolvedValue({ success: true }));
    stubAction('create_human_task_for_email_processing_failure', 1, vi.fn().mockResolvedValue({ task_id: 'task-1' }));

    const result = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: baseEmailPayload() });
    const record = await WorkflowRunModelV2.getById(db, result.runId);

    expect(record?.status).toBe('SUCCEEDED');
    expect(ticketSpy).toHaveBeenCalled();
    expect(attachmentSpy).toHaveBeenCalled();
  });

  it('E2E: email workflow processes reply path end-to-end (comment + attachments). Mocks: non-target dependencies.', async () => {
    const workflowId = await seedEmailWorkflow();

    stubAction('parse_email_reply', 1, vi.fn().mockResolvedValue({ success: true, parsed: { sanitizedText: 'Sanitized', confidence: 'high', tokens: { conversationToken: 'reply-token' } } }));
    const resolveExistingSpy = vi.fn().mockResolvedValue({ success: true, ticket: { ticketId: 'ticket-123' }, source: 'replyToken' });
    stubAction('resolve_existing_ticket_from_email', 1, resolveExistingSpy);
    stubAction('resolve_inbound_ticket_context', 1, vi.fn().mockResolvedValue({ ticketDefaults: {}, matchedClient: null, targetClientId: null, targetContactId: null, targetLocationId: null }));
    const ticketSpy = vi.fn().mockResolvedValue({ ticket_id: 'ticket-new', ticket_number: 'T-1', comment_id: 'comment-1' });
    stubAction('create_ticket_with_initial_comment', 1, ticketSpy);
    const commentSpy = vi.fn().mockResolvedValue({ comment_id: 'comment-1' });
    stubAction('create_comment_from_parsed_email', 1, commentSpy);
    const attachmentSpy = vi.fn().mockResolvedValue({ processed: 1, failed: 0 });
    stubAction('process_email_attachments_batch', 1, attachmentSpy);
    stubAction('send_ticket_acknowledgement_email', 1, vi.fn().mockResolvedValue({ success: true }));
    stubAction('create_human_task_for_email_processing_failure', 1, vi.fn().mockResolvedValue({ task_id: 'task-1' }));

    const result = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: baseEmailPayload() });
    const record = await WorkflowRunModelV2.getById(db, result.runId);

    expect(record?.status).toBe('SUCCEEDED');
    expect(commentSpy).toHaveBeenCalled();
    expect(attachmentSpy).toHaveBeenCalled();
    expect(ticketSpy).not.toHaveBeenCalled();
  });

  it('E2E: email workflow failure creates human task and sets error states. Mocks: non-target dependencies.', async () => {
    const workflowId = await seedEmailWorkflow();

    const humanSpy = vi.fn().mockResolvedValue({ task_id: 'task-1' });
    stubAction('parse_email_reply', 1, vi.fn().mockResolvedValue({ success: true, parsed: { sanitizedText: 'Body', confidence: 'high', tokens: {} } }));
    stubAction('resolve_existing_ticket_from_email', 1, vi.fn().mockResolvedValue({ success: false, ticket: null, source: null }));
    stubAction('resolve_inbound_ticket_context', 1, vi.fn().mockResolvedValue({
      ticketDefaults: { client_id: 'client-1', board_id: 'board-1', status_id: 'status-1', priority_id: 'priority-1', category_id: 'cat-1', subcategory_id: 'sub-1', location_id: 'loc-1', entered_by: 'user-1' },
      matchedClient: null,
      targetClientId: 'client-1',
      targetContactId: null,
      targetLocationId: 'loc-1'
    }));
    stubAction('create_ticket_with_initial_comment', 1, vi.fn().mockRejectedValue(new Error('boom')));
    stubAction('create_human_task_for_email_processing_failure', 1, humanSpy);

    const result = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: baseEmailPayload() });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, result.runId);
    const last = snapshots[snapshots.length - 1].envelope_json as any;

    expect(last.meta.state).toBe('AWAITING_MANUAL_RESOLUTION');
    expect(humanSpy).toHaveBeenCalled();
  });
});
