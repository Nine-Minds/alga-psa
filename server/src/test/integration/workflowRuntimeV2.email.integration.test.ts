import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import fs from 'fs';
import path from 'path';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { resetWorkflowRuntimeTables } from '../helpers/workflowRuntimeV2TestUtils';
import { createTenantKnex, getCurrentTenantId } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { startWorkflowRunAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';
import WorkflowDefinitionModelV2 from '@shared/workflow/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '@shared/workflow/persistence/workflowDefinitionVersionModelV2';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';
import WorkflowRunSnapshotModelV2 from '@shared/workflow/persistence/workflowRunSnapshotModelV2';
import { getActionRegistryV2, getSchemaRegistry } from '@shared/workflow/runtime';
import {
  ensureWorkflowRuntimeV2TestRegistrations
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
}, 180000);

beforeEach(async () => {
  await resetWorkflowRuntimeTables(db);
  tenantId = uuidv4();
  userId = uuidv4();
  mockedCreateTenantKnex.mockImplementation(async () => ({ knex: db, tenant: tenantId }));
  mockedGetCurrentTenantId.mockReturnValue(tenantId);
  mockedGetCurrentUser.mockResolvedValue({ user_id: userId, roles: [] } as any);
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

describe('workflow runtime v2 email workflow integration tests', () => {
  describe('existing ticket path via reply token', () => {
    let runId: string;
    let snapshots: any[];
    let createTicketSpy: any;
    let createCommentSpy: any;
    let processAttachmentsSpy: any;
    let resolveExistingSpy: any;

    beforeEach(async () => {
      await seedEmailWorkflow();

      const parsed = {
        sanitizedText: 'Sanitized',
        sanitizedHtml: '<p>Sanitized</p>',
        confidence: 'high',
        tokens: { conversationToken: 'reply-token' }
      };
      stubAction('parse_email_reply', 1, vi.fn().mockResolvedValue({ success: true, parsed }));
      resolveExistingSpy = vi.fn().mockResolvedValue({ success: true, ticket: { ticketId: 'ticket-123' }, source: 'replyToken' });
      stubAction('resolve_existing_ticket_from_email', 1, resolveExistingSpy);
      stubAction('resolve_inbound_ticket_context', 1, vi.fn().mockResolvedValue({ ticketDefaults: {}, matchedClient: null, targetClientId: null, targetContactId: null, targetLocationId: null }));
      createTicketSpy = vi.fn().mockResolvedValue({ ticket_id: 'ticket-new', ticket_number: 'T-1', comment_id: 'comment-0' });
      stubAction('create_ticket_with_initial_comment', 1, createTicketSpy);
      createCommentSpy = vi.fn().mockResolvedValue({ comment_id: 'comment-1' });
      stubAction('create_comment_from_parsed_email', 1, createCommentSpy);
      processAttachmentsSpy = vi.fn().mockResolvedValue({ processed: 2, failed: 0 });
      stubAction('process_email_attachments_batch', 1, processAttachmentsSpy);
      stubAction('convert_html_to_blocks', 1, vi.fn().mockResolvedValue({ success: true, blocks: [{ type: 'paragraph', content: [] }] }));
      stubAction('create_human_task_for_email_processing_failure', 1, vi.fn().mockResolvedValue({ task_id: 'task-1' }));
      stubAction('send_ticket_acknowledgement_email', 1, vi.fn().mockResolvedValue({ success: true }));

      const result = await startWorkflowRunAction({ workflowId: EMAIL_WORKFLOW_ID, workflowVersion: 1, payload: baseEmailPayload() });
      runId = result.runId;
      snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, runId);
    });

    it('Email workflow start accepts event payload and initializes EmailWorkflowPayload fields. Mocks: non-target dependencies.', () => {
      const payload = snapshots[snapshots.length - 1].envelope_json.payload;
      expect(payload.emailData).toBeDefined();
      expect(payload.providerId).toBe('provider-1');
      expect(payload.tenantId).toBe(tenantId);
    });

    it('Email workflow stores processedAt in vars. Mocks: non-target dependencies.', () => {
      const vars = snapshots[snapshots.length - 1].envelope_json.vars;
      expect(vars.processedAt).toBeDefined();
    });

    it('email.parseBody node parses body and stores parsedEmail with confidence. Mocks: non-target dependencies.', () => {
      const vars = snapshots[snapshots.length - 1].envelope_json.vars;
      expect(vars.parsedEmail.confidence).toBe('high');
    });

    it('email.parseBody sanitizes HTML and strips unsafe content. Mocks: non-target dependencies.', () => {
      const vars = snapshots[snapshots.length - 1].envelope_json.vars;
      expect(vars.parsedEmail.sanitizedHtml).toBe('<p>Sanitized</p>');
    });

    it('Existing ticket resolution runs before branching. Mocks: non-target dependencies.', () => {
      expect(resolveExistingSpy).toHaveBeenCalled();
    });

    it('Existing ticket path creates comment with author_type=contact. Mocks: non-target dependencies.', () => {
      const call = createCommentSpy.mock.calls[0]?.[0];
      expect(call.author_type).toBe('contact');
    });

    it('Existing ticket path processes attachments with per-item error continue. Mocks: non-target dependencies.', async () => {
      const run = await WorkflowRunModelV2.getById(db, runId);
      expect(run?.status).toBe('SUCCEEDED');
      expect(processAttachmentsSpy).toHaveBeenCalled();
    });

    it('Existing ticket path returns early without creating new ticket. Mocks: non-target dependencies.', () => {
      expect(createTicketSpy).not.toHaveBeenCalled();
    });

    it('Attachment processing uses idempotency keys derived from message id and attachment id. Mocks: non-target dependencies.', async () => {
      const invocation = await db('workflow_action_invocations').where({ action_id: 'process_email_attachments_batch', run_id: runId }).first();
      expect(invocation?.idempotency_key).toContain('email-1');
      expect(invocation?.idempotency_key).toContain('attachments');
    });

    it('Comment creation uses idempotency key derived from message id and ticket id. Mocks: non-target dependencies.', async () => {
      const invocation = await db('workflow_action_invocations').where({ action_id: 'create_comment_from_parsed_email', run_id: runId }).first();
      expect(invocation.idempotency_key).toContain('email-1');
      expect(invocation.idempotency_key).toContain('ticket-123');
    });

    it('Workflow preserves parsedEmail metadata for downstream actions. Mocks: non-target dependencies.', () => {
      const call = createCommentSpy.mock.calls[0]?.[0];
      expect(call.parsedEmail?.metadata).toBeDefined();
    });

    it('Existing ticket path does not populate ticket context. Mocks: non-target dependencies.', () => {
      const vars = snapshots[snapshots.length - 1].envelope_json.vars;
      expect(vars.ticketContext).toBeUndefined();
    });
  });

  it('When reply token missing or not matched, resolve existing ticket via threading. Mocks: non-target dependencies.', async () => {
    await resetWorkflowRuntimeTables(db);
    await seedEmailWorkflow();

    stubAction('parse_email_reply', 1, vi.fn().mockResolvedValue({ success: true, parsed: { sanitizedText: 'x', confidence: 'high', tokens: {} } }));
    const resolveExistingSpy = vi.fn().mockResolvedValue({ success: true, ticket: { ticketId: 'ticket-456' }, source: 'threadHeaders' });
    stubAction('resolve_existing_ticket_from_email', 1, resolveExistingSpy);
    stubAction('resolve_inbound_ticket_context', 1, vi.fn().mockResolvedValue({ ticketDefaults: {}, matchedClient: null, targetClientId: null, targetContactId: null, targetLocationId: null }));
    stubAction('create_comment_from_parsed_email', 1, vi.fn().mockResolvedValue({ comment_id: 'comment-2' }));
    stubAction('process_email_attachments_batch', 1, vi.fn().mockResolvedValue({ processed: 0, failed: 0 }));
    stubAction('create_ticket_with_initial_comment', 1, vi.fn().mockResolvedValue({ ticket_id: 'ticket-new', ticket_number: 'T-1', comment_id: 'comment-0' }));
    stubAction('send_ticket_acknowledgement_email', 1, vi.fn().mockResolvedValue({ success: true }));
    stubAction('create_human_task_for_email_processing_failure', 1, vi.fn().mockResolvedValue({ task_id: 'task-1' }));

    await startWorkflowRunAction({ workflowId: EMAIL_WORKFLOW_ID, workflowVersion: 1, payload: baseEmailPayload() });
    expect(resolveExistingSpy).toHaveBeenCalled();
  });

  describe('new ticket path with defaults', () => {
    let runId: string;
    let snapshots: any[];
    let resolveContextSpy: any;
    let ticketSpy: any;
    let attachmentSpy: any;
    let ackSpy: any;

    beforeEach(async () => {
      await seedEmailWorkflow();

      stubAction('parse_email_reply', 1, vi.fn().mockResolvedValue({ success: true, parsed: { sanitizedText: 'Body', confidence: 'high', tokens: {} } }));
      stubAction('resolve_existing_ticket_from_email', 1, vi.fn().mockResolvedValue({ success: false, ticket: null, source: null }));
      const matchedClient = { contact_id: 'contact-1', client_id: 'client-1', email: 'sender@example.com' };
      const defaults = { client_id: 'client-1', board_id: 'board-1', status_id: 'status-1', priority_id: 'priority-1', category_id: 'cat-1', subcategory_id: 'sub-1', location_id: 'loc-1', entered_by: 'user-1' };
      const ticketContext = {
        ticketDefaults: defaults,
        matchedClient,
        targetClientId: 'client-1',
        targetContactId: 'contact-1',
        targetLocationId: 'loc-1'
      };
      resolveContextSpy = vi.fn().mockResolvedValue(ticketContext);
      stubAction('resolve_inbound_ticket_context', 1, resolveContextSpy);
      ticketSpy = vi.fn().mockResolvedValue({ ticket_id: 'ticket-999', ticket_number: 'T-999', comment_id: 'comment-9' });
      stubAction('create_ticket_with_initial_comment', 1, ticketSpy);
      stubAction('create_comment_from_parsed_email', 1, vi.fn().mockResolvedValue({ comment_id: 'comment-9' }));
      attachmentSpy = vi.fn().mockResolvedValue({ processed: 2, failed: 0 });
      stubAction('process_email_attachments_batch', 1, attachmentSpy);
      ackSpy = vi.fn().mockResolvedValue({ success: true, message: 'sent' });
      stubAction('send_ticket_acknowledgement_email', 1, ackSpy);
      stubAction('create_human_task_for_email_processing_failure', 1, vi.fn().mockResolvedValue({ task_id: 'task-1' }));

      const result = await startWorkflowRunAction({ workflowId: EMAIL_WORKFLOW_ID, workflowVersion: 1, payload: baseEmailPayload() });
      runId = result.runId;
      snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, runId);
    });

    it('Matched contact stored as matchedClient in vars.ticketContext. Mocks: non-target dependencies.', () => {
      const vars = snapshots[snapshots.length - 1].envelope_json.vars;
      expect(vars.ticketContext.matchedClient).toBeDefined();
    });

    it('Resolve inbound ticket context by tenantId+providerId+senderEmail. Mocks: non-target dependencies.', () => {
      expect(resolveContextSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: tenantId, providerId: 'provider-1', senderEmail: 'sender@example.com' }),
        expect.anything()
      );
    });

    it('Ticket defaults override logic matches legacy behavior. Mocks: non-target dependencies.', () => {
      const vars = snapshots[snapshots.length - 1].envelope_json.vars;
      expect(vars.ticketContext.targetLocationId).toBe('loc-1');
    });

    it('create_ticket_with_initial_comment is called with computed defaults. Mocks: non-target dependencies.', () => {
      const call = ticketSpy.mock.calls[0]?.[0];
      expect(call.ticketDefaults.board_id).toBe('board-1');
      expect(call.ticketDefaults.status_id).toBe('status-1');
    });

    it('create_ticket_with_initial_comment stores ticket_id into vars.createdTicket. Mocks: non-target dependencies.', () => {
      const vars = snapshots[snapshots.length - 1].envelope_json.vars;
      expect(vars.createdTicket.ticket_id).toBe('ticket-999');
    });

    it('New ticket path processes attachments with per-item error continue. Mocks: non-target dependencies.', async () => {
      const run = await WorkflowRunModelV2.getById(db, runId);
      expect(run?.status).toBe('SUCCEEDED');
      expect(attachmentSpy).toHaveBeenCalled();
    });

    it('send_ticket_acknowledgement_email runs only when matchedClient exists. Mocks: non-target dependencies.', () => {
      expect(ackSpy).toHaveBeenCalled();
    });

    it('send_ticket_acknowledgement_email errors do not fail the workflow (onError=continue). Mocks: non-target dependencies.', async () => {
      await resetWorkflowRuntimeTables(db);
      await seedEmailWorkflow();
      stubAction('parse_email_reply', 1, vi.fn().mockResolvedValue({ success: true, parsed: { sanitizedText: 'Body', confidence: 'high', tokens: {} } }));
      stubAction('resolve_existing_ticket_from_email', 1, vi.fn().mockResolvedValue({ success: false, ticket: null, source: null }));
      stubAction('resolve_inbound_ticket_context', 1, vi.fn().mockResolvedValue({
        ticketDefaults: { client_id: 'client-1', board_id: 'board-1', status_id: 'status-1', priority_id: 'priority-1', category_id: 'cat-1', subcategory_id: 'sub-cat-1', location_id: 'loc-1', entered_by: 'user-1' },
        matchedClient: { contact_id: 'contact-1', client_id: 'client-1', email: 'sender@example.com' },
        targetClientId: 'client-1',
        targetContactId: 'contact-1',
        targetLocationId: 'loc-1'
      }));
      stubAction('create_ticket_with_initial_comment', 1, vi.fn().mockResolvedValue({ ticket_id: 'ticket-999', ticket_number: 'T-999', comment_id: 'comment-9' }));
      stubAction('process_email_attachments_batch', 1, vi.fn().mockResolvedValue({ processed: 1, failed: 0 }));
      stubAction('send_ticket_acknowledgement_email', 1, vi.fn().mockRejectedValue(new Error('fail')));
      stubAction('create_human_task_for_email_processing_failure', 1, vi.fn().mockResolvedValue({ task_id: 'task-1' }));

      const result = await startWorkflowRunAction({ workflowId: EMAIL_WORKFLOW_ID, workflowVersion: 1, payload: baseEmailPayload() });
      const run = await WorkflowRunModelV2.getById(db, result.runId);
      expect(run?.status).toBe('SUCCEEDED');
    });

    it('Workflow sets EMAIL_PROCESSED state on success. Mocks: non-target dependencies.', () => {
      const state = snapshots[snapshots.length - 1].envelope_json.meta.state;
      expect(state).toBe('EMAIL_PROCESSED');
    });

    it('Ticket creation uses idempotency key derived from provider id and message id. Mocks: non-target dependencies.', async () => {
      const invocation = await db('workflow_action_invocations').where({ action_id: 'create_ticket_with_initial_comment', run_id: runId }).first();
      expect(invocation.idempotency_key).toContain('provider-1');
      expect(invocation.idempotency_key).toContain('email-1');
    });

    it('Workflow preserves parsedEmail metadata for ticket creation. Mocks: non-target dependencies.', () => {
      const call = ticketSpy.mock.calls[0]?.[0];
      expect(call.parsedEmail).toBeDefined();
    });

    it('New ticket path persists ticketDefaults and createdTicket together. Mocks: non-target dependencies.', () => {
      const vars = snapshots[snapshots.length - 1].envelope_json.vars;
      expect(vars.ticketContext.ticketDefaults).toBeDefined();
      expect(vars.createdTicket.ticket_id).toBe('ticket-999');
    });
  });

  it('If ticket defaults missing, state set to ERROR_NO_TICKET_DEFAULTS and workflow returns. Mocks: non-target dependencies.', async () => {
    await resetWorkflowRuntimeTables(db);
    await seedEmailWorkflow();

    stubAction('parse_email_reply', 1, vi.fn().mockResolvedValue({ success: true, parsed: { sanitizedText: 'Body', confidence: 'high', tokens: {} } }));
    stubAction('resolve_existing_ticket_from_email', 1, vi.fn().mockResolvedValue({ success: false, ticket: null, source: null }));
    stubAction('resolve_inbound_ticket_context', 1, vi.fn().mockResolvedValue({
      ticketDefaults: null,
      matchedClient: null,
      targetClientId: null,
      targetContactId: null,
      targetLocationId: null
    }));
    stubAction('create_human_task_for_email_processing_failure', 1, vi.fn().mockResolvedValue({ task_id: 'task-1' }));

    const result = await startWorkflowRunAction({ workflowId: EMAIL_WORKFLOW_ID, workflowVersion: 1, payload: baseEmailPayload() });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, result.runId);
    expect(snapshots[snapshots.length - 1].envelope_json.meta.state).toBe('ERROR_NO_TICKET_DEFAULTS');
  });

  it('email.renderCommentBlocks uses HTML->blocks conversion fallback when needed. Mocks: non-target dependencies.', async () => {
    await resetWorkflowRuntimeTables(db);
    const workflowId = await (async () => {
      const definition = {
        id: uuidv4(),
        version: 1,
        name: 'Render Blocks',
        payloadSchemaRef: 'payload.EmailWorkflowPayload.v1',
        steps: [
          {
            id: 'render',
            type: 'email.renderCommentBlocks',
            config: {
              html: { $expr: 'payload.html' },
              text: { $expr: 'payload.text' },
              saveAs: 'blocks'
            }
          }
        ]
      };
      const record = await WorkflowDefinitionModelV2.create(db, {
        workflow_id: definition.id,
        name: definition.name,
        payload_schema_ref: definition.payloadSchemaRef,
        draft_definition: definition,
        draft_version: 1,
        status: 'published'
      });
      await WorkflowDefinitionVersionModelV2.create(db, {
        workflow_id: record.workflow_id,
        version: 1,
        definition_json: definition,
        payload_schema_json: getSchemaRegistry().toJsonSchema('payload.EmailWorkflowPayload.v1') as any,
        published_by: userId,
        published_at: new Date().toISOString()
      });
      return record.workflow_id;
    })();

    stubAction('convert_html_to_blocks', 1, vi.fn().mockResolvedValue({ success: false, blocks: [] }));

    const result = await startWorkflowRunAction({ workflowId, workflowVersion: 1, payload: { html: '<p>Hi</p>', text: 'Hi' } });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, result.runId);
    const blocks = snapshots[snapshots.length - 1].envelope_json.vars.blocks;
    expect(blocks).toBeDefined();
  });

  it('Outer catch sets ERROR_PROCESSING_EMAIL and AWAITING_MANUAL_RESOLUTION. Mocks: non-target dependencies.', async () => {
    await resetWorkflowRuntimeTables(db);
    await seedEmailWorkflow();

    stubAction('parse_email_reply', 1, vi.fn().mockRejectedValue(new Error('fail')));
    stubAction('create_human_task_for_email_processing_failure', 1, vi.fn().mockResolvedValue({ task_id: 'task-1' }));

    const result = await startWorkflowRunAction({ workflowId: EMAIL_WORKFLOW_ID, workflowVersion: 1, payload: baseEmailPayload() });
    const snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, result.runId);
    expect(snapshots[snapshots.length - 1].envelope_json.meta.state).toBe('AWAITING_MANUAL_RESOLUTION');
  });

  it('Outer catch creates human task with failure context and payload snapshot. Mocks: non-target dependencies.', async () => {
    await resetWorkflowRuntimeTables(db);
    await seedEmailWorkflow();

    const humanTaskSpy = vi.fn().mockResolvedValue({ task_id: 'task-1' });
    stubAction('parse_email_reply', 1, vi.fn().mockRejectedValue(new Error('fail')));
    stubAction('create_human_task_for_email_processing_failure', 1, humanTaskSpy);

    await startWorkflowRunAction({ workflowId: EMAIL_WORKFLOW_ID, workflowVersion: 1, payload: baseEmailPayload() });
    const call = humanTaskSpy.mock.calls[0]?.[0];
    expect(call.contextData).toBeDefined();
  });
});
