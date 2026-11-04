import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { TICKET_STATUS_FILTER_ALL, createTicketStatusNameFilterValue } from '@alga-psa/tickets/lib';
import type { ITicketListFilters } from '@alga-psa/types';

/**
 * Table-driven proof for the ticket list filters, all of which compile through the predicate
 * compiler (packages/tickets/src/lib/ticketQuerySchema.ts). Every case names the exact tickets it
 * expects, in individual and bundled view, and asserts the page total.
 *
 * Fixture (one tenant, names are the ids used below):
 *   T1  openA      b1  Open    p1  catA          agent X, +resource Y  c1/k1(VIP)  tag urgent
 *   T2  closedA1   b1  Closed  p2  catA > catA1  team tm1 (Y member)   c2/k2       due -2d, awaiting_client
 *   T3  inactiveB  b2* Open    p1  catB          unassigned            c1/k3       due +3d, tag later
 *   T4  noBoard    -   Open    p2  -             agent Y               c2/-        due today 23:58, awaiting_internal, SLA breached
 *   M   master     b1  Open    p1  -             unassigned            c2/k2       SLA on track
 *   CH1 child of M b1  Open    p1  -             unassigned            c1/k1(VIP)  tag urgent
 *   CH2 child of M b1  Open    p1  -             unassigned            c2/k2       SLA paused
 *   (b2 is an inactive board; c1 carries the client VIP tag; k1 the contact VIP tag)
 */

const authMocks = vi.hoisted(() => ({
  user: null as any,
  tenant: null as string | null,
  hasPermission: vi.fn(),
  scheduleJobAt: vi.fn(),
  cancelScheduledJob: vi.fn().mockResolvedValue(true),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) =>
    action(authMocks.user, { tenant: authMocks.tenant }, ...args),
  hasPermission: (...args: any[]) => authMocks.hasPermission(...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: (...args: any[]) => authMocks.hasPermission(...args) }));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn().mockResolvedValue(null),
  getUserAvatarUrl: vi.fn().mockResolvedValue(null),
  getClientLogoUrlsBatch: vi.fn().mockResolvedValue(new Map()),
  getEntityImageUrlsBatch: vi.fn().mockResolvedValue(new Map()),
}));

const describeDb = await describeWithDb();

type OptimizedActions = typeof import('@alga-psa/tickets/actions/optimizedTicketActions');
let optimized: OptimizedActions;
let db: Knex;

const TICKET_NAMES = ['T1', 'T2', 'T3', 'T4', 'M', 'CH1', 'CH2'] as const;
type TicketName = (typeof TICKET_NAMES)[number];

interface Fixture {
  tenantId: string;
  actorId: string;
  agentX: string;
  agentY: string;
  team: string;
  b1: string;
  b2: string;
  sOpen1: string;
  sClosed1: string;
  p2: string;
  catA: string;
  catA1: string;
  catB: string;
  c1: string;
  c2: string;
  k1: string;
  vipContactTag: string;
  vipClientTag: string;
  urgentTag: string;
  ticketIds: Record<TicketName, string>;
}

let fx: Fixture;
let idToName: Map<string, TicketName>;
let foreign: { tenantId: string; vipContactTag: string };

const DAY = 24 * 3600 * 1000;

async function insertTagDef(tenant: string, text: string, type: string): Promise<string> {
  const tagId = uuidv4();
  await db('tag_definitions').insert({ tenant, tag_id: tagId, tag_text: text, tagged_type: type });
  return tagId;
}

async function mapTag(tenant: string, tagId: string, taggedId: string, type: string): Promise<void> {
  await db('tag_mappings').insert({ tenant, tag_id: tagId, tagged_id: taggedId, tagged_type: type });
}

