/**
 * alga-2026-0003427 (T001-T007): co-managed seat technicians get only the choices, actions and fields the
 * operation allows, on real Postgres and through the normal server actions.
 *
 * The seat is the standard seat role in a sponsor tenant with real arrangement records. Every check has an
 * authorized MSP positive control; the document pickers also run a client-portal user.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { runWithTenant } from '@alga-psa/db';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  tenant: '',
  user: { user_id: '', user_type: 'internal' as 'internal' | 'client' },
  db: null as unknown,
  seatUserIds: new Set<string>(),
  seatGrants: new Set<string>(),
}));
const authUser = vi.hoisted(() => async () => {
  const db = testState.db as import('knex').Knex;
  const row = await db('users').where({ tenant: testState.tenant, user_id: testState.user.user_id }).first();
  if (!row) throw new Error(`test caller ${testState.user.user_id} has no users row in ${testState.tenant}`);
  return { ...row, user_type: testState.user.user_type, tenant: testState.tenant };
});
const withAuthMock = vi.hoisted(() => () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(await authUser(), { tenant: testState.tenant }, ...args),
}));
/** The RBAC answer: a seat technician holds exactly the seat role's grants; every other test caller holds everything. */
const rbac = vi.hoisted(() => async (user: { user_id: string }, resource: string, action: string) =>
  !testState.seatUserIds.has(user.user_id) || testState.seatGrants.has(`${resource}:${action}`));

vi.mock('@alga-psa/auth/withAuth', withAuthMock);
vi.mock('@alga-psa/auth', () => ({
  ...withAuthMock(),
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(await authUser(), { tenant: testState.tenant }, ...args),
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(rbac),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(rbac),
  checkMultiplePermissions: vi.fn(async (user: any, checks: Array<{ resource: string; action: string }>) =>
    Promise.all(checks.map(async (check) => ({ ...check, granted: await rbac(user, check.resource, check.action) })))),
}));
vi.mock('@alga-psa/authorization/rbac', () => ({ hasPermission: vi.fn(rbac) }));
vi.mock('../../../../packages/user-composition/src/lib/permissions', () => ({ hasPermission: vi.fn(rbac) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: testState.db, tenant: testState.tenant }),
    withTransaction: async (knex: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) => knex.transaction((trx) => callback(trx)),
  };
});

