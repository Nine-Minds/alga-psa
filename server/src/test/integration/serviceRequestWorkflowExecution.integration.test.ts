import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import {
  getClientServiceRequestSubmissionDetail,
  getServiceRequestSubmissionDetailForDefinition,
} from '../../lib/service-requests/submissionHistory';
import {
  registerServiceRequestProviders,
  resetServiceRequestProviderRegistry,
} from '../../lib/service-requests/providers/registry';
import { getServiceRequestEnterpriseProviderRegistrations } from '../../../../ee/server/src/lib/service-requests/providers';

type ColumnInfoMap = Record<string, unknown>;

interface WorkflowFixture {
  tenant: string;
  requesterUserId: string;
  clientId: string;
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
  await tenantTable(tenant, 'tickets').del();
  await tenantTable(tenant, 'next_number').del();
  await tenantTable(tenant, 'statuses').del();
  await tenantTable(tenant, 'priorities').del();
  await tenantTable(tenant, 'boards').del();
  await tenantTable(tenant, 'clients').del();
  await tenantTable(tenant, 'users').del();
  await tenantRows().where({ tenant }).del();
}

async function createWorkflowFixture(): Promise<WorkflowFixture> {
  const tenant = uuidv4();
  const requesterUserId = uuidv4();
  const clientId = uuidv4();
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

  await tenantTable(tenant, 'clients').insert({
    tenant,
    client_id: clientId,
    client_name: `Client ${tenant.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

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

  return { tenant, requesterUserId, clientId, boardId, statusId, priorityId };
}

async function createPublishedDefinition(args: {
  tenant: string;
  definitionId: string;
  versionId: string;
  executionProvider: 'workflow-only' | 'ticket-plus-workflow';
  executionConfig: Record<string, unknown>;
}) {
  await tenantTable(args.tenant, 'service_request_definitions').insert({
    tenant: args.tenant,
    definition_id: args.definitionId,
    name: 'Workflow Request',
    form_schema: { fields: [] },
    execution_provider: args.executionProvider,
    execution_config: args.executionConfig,
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
    name: 'Workflow Request',
    form_schema_snapshot: {
      fields: [
        { key: 'request_title', type: 'short-text', label: 'Request Title', required: true },
        { key: 'department', type: 'short-text', label: 'Department', required: false },
      ],
    },
    execution_provider: args.executionProvider,
    execution_config: args.executionConfig,
    form_behavior_provider: 'basic',
    form_behavior_config: {},
    visibility_provider: 'all-authenticated-client-users',
    visibility_config: {},
  });
}

describe('service request workflow execution providers', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await schemaTable('tenants').columnInfo();
    userColumns = await schemaTable('users').columnInfo();
    clientColumns = await schemaTable('clients').columnInfo();
    boardColumns = await schemaTable('boards').columnInfo();
    statusColumns = await schemaTable('statuses').columnInfo();
    priorityColumns = await schemaTable('priorities').columnInfo();

    resetServiceRequestProviderRegistry();
    registerServiceRequestProviders(await getServiceRequestEnterpriseProviderRegistrations());
  });

  afterEach(async () => {
    for (const tenant of tenantsToCleanup) {
      await cleanupTenant(tenant);
      tenantsToCleanup.delete(tenant);
    }
  });

  afterAll(async () => {
    resetServiceRequestProviderRegistry();
    if (db) {
      await db.destroy();
    }
  });

  it('T032: workflow-only execution starts configured workflow and stores workflow execution reference on submission', async () => {
    const fixture = await createWorkflowFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionProvider: 'workflow-only',
      executionConfig: {
        workflowId: 'wf-onboarding',
        inputMapping: {
          title: 'payload.request_title',
          client: 'literal:managed-client',
        },
      },
    });

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: {
        request_title: 'Enable Starter Access',
        department: 'Operations',
      },
    });

    expect(result.executionStatus).toBe('succeeded');
    expect(result.createdTicketId).toBeUndefined();
    expect(result.workflowExecutionId).toBe(`wf_wf-onboarding_${result.submissionId}`);

    const submission = await tenantTable(fixture.tenant, 'service_request_submissions')
      .where({ submission_id: result.submissionId })
      .first();

    expect(submission).toMatchObject({
      execution_status: 'succeeded',
      workflow_execution_id: result.workflowExecutionId,
      created_ticket_id: null,
    });
  });

  it('T033: ticket-plus-workflow execution maps workflow inputs with submission data and created ticket id', async () => {
    const fixture = await createWorkflowFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionProvider: 'ticket-plus-workflow',
      executionConfig: {
        workflowId: 'wf-access-request',
        boardId: fixture.boardId,
        statusId: fixture.statusId,
        priorityId: fixture.priorityId,
        titleFieldKey: 'request_title',
        inputMapping: {
          ticketReference: 'ticketId',
          requestTitle: 'payload.request_title',
        },
      },
    });

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: {
        request_title: 'Provision VPN Access',
      },
    });

    expect(result.executionStatus).toBe('succeeded');
    expect(result.createdTicketId).toBeTruthy();
    expect(result.workflowExecutionId).toBe(`wf_wf-access-request_${result.createdTicketId}`);

    const submission = await tenantTable(fixture.tenant, 'service_request_submissions')
      .where({ submission_id: result.submissionId })
      .first();

    expect(submission).toMatchObject({
      execution_status: 'succeeded',
      created_ticket_id: result.createdTicketId,
      workflow_execution_id: result.workflowExecutionId,
    });
  });

  it('T034: workflow execution failure keeps durable submission and marks execution status failed', async () => {
    const fixture = await createWorkflowFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionProvider: 'workflow-only',
      executionConfig: {
        workflowId: 'wf-failing-startup',
        simulateFailure: true,
      },
    });

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: {
        request_title: 'Run Failing Workflow',
      },
    });

    expect(result.executionStatus).toBe('failed');

    const submission = await tenantTable(fixture.tenant, 'service_request_submissions')
      .where({ submission_id: result.submissionId })
      .first();

    expect(submission).toBeTruthy();
    expect(submission.execution_status).toBe('failed');
    expect(submission.workflow_execution_id).toBeNull();
    expect(submission.execution_error_summary).toContain('Workflow startup failed');
  });

  it('T035: workflow-backed submissions expose workflow references in request history views', async () => {
    const fixture = await createWorkflowFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionProvider: 'workflow-only',
      executionConfig: {
        workflowId: 'wf-history-reference',
      },
    });

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: {
        request_title: 'History Reference Check',
      },
    });

    expect(result.executionStatus).toBe('succeeded');
    expect(result.workflowExecutionId).toBeTruthy();

    const clientDetail = await getClientServiceRequestSubmissionDetail(
      db,
      fixture.tenant,
      fixture.clientId,
      result.submissionId
    );
    expect(clientDetail?.workflow_execution_id).toBe(result.workflowExecutionId);

    const adminDetail = await getServiceRequestSubmissionDetailForDefinition(
      db,
      fixture.tenant,
      definitionId,
      result.submissionId
    );
    expect(adminDetail?.workflow_execution_id).toBe(result.workflowExecutionId);
  });
});
