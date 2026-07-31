import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import { getClientServiceRequestSubmissionDetail } from '../../lib/service-requests/submissionHistory';

type ColumnInfoMap = Record<string, unknown>;

interface TicketFixture {
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

async function createTicketFixture(): Promise<TicketFixture> {
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
  executionConfig: Record<string, unknown>;
  linkedServiceId?: string | null;
}) {
  await tenantTable(args.tenant, 'service_request_definitions').insert({
    tenant: args.tenant,
    definition_id: args.definitionId,
    name: 'Employee Onboarding',
    linked_service_id: args.linkedServiceId ?? null,
    form_schema: { fields: [] },
    execution_provider: 'ticket-only',
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
    name: 'Employee Onboarding',
    form_schema_snapshot: {
      fields: [
        { key: 'request_title', type: 'short-text', label: 'Request Title', required: true },
        { key: 'notes', type: 'long-text', label: 'Notes', required: false },
      ],
    },
    execution_provider: 'ticket-only',
    execution_config: args.executionConfig,
    form_behavior_provider: 'basic',
    form_behavior_config: {},
    visibility_provider: 'all-authenticated-client-users',
    visibility_config: {},
  });
}

async function createItilPriority(
  tenant: string,
  requesterUserId: string,
  priorityName: string,
  priorityLevel: number,
  orderNumber: number
): Promise<string> {
  const priorityId = uuidv4();
  await tenantTable(tenant, 'priorities').insert({
    tenant,
    priority_id: priorityId,
    priority_name: priorityName,
    ...(hasColumn(priorityColumns, 'item_type') ? { item_type: 'ticket' } : {}),
    ...(hasColumn(priorityColumns, 'order_number') ? { order_number: orderNumber } : {}),
    ...(hasColumn(priorityColumns, 'color') ? { color: '#EF4444' } : {}),
    ...(hasColumn(priorityColumns, 'is_from_itil_standard') ? { is_from_itil_standard: true } : {}),
    ...(hasColumn(priorityColumns, 'itil_priority_level') ? { itil_priority_level: priorityLevel } : {}),
    ...(hasColumn(priorityColumns, 'created_by') ? { created_by: requesterUserId } : {}),
    ...(hasColumn(priorityColumns, 'updated_by') ? { updated_by: requesterUserId } : {}),
    ...(hasColumn(priorityColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(priorityColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });
  return priorityId;
}

describe('service request ticket-only execution', () => {
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

  it('T026: ticket-only execution creates a ticket using configured defaults and mapped request data', async () => {
    const fixture = await createTicketFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionConfig: {
        boardId: fixture.boardId,
        statusId: fixture.statusId,
        priorityId: fixture.priorityId,
        titleFieldKey: 'request_title',
        descriptionPrefix: 'Portal Service Request',
      },
    });

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: {
        request_title: 'New Hire Laptop',
        notes: 'Ship before Monday',
      },
    });

    expect(result.executionStatus).toBe('succeeded');
    expect(result.createdTicketId).toBeTruthy();

    const submission = await tenantTable(fixture.tenant, 'service_request_submissions')
      .where({ submission_id: result.submissionId })
      .first();
    expect(submission).toMatchObject({
      execution_status: 'succeeded',
      created_ticket_id: result.createdTicketId,
    });

    const createdTicket = await tenantTable(fixture.tenant, 'tickets')
      .where({ ticket_id: result.createdTicketId })
      .first();
    expect(createdTicket).toBeTruthy();
    expect(createdTicket.title).toBe('New Hire Laptop');
    expect(createdTicket.board_id).toBe(fixture.boardId);
    expect(createdTicket.status_id).toBe(fixture.statusId);
    expect(createdTicket.priority_id).toBe(fixture.priorityId);
    const ticketDescription = (createdTicket.attributes as { description?: string } | null)?.description;
    expect(ticketDescription).toContain('Portal Service Request');
    expect(ticketDescription).toContain('request_title: New Hire Laptop');
    expect(ticketDescription).toContain('notes: Ship before Monday');
  });

  it('T027: ticket-only execution failure keeps submission persisted with failed status and error summary', async () => {
    const fixture = await createTicketFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionConfig: {
        boardId: uuidv4(),
        statusId: fixture.statusId,
        priorityId: fixture.priorityId,
      },
    });

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: {
        request_title: 'Bad Routing',
      },
    });

    expect(result.executionStatus).toBe('failed');
    const submission = await tenantTable(fixture.tenant, 'service_request_submissions')
      .where({ submission_id: result.submissionId })
      .first();
    expect(submission).toBeTruthy();
    expect(submission.execution_status).toBe('failed');
    expect(submission.created_ticket_id).toBeNull();
    expect(submission.execution_error_summary).toBeTruthy();
  });

  it('T028: ticket-backed request history detail includes linked ticket reference after successful execution', async () => {
    const fixture = await createTicketFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionConfig: {
        boardId: fixture.boardId,
        statusId: fixture.statusId,
        priorityId: fixture.priorityId,
        titleFieldKey: 'request_title',
      },
    });

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: { request_title: 'Badge Access' },
    });

    const detail = await getClientServiceRequestSubmissionDetail(
      db,
      fixture.tenant,
      fixture.clientId,
      result.submissionId
    );
    expect(detail).toBeTruthy();
    expect(detail?.created_ticket_id).toBe(result.createdTicketId);
  });

  it('T029: definitions without linked services can still submit successfully through ticket-only execution', async () => {
    const fixture = await createTicketFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionConfig: {
        boardId: fixture.boardId,
        statusId: fixture.statusId,
        priorityId: fixture.priorityId,
      },
      linkedServiceId: null,
    });

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: { request_title: 'No Linked Service Needed' },
    });

    expect(result.executionStatus).toBe('succeeded');
    expect(result.createdTicketId).toBeTruthy();
  });

  it('T030: ticket-only execution maps ITIL impact and urgency to the created ticket priority', async () => {
    const fixture = await createTicketFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    const itilPriorityId = await createItilPriority(
      fixture.tenant,
      fixture.requesterUserId,
      'P1 - Critical',
      1,
      1
    );

    await tenantTable(fixture.tenant, 'boards')
      .where({ board_id: fixture.boardId })
      .update({ priority_type: 'itil' });

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionConfig: {
        boardId: fixture.boardId,
        statusId: fixture.statusId,
        priorityId: fixture.priorityId,
        itilImpact: 1,
        itilUrgency: 1,
        titleFieldKey: 'request_title',
      },
    });

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: {
        request_title: 'Emergency Access',
      },
    });

    expect(result.executionStatus).toBe('succeeded');
    expect(result.createdTicketId).toBeTruthy();

    const createdTicket = await tenantTable(fixture.tenant, 'tickets')
      .where({ ticket_id: result.createdTicketId })
      .first();
    expect(createdTicket).toBeTruthy();
    expect(createdTicket.priority_id).toBe(itilPriorityId);
    expect(createdTicket.itil_impact).toBe(1);
    expect(createdTicket.itil_urgency).toBe(1);
  });

  it('T031: ticket-only execution honors starter-template title and description defaults', async () => {
    const fixture = await createTicketFixture();
    const definitionId = uuidv4();
    const versionId = uuidv4();

    await createPublishedDefinition({
      tenant: fixture.tenant,
      definitionId,
      versionId,
      executionConfig: {
        boardId: fixture.boardId,
        statusId: fixture.statusId,
        priorityId: fixture.priorityId,
        titleTemplate: 'New Hire Setup: {{request_title}}',
        descriptionPrefix: 'Starter Template Request',
        includeFormResponsesInDescription: false,
      },
    });

    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: fixture.tenant,
      definitionId,
      requesterUserId: fixture.requesterUserId,
      clientId: fixture.clientId,
      payload: {
        request_title: 'Laptop Provisioning',
        notes: 'Ship before Monday',
      },
    });

    expect(result.executionStatus).toBe('succeeded');
    expect(result.createdTicketId).toBeTruthy();

    const createdTicket = await tenantTable(fixture.tenant, 'tickets')
      .where({ ticket_id: result.createdTicketId })
      .first();
    expect(createdTicket).toBeTruthy();
    expect(createdTicket.title).toBe('New Hire Setup: Laptop Provisioning');
    const ticketDescription = (createdTicket.attributes as { description?: string } | null)?.description;
    expect(ticketDescription).toBe('Starter Template Request');
    expect(ticketDescription).not.toContain('request_title: Laptop Provisioning');
    expect(ticketDescription).not.toContain('notes: Ship before Monday');
  });
});