import { createCoManagedSeatArrangement, setCoManagedSeatBoardScope, CO_MANAGED_SEAT_ROLE_GRANTS } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import {
  createAuthorizationBundle, createBundleAssignment, publishBundleRevision, upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { assertAuthorizedAssociationTarget } from '../../../../shared/lib/documentAssociationTargetAuthorization';
import { assertActorMayAssign } from '../../../../shared/lib/humanWork/seatAssigneeAudience';
import { assignableAgentsOf } from '../../../../packages/tickets/src/lib/assignableAgents';
import * as categoryActions from '../../../../packages/tickets/src/actions/ticketCategoryActions';
import * as boardActions from '../../../../packages/tickets/src/actions/board-actions/boardActions';
import * as ticketFormActions from '../../../../packages/tickets/src/actions/ticketFormActions';
import * as optimizedTicketActions from '../../../../packages/tickets/src/actions/optimizedTicketActions';
import * as ticketActions from '../../../../packages/tickets/src/actions/ticketActions';
import * as ticketWatcherActions from '../../../../packages/tickets/src/actions/ticketWatcherActions';
import * as statusActions from '../../../../packages/reference-data/src/actions/status-actions/statusActions';
import * as documentActions from '../../../../packages/documents/src/actions/documentActions';
import * as workItemActions from '../../../../packages/scheduling/src/actions/workItemActions';
import { searchUsersForMentions as searchMentions } from '../../../../packages/user-composition/src/actions/searchUsersForMentions';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const DAY = 86_400_000;
const inTenant = <F extends (...args: any[]) => Promise<any>>(action: F) =>
  ((...args: any[]) => runWithTenant(testState.tenant, () => action(...args))) as F;
const createTicketCategory = inTenant(categoryActions.createTicketCategory);
const getTicketCategoriesByBoard = inTenant(categoryActions.getTicketCategoriesByBoard);
const getTicketCategories = inTenant(categoryActions.getTicketCategories);
const getAllBoards = inTenant(boardActions.getAllBoards);
const getBoardsForOperation = inTenant(boardActions.getBoardsForOperation);
const getTicketFormData = inTenant(ticketFormActions.getTicketFormData);
const getTicketFormOptions = inTenant(optimizedTicketActions.getTicketFormOptions);
const getConsolidatedTicketData = inTenant(optimizedTicketActions.getConsolidatedTicketData);
const addTicket = inTenant(ticketActions.addTicket);
const addTicketWatchers = inTenant(ticketWatcherActions.addTicketWatchers);
const getTicketStatuses = inTenant(statusActions.getTicketStatuses);
const searchAssociations = inTenant(documentActions.searchDocumentAssociationEntities);
const getAssociationContacts = inTenant(documentActions.getDocumentAssociationContactsForPicker);
const searchPickerWorkItems = inTenant(workItemActions.searchPickerWorkItems);
const createWorkItem = inTenant(workItemActions.createWorkItem);
const getWorkItemPickerOptions = inTenant(workItemActions.getWorkItemPickerOptions);
const searchUsersForMentions = inTenant(searchMentions);
const describeDb = await describeWithDb();

describeDb('seat pickers and actions return only what the operation allows', { shuffle: false }, () => {
  let db: Knex;
  const tag = randomUUID().slice(0, 6);
  const s: Record<string, any> = {};

  const as = (userId: string, userType: 'internal' | 'client' = 'internal') => { testState.user = { user_id: userId, user_type: userType }; };
  const ids = (rows: Array<Record<string, any>>, key = 'value') => rows.map((row) => row[key]).sort();
  const isError = (value: any) => Boolean(value && typeof value === 'object' && ('permissionError' in value || 'actionError' in value));

  const staff = (name: string) => createUser(db, s.tenant, {
    user_type: 'internal', first_name: name, last_name: `Staff${tag}`, email: `${name.toLowerCase()}.${tag}@msp-secret.test`,
    username: `${name.toLowerCase()}-login-${tag}`,
  });
  const seatTechnician = async (arrangementId: string, name: string) => {
    const userId = await createUser(db, s.tenant, { user_type: 'internal', first_name: name, last_name: `Tech${tag}`, email: `${name.toLowerCase()}.${tag}@client.test` });
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant: s.tenant, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({ tenant: s.tenant, assignment_id: randomUUID(), arrangement_id: arrangementId, user_id: userId, state: 'active' });
    });
    testState.seatUserIds.add(userId);
    return userId;
  };
  const board = async (name: string) => {
    const boardId = randomUUID();
    await db('boards').insert({ tenant: s.tenant, board_id: boardId, board_name: `${name} ${tag}`, is_default: false, is_inactive: false, display_order: 1 });
    await db('statuses').insert({ tenant: s.tenant, status_id: randomUUID(), name: `Open ${name}`, status_type: 'ticket', board_id: boardId, order_number: 1, is_closed: false, is_default: true });
    await db('categories').insert({ tenant: s.tenant, category_id: randomUUID(), category_name: `Cat ${name} ${tag}`, board_id: boardId, created_by: s.admin });
    return boardId;
  };
  const ticket = async (clientId: string, boardId: string, title: string, options: { assignedTo?: string | null; master?: string | null; contact?: string | null } = {}) => {
    const ticketId = randomUUID();
    await db('tickets').insert({ tenant: s.tenant, ticket_id: ticketId, ticket_number: `T-${randomUUID().slice(0, 8)}`, title: `${title} ${tag}`, status_id: s.statusId,
      priority_id: s.priorityId, board_id: boardId, client_id: clientId, assigned_to: options.assignedTo ?? null, master_ticket_id: options.master ?? null,
      contact_name_id: options.contact ?? null, entered_at: new Date(), updated_at: new Date() });
    return ticketId;
  };
  const contact = async (clientId: string, name: string, portal = false) => {
    const contactId = randomUUID();
    await db('contacts').insert({ tenant: s.tenant, contact_name_id: contactId, client_id: clientId, full_name: `${name} ${tag}`, email: `${name.toLowerCase()}.${tag}@contact.test`, is_inactive: false });
    const userId = portal
      ? await createUser(db, s.tenant, { user_type: 'client', contact_id: contactId, first_name: name, last_name: `Portal${tag}`, email: `${name.toLowerCase()}.portal.${tag}@contact.test` })
      : null;
    return { contactId, userId };
  };
  const project = async (clientId: string, name: string, taskAssignee: string | null, serviceId: string | null) => {
    const projectId = randomUUID();
    const phaseId = randomUUID();
    const taskId = randomUUID();
    await db('projects').insert({ tenant: s.tenant, project_id: projectId, project_name: `${name} ${tag}`, client_id: clientId, status: s.projectStatusId, wbs_code: `w-${randomUUID().slice(0, 4)}`, project_number: `PRJ-${randomUUID().slice(0, 6)}`, is_inactive: false });
    const mappingId = randomUUID();
    await db('project_status_mappings').insert({ tenant: s.tenant, project_status_mapping_id: mappingId, project_id: projectId, status_id: s.projectStatusId, is_standard: false, display_order: 1, is_visible: true });
    await db('project_phases').insert({ tenant: s.tenant, phase_id: phaseId, project_id: projectId, phase_name: `Phase ${name}`, wbs_code: '1', status: s.projectStatusId, order_number: 1 });
    await db('project_tasks').insert({ tenant: s.tenant, task_id: taskId, phase_id: phaseId, task_name: `Task ${name} ${tag}`, wbs_code: '1.1', order_key: 'a0', assigned_to: taskAssignee, service_id: serviceId, project_status_mapping_id: mappingId, estimated_hours: 1 });
    return { projectId, taskId };
  };
  /** A bundle that narrows ticket reads to `boardIds`, assigned to `userId` (it can only narrow a seat further). */
  const narrowingBundle = async (userId: string, boardIds: string[]) => {
    const bundle = await createAuthorizationBundle(db, { tenant: s.tenant, name: `narrow-${randomUUID().slice(0, 6)}`, actorUserId: s.admin });
    for (const action of ['read', 'create', 'update']) {
      await upsertBundleRule(db, { tenant: s.tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, resourceType: 'ticket', action,
        templateKey: 'selected_boards', config: { selectedBoardIds: boardIds }, actorUserId: s.admin });
    }
    await publishBundleRevision(db as any, { tenant: s.tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: s.admin });
    await createBundleAssignment(db, { tenant: s.tenant, bundleId: bundle.bundleId, targetType: 'user', targetId: userId, actorUserId: s.admin });
    return bundle.bundleId;
  };

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's3427_seat_pickers_test' });
    testState.db = db;
    testState.seatGrants = new Set(CO_MANAGED_SEAT_ROLE_GRANTS as readonly string[]);
    s.tenant = await createTenant(db, `Seat pickers ${tag}`, { productCode: 'psa' });
    testState.tenant = s.tenant;
    await db('co_managed_entitlements').insert({ tenant: s.tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 20,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    s.statusId = randomUUID();
    s.priorityId = randomUUID();
    await db('statuses').insert({ tenant: s.tenant, status_id: s.statusId, name: 'Open', status_type: 'ticket', order_number: 1, is_closed: false, created_by: null });
    await db('priorities').insert({ tenant: s.tenant, priority_id: s.priorityId, priority_name: 'Normal', order_number: 1, color: '#000000', item_type: 'ticket', created_by: null });

    s.clientX = await createClient(db, s.tenant, `Client X ${tag}`);
    s.clientY = await createClient(db, s.tenant, `Client Y ${tag}`);
    s.admin = await staff('Admin');   // authorized MSP user (positive control)
    s.in1 = await board('In1'); s.in2 = await board('In2'); s.out = await board('Out');
    s.arrX = (await createCoManagedSeatArrangement(db, { sponsorTenant: s.tenant, clientId: s.clientX, operationId: randomUUID(), seats: 3 })).arrangement_id;
    await setCoManagedSeatBoardScope(db, { sponsorTenant: s.tenant, arrangementId: s.arrX, boards: [{ boardId: s.in1, canCreate: true }, { boardId: s.in2, canCreate: false }] });

    s.A = await seatTechnician(s.arrX, 'Alpha');
    s.B = await seatTechnician(s.arrX, 'Bravo');
    s.S1 = await staff('Sierra');     // MSP staff who participates on a ticket the seat can see
    s.S2 = await staff('Sable');      // MSP staff who participates nowhere the seat can see
    s.ordinary = s.admin;

    s.tIn1 = await ticket(s.clientX, s.in1, 'Ticket in1', { assignedTo: s.S1 });
    s.tIn2 = await ticket(s.clientX, s.in2, 'Ticket in2');
    s.tOut = await ticket(s.clientX, s.out, 'Ticket out');
    s.tY = await ticket(s.clientY, s.in1, 'Ticket clientY');
    s.tParent = await ticket(s.clientX, s.out, 'Bundle parent');
    s.tChild = await ticket(s.clientX, s.in1, 'Bundle child', { master: s.tParent });

    s.cX = await contact(s.clientX, 'Xena', true);
    s.cY = await contact(s.clientY, 'Yara');

    s.serviceTypeId = randomUUID();
    await db('service_types').insert({ tenant: s.tenant, id: s.serviceTypeId, name: `Type ${tag}`, is_active: true, order_number: 1 });
    s.serviceId = randomUUID();
    await db('service_catalog').insert({ tenant: s.tenant, service_id: s.serviceId, service_name: `Secret service ${tag}`, custom_service_type_id: s.serviceTypeId, billing_method: 'fixed', default_rate: 10000, unit_of_measure: 'hour' });
    s.projectStatusId = randomUUID();
    await db('statuses').insert({ tenant: s.tenant, status_id: s.projectStatusId, name: 'Planning', status_type: 'project', order_number: 1, is_closed: false });
    s.shared = await project(s.clientX, 'Shared', s.S1, s.serviceId);
    s.unshared = await project(s.clientX, 'Unshared', null, null);
    s.otherClient = await project(s.clientY, 'OtherClient', null, null);
    await db('co_managed_seat_project_grants').insert({ tenant: s.tenant, arrangement_id: s.arrX, project_id: s.shared.projectId });

    s.interactionTypeId = randomUUID();
    await db('interaction_types').insert({ tenant: s.tenant, type_id: s.interactionTypeId, type_name: `Call ${tag}`, icon: 'phone', display_order: 1 });
    s.interactionId = randomUUID();
    await db('interactions').insert({ tenant: s.tenant, interaction_id: s.interactionId, client_id: s.clientX, user_id: s.S1, title: `Call ${tag}`, interaction_date: new Date(), type_id: s.interactionTypeId });
    s.adHocId = randomUUID();
    await db('schedule_entries').insert({ tenant: s.tenant, entry_id: s.adHocId, title: `Adhoc ${tag}`, work_item_type: 'ad_hoc', work_item_id: null, scheduled_start: new Date(), scheduled_end: new Date(Date.now() + 3600_000), status: 'scheduled' });
  }, 300_000);
  afterAll(async () => { await db?.destroy(); });
  beforeEach(() => { testState.db = db; testState.tenant = s.tenant; });

  // ---------------------------------------------------------------- T001 / F001
  it('T001: a stock seat cannot create a board category, the database is unchanged, an administrator can', async () => {
    const before = await db('categories').where({ tenant: s.tenant }).orderBy('category_id').select('category_id', 'category_name', 'board_id');
    as(s.A);
    const denied = await createTicketCategory('Seat made category', s.in1) as any;
    expect(denied.permissionError ?? denied.actionError).toMatch(/Permission denied/);
    const deniedOutside = await createTicketCategory('Seat made category', s.out) as any;
    expect(isError(deniedOutside)).toBe(true);
    expect(await db('categories').where({ tenant: s.tenant }).orderBy('category_id').select('category_id', 'category_name', 'board_id')).toEqual(before);

    as(s.admin);
    const created = await createTicketCategory(`Admin category ${tag}`, s.in1) as any;
    expect(created.category_name).toBe(`Admin category ${tag}`);
    expect(await db('categories').where({ tenant: s.tenant, board_id: s.in1, category_name: `Admin category ${tag}` })).toHaveLength(1);
    const unknownBoard = await createTicketCategory('Nowhere', randomUUID()) as any;
    expect(isError(unknownBoard)).toBe(true);
  });

  // ---------------------------------------------------------------- T002 / F002
  it('T002: document association pickers return only permitted clients, contacts and tickets with their counts', async () => {
    as(s.A);
    const clients = await searchAssociations('client', '', 1, 10) as any;
    expect(ids(clients.options)).toEqual([s.clientX]);
    expect(clients.total).toBe(1);
    const tickets = await searchAssociations('ticket', '', 1, 10) as any;
    expect(ids(tickets.options)).toEqual([s.tIn1, s.tIn2, s.tChild].sort());
    expect(tickets.total).toBe(3);
    expect(tickets.options.every((option: any) => Object.keys(option).sort().join() === 'label,value')).toBe(true);
    // Paging and the count come from the scoped query: a page of one still reports the scoped total.
    const page = await searchAssociations('ticket', '', 2, 1) as any;
    expect(page.options).toHaveLength(1);
    expect(page.total).toBe(3);
    // Search runs inside the scope: a term naming an out-of-scope record finds nothing.
    expect((await searchAssociations('ticket', 'Ticket out', 1, 10) as any).total).toBe(0);
    expect((await searchAssociations('client', 'Client Y', 1, 10) as any).options).toEqual([]);
    const contacts = await searchAssociations('contact', '', 1, 10) as any;
    expect(ids(contacts.options)).toEqual([s.cX.contactId]);
    expect(contacts.total).toBe(1);

    const picker = await getAssociationContacts() as any[];
    expect(picker.map((row) => row.contact_name_id)).toEqual([s.cX.contactId]);
    // Only what an option renders (name, email, client, the remote-work hint): never the phone, the role or any
    // other column of the contact row.
    expect(Object.keys(picker[0]).sort()).toEqual(['avatarUrl', 'client_id', 'client_name', 'contact_name_id', 'email', 'full_name', 'is_inactive', 'work_arrangement']);

    // Selecting the target at upload time is held to the same scope.
    const target = (type: string, id: string, action: 'read' | 'create' = 'read') => db.transaction((trx) => runWithTenant(s.tenant, async () =>
      assertAuthorizedAssociationTarget(trx, s.tenant, { user_id: s.A, user_type: 'internal', tenant: s.tenant } as any, type, id, action)));
    expect(await target('ticket', s.tIn1, 'create')).toBe(true);
    expect(await target('ticket', s.tOut, 'create')).toBe(false);
    expect(await target('ticket', s.tIn1)).toBe(true);
    expect(await target('ticket', s.tOut)).toBe(false);
    expect(await target('ticket', s.tY)).toBe(false);
    expect(await target('client', s.clientX)).toBe(true);
    expect(await target('client', s.clientY)).toBe(false);
    expect(await target('contact', s.cX.contactId)).toBe(true);
    expect(await target('contact', s.cY.contactId)).toBe(false);

    // Positive control: an authorized MSP user keeps the whole tenant.
    as(s.admin);
    expect(ids(((await searchAssociations('client', '', 1, 50)) as any).options)).toEqual(expect.arrayContaining([s.clientX, s.clientY]));
    expect(((await searchAssociations('ticket', '', 1, 50)) as any).total).toBe(6);
    expect(((await getAssociationContacts()) as any[]).map((row) => row.contact_name_id)).toEqual(expect.arrayContaining([s.cX.contactId, s.cY.contactId]));
    expect(await target('ticket', s.tOut)).toBe(false); // the helper above is bound to the seat's own user row

    // Portal control: a client user keeps the portal's rules (their own client only).
    as(s.cX.userId, 'client');
    expect(ids(((await searchAssociations('client', '', 1, 50)) as any).options)).toEqual([s.clientX]);
  });

  // ---------------------------------------------------------------- T003 / F003
  it('T003: the work item picker is scoped per branch, with counts, paging and projected fields', async () => {
    as(s.A);
    const all = await searchPickerWorkItems({ type: 'all', statusFilter: 'all_open', pageSize: 50, includeInactive: true }) as any;
    const types = new Set(all.items.map((item: any) => item.type));
    expect([...types].sort()).toEqual(['project_task', 'ticket']);
    expect(ids(all.items.filter((item: any) => item.type === 'ticket'), 'work_item_id')).toEqual([s.tIn1, s.tIn2, s.tChild].sort());
    expect(ids(all.items.filter((item: any) => item.type === 'project_task'), 'work_item_id')).toEqual([s.shared.taskId]);
    expect(all.total).toBe(4);
    const paged = [];
    for (let page = 1; page <= 4; page += 1) {
      paged.push(...(await searchPickerWorkItems({ type: 'all', statusFilter: 'all_open', pageSize: 1, page, includeInactive: true }) as any).items);
    }
    expect(paged.map((item: any) => item.work_item_id).sort()).toEqual(all.items.map((item: any) => item.work_item_id).sort());
    expect(await searchPickerWorkItems({ type: 'interaction', statusFilter: 'all_open' })).toEqual({ items: [], total: 0 });
    expect(await searchPickerWorkItems({ type: 'ad_hoc', statusFilter: 'all_open' })).toEqual({ items: [], total: 0 });

    // Fields: a visible child whose parent the seat cannot read shows no parent; the task shows no service and no MSP assignee.
    const child = all.items.find((item: any) => item.work_item_id === s.tChild);
    expect(child.master_ticket_id ?? null).toBeNull();
    expect(child.master_ticket_number ?? null).toBeNull();
    const task = all.items.find((item: any) => item.work_item_id === s.shared.taskId);
    expect(task.service_id ?? null).toBeNull();
    expect(task.service_source ?? null).toBeNull();
    expect(task.assigned_user_ids).toEqual([]);
    expect(task.assigned_to_name ?? null).toBeNull();
    expect(JSON.stringify(all)).not.toContain('Secret service');
    // The MSP assignee of a task the seat reaches is not released (a ticket's assignee is: they participate on a ticket it can see).
    expect(JSON.stringify(task)).not.toContain(s.S1);

    expect(await getWorkItemPickerOptions()).toEqual({ types: ['ticket', 'project_task'], canCreateAdHoc: false });
    const adHoc = await createWorkItem({ type: 'ad_hoc', name: 'x', title: 'x', description: '', startTime: new Date(), endTime: new Date(Date.now() + 1000) } as any) as any;
    expect(isError(adHoc)).toBe(true);

    // Positive control.
    as(s.admin);
    const full = await searchPickerWorkItems({ type: 'all', statusFilter: 'all_open', pageSize: 50, includeInactive: true }) as any;
    expect(new Set(full.items.map((item: any) => item.type))).toEqual(new Set(['ticket', 'project_task', 'interaction', 'ad_hoc']));
    const fullChild = full.items.find((item: any) => item.work_item_id === s.tChild);
    expect(fullChild.master_ticket_id).toBe(s.tParent);
    expect(fullChild.master_ticket_number).toBeTruthy();
    const fullTask = full.items.find((item: any) => item.work_item_id === s.shared.taskId);
    expect(fullTask.service_id).toBe(s.serviceId);
    expect(fullTask.assigned_user_ids).toEqual([s.S1]);
    expect((await getWorkItemPickerOptions() as any).canCreateAdHoc).toBe(true);
  });

  // ---------------------------------------------------------------- T004 / F004
  it('T004: board, status and category options follow the operation', async () => {
    as(s.A);
    expect(ids(await getBoardsForOperation('create') as any[], 'board_id')).toEqual([s.in1]);
    expect(ids(await getBoardsForOperation('read') as any[], 'board_id')).toEqual([s.in1, s.in2].sort());
    expect(ids(await getBoardsForOperation('update') as any[], 'board_id')).toEqual([s.in1, s.in2].sort());
    expect(ids(await getAllBoards(true) as any[], 'board_id')).toEqual([s.in1, s.in2].sort());

    expect(ids((await getTicketFormData() as any).boards, 'board_id')).toEqual([s.in1]);
    const options = await getTicketFormOptions() as any;
    expect(ids(options.boardOptions, 'board_id')).toEqual([s.in1, s.in2].sort());
    expect(options.statusOptions.filter((option: any) => option.boardId).map((option: any) => option.boardId).every((id: string) => [s.in1, s.in2].includes(id))).toBe(true);
    expect(options.categories.every((category: any) => [s.in1, s.in2].includes(category.board_id))).toBe(true);

    // Dependent loaders decide on their own, including for a preselected board.
    expect((await getTicketStatuses(s.in1) as any[]).length).toBeGreaterThan(0);
    expect(await getTicketStatuses(s.out)).toEqual([]);
    expect(ids(await getTicketStatuses() as any[], 'board_id').every((id) => [s.in1, s.in2].includes(id))).toBe(true);
    expect((await getTicketCategoriesByBoard(s.in1) as any).categories.length).toBeGreaterThan(0);
    expect(isError(await getTicketCategoriesByBoard(s.out))).toBe(true);
    expect((await getTicketCategories() as any[]).every((category) => [s.in1, s.in2].includes(category.board_id))).toBe(true);

    // The destination of an existing ticket: boards an update may leave it on (plus where it already is).
    const data = await getConsolidatedTicketData(s.tIn1) as any;
    expect(data.options.board.map((option: any) => option.value).sort()).toEqual([s.in1, s.in2].sort());

    // Positive control: everything, as before.
    as(s.admin);
    expect(await getBoardsForOperation('create') as any[]).toHaveLength(3);
    expect(await getAllBoards(true) as any[]).toHaveLength(3);
    expect((await getTicketFormData() as any).boards).toHaveLength(3);
    expect((await getTicketFormOptions() as any).boardOptions).toHaveLength(3);
    expect((await getTicketStatuses(s.out) as any[]).length).toBeGreaterThan(0);
    expect(isError(await getTicketCategoriesByBoard(s.out))).toBe(false);
    expect(((await getConsolidatedTicketData(s.tIn1)) as any).options.board).toHaveLength(3);
  });

  // ---------------------------------------------------------------- T005 / F005
  it('T005: assignee controls offer the people the caller may assign; mentions stay on the projection', async () => {
    as(s.A);
    const data = await getConsolidatedTicketData(s.tIn1) as any;
    const visible = data.availableAgents.map((agent: any) => agent.user_id);
    expect(visible).toEqual(expect.arrayContaining([s.S1, s.A, s.B]));
    const assignable = assignableAgentsOf(data.availableAgents).map((agent: any) => agent.user_id);
    expect(assignable.sort()).toEqual([s.A, s.B].sort());
    expect(assignable).not.toContain(s.S1);
    const formOptions = await getTicketFormOptions() as any;
    expect(assignableAgentsOf(formOptions.users).map((agent: any) => agent.user_id)).not.toContain(s.S1);
    // Mentions and read-only displays keep the projection (a visible MSP participant is mentionable, by name only).
    const mentions = await searchUsersForMentions('sierra');
    expect(mentions.map((mention: any) => mention.user_id)).toEqual([s.S1]);
    // The server refuses what the picker never offers.
    await db.transaction(async (trx) => {
      await expect(assertActorMayAssign(trx, s.tenant, s.A, [s.S1])).rejects.toThrow();
      await expect(assertActorMayAssign(trx, s.tenant, s.A, [s.B, s.A])).resolves.toBeUndefined();
    });

    as(s.admin);
    const full = await getConsolidatedTicketData(s.tIn1) as any;
    expect(assignableAgentsOf(full.availableAgents)).toHaveLength(full.availableAgents.length);
    expect(full.availableAgents.some((agent: any) => 'assignable' in agent)).toBe(false);
  });

  // ---------------------------------------------------------------- T006 / F006
  it('T006: watchers are validated, and the create response carries no restricted email', async () => {
    const in1Status = (await db('statuses').where({ tenant: s.tenant, board_id: s.in1, status_type: 'ticket' }).first()).status_id;
    await db('board_default_watchers').insert({ tenant: s.tenant, board_id: s.in1, user_id: s.S2 });
    const form = (watchers: string[], title: string) => {
      const data = new FormData();
      data.set('title', `${title} ${tag}`);
      data.set('board_id', s.in1);
      data.set('client_id', s.clientX);
      data.set('status_id', in1Status);
      data.set('priority_id', s.priorityId);
      data.set('description', 'created by a picker test');
      data.set('assigned_to', s.A);
      data.set('watcher_ids', JSON.stringify(watchers));
      return data;
    };
    const countTickets = async () => Number((await db('tickets').where({ tenant: s.tenant }).count('* as n').first())?.n);

    // A watcher the technician may not name is refused, and nothing is created.
    as(s.A);
    const before = await countTickets();
    const refused = await addTicket(form([s.S2], 'Watcher refused')) as any;
    expect(isError(refused)).toBe(true);
    expect(await countTickets()).toBe(before);

    // A peer technician is permitted. The response hides the board's default MSP recipient entirely.
    const created = await addTicket(form([s.B], 'Watcher peer')) as any;
    expect(created.ticket_id).toBeTruthy();
    const serialized = JSON.stringify(created);
    expect(serialized).not.toContain('msp-secret.test');
    expect(serialized).not.toContain(s.S2);
    // The stored recipients keep every address, so authorized notification delivery still works.
    const stored = (await db('tickets').where({ tenant: s.tenant, ticket_id: created.ticket_id }).first()).attributes;
    const storedEmails = (stored.watch_list as Array<{ email: string }>).map((entry) => entry.email);
    expect(storedEmails).toEqual(expect.arrayContaining([`sable.${tag}@msp-secret.test`, `bravo.${tag}@client.test`]));

    // The ticket screen and the watcher write answer use the same projection: opening the ticket it just created
    // ("Create + View") or adding a watcher never hands the seat the board's default MSP recipient.
    const screen = await getConsolidatedTicketData(created.ticket_id) as any;
    const screenWatchers = JSON.stringify(screen.ticket.attributes?.watch_list ?? []);
    expect(screenWatchers).toContain(s.B);
    expect(screenWatchers).not.toContain('msp-secret.test');
    expect(screenWatchers).not.toContain(s.S2);
    const added = await addTicketWatchers(created.ticket_id, [{ user_id: s.A }]) as any;
    expect(added.watchers.map((watcher: any) => watcher.entity_id)).toEqual(expect.arrayContaining([s.A, s.B]));
    expect(JSON.stringify(added.watchers)).not.toContain('msp-secret.test');

    // Positive control: an authorized MSP user is returned the full recipient list, on create and on the screen.
    as(s.admin);
    const adminCreated = await addTicket(form([s.S1], 'Watcher admin')) as any;
    const adminEmails = (adminCreated.attributes.watch_list as Array<{ email: string }>).map((entry) => entry.email);
    expect(adminEmails).toEqual(expect.arrayContaining([`sable.${tag}@msp-secret.test`, `sierra.${tag}@msp-secret.test`]));
    const adminScreen = await getConsolidatedTicketData(created.ticket_id) as any;
    expect((adminScreen.ticket.attributes.watch_list as Array<{ email: string }>).map((entry) => entry.email))
      .toEqual(expect.arrayContaining([`sable.${tag}@msp-secret.test`, `bravo.${tag}@client.test`, `alpha.${tag}@client.test`]));
  });

  // ---------------------------------------------------------------- T007 / F002 F003 F004
  it('T007: a seat works with no bundle, a bundle only narrows it, and a fresh request after revocation loses access', async () => {
    const ticketIds = async () => ids(((await searchAssociations('ticket', '', 1, 50)) as any).options);
    const workItemTicketIds = async () => ids(((await searchPickerWorkItems({ type: 'ticket', statusFilter: 'all_open', pageSize: 50 })) as any).items, 'work_item_id');

    // No bundle at all: the built-in seat scope alone serves the seat.
    expect(await db('authorization_bundles').where({ tenant: s.tenant })).toEqual([]);
    as(s.A);
    expect(ids(await getBoardsForOperation('read') as any[], 'board_id')).toEqual([s.in1, s.in2].sort());
    expect(await ticketIds()).toEqual(expect.arrayContaining([s.tIn1, s.tIn2, s.tChild]));
    expect(await ticketIds()).not.toContain(s.tOut);
    expect(await workItemTicketIds()).toContain(s.tIn2);

    // An MSP user's visibility is what it was.
    as(s.admin);
    expect(await getBoardsForOperation('read') as any[]).toHaveLength(3);
    expect(await ticketIds()).toEqual(expect.arrayContaining([s.tOut, s.tY]));

    // A bundle assigned to the technician can only narrow the built-in scope.
    await narrowingBundle(s.A, [s.in1, s.out]);
    as(s.A);
    expect(ids(await getBoardsForOperation('read') as any[], 'board_id')).toEqual([s.in1]);
    expect(ids(await getBoardsForOperation('create') as any[], 'board_id')).toEqual([s.in1]);
    expect(ids(await getBoardsForOperation('update') as any[], 'board_id')).toEqual([s.in1]);
    expect(await ticketIds()).not.toContain(s.tIn2);
    expect(await ticketIds()).not.toContain(s.tOut); // the bundle names it; the seat scope still excludes it
    expect(await ticketIds()).toContain(s.tIn1);
    expect(await workItemTicketIds()).not.toContain(s.tIn2);
    expect(await getTicketStatuses(s.in2)).toEqual([]);
    expect(isError(await getTicketCategoriesByBoard(s.in2))).toBe(true);
    // The unassigned MSP user is untouched by that bundle.
    as(s.admin);
    expect(await getBoardsForOperation('read') as any[]).toHaveLength(3);

    // Revocation: the next request carries no access at all.
    await db('co_managed_seat_arrangements').where({ tenant: s.tenant, arrangement_id: s.arrX })
      .update({ state: 'ended', ended_at: new Date(), updated_at: new Date() });
    as(s.B);
    expect(await getBoardsForOperation('read')).toEqual([]);
    expect(await getBoardsForOperation('create')).toEqual([]);
    expect(await getAllBoards(true)).toEqual([]);
    expect(await ticketIds()).toEqual([]);
    expect(((await searchAssociations('client', '', 1, 50)) as any).options).toEqual([]);
    expect(await getAssociationContacts()).toEqual([]);
    expect(await workItemTicketIds()).toEqual([]);
    expect(await getTicketStatuses(s.in1)).toEqual([]);
  });
});
