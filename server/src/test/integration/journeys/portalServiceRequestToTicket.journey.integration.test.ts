import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth';
import { TICKET_STATUS_FILTER_OPEN } from '@alga-psa/tickets/lib/ticketStatusFilter';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';

// P0 journey (docs: journey-first testing pivot): the client-portal request
// loop an MSP's customer actually walks — a portal user opens a published
// service-request form, submits it, the ticket-only execution provider turns
// it into a ticket, the MSP triages it (assign + status) and replies, and the
// portal user sees the update on their side. The bricks (definition
// publishing, ticket-only execution, portal history reads, client-ticket
// visibility) are covered elsewhere; this asserts the seams between them,
// plus tenant + client scoping: a portal user from a sibling client in the
// same tenant sees the catalog but none of the other client's data.

let db: Knex;
let tenantId: string;
// The MSP/portal identities alternate through the journey; the withAuth mocks
// read this at call time so each step runs as the right persona.
let activeActor: any;

type ColumnInfoMap = Record<string, unknown>;

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

function tenantTable<Row extends object = Record<string, unknown>>(
  connection: Knex,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(connection, tenant).table<Row>(tableExpression);
}

function tenantRows(connection: Knex): Knex.QueryBuilder<Record<string, unknown>, Record<string, unknown>[]> {
  return tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

function schemaTable(connection: Knex, table: string) {
  return tenantDb(connection, '__test_schema__')
    .unscoped(table, 'columnInfo reads schema metadata, not tenant rows');
}

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getConnection: vi.fn(async () => db),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(activeActor, { tenant: tenantId }, ...args),
  withOptionalAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(activeActor ?? null, activeActor ? { tenant: tenantId } : null, ...args),
  withAuthCheck: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(activeActor, { tenant: tenantId }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

// The portal submit action terminates in Next's redirect(); surface the URL
// as a throw the test can catch, matching Next's control-flow semantics.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    const error = new Error(`JOURNEY_REDIRECT:${url}`);
    (error as any).journeyRedirectUrl = url;
    throw error;
  },
  notFound: () => {
    throw new Error('JOURNEY_NOT_FOUND');
  },
  useRouter: vi.fn(),
  usePathname: vi.fn(() => '/'),
  useSearchParams: vi.fn(),
}));

const HOOK_TIMEOUT = 180_000;

type PortalDefinitionActions = typeof import('../../../app/client-portal/request-services/[definitionId]/actions');
type PortalHistoryActions = typeof import('../../../app/client-portal/request-services/my-requests/actions');
type MspServiceRequestActions = typeof import('../../../app/msp/service-requests/actions');
type TicketActions = typeof import('@alga-psa/tickets/actions/ticketActions');
type CommentActions = typeof import('@alga-psa/tickets/actions/comment-actions/commentActions');
type ClientTicketActions = typeof import('@alga-psa/client-portal/actions/client-portal-actions/client-tickets');

let getRequestServiceDefinitionDetailAction: PortalDefinitionActions['getRequestServiceDefinitionDetailAction'];
let submitRequestServiceDefinitionAction: PortalDefinitionActions['submitRequestServiceDefinitionAction'];
let listMyServiceRequestSubmissionsAction: PortalHistoryActions['listMyServiceRequestSubmissionsAction'];
let getMyServiceRequestSubmissionDetailAction: PortalHistoryActions['getMyServiceRequestSubmissionDetailAction'];
let listServiceRequestDefinitionSubmissionsAction: MspServiceRequestActions['listServiceRequestDefinitionSubmissionsAction'];
let getServiceRequestDefinitionSubmissionDetailAction: MspServiceRequestActions['getServiceRequestDefinitionSubmissionDetailAction'];
let updateTicket: TicketActions['updateTicket'];
let createComment: CommentActions['createComment'];
let getClientTicketDetails: ClientTicketActions['getClientTicketDetails'];
let getClientTickets: ClientTicketActions['getClientTickets'];

function actAs(user: any): void {
  activeActor = user;
  vi.mocked(getCurrentUser).mockImplementation(async () => user);
}

async function captureRedirect(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error: any) {
    if (typeof error?.journeyRedirectUrl === 'string') {
      return error.journeyRedirectUrl;
    }
    throw error;
  }
  throw new Error('Expected the action to redirect, but it returned normally');
}

