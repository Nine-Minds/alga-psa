import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { TICKET_STATUS_FILTER_ALL } from '@alga-psa/tickets/lib';
import type { ITicketListFilters } from '@alga-psa/types';

/**
 * DB-backed proof for the client/contact filter on the bundled ticket list.
 *
 * In bundled view the filter also matches a master ticket whose CHILD has the
 * client/contact, via a correlated EXISTS over `tickets as tc`. That subquery
 * must correlate on the distribution column (`tc.tenant = t.tenant`) or Citus
 * rejects it with 0A000 ("complex joins are only supported when all
 * distributed tables are co-located and joined on their distribution columns").
 * alga-2026-0002783.
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

let fx: Fixture;
let otherTenant: { tenantId: string; clientId: string; contactId: string; ticketId: string };

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

async function insertClientAndContact(tenantId: string, name: string): Promise<{ clientId: string; contactId: string }> {
  const clientId = uuidv4();
  const contactId = uuidv4();
  await db('clients').insert({ tenant: tenantId, client_id: clientId, client_name: name, is_inactive: false });
  await db('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    client_id: clientId,
    full_name: `${name} Contact`,
    email: `${contactId.slice(0, 8)}@example.com`,
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
  const base = await seedTenant('Bundled Filter');
  const target = await insertClientAndContact(base.tenantId, 'Target');
  const other = await insertClientAndContact(base.tenantId, 'Other');
  const none = { clientId: other.clientId, contactId: other.contactId };

  const masterOwn = await insertTicket(base, { clientId: target.clientId, contactId: target.contactId });
  const masterViaChild = await insertTicket(base, { clientId: none.clientId, contactId: none.contactId });
  const childMatching = await insertTicket(base, {
    clientId: target.clientId, contactId: target.contactId, masterTicketId: masterViaChild,
  });
  const masterUnrelated = await insertTicket(base, { clientId: none.clientId, contactId: none.contactId });
  const childUnrelated = await insertTicket(base, {
    clientId: none.clientId, contactId: none.contactId, masterTicketId: masterUnrelated,
  });
  const standalone = await insertTicket(base, { clientId: target.clientId, contactId: target.contactId });

  fx = {
    ...base,
    targetClientId: target.clientId,
    otherClientId: other.clientId,
    targetContactId: target.contactId,
    otherContactId: other.contactId,
    masterOwn, masterViaChild, childMatching, masterUnrelated, childUnrelated, standalone,
  };

  // A second tenant with its own client/contact and a matching ticket. Querying
  // the first tenant with the second tenant's client/contact must find nothing.
  const base2 = await seedTenant('Isolation');
  const t2 = await insertClientAndContact(base2.tenantId, 'Isolation Target');
  const ticket2 = await insertTicket(base2, { clientId: t2.clientId, contactId: t2.contactId });
  const child2 = await insertTicket(base2, { clientId: t2.clientId, contactId: t2.contactId, masterTicketId: ticket2 });
  void child2;
  otherTenant = { tenantId: base2.tenantId, clientId: t2.clientId, contactId: t2.contactId, ticketId: ticket2 };
}

const baseFilters: ITicketListFilters = {
  boardFilterState: 'all',
  statusId: TICKET_STATUS_FILTER_ALL,
  showOpenOnly: false,
  bundleView: 'bundled',
};

async function listIds(filters: ITicketListFilters): Promise<Set<string>> {
  const result = await optimized.getTicketsForList(filters, 1, 50);
  if (!('tickets' in (result as any))) {
    throw new Error(`ticket list returned an error: ${JSON.stringify(result)}`);
  }
  return new Set((result as any).tickets.map((ticket: { ticket_id: string }) => ticket.ticket_id));
}

describeDb('bundled ticket list client/contact filters (DB-backed)', () => {
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

  it('bundled + clientId returns masters matching directly or via a child, and excludes unrelated tickets', async () => {
    const ids = await listIds({ ...baseFilters, clientId: fx.targetClientId });
    expect(ids).toEqual(new Set([fx.masterOwn, fx.masterViaChild, fx.standalone]));
    expect(ids.has(fx.masterUnrelated)).toBe(false);
    expect(ids.has(fx.childMatching)).toBe(false); // children are hidden in bundled view
  });

  it('bundled + contactId returns masters matching directly or via a child, and excludes unrelated tickets', async () => {
    const ids = await listIds({ ...baseFilters, contactId: fx.targetContactId });
    expect(ids).toEqual(new Set([fx.masterOwn, fx.masterViaChild, fx.standalone]));
    expect(ids.has(fx.masterUnrelated)).toBe(false);
  });

  it('bundled + clientId + contactId combine with AND', async () => {
    const ids = await listIds({ ...baseFilters, clientId: fx.targetClientId, contactId: fx.targetContactId });
    expect(ids).toEqual(new Set([fx.masterOwn, fx.masterViaChild, fx.standalone]));
  });

  it('non-bundled + clientId filters on the ticket own client only (no child roll-up)', async () => {
    const ids = await listIds({ ...baseFilters, bundleView: 'individual', clientId: fx.targetClientId });
    expect(ids).toEqual(new Set([fx.masterOwn, fx.childMatching, fx.standalone]));
    expect(ids.has(fx.masterViaChild)).toBe(false);
  });

  it('non-bundled + contactId filters on the ticket own contact only (no child roll-up)', async () => {
    const ids = await listIds({ ...baseFilters, bundleView: 'individual', contactId: fx.targetContactId });
    expect(ids).toEqual(new Set([fx.masterOwn, fx.childMatching, fx.standalone]));
    expect(ids.has(fx.masterViaChild)).toBe(false);
  });

  it('bundled + open-only status filter still works (statuses EXISTS correlated on tenant)', async () => {
    const ids = await listIds({ ...baseFilters, statusId: undefined as any, showOpenOnly: true, clientId: fx.targetClientId });
    expect(ids).toEqual(new Set([fx.masterOwn, fx.masterViaChild, fx.standalone]));
  });

  it('does not match another tenant\'s client or contact (tenant isolation)', async () => {
    expect((await listIds({ ...baseFilters, clientId: otherTenant.clientId })).size).toBe(0);
    expect((await listIds({ ...baseFilters, contactId: otherTenant.contactId })).size).toBe(0);
    const all = await listIds({ ...baseFilters });
    expect(all.has(otherTenant.ticketId)).toBe(false);
  });
});