async function seedTenantBase(label: string) {
  const tenantId = uuidv4();
  const actorId = uuidv4();
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `${label} ${tenantId.slice(0, 8)}`,
    email: `${label}-${tenantId.slice(0, 8)}@example.com`,
    product_code: 'psa',
  });
  const user = (id: string, name: string, type: 'internal' | 'client' = 'internal') => ({
    tenant: tenantId,
    user_id: id,
    username: `${name}-${id.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `${name}-${id.slice(0, 8)}@example.com`,
    first_name: name,
    last_name: label,
    user_type: type,
    is_inactive: false,
    timezone: 'UTC',
  });
  await db('users').insert(user(actorId, 'Actor'));
  return { tenantId, actorId, user };
}

async function seedFixture(): Promise<void> {
  const { tenantId, actorId, user } = await seedTenantBase('Matrix');
  const agentX = uuidv4();
  const agentY = uuidv4();
  await db('users').insert([user(agentX, 'AgentX'), user(agentY, 'AgentY')]);
  const team = uuidv4();
  await db('teams').insert({ tenant: tenantId, team_id: team, team_name: 'Team 1', manager_id: actorId });
  await db('team_members').insert({ tenant: tenantId, team_id: team, user_id: agentY, role: 'member' });

  const b1 = uuidv4();
  const b2 = uuidv4();
  await db('boards').insert([
    { tenant: tenantId, board_id: b1, board_name: 'Active Board', is_default: true, is_inactive: false },
    { tenant: tenantId, board_id: b2, board_name: 'Inactive Board', is_default: false, is_inactive: true },
  ]);
  const sOpen1 = uuidv4();
  const sClosed1 = uuidv4();
  const sOpen2 = uuidv4();
  const status = (id: string, board: string, name: string, closed: boolean, order: number) => ({
    tenant: tenantId, status_id: id, board_id: board, name, status_type: 'ticket',
    is_closed: closed, is_default: false, created_by: actorId, order_number: order,
  });
  await db('statuses').insert([
    status(sOpen1, b1, 'Open', false, 10),
    status(sClosed1, b1, 'Closed', true, 20),
    status(sOpen2, b2, 'Open', false, 10),
  ]);
  const p1 = uuidv4();
  const p2 = uuidv4();
  await db('priorities').insert([
    { tenant: tenantId, priority_id: p1, priority_name: 'High', created_by: actorId, order_number: 10 },
    { tenant: tenantId, priority_id: p2, priority_name: 'Low', created_by: actorId, order_number: 20 },
  ]);
  const catA = uuidv4();
  const catA1 = uuidv4();
  const catB = uuidv4();
  await db('categories').insert([
    { tenant: tenantId, category_id: catA, category_name: 'A', created_by: actorId, display_order: 1 },
    { tenant: tenantId, category_id: catA1, category_name: 'A1', parent_category: catA, created_by: actorId, display_order: 2 },
    { tenant: tenantId, category_id: catB, category_name: 'B', created_by: actorId, display_order: 3 },
  ]);
  const slaPolicy = uuidv4();
  await db('sla_policies').insert({ tenant: tenantId, sla_policy_id: slaPolicy, policy_name: 'Std' });

  const c1 = uuidv4();
  const c2 = uuidv4();
  await db('clients').insert([
    { tenant: tenantId, client_id: c1, client_name: 'Client One', is_inactive: false },
    { tenant: tenantId, client_id: c2, client_name: 'Client Two', is_inactive: false },
  ]);
  const k1 = uuidv4();
  const k2 = uuidv4();
  const k3 = uuidv4();
  const contact = (id: string, client: string, name: string) => ({
    tenant: tenantId, contact_name_id: id, client_id: client, full_name: name, email: `${id.slice(0, 8)}@example.com`,
  });
  await db('contacts').insert([contact(k1, c1, 'K1'), contact(k2, c2, 'K2'), contact(k3, c1, 'K3')]);

  const vipContactTag = await insertTagDef(tenantId, 'VIP', 'contact');
  const vipClientTag = await insertTagDef(tenantId, 'VIP', 'client');
  const urgentTag = await insertTagDef(tenantId, 'urgent', 'ticket');
  const laterTag = await insertTagDef(tenantId, 'later', 'ticket');
  const billingTag = await insertTagDef(tenantId, 'Billing', 'contact');
  await mapTag(tenantId, vipContactTag, k1, 'contact');
  await mapTag(tenantId, billingTag, k3, 'contact');
  await mapTag(tenantId, vipClientTag, c1, 'client');

  const now = Date.now();
  const startOfTodayUtc = new Date(new Date(now).setUTCHours(0, 0, 0, 0)).getTime();
  const ids = Object.fromEntries(TICKET_NAMES.map((name) => [name, uuidv4()])) as Record<TicketName, string>;
  let seq = 0;
  const ticket = (name: TicketName, fields: Record<string, unknown>) => {
    seq += 1;
    return {
      tenant: tenantId,
      ticket_id: ids[name],
      ticket_number: `MX-${name}-${seq}`,
      title: `Ticket ${name}`,
      priority_id: p1,
      entered_by: actorId,
      entered_at: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)),
      ...fields,
    };
  };
  await db('tickets').insert([
    ticket('M', {
      board_id: b1, status_id: sOpen1, client_id: c2, contact_name_id: k2,
      sla_policy_id: slaPolicy,
      sla_response_due_at: new Date(now + DAY), sla_resolution_due_at: new Date(now + 2 * DAY),
    }),
  ]);
  await db('tickets').insert([
    ticket('T1', { board_id: b1, status_id: sOpen1, category_id: catA, assigned_to: agentX, client_id: c1, contact_name_id: k1 }),
    ticket('T2', {
      board_id: b1, status_id: sClosed1, priority_id: p2, category_id: catA, subcategory_id: catA1,
      assigned_team_id: team, client_id: c2, contact_name_id: k2,
      due_date: new Date(now - 2 * DAY), response_state: 'awaiting_client',
    }),
    ticket('T3', {
      board_id: b2, status_id: sOpen2, category_id: catB, client_id: c1, contact_name_id: k3,
      due_date: new Date(now + 3 * DAY),
    }),
    ticket('T4', {
      board_id: null, status_id: sOpen1, priority_id: p2, assigned_to: agentY, client_id: c2, contact_name_id: null,
      due_date: new Date(startOfTodayUtc + (23 * 60 + 58) * 60 * 1000), response_state: 'awaiting_internal',
      sla_policy_id: slaPolicy, sla_response_due_at: new Date(now - DAY),
    }),
    ticket('CH1', { board_id: b1, status_id: sOpen1, client_id: c1, contact_name_id: k1, master_ticket_id: ids.M }),
    ticket('CH2', {
      board_id: b1, status_id: sOpen1, client_id: c2, contact_name_id: k2, master_ticket_id: ids.M,
      sla_policy_id: slaPolicy, sla_paused_at: new Date(now - 3600 * 1000),
    }),
  ]);
  await mapTag(tenantId, urgentTag, ids.T1, 'ticket');
  await mapTag(tenantId, urgentTag, ids.CH1, 'ticket');
  await mapTag(tenantId, laterTag, ids.T3, 'ticket');
  await db('ticket_resources').insert({
    tenant: tenantId, ticket_id: ids.T1, assigned_to: agentX, additional_user_id: agentY, role: 'support',
  });

  fx = {
    tenantId, actorId, agentX, agentY, team, b1, b2, sOpen1, sClosed1, p2, catA, catA1, catB,
    c1, c2, k1, vipContactTag, vipClientTag, urgentTag, ticketIds: ids,
  };
  idToName = new Map(TICKET_NAMES.map((name) => [ids[name], name]));

  // A second tenant with its own VIP contact tag on a ticket; its ids must never match here.
  const other = await seedTenantBase('Foreign');
  const foreignClient = uuidv4();
  const foreignContact = uuidv4();
  const foreignBoard = uuidv4();
  const foreignStatus = uuidv4();
  const foreignPriority = uuidv4();
  await db('clients').insert({ tenant: other.tenantId, client_id: foreignClient, client_name: 'F', is_inactive: false });
  await db('contacts').insert({
    tenant: other.tenantId, contact_name_id: foreignContact, client_id: foreignClient, full_name: 'F', email: 'f@example.com',
  });
  await db('boards').insert({ tenant: other.tenantId, board_id: foreignBoard, board_name: 'FB', is_default: true, is_inactive: false });
  await db('statuses').insert({
    tenant: other.tenantId, status_id: foreignStatus, board_id: foreignBoard, name: 'Open', status_type: 'ticket',
    is_closed: false, is_default: true, created_by: other.actorId, order_number: 10,
  });
  await db('priorities').insert({
    tenant: other.tenantId, priority_id: foreignPriority, priority_name: 'High', created_by: other.actorId, order_number: 10,
  });
  const foreignTicket = uuidv4();
  await db('tickets').insert({
    tenant: other.tenantId, ticket_id: foreignTicket, ticket_number: 'MX-F-1', title: 'Foreign',
    client_id: foreignClient, contact_name_id: foreignContact, board_id: foreignBoard,
    status_id: foreignStatus, priority_id: foreignPriority, entered_by: other.actorId,
  });
  const foreignVip = await insertTagDef(other.tenantId, 'VIP', 'contact');
  await mapTag(other.tenantId, foreignVip, foreignContact, 'contact');
  foreign = { tenantId: other.tenantId, vipContactTag: foreignVip };
}

const base: ITicketListFilters = {
  boardFilterState: 'all',
  statusId: TICKET_STATUS_FILTER_ALL,
  showOpenOnly: false,
};

function allowAll() {
  authMocks.hasPermission.mockImplementation(async () => true);
}

async function list(filters: ITicketListFilters, page = 1, pageSize = 50) {
  const result = await optimized.getTicketsForList(filters, page, pageSize);
  if (!('tickets' in (result as any))) {
    throw new Error(`ticket list returned an error: ${JSON.stringify(result)}`);
  }
  return result as { tickets: Array<{ ticket_id: string }>; totalCount: number };
}

async function names(filters: ITicketListFilters): Promise<{ names: TicketName[]; total: number }> {
  const result = await list(filters);
  return {
    names: result.tickets.map((row) => (idToName.get(row.ticket_id) ?? `UNKNOWN:${row.ticket_id}`) as TicketName).sort(),
    total: result.totalCount,
  };
}

interface MatrixCase {
  id: string;
  filters: (f: Fixture) => Partial<ITicketListFilters>;
  /** Expected tickets in the individual view. */
  individual: TicketName[];
  /** Expected tickets in the bundled view (children hidden; masters roll up through children). */
  bundled: TicketName[];
}

const EVERY: TicketName[] = ['CH1', 'CH2', 'M', 'T1', 'T2', 'T3', 'T4'];
const TOP: TicketName[] = ['M', 'T1', 'T2', 'T3', 'T4'];

const CASES: MatrixCase[] = [
  { id: 'baseline', filters: () => ({}), individual: EVERY, bundled: TOP },

  // Boards
  { id: 'board-include-b1', filters: (f) => ({ boardIds: [f.b1] }), individual: ['CH1', 'CH2', 'M', 'T1', 'T2'], bundled: ['M', 'T1', 'T2'] },
  { id: 'board-include-legacy-single', filters: (f) => ({ boardId: f.b2 }), individual: ['T3'], bundled: ['T3'] },
  { id: 'board-include-no-board', filters: () => ({ boardIds: ['no-board'] }), individual: ['T4'], bundled: ['T4'] },
  { id: 'board-include-b1-and-no-board', filters: (f) => ({ boardIds: [f.b1, 'no-board'] }), individual: ['CH1', 'CH2', 'M', 'T1', 'T2', 'T4'], bundled: ['M', 'T1', 'T2', 'T4'] },
  { id: 'board-include-inactive-explicit-beats-state', filters: (f) => ({ boardIds: [f.b2], boardFilterState: 'active' }), individual: ['T3'], bundled: ['T3'] },
  { id: 'board-exclude-b1', filters: (f) => ({ excludeBoardIds: [f.b1] }), individual: ['T3', 'T4'], bundled: ['T3', 'T4'] },
  { id: 'board-exclude-no-board', filters: () => ({ excludeBoardIds: ['no-board'] }), individual: ['CH1', 'CH2', 'M', 'T1', 'T2', 'T3'], bundled: ['M', 'T1', 'T2', 'T3'] },
  { id: 'board-state-active', filters: () => ({ boardFilterState: 'active' }), individual: ['CH1', 'CH2', 'M', 'T1', 'T2'], bundled: ['M', 'T1', 'T2'] },
  { id: 'board-state-inactive', filters: () => ({ boardFilterState: 'inactive' }), individual: ['T3'], bundled: ['T3'] },

  // Status
  { id: 'status-open-only', filters: () => ({ statusId: undefined, showOpenOnly: true }), individual: ['CH1', 'CH2', 'M', 'T1', 'T3', 'T4'], bundled: ['M', 'T1', 'T3', 'T4'] },
  { id: 'status-by-name-spans-boards', filters: () => ({ statusId: createTicketStatusNameFilterValue('Open') }), individual: ['CH1', 'CH2', 'M', 'T1', 'T3', 'T4'], bundled: ['M', 'T1', 'T3', 'T4'] },
  { id: 'status-by-id', filters: (f) => ({ statusId: f.sClosed1 }), individual: ['T2'], bundled: ['T2'] },

  // Priority
  { id: 'priority-by-id', filters: (f) => ({ priorityId: f.p2 }), individual: ['T2', 'T4'], bundled: ['T2', 'T4'] },

  // Category
  { id: 'category-parent-matches-subcategorized', filters: (f) => ({ categoryIds: [f.catA] }), individual: ['T1', 'T2'], bundled: ['T1', 'T2'] },
  { id: 'category-subcategory', filters: (f) => ({ categoryIds: [f.catA1] }), individual: ['T2'], bundled: ['T2'] },
  { id: 'category-legacy-single', filters: (f) => ({ categoryId: f.catB }), individual: ['T3'], bundled: ['T3'] },
  { id: 'category-none', filters: () => ({ categoryIds: ['no-category'] }), individual: ['CH1', 'CH2', 'M', 'T4'], bundled: ['M', 'T4'] },
  { id: 'category-b-or-none', filters: (f) => ({ categoryIds: [f.catB, 'no-category'] }), individual: ['CH1', 'CH2', 'M', 'T3', 'T4'], bundled: ['M', 'T3', 'T4'] },
  { id: 'category-exclude-parent-keeps-uncategorized', filters: (f) => ({ excludeCategoryIds: [f.catA] }), individual: ['CH1', 'CH2', 'M', 'T3', 'T4'], bundled: ['M', 'T3', 'T4'] },
  { id: 'category-exclude-subcategory', filters: (f) => ({ excludeCategoryIds: [f.catA1] }), individual: ['CH1', 'CH2', 'M', 'T1', 'T3', 'T4'], bundled: ['M', 'T1', 'T3', 'T4'] },
  { id: 'category-exclude-none', filters: () => ({ excludeCategoryIds: ['no-category'] }), individual: ['T1', 'T2', 'T3'], bundled: ['T1', 'T2', 'T3'] },

  // Assignment
  { id: 'assignee-user', filters: (f) => ({ assignedToIds: [f.agentX] }), individual: ['T1'], bundled: ['T1'] },
  { id: 'assignee-team', filters: (f) => ({ assignedTeamIds: [f.team] }), individual: ['T2'], bundled: ['T2'] },
  { id: 'assignee-unassigned-means-no-assigned-to', filters: () => ({ includeUnassigned: true }), individual: ['CH1', 'CH2', 'M', 'T2', 'T3'], bundled: ['M', 'T2', 'T3'] },
  { id: 'assignee-user-or-unassigned', filters: (f) => ({ assignedToIds: [f.agentX], includeUnassigned: true }), individual: ['CH1', 'CH2', 'M', 'T1', 'T2', 'T3'], bundled: ['M', 'T1', 'T2', 'T3'] },
  { id: 'assignee-user-or-team', filters: (f) => ({ assignedToIds: [f.agentX], assignedTeamIds: [f.team] }), individual: ['T1', 'T2'], bundled: ['T1', 'T2'] },

  // Due date (the actor's time zone is UTC)
  { id: 'due-overdue', filters: () => ({ dueDateFilter: 'overdue' }), individual: ['T2'], bundled: ['T2'] },
  { id: 'due-upcoming-7d', filters: () => ({ dueDateFilter: 'upcoming' }), individual: ['T3', 'T4'], bundled: ['T3', 'T4'] },
  { id: 'due-today', filters: () => ({ dueDateFilter: 'today' }), individual: ['T4'], bundled: ['T4'] },
  { id: 'due-none', filters: () => ({ dueDateFilter: 'no_due_date' }), individual: ['CH1', 'CH2', 'M', 'T1'], bundled: ['M', 'T1'] },
  { id: 'due-before', filters: () => ({ dueDateFilter: 'before', dueDateTo: new Date(Date.now()).toISOString() }), individual: ['T2'], bundled: ['T2'] },
  { id: 'due-after', filters: () => ({ dueDateFilter: 'after', dueDateFrom: new Date(Date.now()).toISOString() }), individual: ['T3', 'T4'], bundled: ['T3', 'T4'] },
  { id: 'due-custom-range', filters: () => ({ dueDateFilter: 'custom', dueDateFrom: new Date(Date.now() - 3 * DAY).toISOString(), dueDateTo: new Date(Date.now()).toISOString() }), individual: ['T2'], bundled: ['T2'] },

  // Response state
  { id: 'response-awaiting-client', filters: () => ({ responseState: 'awaiting_client' }), individual: ['T2'], bundled: ['T2'] },
  { id: 'response-awaiting-internal', filters: () => ({ responseState: 'awaiting_internal' }), individual: ['T4'], bundled: ['T4'] },
  { id: 'response-none-means-null', filters: () => ({ responseState: 'none' }), individual: ['CH1', 'CH2', 'M', 'T1', 'T3'], bundled: ['M', 'T1', 'T3'] },

  // SLA (a bundled master matches on its own SLA only)
  { id: 'sla-has', filters: () => ({ slaStatusFilter: 'has_sla' }), individual: ['CH2', 'M', 'T4'], bundled: ['M', 'T4'] },
  { id: 'sla-none', filters: () => ({ slaStatusFilter: 'no_sla' }), individual: ['CH1', 'T1', 'T2', 'T3'], bundled: ['T1', 'T2', 'T3'] },
  { id: 'sla-breached', filters: () => ({ slaStatusFilter: 'breached' }), individual: ['T4'], bundled: ['T4'] },
  { id: 'sla-on-track', filters: () => ({ slaStatusFilter: 'on_track' }), individual: ['M'], bundled: ['M'] },
  { id: 'sla-paused', filters: () => ({ slaStatusFilter: 'paused' }), individual: ['CH2'], bundled: [] },

  // Client, contact and ticket tags roll up to a bundle master through its children
  { id: 'client-id', filters: (f) => ({ clientId: f.c1 }), individual: ['CH1', 'T1', 'T3'], bundled: ['M', 'T1', 'T3'] },
  { id: 'contact-id', filters: (f) => ({ contactId: f.k1 }), individual: ['CH1', 'T1'], bundled: ['M', 'T1'] },
  { id: 'ticket-tags-legacy-text', filters: () => ({ tags: ['urgent'] }), individual: ['CH1', 'T1'], bundled: ['M', 'T1'] },
  { id: 'ticket-tags-where-empty-in-matches-nothing', filters: () => ({ where: { join: 'and', clauses: [{ path: 'tags', operator: 'in', value: [] }] } }), individual: [], bundled: [] },
  { id: 'ticket-tags-legacy-unknown-text', filters: () => ({ tags: ['no-such-tag'] }), individual: [], bundled: [] },

  // New predicate dimensions
  { id: 'contact-tags-any-of-vip', filters: (f) => ({ where: { join: 'and', clauses: [{ path: 'contact.tags', operator: 'in', value: [f.vipContactTag] }] } }), individual: ['CH1', 'T1'], bundled: ['M', 'T1'] },
  { id: 'contact-tags-none-of-vip-keeps-no-contact', filters: (f) => ({ where: { join: 'and', clauses: [{ path: 'contact.tags', operator: 'not_in', value: [f.vipContactTag] }] } }), individual: ['CH2', 'M', 'T2', 'T3', 'T4'], bundled: ['T2', 'T3', 'T4'] },
  { id: 'contact-tags-none', filters: () => ({ where: { join: 'and', clauses: [{ path: 'contact.tags', operator: 'is_empty' }] } }), individual: ['CH2', 'M', 'T2', 'T4'], bundled: ['T2', 'T4'] },
  { id: 'client-tags-any-of-vip', filters: (f) => ({ where: { join: 'and', clauses: [{ path: 'client.tags', operator: 'in', value: [f.vipClientTag] }] } }), individual: ['CH1', 'T1', 'T3'], bundled: ['M', 'T1', 'T3'] },
  { id: 'client-tags-none-of-vip', filters: (f) => ({ where: { join: 'and', clauses: [{ path: 'client.tags', operator: 'not_in', value: [f.vipClientTag] }] } }), individual: ['CH2', 'M', 'T2', 'T4'], bundled: ['T2', 'T4'] },
  { id: 'where-combines-with-legacy-keys', filters: (f) => ({ boardIds: [f.b1], where: { join: 'and', clauses: [{ path: 'contact.tags', operator: 'in', value: [f.vipContactTag] }] } }), individual: ['CH1', 'T1'], bundled: ['M', 'T1'] },
  { id: 'where-two-clauses-and', filters: (f) => ({ where: { join: 'and', clauses: [{ path: 'contact.tags', operator: 'in', value: [f.vipContactTag] }, { path: 'client.tags', operator: 'not_in', value: [f.vipClientTag] }] } }), individual: [], bundled: [] },
  { id: 'where-ticket-tags-by-definition-id', filters: (f) => ({ where: { join: 'and', clauses: [{ path: 'tags', operator: 'in', value: [f.urgentTag] }] } }), individual: ['CH1', 'T1'], bundled: ['M', 'T1'] },
  { id: 'where-other-tenant-tag-id-matches-nothing', filters: () => ({ where: { join: 'and', clauses: [{ path: 'contact.tags', operator: 'in', value: [foreign.vipContactTag] }] } }), individual: [], bundled: [] },
];

describeDb('ticket list filter matrix (DB-backed, compiled predicates)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ runSeeds: false });
    optimized = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    await seedFixture();
    allowAll();
    authMocks.tenant = fx.tenantId;
    authMocks.user = { user_id: fx.actorId, user_type: 'internal', tenant: fx.tenantId };
  }, 300000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, 60000);

  describe.each(['individual', 'bundled'] as const)('%s view', (view) => {
    it.each(CASES.map((c) => [c.id, c] as const))('%s', async (_id, testCase) => {
      const expected = [...(view === 'bundled' ? testCase.bundled : testCase.individual)].sort();
      const result = await names({ ...base, ...testCase.filters(fx), bundleView: view } as ITicketListFilters);
      expect(result.names).toEqual(expected);
      expect(result.total).toBe(expected.length);
    });
  });

  // The projects package still calls ticketActions.getTicketsForList; its tag branch resolves text to
  // definition ids and compiles `tags in` (rootAlias 't'), so it must agree with the matrix above.
  describe('ticketActions.getTicketsForList tag filter', () => {
    async function legacyNames(tags: string[]): Promise<TicketName[]> {
      const legacy = await import('@alga-psa/tickets/actions/ticketActions');
      const result = await legacy.getTicketsForList({ ...base, tags } as ITicketListFilters);
      if (!Array.isArray(result)) throw new Error(`legacy list returned an error: ${JSON.stringify(result)}`);
      return result.map((row) => (idToName.get(row.ticket_id) ?? `UNKNOWN:${row.ticket_id}`) as TicketName).sort();
    }

    it('a known tag text returns only the tickets carrying that tag', async () => {
      expect(await legacyNames(['urgent'])).toEqual(['CH1', 'T1']);
    });

    it('an unknown tag text returns no tickets', async () => {
      expect(await legacyNames(['no-such-tag'])).toEqual([]);
    });

    it('known plus unknown text returns the known tag tickets', async () => {
      expect(await legacyNames(['urgent', 'no-such-tag'])).toEqual(['CH1', 'T1']);
    });
  });

  it('paginates a filtered result without losing or repeating rows (totals hold on every page)', async () => {
    const filters = { ...base, bundleView: 'individual', boardIds: [fx.b1] } as ITicketListFilters;
    const seen: TicketName[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const result = await list(filters, page, 2);
      expect(result.totalCount).toBe(5);
      seen.push(...result.tickets.map((row) => idToName.get(row.ticket_id) as TicketName));
    }
    expect([...seen].sort()).toEqual(['CH1', 'CH2', 'M', 'T1', 'T2']);
  });

  it('assignedToMe matches assignee, additional agent and team member, and is bypassed with project:read', async () => {
    authMocks.user = { user_id: fx.agentY, user_type: 'internal', tenant: fx.tenantId };
    try {
      authMocks.hasPermission.mockImplementation(async (_user: any, resource: string) => resource !== 'project');
      const mine = await names({ ...base, assignedToMe: true, bundleView: 'individual' });
      expect(mine.names).toEqual(['T1', 'T2', 'T4']);
      expect(mine.total).toBe(3);

      allowAll();
      const admin = await names({ ...base, assignedToMe: true, bundleView: 'individual' });
      expect(admin.names).toEqual(EVERY);
    } finally {
      allowAll();
      authMocks.user = { user_id: fx.actorId, user_type: 'internal', tenant: fx.tenantId };
    }
  });

  it('a client-portal user gets the same filter results confined by their own visibility', async () => {
    const clientUserId = uuidv4();
    await db('users').insert({
      tenant: fx.tenantId, user_id: clientUserId, username: `portal-${clientUserId.slice(0, 8)}`,
      hashed_password: 'not-used', email: `portal-${clientUserId.slice(0, 8)}@example.com`,
      first_name: 'Portal', last_name: 'User', user_type: 'client', is_inactive: false,
    });
    authMocks.user = { user_id: clientUserId, user_type: 'client', clientId: fx.c1, tenant: fx.tenantId };
    try {
      const filtered = await names({
        ...base,
        bundleView: 'individual',
        where: { join: 'and', clauses: [{ path: 'contact.tags', operator: 'in', value: [fx.vipContactTag] }] },
      });
      // Whatever the portal user may see, the filter never widens it.
      expect(filtered.names.every((name) => ['CH1', 'T1'].includes(name))).toBe(true);
      expect(filtered.total).toBe(filtered.names.length);
    } finally {
      authMocks.user = { user_id: fx.actorId, user_type: 'internal', tenant: fx.tenantId };
    }
  });
});