describe('journey: client portal service request → MSP ticket triage → portal update', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    // Keep live-update fan-out out of the loop; it is fire-and-forget Redis
    // pub/sub and not a seam this journey asserts.
    process.env.LIVE_TICKET_UPDATES_DISABLED = '1';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureTenant(db);
    setupCommonMocks({ tenantId, userId: 'journey-msp-user', permissionCheck: () => true });
    ({ getRequestServiceDefinitionDetailAction, submitRequestServiceDefinitionAction } =
      await import('../../../app/client-portal/request-services/[definitionId]/actions'));
    ({ listMyServiceRequestSubmissionsAction, getMyServiceRequestSubmissionDetailAction } =
      await import('../../../app/client-portal/request-services/my-requests/actions'));
    ({ listServiceRequestDefinitionSubmissionsAction, getServiceRequestDefinitionSubmissionDetailAction } =
      await import('../../../app/msp/service-requests/actions'));
    ({ updateTicket } = await import('@alga-psa/tickets/actions/ticketActions'));
    ({ createComment } = await import('@alga-psa/tickets/actions/comment-actions/commentActions'));
    ({ getClientTicketDetails, getClientTickets } =
      await import('@alga-psa/client-portal/actions/client-portal-actions/client-tickets'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('walks a portal request from submission through MSP triage back to the portal, scoped to the requesting client', async () => {
    const userColumns = await schemaTable(db, 'users').columnInfo();
    const clientColumns = await schemaTable(db, 'clients').columnInfo();
    const boardColumns = await schemaTable(db, 'boards').columnInfo();
    const statusColumns = await schemaTable(db, 'statuses').columnInfo();
    const priorityColumns = await schemaTable(db, 'priorities').columnInfo();

    const suffix = uuidv4().slice(0, 8);

    // --- two clients in the same tenant, each with a portal contact + user ---
    const clientAId = uuidv4();
    const clientBId = uuidv4();
    const makeClient = async (clientId: string, name: string) => {
      await tenantTable(db, tenantId, 'clients').insert({
        tenant: tenantId,
        client_id: clientId,
        client_name: `${name} ${suffix}`,
        ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
        ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
        ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });
    };
    await makeClient(clientAId, 'Journey Requesting Client');
    await makeClient(clientBId, 'Journey Sibling Client');

    const contactAId = uuidv4();
    const contactBId = uuidv4();
    const makeContact = async (contactId: string, clientId: string, name: string) => {
      await tenantTable(db, tenantId, 'contacts').insert({
        tenant: tenantId,
        contact_name_id: contactId,
        client_id: clientId,
        full_name: name,
        email: `${name.toLowerCase().replace(/\s+/g, '.')}-${suffix}@journey.test`,
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });
    };
    await makeContact(contactAId, clientAId, 'Paula Portal');
    await makeContact(contactBId, clientBId, 'Riley Rival');

    const portalUserAId = uuidv4();
    const portalUserBId = uuidv4();
    const mspUserId = uuidv4();
    const makeUser = async (
      userId: string,
      username: string,
      userType: 'client' | 'internal',
      contactId: string | null,
      firstName: string,
      lastName: string
    ) => {
      await tenantTable(db, tenantId, 'users').insert({
        tenant: tenantId,
        user_id: userId,
        username: `${username}-${suffix}`,
        email: `${username}-${suffix}@journey.test`,
        hashed_password: 'not-used',
        user_type: userType,
        first_name: firstName,
        last_name: lastName,
        ...(contactId ? { contact_id: contactId } : {}),
        ...(hasColumn(userColumns, 'is_inactive') ? { is_inactive: false } : {}),
        created_at: db.fn.now(),
        ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {})
      });
    };
    await makeUser(portalUserAId, 'journey-portal-a', 'client', contactAId, 'Paula', 'Portal');
    await makeUser(portalUserBId, 'journey-portal-b', 'client', contactBId, 'Riley', 'Rival');
    await makeUser(mspUserId, 'journey-msp', 'internal', null, 'Morgan', 'Agent');

    const portalActorA = {
      user_id: portalUserAId,
      tenant: tenantId,
      user_type: 'client',
      contact_id: contactAId,
      email: `journey-portal-a-${suffix}@journey.test`,
      first_name: 'Paula',
      last_name: 'Portal',
      is_inactive: false,
      roles: []
    };
    const portalActorB = {
      user_id: portalUserBId,
      tenant: tenantId,
      user_type: 'client',
      contact_id: contactBId,
      email: `journey-portal-b-${suffix}@journey.test`,
      first_name: 'Riley',
      last_name: 'Rival',
      is_inactive: false,
      roles: []
    };
    const mspActor = {
      user_id: mspUserId,
      tenant: tenantId,
      user_type: 'internal',
      email: `journey-msp-${suffix}@journey.test`,
      first_name: 'Morgan',
      last_name: 'Agent',
      is_inactive: false,
      roles: [{ role_name: 'Admin' }]
    };

    // --- ticket routing targets, as MSP settings would have built them ---
    const boardId = uuidv4();
    await tenantTable(db, tenantId, 'boards').insert({
      tenant: tenantId,
      board_id: boardId,
      board_name: `Journey Support ${suffix}`,
      ...(hasColumn(boardColumns, 'description') ? { description: 'Journey support board' } : {}),
      ...(hasColumn(boardColumns, 'display_order') ? { display_order: 9000 } : {}),
      ...(hasColumn(boardColumns, 'is_default') ? { is_default: false } : {}),
      ...(hasColumn(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
      ...(hasColumn(boardColumns, 'is_active') ? { is_active: true } : {}),
      ...(hasColumn(boardColumns, 'category_type') ? { category_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'priority_type') ? { priority_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(boardColumns, 'updated_at') ? { updated_at: db.fn.now() } : {})
    });

    const makeStatus = async (statusId: string, name: string, orderNumber: number) => {
      await tenantTable(db, tenantId, 'statuses').insert({
        tenant: tenantId,
        status_id: statusId,
        ...(hasColumn(statusColumns, 'board_id') ? { board_id: boardId } : {}),
        name,
        ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
        ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
        is_closed: false,
        is_default: false,
        order_number: orderNumber,
        created_by: mspUserId,
        ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
        ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
        ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
        ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {})
      });
    };
    const statusOpenId = uuidv4();
    const statusInProgressId = uuidv4();
    await makeStatus(statusOpenId, `Journey Open ${suffix}`, 9001);
    await makeStatus(statusInProgressId, `Journey In Progress ${suffix}`, 9002);

    const priorityId = uuidv4();
    await tenantTable(db, tenantId, 'priorities').insert({
      tenant: tenantId,
      priority_id: priorityId,
      priority_name: `Journey High ${suffix}`,
      ...(hasColumn(priorityColumns, 'item_type') ? { item_type: 'ticket' } : {}),
      ...(hasColumn(priorityColumns, 'order_number') ? { order_number: 9001 } : {}),
      ...(hasColumn(priorityColumns, 'color') ? { color: '#EF4444' } : {}),
      ...(hasColumn(priorityColumns, 'created_by') ? { created_by: mspUserId } : {}),
      ...(hasColumn(priorityColumns, 'updated_by') ? { updated_by: mspUserId } : {}),
      ...(hasColumn(priorityColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(priorityColumns, 'updated_at') ? { updated_at: db.fn.now() } : {})
    });

    // --- a published ticket-only service-request definition ---
    const definitionId = uuidv4();
    const versionId = uuidv4();
    const formSchema = {
      fields: [
        { key: 'request_title', type: 'short-text', label: 'Request Title', required: true },
        { key: 'notes', type: 'long-text', label: 'Notes', required: false },
      ],
    };
    const executionConfig = {
      boardId,
      statusId: statusOpenId,
      priorityId,
      titleFieldKey: 'request_title',
      descriptionPrefix: 'Portal Service Request',
    };
    await tenantTable(db, tenantId, 'service_request_definitions').insert({
      tenant: tenantId,
      definition_id: definitionId,
      name: `Journey Support Request ${suffix}`,
      form_schema: formSchema,
      execution_provider: 'ticket-only',
      execution_config: executionConfig,
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
      lifecycle_state: 'published',
    });
    await tenantTable(db, tenantId, 'service_request_definition_versions').insert({
      tenant: tenantId,
      version_id: versionId,
      definition_id: definitionId,
      version_number: 1,
      name: `Journey Support Request ${suffix}`,
      form_schema_snapshot: formSchema,
      execution_provider: 'ticket-only',
      execution_config: executionConfig,
      form_behavior_provider: 'basic',
      form_behavior_config: {},
      visibility_provider: 'all-authenticated-client-users',
      visibility_config: {},
    });

    // --- step 1: portal user A opens the published request form ---
    actAs(portalActorA);
    const portalDetail = await getRequestServiceDefinitionDetailAction(definitionId);
    expect(portalDetail).not.toBeNull();
    expect(portalDetail?.title).toBe(`Journey Support Request ${suffix}`);
    expect(portalDetail?.visibleFieldKeys).toContain('request_title');

    // --- step 2: portal user A submits the request; the action redirects to
    // the catalog with the submission + created-ticket ids on the URL ---
    const formData = new FormData();
    formData.set('request_title', `Printer on fire ${suffix}`);
    formData.set('notes', 'Third floor copier is smoking');
    const redirectUrl = await captureRedirect(() =>
      submitRequestServiceDefinitionAction(definitionId, formData)
    );
    expect(redirectUrl.startsWith('/client-portal/request-services?')).toBe(true);
    const redirectParams = new URLSearchParams(redirectUrl.split('?')[1] ?? '');
    const submissionId = redirectParams.get('submitted');
    const ticketId = redirectParams.get('ticketId');
    expect(submissionId).toBeTruthy();
    expect(ticketId).toBeTruthy();

    // Seam: the submission committed under user A's client and executed into a ticket.
    const submission = await tenantTable(db, tenantId, 'service_request_submissions')
      .where({ tenant: tenantId, submission_id: submissionId! })
      .first();
    expect(submission).toBeTruthy();
    expect(submission?.tenant).toBe(tenantId);
    expect(submission?.client_id).toBe(clientAId);
    expect(submission?.contact_id).toBe(contactAId);
    expect(submission?.requester_user_id).toBe(portalUserAId);
    expect(submission?.execution_status).toBe('succeeded');
    expect(submission?.created_ticket_id).toBe(ticketId);

    const ticket = await tenantTable(db, tenantId, 'tickets')
      .where({ tenant: tenantId, ticket_id: ticketId! })
      .first();
    expect(ticket).toBeTruthy();
    expect(ticket?.tenant).toBe(tenantId);
    expect(ticket?.client_id).toBe(clientAId);
    expect(ticket?.contact_name_id).toBe(contactAId);
    expect(ticket?.entered_by).toBe(portalUserAId);
    expect(ticket?.board_id).toBe(boardId);
    expect(ticket?.status_id).toBe(statusOpenId);
    expect(ticket?.priority_id).toBe(priorityId);
    expect(ticket?.title).toBe(`Printer on fire ${suffix}`);
    expect(typeof ticket?.ticket_number).toBe('string');
    expect(String(ticket?.ticket_number).length).toBeGreaterThan(0);
    const ticketDescription = (ticket?.attributes as { description?: string } | null)?.description;
    expect(ticketDescription).toContain('Portal Service Request');
    expect(ticketDescription).toContain(`request_title: Printer on fire ${suffix}`);

    // --- step 3: the MSP side sees the submission and its ticket ---
    actAs(mspActor);
    const mspSubmissions = await listServiceRequestDefinitionSubmissionsAction(definitionId);
    expect(mspSubmissions.map((row) => row.submission_id)).toContain(submissionId);
    const mspSubmissionRow = mspSubmissions.find((row) => row.submission_id === submissionId);
    expect(mspSubmissionRow?.created_ticket_id).toBe(ticketId);
    expect(mspSubmissionRow?.client_id).toBe(clientAId);

    const mspSubmissionDetail = await getServiceRequestDefinitionSubmissionDetailAction(
      definitionId,
      submissionId!
    );
    expect(mspSubmissionDetail).not.toBeNull();
    expect(mspSubmissionDetail?.client_name).toBe(`Journey Requesting Client ${suffix}`);
    expect(mspSubmissionDetail?.contact_name).toBe('Paula Portal');
    expect(mspSubmissionDetail?.created_ticket_display).toBe(
      `#${ticket!.ticket_number} · Printer on fire ${suffix}`
    );

    // --- step 4: MSP triages (assign + move status) and replies publicly ---
    const updateResult = await updateTicket(ticketId!, {
      status_id: statusInProgressId,
      assigned_to: mspUserId,
    });
    expect(updateResult).toBe('success');

    const mspReply = 'We are on it — a technician is heading to the third floor.';
    const commentResult = await createComment({
      ticket_id: ticketId!,
      user_id: mspUserId,
      note: mspReply,
      is_internal: false,
      is_resolution: false,
    } as any);
    expect(typeof commentResult).toBe('string');
    const commentId = commentResult as string;

    const triagedTicket = await tenantTable(db, tenantId, 'tickets')
      .where({ tenant: tenantId, ticket_id: ticketId! })
      .first();
    expect(triagedTicket?.status_id).toBe(statusInProgressId);
    expect(triagedTicket?.assigned_to).toBe(mspUserId);

    // --- step 5: portal user A sees the triage + reply ---
    actAs(portalActorA);
    const myRequests = await listMyServiceRequestSubmissionsAction();
    expect(myRequests.map((row) => row.submission_id)).toContain(submissionId);
    const myRequestRow = myRequests.find((row) => row.submission_id === submissionId);
    expect(myRequestRow?.created_ticket_id).toBe(ticketId);
    expect(myRequestRow?.ticket_number).toBe(ticket!.ticket_number);

    const mySubmissionDetail = await getMyServiceRequestSubmissionDetailAction(submissionId!);
    expect(mySubmissionDetail).not.toBeNull();
    expect(mySubmissionDetail?.created_ticket_id).toBe(ticketId);

    const portalTicketDetails = await getClientTicketDetails(ticketId!);
    expect(portalTicketDetails).not.toHaveProperty('actionError');
    expect(portalTicketDetails).not.toHaveProperty('permissionError');
    const portalTicket = portalTicketDetails as any;
    expect(portalTicket.ticket_id).toBe(ticketId);
    expect(portalTicket.status_name).toBe(`Journey In Progress ${suffix}`);
    expect(portalTicket.assigned_to).toBe(mspUserId);
    const replyComment = (portalTicket.conversations as any[]).find(
      (comment) => comment.comment_id === commentId
    );
    expect(replyComment).toBeTruthy();
    expect(replyComment.note).toBe(mspReply);
    expect(replyComment.is_internal).toBe(false);
    expect(replyComment.author_type).toBe('internal');
    expect(portalTicket.userMap[mspUserId]).toMatchObject({
      first_name: 'Morgan',
      last_name: 'Agent',
      user_type: 'internal',
    });

    const portalOpenTickets = await getClientTickets(TICKET_STATUS_FILTER_OPEN);
    expect(Array.isArray(portalOpenTickets)).toBe(true);
    expect((portalOpenTickets as any[]).map((row) => row.ticket_id)).toContain(ticketId);

    // --- step 6: client scoping — portal user B (sibling client, same tenant)
    // sees the shared catalog but none of client A's request data ---
    actAs(portalActorB);
    const siblingCatalogDetail = await getRequestServiceDefinitionDetailAction(definitionId);
    expect(siblingCatalogDetail).not.toBeNull();

    const siblingRequests = await listMyServiceRequestSubmissionsAction();
    expect(siblingRequests).toHaveLength(0);
    const siblingSubmissionDetail = await getMyServiceRequestSubmissionDetailAction(submissionId!);
    expect(siblingSubmissionDetail).toBeNull();

    const siblingTicketDetails = await getClientTicketDetails(ticketId!);
    expect(siblingTicketDetails).toMatchObject({
      actionError: 'Ticket not found or access denied',
    });
    const siblingTickets = await getClientTickets(TICKET_STATUS_FILTER_OPEN);
    expect(Array.isArray(siblingTickets)).toBe(true);
    expect((siblingTickets as any[]).map((row) => row.ticket_id)).not.toContain(ticketId);

    // --- tenant scoping: the rows carry the tenant key and are invisible
    // through another tenant's scope ---
    const foreignTenantId = uuidv4();
    const foreignSubmission = await tenantTable(db, foreignTenantId, 'service_request_submissions')
      .where({ submission_id: submissionId! })
      .first();
    expect(foreignSubmission).toBeUndefined();
    const foreignTicket = await tenantTable(db, foreignTenantId, 'tickets')
      .where({ ticket_id: ticketId! })
      .first();
    expect(foreignTicket).toBeUndefined();
  }, HOOK_TIMEOUT);
});

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantRows(connection).first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }
  const newTenantId = uuidv4();
  await tenantRows(connection).insert({
    tenant: newTenantId,
    client_name: 'Journey Integration Tenant',
    email: 'journeys@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
}
