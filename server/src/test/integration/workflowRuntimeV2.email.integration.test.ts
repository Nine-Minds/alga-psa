import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import fs from 'fs';
import path from 'path';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { resetWorkflowRuntimeTables } from '../helpers/workflowRuntimeV2TestUtils';
import { createTenantKnex, getCurrentTenantId } from 'server/src/lib/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { startWorkflowRunAction } from '@alga-psa/workflows/actions';
import WorkflowDefinitionModelV2 from '@alga-psa/workflows/persistence/workflowDefinitionModelV2';
import WorkflowDefinitionVersionModelV2 from '@alga-psa/workflows/persistence/workflowDefinitionVersionModelV2';
import WorkflowRunSnapshotModelV2 from '@alga-psa/workflows/persistence/workflowRunSnapshotModelV2';
import { getActionRegistryV2, getSchemaRegistry } from '@alga-psa/workflows/runtime';
import {
  ensureWorkflowRuntimeV2TestRegistrations
} from '../helpers/workflowRuntimeV2TestHelpers';

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(),
  getCurrentTenantId: vi.fn()
}));

vi.mock('@alga-psa/users/actions', () => ({
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
// Version of the published definition seeded by seedEmailWorkflow (the
// email-processing-workflow.v2.json ships version 2; runs must request the
// version that is actually published, as production callers do).
let emailWorkflowVersion = 1;

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
  await WorkflowDefinitionModelV2.create(db, tenantId, {
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
  // Mirror publishWorkflowVersionAction, which stamps the tenant on version rows;
  // startWorkflowRunAction resolves versions tenant-scoped.
  await WorkflowDefinitionVersionModelV2.create(db, {
    workflow_id: definition.id,
    tenant: tenantId,
    version: definition.version,
    definition_json: definition,
    payload_schema_json: payloadSchemaJson as Record<string, unknown>,
    published_by: userId,
    published_at: new Date().toISOString()
  });
  emailWorkflowVersion = definition.version;
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

// Two remaining retired-interpreter assertions await active replacements:
// application-action email start and real threading lookup. The other original
// assertions now run in snapshotStorage integration and email-definition engine
// suites; see the production-regression-prevention plan evidence.
describe.skip('workflow runtime v2 email workflow integration tests', () => {
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

      const result = await startWorkflowRunAction({ workflowId: EMAIL_WORKFLOW_ID, workflowVersion: emailWorkflowVersion, payload: baseEmailPayload() });
      runId = result.runId;
      snapshots = await WorkflowRunSnapshotModelV2.listByRun(db, runId);
    });

    it('Email workflow start accepts event payload and initializes EmailWorkflowPayload fields. Mocks: non-target dependencies.', () => {
      const payload = snapshots[snapshots.length - 1].envelope_json.payload;
      expect(payload.emailData).toBeDefined();
      expect(payload.providerId).toBe('provider-1');
      expect(payload.tenantId).toBe(tenantId);
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

    await startWorkflowRunAction({ workflowId: EMAIL_WORKFLOW_ID, workflowVersion: emailWorkflowVersion, payload: baseEmailPayload() });
    expect(resolveExistingSpy).toHaveBeenCalled();
  });
});
