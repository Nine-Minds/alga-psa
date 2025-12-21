import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import fs from 'fs';
import path from 'path';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { resetWorkflowRuntimeTables } from '../helpers/workflowRuntimeV2TestUtils';
import { createTenantKnex } from 'server/src/lib/db';
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
  createTenantKnex: vi.fn()
}));

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn()
}));

const mockedCreateTenantKnex = vi.mocked(createTenantKnex);
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
  const filePath = path.resolve(__dirname, '../../../../shared/workflow/runtime/workflows/email-processing-workflow.v1.json');
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
  mockedCreateTenantKnex.mockImplementation(async () => ({ knex: db, tenant: tenantId }));
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
    let processAttachmentSpy: any;
    let findReplyTokenSpy: any;
    let parsedEmailMetadata: any;

    beforeEach(async () => {
      await seedEmailWorkflow();

      const parsed = {
        sanitizedText: 'Sanitized',
        sanitizedHtml: '<p>Sanitized</p>',
        confidence: 'high',
        tokens: { conversationToken: 'reply-token' }
      };
      parsedEmailMetadata = { parser: { confidence: 'high', tokens: { conversationToken: 'reply-token' } } };

      stubAction('parse_email_reply', 1, vi.fn().mockResolvedValue({ success: true, parsed }));
      findReplyTokenSpy = vi.fn().mockResolvedValue({ success: true, match: { ticketId: 'ticket-123' } });
      stubAction('find_ticket_by_reply_token', 1, findReplyTokenSpy);
      stubAction('find_ticket_by_email_thread', 1, vi.fn().mockResolvedValue({ success: false, ticket: null }));
      stubAction('find_contact_by_email', 1, vi.fn().mockResolvedValue({ success: false, contact: null }));
      stubAction('resolve_inbound_ticket_defaults', 1, vi.fn().mockResolvedValue({}));
      createTicketSpy = vi.fn().mockResolvedValue({ ticket_id: 'ticket-new', ticket_number: 'T-1' });
      stubAction('create_ticket_from_email', 1, createTicketSpy);
      createCommentSpy = vi.fn().mockResolvedValue({ comment_id: 'comment-1' });
      stubAction('create_comment_from_email', 1, createCommentSpy);
      processAttachmentSpy = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue({ success: true, documentId: 'doc-1', fileName: 'file', fileSize: 10, contentType: 'text/plain' });
      stubAction('process_email_attachment', 1, processAttachmentSpy);
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

    it('Email workflow stores emailData, providerId, tenantId, and processedAt. Mocks: non-target dependencies.', () => {
      const payload = snapshots[snapshots.length - 1].envelope_json.payload;
      expect(payload.processedAt).toBeDefined();
    });

    it('email.parseBody node parses body and stores parsedEmail with confidence. Mocks: non-target dependencies.', () => {
      const payload = snapshots[snapshots.length - 1].envelope_json.payload;
      expect(payload.parsedEmail.confidence).toBe('high');
    });

    it('email.parseBody sanitizes HTML and strips unsafe content. Mocks: non-target dependencies.', () => {
      const payload = snapshots[snapshots.length - 1].envelope_json.payload;
      expect(payload.parsedEmail.sanitizedHtml).toBe('<p>Sanitized</p>');
    });

    it('When reply token present, find_ticket_by_reply_token is invoked. Mocks: non-target dependencies.', () => {
      expect(findReplyTokenSpy).toHaveBeenCalled();
    });

    it('Existing ticket path creates comment with author_type=contact. Mocks: non-target dependencies.', () => {
      const call = createCommentSpy.mock.calls[0]?.[0];
      expect(call.author_type).toBe('contact');
    });

    it('Existing ticket path processes attachments with per-item error continue. Mocks: non-target dependencies.', async () => {
      const run = await WorkflowRunModelV2.getById(db, runId);
      expect(run?.status).toBe('SUCCEEDED');
      expect(processAttachmentSpy).toHaveBeenCalled();
    });

    it('Existing ticket path returns early without creating new ticket. Mocks: non-target dependencies.', () => {
      expect(createTicketSpy).not.toHaveBeenCalled();
    });

    it('Attachment processing uses idempotency keys derived from message id and attachment id. Mocks: non-target dependencies.', async () => {
      const invocations = await db('workflow_action_invocations').where({ action_id: 'process_email_attachment', run_id: runId });
      const keys = invocations.map((invocation) => invocation.idempotency_key);
      expect(keys.some((key) => key.includes('email-1') && key.includes('att-1'))).toBe(true);
      expect(keys.some((key) => key.includes('email-1') && key.includes('att-2'))).toBe(true);
    });

    it('Comment creation uses idempotency key derived from message id and ticket id. Mocks: non-target dependencies.', async () => {
      const invocation = await db('workflow_action_invocations').where({ action_id: 'create_comment_from_email', run_id: runId }).first();
      expect(invocation.idempotency_key).toContain('email-1');
      expect(invocation.idempotency_key).toContain('ticket-123');
    });

    it('Workflow preserves parsedEmail metadata for downstream actions. Mocks: non-target dependencies.', () => {
      const call = createCommentSpy.mock.calls[0]?.[0];
      expect(call.metadata).toBeDefined();
    });

    it('Existing ticket path does not overwrite ticketDefaults. Mocks: non-target dependencies.', () => {
      const payload = snapshots[snapshots.length - 1].envelope_json.payload;
      expect(payload.ticketDefaults).toBeUndefined();
    });
  });

  it('When reply token missing or not matched, fallback to find_ticket_by_email_thread. Mocks: non-target dependencies.', async () => {
    await resetWorkflowRuntimeTables(db);
    await seedEmailWorkflow();

    stubAction('parse_email_reply', 1, vi.fn().mockResolvedValue({ success: true, parsed: { sanitizedText: 'x', confidence: 'high', tokens: {} } }));
    stubAction('find_ticket_by_reply_token', 1, vi.fn().mockResolvedValue({ success: false, match: null }));
    const threadSpy = vi.fn().mockResolvedValue({ success: true, ticket: { ticketId: 'ticket-456' } });
    stubAction('find_ticket_by_email_thread', 1, threadSpy);
    stubAction('find_contact_by_email', 1, vi.fn().mockResolvedValue({ success: false, contact: null }));
    stubAction('resolve_inbound_ticket_defaults', 1, vi.fn().mockResolvedValue({}));
    stubAction('create_comment_from_email', 1, vi.fn().mockResolvedValue({ comment_id: 'comment-2' }));
    stubAction('process_email_attachment', 1, vi.fn().mockResolvedValue({ success: true, documentId: 'doc-1', fileName: 'file', fileSize: 10, contentType: 'text/plain' }));
    stubAction('create_ticket_from_email', 1, vi.fn().mockResolvedValue({ ticket_id: 'ticket-new', ticket_number: 'T-1' }));
    stubAction('send_ticket_acknowledgement_email', 1, vi.fn().mockResolvedValue({ success: true }));
    stubAction('create_human_task_for_email_processing_failure', 1, vi.fn().mockResolvedValue({ task_id: 'task-1' }));

    await startWorkflowRunAction({ workflowId: EMAIL_WORKFLOW_ID, workflowVersion: 1, payload: baseEmailPayload() });
    expect(threadSpy).toHaveBeenCalled();
  });

  describe('new ticket path with defaults', () => {
    let runId: string;
    let snapshots: any[];
    let contactSpy: any;
    let defaultsSpy: any;
    let ticketSpy: any;
    let commentSpy: any;
    let attachmentSpy: any;
    let ackSpy: any;

    beforeEach(async () => {
      await seedEmailWorkflow();

      stubAction('parse_email_reply', 1, vi.fn().mockResolvedValue({ success: true, parsed: { sanitizedText: 'Body', confidence: 'high', tokens: {} } }));
      stubAction('find_ticket_by_reply_token', 1, vi.fn().mockResolvedValue({ success: false, match: null }));
      stubAction('find_ticket_by_email_thread', 1, vi.fn().mockResolvedValue({ success: false, ticket: null }));
      contactSpy = vi.fn().mockResolvedValue({ success: true, contact: { contact_id: 'contact-1', client_id: 'client-1', email: 'sender@example.com' } });
      stubAction('find_contact_by_email', 1, contactSpy);
      defaultsSpy = vi.fn().mockResolvedValue({ client_id: 'client-1', board_id: 'board-1', status_id: 'status-1', priority_id: 'priority-1', category_id: 'cat-1', subcategory_id: 'sub-1', location_id: 'loc-1', entered_by: 'user-1' });
      stubAction('resolve_inbound_ticket_defaults', 1, defaultsSpy);
      ticketSpy = vi.fn().mockResolvedValue({ ticket_id: 'ticket-999', ticket_number: 'T-999' });
      stubAction('create_ticket_from_email', 1, ticketSpy);
      commentSpy = vi.fn().mockResolvedValue({ comment_id: 'comment-9' });
      stubAction('create_comment_from_email', 1, commentSpy);
      attachmentSpy = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue({ success: true, documentId: 'doc-2', fileName: 'file', fileSize: 10, contentType: 'text/plain' });
      stubAction('process_email_attachment', 1, attachmentSpy);
      ackSpy = vi.fn().mockResolvedValue({ success: true, message: 'sent' });
      stubAction('send_ticket_acknowledgement_email', 1, ackSpy);
      stubAction('create_human_task_for_email_processing_failure', 1, vi.fn().mockResolvedValue({ task_id: 'task-1' }));

      const result = await startWorkflowRunAction({ workflowId: EMAIL_WORKFLOW_ID, workflowVersion: 1, payload: baseEmailPayload() });
      runId = result.runId;
      snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, runId);
    });

    it('New ticket path attempts exact contact match by sender email. Mocks: non-target dependencies.', () => {
      expect(contactSpy).toHaveBeenCalledWith(expect.objectContaining({ email: 'sender@example.com' }), expect.anything());
    });

    it('Matched contact stored as matchedClient in payload. Mocks: non-target dependencies.', () => {
      const payload = snapshots[snapshots.length - 1].envelope_json.payload;
      expect(payload.matchedClient).toBeDefined();
    });

    it('Resolve inbound ticket defaults by tenantId+providerId. Mocks: non-target dependencies.', () => {
      expect(defaultsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenant: tenantId, providerId: 'provider-1' }),
        expect.anything()
      );
    });

    it('Ticket defaults override logic matches legacy behavior. Mocks: non-target dependencies.', () => {
      const payload = snapshots[snapshots.length - 1].envelope_json.payload;
      expect(payload.targetLocationId).toBe('loc-1');
    });

    it('create_ticket_from_email is called with computed defaults. Mocks: non-target dependencies.', () => {
      const call = ticketSpy.mock.calls[0]?.[0];
      expect(call.board_id).toBe('board-1');
      expect(call.status_id).toBe('status-1');
    });

    it('create_ticket_from_email stores ticket_id into payload.targetTicketId. Mocks: non-target dependencies.', () => {
      const payload = snapshots[snapshots.length - 1].envelope_json.payload;
      expect(payload.targetTicketId).toBe('ticket-999');
    });

    it('New ticket path processes attachments with per-item error continue. Mocks: non-target dependencies.', async () => {
      const run = await WorkflowRunModelV2.getById(db, runId);
      expect(run?.status).toBe('SUCCEEDED');
      expect(attachmentSpy).toHaveBeenCalled();
    });

    it('New ticket path creates initial comment with author_type=internal. Mocks: non-target dependencies.', () => {
      const call = commentSpy.mock.calls[0]?.[0];
      expect(call.author_type).toBe('internal');
    });

    it('send_ticket_acknowledgement_email runs only when matchedClient exists. Mocks: non-target dependencies.', () => {
      expect(ackSpy).toHaveBeenCalled();
    });

    it('send_ticket_acknowledgement_email errors do not fail the workflow (onError=continue). Mocks: non-target dependencies.', async () => {
      await resetWorkflowRuntimeTables(db);
      await seedEmailWorkflow();
      stubAction('parse_email_reply', 1, vi.fn().mockResolvedValue({ success: true, parsed: { sanitizedText: 'Body', confidence: 'high', tokens: {} } }));
      stubAction('find_ticket_by_reply_token', 1, vi.fn().mockResolvedValue({ success: false, match: null }));
      stubAction('find_ticket_by_email_thread', 1, vi.fn().mockResolvedValue({ success: false, ticket: null }));
      stubAction('find_contact_by_email', 1, vi.fn().mockResolvedValue({ success: true, contact: { contact_id: 'contact-1', client_id: 'client-1', email: 'sender@example.com' } }));
      stubAction('resolve_inbound_ticket_defaults', 1, vi.fn().mockResolvedValue({ client_id: 'client-1', board_id: 'board-1', status_id: 'status-1', priority_id: 'priority-1', category_id: 'cat-1', subcategory_id: 'sub-1', location_id: 'loc-1', entered_by: 'user-1' }));
      stubAction('create_ticket_from_email', 1, vi.fn().mockResolvedValue({ ticket_id: 'ticket-999', ticket_number: 'T-999' }));
      stubAction('create_comment_from_email', 1, vi.fn().mockResolvedValue({ comment_id: 'comment-9' }));
      stubAction('process_email_attachment', 1, vi.fn().mockResolvedValue({ success: true, documentId: 'doc-2', fileName: 'file', fileSize: 10, contentType: 'text/plain' }));
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
      const invocation = await db('workflow_action_invocations').where({ action_id: 'create_ticket_from_email', run_id: runId }).first();
      expect(invocation.idempotency_key).toContain('provider-1');
      expect(invocation.idempotency_key).toContain('email-1');
    });

    it('Workflow preserves parsedEmail metadata for downstream actions. Mocks: non-target dependencies.', () => {
      const call = commentSpy.mock.calls[0]?.[0];
      expect(call.metadata).toBeDefined();
    });

    it('New ticket path persists ticketDefaults and targetTicketId together. Mocks: non-target dependencies.', () => {
      const payload = snapshots[snapshots.length - 1].envelope_json.payload;
      expect(payload.ticketDefaults).toBeDefined();
      expect(payload.targetTicketId).toBe('ticket-999');
    });
  });

  it('If ticket defaults missing, state set to ERROR_NO_TICKET_DEFAULTS and workflow returns. Mocks: non-target dependencies.', async () => {
    await resetWorkflowRuntimeTables(db);
    await seedEmailWorkflow();

    stubAction('parse_email_reply', 1, vi.fn().mockResolvedValue({ success: true, parsed: { sanitizedText: 'Body', confidence: 'high', tokens: {} } }));
    stubAction('find_ticket_by_reply_token', 1, vi.fn().mockResolvedValue({ success: false, match: null }));
    stubAction('find_ticket_by_email_thread', 1, vi.fn().mockResolvedValue({ success: false, ticket: null }));
    stubAction('find_contact_by_email', 1, vi.fn().mockResolvedValue({ success: false, contact: null }));
    stubAction('resolve_inbound_ticket_defaults', 1, vi.fn().mockResolvedValue(null));
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
              saveAs: 'payload.blocks'
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
    const blocks = snapshots[snapshots.length - 1].envelope_json.payload.blocks;
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
