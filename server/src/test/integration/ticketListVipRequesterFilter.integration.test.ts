import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { TICKET_STATUS_FILTER_ALL } from '@alga-psa/tickets/lib';
import type { ITicketListFilters } from '@alga-psa/types';

/**
 * DB-backed proof for the VIP requester filter on the ticket list.
 *
 * `requester_vip` is a WHERE predicate on the same tenant-scoped `contacts as cn`
 * join that resolves contact_name, so the page rows and the total agree and no
 * row is fetched-then-dropped.
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
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: authMocks.hasPermission }));
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

interface Fixture {
  tenantId: string;
  actorId: string;
  statusId: string;
  boardId: string;
  priorityId: string;
  targetClientId: string;
  otherClientId: string;
  targetContactId: string;
  otherContactId: string;
  // tickets
  masterOwn: string; // master, itself matches
  masterViaChild: string; // master, no match itself, matching child
  childMatching: string; // child of masterViaChild, matches
  masterUnrelated: string; // master, no match anywhere
  childUnrelated: string; // child of masterUnrelated, no match
  standalone: string; // non-bundled, matches (client/contact)
}

interface Fixture {
  tenantId: string;
  actorId: string;
  vipContactId: string;
  plainContactId: string;
  vipClientId: string;
  vipTickets: string[];
  plainTicket: string;
  noContactTicket: string;
}

let fx: Fixture;
let otherTenant: { tenantId: string; vipTicketId: string };

async function seedTenant(label: string): Promise<{ tenantId: string; actorId: string; statusId: string; boardId: string; priorityId: string }> {
  const tenantId = uuidv4();
  const actorId = uuidv4();
  const statusId = uuidv4();
  const boardId = uuidv4();
  const priorityId = uuidv4();
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `${label} ${tenantId.slice(0, 8)}`,
    email: `${label}-${tenantId.slice(0, 8)}@example.com`,
    product_code: 'psa',
  });
  await db('users').insert({
    tenant: tenantId,
    user_id: actorId,
    username: `${label}-actor-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `${label}-actor-${tenantId.slice(0, 8)}@example.com`,
    first_name: 'Actor',
    last_name: label,
    user_type: 'internal',
    is_inactive: false,
  });
  await db('boards').insert({
    tenant: tenantId, board_id: boardId, board_name: `${label} Board`, is_default: true, is_inactive: false,
  });
  await db('priorities').insert({
    tenant: tenantId, priority_id: priorityId, priority_name: 'High', created_by: actorId, order_number: 10,
  });
  await db('statuses').insert({
    tenant: tenantId, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket',
    is_closed: false, is_default: true, created_by: actorId, order_number: 10,
  });
  return { tenantId, actorId, statusId, boardId, priorityId };
}

async function insertClientAndContact(tenantId: string, name: string, vip = false): Promise<{ clientId: string; contactId: string }> {
  const clientId = uuidv4();
  const contactId = uuidv4();
  await db('clients').insert({ tenant: tenantId, client_id: clientId, client_name: name, is_inactive: false });
  await db('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    client_id: clientId,
    full_name: `${name} Contact`,
    email: `${contactId.slice(0, 8)}@example.com`,
    is_vip: vip,
  });
  return { clientId, contactId };
}

let ticketSeq = 0;
async function insertTicket(
  base: { tenantId: string; actorId: string; statusId: string; boardId: string; priorityId: string },
  fields: { clientId: string | null; contactId: string | null; masterTicketId?: string | null }
): Promise<string> {
  const ticketId = uuidv4();
  ticketSeq += 1;
  await db('tickets').insert({
    tenant: base.tenantId,
    ticket_id: ticketId,
    ticket_number: `T-${Date.now()}-${ticketSeq}`,
    title: `Ticket ${ticketSeq}`,
    client_id: fields.clientId,
    contact_name_id: fields.contactId,
    master_ticket_id: fields.masterTicketId ?? null,
    board_id: base.boardId,
    status_id: base.statusId,
    priority_id: base.priorityId,
    entered_by: base.actorId,
    entered_at: new Date(Date.UTC(2026, 0, 1, 0, 0, ticketSeq)),
  });
  return ticketId;
}

async function seedFixture(): Promise<void> {
  const base = await seedTenant('Vip Filter');
  const vip = await insertClientAndContact(base.tenantId, 'Vip', true);
  const plain = await insertClientAndContact(base.tenantId, 'Plain', false);
  // 3 VIP-requester tickets, with page size 2 below so the total must come from SQL, not the page.
  const vipTickets = [
    await insertTicket(base, { clientId: vip.clientId, contactId: vip.contactId }),
    await insertTicket(base, { clientId: vip.clientId, contactId: vip.contactId }),
    await insertTicket(base, { clientId: vip.clientId, contactId: vip.contactId }),
  ];
  const plainTicket = await insertTicket(base, { clientId: plain.clientId, contactId: plain.contactId });
  const noContactTicket = await insertTicket(base, { clientId: plain.clientId, contactId: null });
  await db('clients').where({ tenant: base.tenantId, client_id: vip.clientId }).update({ is_vip: true });

  fx = {
    tenantId: base.tenantId,
    actorId: base.actorId,
    vipContactId: vip.contactId,
    plainContactId: plain.contactId,
    vipClientId: vip.clientId,
    vipTickets,
    plainTicket,
    noContactTicket,
  };

  // Another tenant with its own VIP requester: must never leak into the first tenant's filtered list.
  const base2 = await seedTenant('Vip Isolation');
  const t2 = await insertClientAndContact(base2.tenantId, 'Other Vip', true);
  const ticket2 = await insertTicket(base2, { clientId: t2.clientId, contactId: t2.contactId });
  otherTenant = { tenantId: base2.tenantId, vipTicketId: ticket2 };
}

const baseFilters: ITicketListFilters = {
  boardFilterState: 'all',
  statusId: TICKET_STATUS_FILTER_ALL,
  showOpenOnly: false,
  bundleView: 'individual',
};

async function list(filters: ITicketListFilters, page = 1, pageSize = 50) {
  const result = await optimized.getTicketsForList(filters, page, pageSize);
  if (!('tickets' in (result as any))) {
    throw new Error(`ticket list returned an error: ${JSON.stringify(result)}`);
  }
  return result as any;
}

describeDb('ticket list VIP requester filter (DB-backed)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ runSeeds: false });
    optimized = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    await seedFixture();

    authMocks.hasPermission.mockResolvedValue(true);
    authMocks.tenant = fx.tenantId;
    authMocks.user = { user_id: fx.actorId, user_type: 'internal', tenant: fx.tenantId };
  }, 300000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, 60000);

  it('requester_vip returns only tickets whose requester contact is flagged', async () => {
    const result = await list({ ...baseFilters, requester_vip: true });
    expect(new Set(result.tickets.map((t: any) => t.ticket_id))).toEqual(new Set(fx.vipTickets));
    expect(result.tickets.every((t: any) => t.contact_is_vip === true)).toBe(true);
  });

  it('keeps the total correct across pages (filter runs in SQL, not after the fetch)', async () => {
    const page1 = await list({ ...baseFilters, requester_vip: true }, 1, 2);
    const page2 = await list({ ...baseFilters, requester_vip: true }, 2, 2);
    expect(page1.tickets).toHaveLength(2);
    expect(page2.tickets).toHaveLength(1);
    expect(page1.totalCount).toBe(3);
    expect(page2.totalCount).toBe(3);
  });

  it('without the filter every ticket is listed and non-VIP rows carry contact_is_vip=false', async () => {
    const result = await list({ ...baseFilters });
    const ids = new Set(result.tickets.map((t: any) => t.ticket_id));
    expect(ids.has(fx.plainTicket)).toBe(true);
    expect(ids.has(fx.noContactTicket)).toBe(true);
    const plain = result.tickets.find((t: any) => t.ticket_id === fx.plainTicket);
    expect(plain.contact_is_vip).toBe(false);
    expect(result.totalCount).toBe(5);
  });

  it('client_vip filters on the client flag', async () => {
    const result = await list({ ...baseFilters, client_vip: true });
    expect(new Set(result.tickets.map((t: any) => t.ticket_id))).toEqual(new Set(fx.vipTickets));
    expect(result.tickets.every((t: any) => t.client_is_vip === true)).toBe(true);
  });

  it("does not surface another tenant's VIP requester (tenant isolation)", async () => {
    const result = await list({ ...baseFilters, requester_vip: true });
    const ids = new Set(result.tickets.map((t: any) => t.ticket_id));
    expect(ids.has(otherTenant.vipTicketId)).toBe(false);
    expect(result.totalCount).toBe(3);
  });
});
