import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import {
  getClientServiceRequestSubmissionDetail,
  getServiceRequestSubmissionDetailForDefinition,
  listClientServiceRequestSubmissions,
} from '../../lib/service-requests/submissionHistory';
import { getServiceRequestDefinitionEditorData } from '../../lib/service-requests/definitionEditor';
import { validateServiceRequestDefinitionForPublish } from '../../lib/service-requests/definitionValidation';

type ColumnInfoMap = Record<string, unknown>;

interface SubmissionFixture {
  tenant: string;
  requesterUserId: string;
  clientId: string;
  otherClientId: string;
  boardId: string;
  statusId: string;
  priorityId: string;
}

let db: Knex;
let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;
let boardColumns: ColumnInfoMap;
let statusColumns: ColumnInfoMap;
let priorityColumns: ColumnInfoMap;
const tenantsToCleanup = new Set<string>();

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

function tenantTable(tenant: string, table: string) {
  return tenantDb(db, tenant).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

function schemaTable(table: string) {
  return tenantDb(db, '__test_schema__')
    .unscoped(table, 'columnInfo reads schema metadata, not tenant rows');
}

async function cleanupTenant(tenant: string): Promise<void> {
  await tenantTable(tenant, 'service_request_submission_attachments').del();
  await tenantTable(tenant, 'service_request_submissions').del();
  await tenantTable(tenant, 'service_request_definition_versions').del();
  await tenantTable(tenant, 'service_request_definitions').del();
  await tenantTable(tenant, 'external_files').del();
  await tenantTable(tenant, 'tickets').del();
  await tenantTable(tenant, 'next_number').del();
  await tenantTable(tenant, 'statuses').del();
  await tenantTable(tenant, 'priorities').del();
  await tenantTable(tenant, 'boards').del();
  await tenantTable(tenant, 'clients').del();
  await tenantTable(tenant, 'users').del();
  await tenantRows().where({ tenant }).del();
}

async function createSubmissionFixture(): Promise<SubmissionFixture> {
  const tenant = uuidv4();
  const requesterUserId = uuidv4();
  const clientId = uuidv4();
  const otherClientId = uuidv4();
  const boardId = uuidv4();
  const statusId = uuidv4();
  const priorityId = uuidv4();

  tenantsToCleanup.add(tenant);

  await tenantRows().insert({
    tenant,
    ...(hasColumn(tenantColumns, 'company_name')
      ? { company_name: `Tenant ${tenant.slice(0, 8)}` }
      : { client_name: `Tenant ${tenant.slice(0, 8)}` }),
    email: `tenant-${tenant.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenant, 'users').insert({
    tenant,
    user_id: requesterUserId,
    username: `requester-${tenant.slice(0, 8)}`,
    hashed_password: 'not-used',
    ...(hasColumn(userColumns, 'role') ? { role: 'admin' } : {}),
    ...(hasColumn(userColumns, 'email') ? { email: `requester-${tenant.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  for (const [id, name] of [
    [clientId, `Client ${tenant.slice(0, 8)}`],
    [otherClientId, `Other Client ${tenant.slice(0, 8)}`],
  ] as const) {
    await tenantTable(tenant, 'clients').insert({
      tenant,
      client_id: id,
      client_name: name,
      ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
      ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
      ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
      ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
  }

  await tenantTable(tenant, 'boards').insert({
    tenant,
    board_id: boardId,
    board_name: `Support ${tenant.slice(0, 8)}`,
    ...(hasColumn(boardColumns, 'description') ? { description: 'Support board' } : {}),
    ...(hasColumn(boardColumns, 'display_order') ? { display_order: 10 } : {}),
    ...(hasColumn(boardColumns, 'is_default') ? { is_default: true } : {}),
    ...(hasColumn(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn(boardColumns, 'is_active') ? { is_active: true } : {}),
    ...(hasColumn(boardColumns, 'category_type') ? { category_type: 'custom' } : {}),
    ...(hasColumn(boardColumns, 'priority_type') ? { priority_type: 'custom' } : {}),
    ...(hasColumn(boardColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(boardColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenant, 'priorities').insert({
    tenant,
    priority_id: priorityId,
    priority_name: 'High',
    ...(hasColumn(priorityColumns, 'item_type') ? { item_type: 'ticket' } : {}),
    ...(hasColumn(priorityColumns, 'order_number') ? { order_number: 10 } : {}),
    ...(hasColumn(priorityColumns, 'color') ? { color: '#EF4444' } : {}),
    ...(hasColumn(priorityColumns, 'created_by') ? { created_by: requesterUserId } : {}),
    ...(hasColumn(priorityColumns, 'updated_by') ? { updated_by: requesterUserId } : {}),
    ...(hasColumn(priorityColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(priorityColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenant, 'statuses').insert({
    tenant,
    status_id: statusId,
    ...(hasColumn(statusColumns, 'board_id') ? { board_id: boardId } : {}),
    name: 'Open',
    ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
    ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
    is_closed: false,
    is_default: true,
    order_number: 10,
    created_by: requesterUserId,
    ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
    ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
    ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return { tenant, requesterUserId, clientId, otherClientId, boardId, statusId, priorityId };
}

const REPRESENTATIVE_FORM_SCHEMA = {
  fields: [
    { key: 'request_title', type: 'short-text', label: 'Request Title', required: true },
    { key: 'notes', type: 'long-text', label: 'Notes', required: false },
    { key: 'evidence', type: 'file-upload', label: 'Evidence', required: false },
  ],
};

async function createPublishedDefinition(args: {
  tenant: string;
  definitionId: string;
  versionId: string;
  executionProvider: 'store-only' | 'ticket-only';
  executionConfig?: Record<string, unknown>;
}) {
  const executionConfig = args.executionConfig ?? {};
  await tenantTable(args.tenant, 'service_request_definitions').insert({
    tenant: args.tenant,
    definition_id: args.definitionId,
    name: 'Onboarding Questionnaire',
    form_schema: REPRESENTATIVE_FORM_SCHEMA,
    execution_provider: args.executionProvider,
    execution_config: executionConfig,
    form_behavior_provider: 'basic',
    form_behavior_config: {},
    visibility_provider: 'all-authenticated-client-users',
    visibility_config: {},
    lifecycle_state: 'published',
  });

  await tenantTable(args.tenant, 'service_request_definition_versions').insert({
    tenant: args.tenant,
    version_id: args.versionId,
    definition_id: args.definitionId,
    version_number: 1,
    name: 'Onboarding Questionnaire',
    form_schema_snapshot: REPRESENTATIVE_FORM_SCHEMA,
    execution_provider: args.executionProvider,
    execution_config: executionConfig,
    form_behavior_provider: 'basic',
    form_behavior_config: {},
    visibility_provider: 'all-authenticated-client-users',
    visibility_config: {},
  });
}

function ticketRoutingConfig(fixture: SubmissionFixture): Record<string, unknown> {
  return {
    boardId: fixture.boardId,
    statusId: fixture.statusId,
    priorityId: fixture.priorityId,
    titleFieldKey: 'request_title',
  };
}

async function seedExternalFile(tenant: string, fileId: string, uploadedById: string) {
  await tenantTable(tenant, 'external_files').insert({
    tenant,
    file_id: fileId,
    file_name: 'evidence.pdf',
    original_name: 'evidence.pdf',
    mime_type: 'application/pdf',
    file_size: 2048,
    storage_path: `service-requests/${fileId}`,
    uploaded_by_id: uploadedById,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function countRows(tenant: string, table: string): Promise<number> {
  const [row] = await tenantTable(tenant, table).count<{ count: string }[]>('* as count');
  return Number(row.count);
}

const REPRESENTATIVE_PAYLOAD = {
  request_title: 'New Hire Onboarding',
  notes: 'Starts Monday; needs laptop and badge.',
};

describe('service request store-only submissions', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await schemaTable('tenants').columnInfo();
    userColumns = await schemaTable('users').columnInfo();
    clientColumns = await schemaTable('clients').columnInfo();
    boardColumns = await schemaTable('boards').columnInfo();
    statusColumns = await schemaTable('statuses').columnInfo();
    priorityColumns = await schemaTable('priorities').columnInfo();
  });

  afterEach(async () => {
    for (const tenant of tenantsToCleanup) {
      await cleanupTenant(tenant);
      tenantsToCleanup.delete(tenant);
    }
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('store-only submission retains the full versioned response and creates zero tickets or workflow executions', async () => {
    const fixture = await createSubmissionFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const fileId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionProvider: 'store-only',
    });
    await seedExternalFile(fixture.tenant, fileId, fixture.requesterUserId);

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: REPRESENTATIVE_PAYLOAD,
      attachments: [
        {
          fieldKey: 'evidence',
          fileId,
          fileName: 'evidence.pdf',
          mimeType: 'application/pdf',
          fileSize: 2048,
        },
      ],
    });

    expect(result.executionStatus).toBe('succeeded');
    expect(result.createdTicketId).toBeUndefined();
    expect(result.workflowExecutionId).toBeUndefined();
    expect(result.redirectUrl).toBeUndefined();

    const submission = await tenantTable(fixture.tenant, 'service_request_submissions')
      .where({ submission_id: result.submissionId })
      .first();
    expect(submission).toMatchObject({
      definition_id: definitionId,
      definition_version_id: versionId,
      requester_user_id: fixture.requesterUserId,
      client_id: fixture.clientId,
      execution_status: 'succeeded',
      created_ticket_id: null,
      workflow_execution_id: null,
      execution_error_summary: null,
    });
    expect(submission.submitted_payload).toEqual(REPRESENTATIVE_PAYLOAD);
    expect(submission.created_at).toBeTruthy();

    expect(await countRows(fixture.tenant, 'tickets')).toBe(0);

    const detail = await getClientServiceRequestSubmissionDetail(
      db,
      fixture.tenant,
      fixture.clientId,
      result.submissionId
    );
    expect(detail).toBeTruthy();
    expect(detail?.submitted_payload).toEqual(REPRESENTATIVE_PAYLOAD);
    expect(detail?.form_schema_snapshot).toEqual(REPRESENTATIVE_FORM_SCHEMA);
    expect(detail?.created_ticket_id).toBeNull();
    expect(detail?.workflow_execution_id).toBeNull();
    expect(detail?.attachments).toHaveLength(1);
    expect(detail?.attachments[0]).toMatchObject({
      field_key: 'evidence',
      file_id: fileId,
      file_name: 'evidence.pdf',
    });
  });

  it('the same representative questionnaire in ticket-only mode retains the response and creates exactly one ticket', async () => {
    const fixture = await createSubmissionFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionProvider: 'ticket-only',
      executionConfig: ticketRoutingConfig(fixture),
    });

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: REPRESENTATIVE_PAYLOAD,
    });

    expect(result.executionStatus).toBe('succeeded');
    expect(result.createdTicketId).toBeTruthy();

    const submission = await tenantTable(fixture.tenant, 'service_request_submissions')
      .where({ submission_id: result.submissionId })
      .first();
    expect(submission.submitted_payload).toEqual(REPRESENTATIVE_PAYLOAD);
    expect(submission.execution_status).toBe('succeeded');
    expect(submission.created_ticket_id).toBe(result.createdTicketId);

    expect(await countRows(fixture.tenant, 'tickets')).toBe(1);
  });

  it('sequential same-key retries return the original store-only submission without a second row', async () => {
    const fixture = await createSubmissionFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const clientSubmissionKey = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionProvider: 'store-only',
    });

    const first = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: REPRESENTATIVE_PAYLOAD,
      clientSubmissionKey,
    });
    const retry = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: REPRESENTATIVE_PAYLOAD,
      clientSubmissionKey,
    });

    expect(first.replayed).toBeUndefined();
    expect(retry.replayed).toBe(true);
    expect(retry.submissionId).toBe(first.submissionId);
    expect(retry.executionStatus).toBe('succeeded');

    expect(await countRows(fixture.tenant, 'service_request_submissions')).toBe(1);
  });

  it('sequential same-key retries in ticket-only mode replay the original ticket instead of creating another', async () => {
    const fixture = await createSubmissionFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const clientSubmissionKey = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionProvider: 'ticket-only',
      executionConfig: ticketRoutingConfig(fixture),
    });

    const submitOnce = () =>
      submitPortalServiceRequest({
        knex: db,
        tenant: fixture.tenant,
        definitionId,
        requesterUserId: fixture.requesterUserId,
        clientId: fixture.clientId,
        payload: REPRESENTATIVE_PAYLOAD,
        clientSubmissionKey,
      });

    const first = await submitOnce();
    const retry = await submitOnce();

    expect(first.createdTicketId).toBeTruthy();
    expect(retry.replayed).toBe(true);
    expect(retry.submissionId).toBe(first.submissionId);
    expect(retry.createdTicketId).toBe(first.createdTicketId);

    expect(await countRows(fixture.tenant, 'service_request_submissions')).toBe(1);
    expect(await countRows(fixture.tenant, 'tickets')).toBe(1);
  });

  it('concurrent same-key submissions resolve to one submission and at most one ticket', async () => {
    const fixture = await createSubmissionFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const clientSubmissionKey = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionProvider: 'ticket-only',
      executionConfig: ticketRoutingConfig(fixture),
    });

    const submitOnce = () =>
      submitPortalServiceRequest({
        knex: db,
        tenant: fixture.tenant,
        definitionId,
        requesterUserId: fixture.requesterUserId,
        clientId: fixture.clientId,
        payload: REPRESENTATIVE_PAYLOAD,
        clientSubmissionKey,
      });

    const [resultA, resultB] = await Promise.all([submitOnce(), submitOnce()]);

    expect(resultA.submissionId).toBe(resultB.submissionId);
    expect([resultA.replayed, resultB.replayed]).toContain(true);

    expect(await countRows(fixture.tenant, 'service_request_submissions')).toBe(1);
    expect(await countRows(fixture.tenant, 'tickets')).toBe(1);
  });

  it('distinct keys and absent keys keep creating distinct submissions', async () => {
    const fixture = await createSubmissionFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionProvider: 'store-only',
    });

    const submitOnce = (clientSubmissionKey?: string) =>
      submitPortalServiceRequest({
        knex: db,
        tenant: fixture.tenant,
        definitionId,
        requesterUserId: fixture.requesterUserId,
        clientId: fixture.clientId,
        payload: REPRESENTATIVE_PAYLOAD,
        clientSubmissionKey,
      });

    const keyedA = await submitOnce(uuidv4());
    const keyedB = await submitOnce(uuidv4());
    const unkeyedA = await submitOnce();
    const unkeyedB = await submitOnce();

    const submissionIds = new Set([
      keyedA.submissionId,
      keyedB.submissionId,
      unkeyedA.submissionId,
      unkeyedB.submissionId,
    ]);
    expect(submissionIds.size).toBe(4);
    expect(await countRows(fixture.tenant, 'service_request_submissions')).toBe(4);
  });

  it('rejects malformed client submission keys before persisting anything', async () => {
    const fixture = await createSubmissionFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionProvider: 'store-only',
    });

    await expect(
      submitPortalServiceRequest({
        knex: db,
        tenant: fixture.tenant,
        definitionId,
        requesterUserId: fixture.requesterUserId,
        clientId: fixture.clientId,
        payload: REPRESENTATIVE_PAYLOAD,
        clientSubmissionKey: 'not-a-uuid',
      })
    ).rejects.toThrow('Client submission key must be a UUID');

    expect(await countRows(fixture.tenant, 'service_request_submissions')).toBe(0);
  });

  it('stored responses are readable in their own client and definition scope but not from foreign scopes', async () => {
    const fixture = await createSubmissionFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionProvider: 'store-only',
    });

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: REPRESENTATIVE_PAYLOAD,
    });

    const ownDetail = await getClientServiceRequestSubmissionDetail(
      db,
      fixture.tenant,
      fixture.clientId,
      result.submissionId
    );
    expect(ownDetail?.submission_id).toBe(result.submissionId);

    const ownList = await listClientServiceRequestSubmissions(db, fixture.tenant, fixture.clientId);
    expect(ownList.map((row) => row.submission_id)).toContain(result.submissionId);

    const adminDetail = await getServiceRequestSubmissionDetailForDefinition(
      db,
      fixture.tenant,
      definitionId,
      result.submissionId
    );
    expect(adminDetail?.submission_id).toBe(result.submissionId);
    expect(adminDetail?.created_ticket_display).toBeNull();

    const foreignClientDetail = await getClientServiceRequestSubmissionDetail(
      db,
      fixture.tenant,
      fixture.otherClientId,
      result.submissionId
    );
    expect(foreignClientDetail).toBeNull();

    const foreignClientList = await listClientServiceRequestSubmissions(
      db,
      fixture.tenant,
      fixture.otherClientId
    );
    expect(foreignClientList).toHaveLength(0);

    const foreignTenantDetail = await getClientServiceRequestSubmissionDetail(
      db,
      uuidv4(),
      fixture.clientId,
      result.submissionId
    );
    expect(foreignTenantDetail).toBeNull();
  });

  it('store-only is an offered execution provider and publishes without ticket routing configuration', async () => {
    const fixture = await createSubmissionFixture();
    const storeOnlyDefinitionId = uuidv4();
    const ticketOnlyDefinitionId = uuidv4();

    await tenantTable(fixture.tenant, 'service_request_definitions').insert([
      {
        tenant: fixture.tenant,
        definition_id: storeOnlyDefinitionId,
        name: 'Store Only Draft',
        form_schema: REPRESENTATIVE_FORM_SCHEMA,
        execution_provider: 'store-only',
        execution_config: {},
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: 'all-authenticated-client-users',
        visibility_config: {},
        lifecycle_state: 'draft',
      },
      {
        tenant: fixture.tenant,
        definition_id: ticketOnlyDefinitionId,
        name: 'Ticket Only Draft',
        form_schema: REPRESENTATIVE_FORM_SCHEMA,
        execution_provider: 'ticket-only',
        execution_config: {},
        form_behavior_provider: 'basic',
        form_behavior_config: {},
        visibility_provider: 'all-authenticated-client-users',
        visibility_config: {},
        lifecycle_state: 'draft',
      },
    ]);

    const editorData = await getServiceRequestDefinitionEditorData(
      db,
      fixture.tenant,
      storeOnlyDefinitionId
    );
    expect(
      editorData?.execution.availableExecutionProviders.map((provider) => provider.key)
    ).toEqual(expect.arrayContaining(['ticket-only', 'store-only']));
    expect(editorData?.execution.executionProvider).toBe('store-only');
    expect(editorData?.execution.showWorkflowExecutionConfigPanel).toBe(false);

    // Store-only needs no routing config to publish...
    const storeOnlyValidation = await validateServiceRequestDefinitionForPublish(
      db,
      fixture.tenant,
      storeOnlyDefinitionId
    );
    expect(storeOnlyValidation.isValid).toBe(true);
    expect(storeOnlyValidation.errors).toHaveLength(0);

    // ...while ticket-only keeps requiring it, so the new provider loosened nothing.
    const ticketOnlyValidation = await validateServiceRequestDefinitionForPublish(
      db,
      fixture.tenant,
      ticketOnlyDefinitionId
    );
    expect(ticketOnlyValidation.isValid).toBe(false);
  });

  it('validation failures persist no submission and run no side effects', async () => {
    const fixture = await createSubmissionFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionProvider: 'store-only',
    });

    await expect(
      submitPortalServiceRequest({
        knex: db,
        tenant: fixture.tenant,
        definitionId,
        requesterUserId: fixture.requesterUserId,
        clientId: fixture.clientId,
        payload: { notes: 'missing the required title' },
      })
    ).rejects.toThrow('Submission validation failed');

    await expect(
      submitPortalServiceRequest({
        knex: db,
        tenant: fixture.tenant,
        definitionId,
        requesterUserId: fixture.requesterUserId,
        clientId: fixture.clientId,
        payload: REPRESENTATIVE_PAYLOAD,
        attachments: [{ fieldKey: 'evidence', fileId: uuidv4() }],
      })
    ).rejects.toThrow('Submission attachments reference unknown files');

    expect(await countRows(fixture.tenant, 'service_request_submissions')).toBe(0);
    expect(await countRows(fixture.tenant, 'tickets')).toBe(0);
  });
});
