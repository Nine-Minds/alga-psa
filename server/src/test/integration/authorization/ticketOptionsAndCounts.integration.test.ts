/**
 * T016 (alga-2026-0003212, S15): ticket form options and counts are computed over the tickets the subject may
 * read. A client-restricted internal user (bundle narrows `ticket` reads to client A) gets
 *   - assignee/user options that are internal staff only (portal users never appear, for anyone), and tag text
 *     only from tickets they can read;
 *   - ticket counts (client cards, client pulse, contact stats, dashboard tiles, bundle child stats) that equal
 *     the number of rows the same subject gets from the ticket list.
 * An unrestricted user sees every tag and the full counts. Real kernel, real bundle service, real DB; only the
 * session seam (withAuth), the DB handle and the coarse RBAC grant are stood in for.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../../test-utils/testDataFactory';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { runWithTenant } from '@alga-psa/db';
import { TICKET_STATUS_FILTER_ALL } from '@alga-psa/tickets/lib';
import type { ITicketListFilters } from '@alga-psa/types';

const ref = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '', user: null as any }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
  getConnection: vi.fn(async () => ref.knex),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('../../../../../packages/user-composition/src/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishStoredWorkflowEvent: vi.fn(),
}));
vi.mock('@alga-psa/formatting/avatarUtils', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getContactAvatarUrlsBatch: vi.fn().mockResolvedValue(new Map()),
  getClientLogoUrl: vi.fn().mockResolvedValue(null),
  getUserAvatarUrl: vi.fn().mockResolvedValue(null),
  getClientLogoUrlsBatch: vi.fn().mockResolvedValue(new Map()),
  getEntityImageUrlsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import {
  getTicketFormOptions,
  getTicketsForList,
  fetchBundleChildrenForMaster,
} from '../../../../../packages/tickets/src/actions/optimizedTicketActions';
import { getTicketFormData } from '../../../../../packages/tickets/src/actions/ticketFormActions';
import { getBundleMasterClosedContextAction } from '../../../../../packages/tickets/src/actions/ticketBundleActions';
import { getClientOpenTicketCounts } from '../../../../../packages/clients/src/actions/clientTicketStatsActions';
import { getClientPulse } from '../../../../../packages/clients/src/actions/clientPulseActions';
import { getContactStats } from '../../../../../packages/clients/src/actions/contact-actions/contactBentoActions';
import { getAlgaDeskDashboardSummary } from '../../../lib/actions/algadeskDashboardActions';

const HOOK_TIMEOUT = 900_000;

describe('ticket options and counts over readable tickets (real kernel, real DB)', () => {
  let db: Knex;
  let tenant: string;
  const mark = uuidv4().slice(0, 8);
  const clients = { a: uuidv4(), b: uuidv4() };
  const contacts = { a: uuidv4(), b: uuidv4() };
  const tag = { a: `tag-a-only-${mark}`, b: `tag-b-only-${mark}` };
  let restrictedId = '';
  let unrestrictedId = '';
  let adminId = '';
  const portalIds: string[] = [];
  let boardId = '';
  let openStatusId = '';
  let closedStatusId = '';
  let priorityId = '';
  let master = '';
  const ticketIds: Record<string, string> = {};

  const asUser = (userId: string) => {
    ref.tenant = tenant;
    ref.user = { user_id: userId, user_type: 'internal', tenant, roles: [], email: `${userId}@example.com` };
  };

  let seq = 0;
  async function insertTicket(clientId: string, contactId: string | null, opts: { closed?: boolean; masterId?: string } = {}) {
    const ticket_id = uuidv4();
    seq += 1;
    await db('tickets').insert({
      tenant, ticket_id, ticket_number: `S15-${mark}-${seq}`, title: `S15 ticket ${seq} ${mark}`,
      client_id: clientId, contact_name_id: contactId, board_id: boardId, priority_id: priorityId,
      status_id: opts.closed ? closedStatusId : openStatusId, entered_by: adminId,
      master_ticket_id: opts.masterId ?? null, closed_at: opts.closed ? new Date() : null,
      entered_at: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)),
    });
    return ticket_id;
  }

  async function tagTicket(ticketId: string, text: string) {
    let def = await db('tag_definitions').where({ tenant, tag_text: text, tagged_type: 'ticket' }).first();
    if (!def) {
      const tag_id = uuidv4();
      await db('tag_definitions').insert({ tenant, tag_id, tag_text: text, tagged_type: 'ticket', background_color: '#eee', text_color: '#111' });
      def = { tag_id };
    }
    await db('tag_mappings').insert({ tenant, tag_id: def.tag_id, tagged_id: ticketId, tagged_type: 'ticket' });
  }

  const baseFilters: ITicketListFilters = {
    boardFilterState: 'all', statusId: TICKET_STATUS_FILTER_ALL, showOpenOnly: false, bundleView: 'individual',
  };
  async function listFor(filters: Partial<ITicketListFilters>) {
    const result: any = await getTicketsForList({ ...baseFilters, ...filters }, 1, 100);
    if (!('tickets' in result)) throw new Error(`ticket list error: ${JSON.stringify(result)}`);
    return result as { tickets: any[]; totalCount: number };
  }
  const mine = (rows: any[]) => rows.filter((row) => String(row.title ?? '').includes(mark));

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    ref.knex = db;
    tenant = await createTenant(db, `Ticket options ${mark}`);
    adminId = await createUser(db, tenant, { user_type: 'internal', first_name: 'Ada', last_name: 'Admin' });
    restrictedId = await createUser(db, tenant, { user_type: 'internal', first_name: 'Rhea', last_name: 'Restricted' });
    unrestrictedId = await createUser(db, tenant, { user_type: 'internal', first_name: 'Una', last_name: 'Unrestricted' });

    for (const [key, id] of Object.entries(clients)) {
      await db('clients').insert({ tenant, client_id: id, client_name: `Client ${key} ${mark}`, billing_cycle: 'monthly', is_tax_exempt: false, is_inactive: false });
    }
    for (const key of ['a', 'b'] as const) {
      await db('contacts').insert({
        tenant, contact_name_id: contacts[key], full_name: `Contact ${key} ${mark}`, client_id: clients[key],
        email: `contact-${key}-${mark}@example.com`, is_inactive: false,
      });
      // One portal user for each client.
      portalIds.push(await createUser(db, tenant, {
        user_type: 'client', contact_id: contacts[key], first_name: `Portal${key.toUpperCase()}`, last_name: mark,
      }));
    }

    boardId = uuidv4();
    priorityId = uuidv4();
    openStatusId = uuidv4();
    closedStatusId = uuidv4();
    await db('boards').insert({ tenant, board_id: boardId, board_name: `Board ${mark}`, is_default: true, is_inactive: false });
    await db('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'High', created_by: adminId, order_number: 10 });
    await db('statuses').insert({ tenant, status_id: openStatusId, board_id: boardId, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, created_by: adminId, order_number: 10 });
    await db('statuses').insert({ tenant, status_id: closedStatusId, board_id: boardId, name: 'Closed', status_type: 'ticket', is_closed: true, is_default: false, created_by: adminId, order_number: 20 });

    // Client A: 2 open + 1 closed. Client B: 3 open.
    ticketIds.a1 = await insertTicket(clients.a, contacts.a);
    ticketIds.a2 = await insertTicket(clients.a, null);
    ticketIds.a3 = await insertTicket(clients.a, contacts.a, { closed: true });
    ticketIds.b1 = await insertTicket(clients.b, contacts.b);
    ticketIds.b2 = await insertTicket(clients.b, contacts.b);
    ticketIds.b3 = await insertTicket(clients.b, null);
    await tagTicket(ticketIds.a1, tag.a);
    await tagTicket(ticketIds.b1, tag.b);

    // A bundle whose master is in A and whose children span A and B.
    master = await insertTicket(clients.a, contacts.a);
    ticketIds.childA = await insertTicket(clients.a, contacts.a, { masterId: master });
    ticketIds.childB1 = await insertTicket(clients.b, contacts.b, { masterId: master });
    ticketIds.childB2 = await insertTicket(clients.b, contacts.b, { masterId: master });

    // The restricted user reads tickets of client A only.
    const bundle = await createAuthorizationBundle(db, { tenant, name: `ticket-client-a-${mark}`, actorUserId: adminId });
    await upsertBundleRule(db, {
      tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
      resourceType: 'ticket', action: 'read', templateKey: 'selected_clients',
      config: { selectedClientIds: [clients.a] }, actorUserId: adminId,
    });
    await publishBundleRevision(db as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: adminId });
    await createBundleAssignment(db, { tenant, bundleId: bundle.bundleId, targetType: 'user', targetId: restrictedId, actorUserId: adminId });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  describe('form options', () => {
    it.each([['restricted', () => restrictedId], ['unrestricted', () => unrestrictedId]])(
      'lists internal staff only for the %s subject, in form options and in new-ticket data',
      async (_label, who) => {
        asUser(who());
        const options: any = await getTicketFormOptions();
        const optionUserIds = [...options.users.map((u: any) => u.user_id), ...options.agentOptions.map((o: any) => o.value)];
        expect(optionUserIds).toContain(adminId);
        for (const portalId of portalIds) expect(optionUserIds).not.toContain(portalId);
        expect(options.users.every((u: any) => u.user_type === 'internal')).toBe(true);

        // The users model reads the tenant from the request context, as it does under a real session.
        const formData = await runWithTenant(tenant, () => getTicketFormData());
        const formUserIds = formData.users.map((u) => u.user_id);
        expect(formUserIds).toContain(adminId);
        for (const portalId of portalIds) expect(formUserIds).not.toContain(portalId);
      }
    );

    it('offers tag text only from readable tickets to the restricted subject', async () => {
      asUser(restrictedId);
      const options: any = await getTicketFormOptions();
      const texts = options.tags.map((t: any) => t.tag_text);
      expect(texts).toContain(tag.a);
      expect(texts).not.toContain(tag.b);
    });

    it('offers every ticket tag to the unrestricted subject', async () => {
      asUser(unrestrictedId);
      const options: any = await getTicketFormOptions();
      const texts = options.tags.map((t: any) => t.tag_text);
      expect(texts).toContain(tag.a);
      expect(texts).toContain(tag.b);
    });
  });

  describe('counts equal the subject\'s own list', () => {
    it('client open-ticket counts equal the open ticket list per client', async () => {
      for (const who of [restrictedId, unrestrictedId]) {
        asUser(who);
        const counts = await getClientOpenTicketCounts([clients.a, clients.b]);
        for (const key of ['a', 'b'] as const) {
          const list = await listFor({ clientId: clients[key], showOpenOnly: true, statusId: undefined as any });
          expect(counts[clients[key]] ?? 0).toBe(list.totalCount);
        }
      }
      asUser(restrictedId);
      const restricted = await getClientOpenTicketCounts([clients.a, clients.b]);
      expect(restricted[clients.b]).toBeUndefined();
      expect(restricted[clients.a]).toBeGreaterThan(0);
      asUser(unrestrictedId);
      const full = await getClientOpenTicketCounts([clients.a, clients.b]);
      // b1..b3 plus the two client-B children of the bundle.
      expect(full[clients.b]).toBe(5);
    });

    it('contact ticket stats equal the ticket list per contact', async () => {
      for (const who of [restrictedId, unrestrictedId]) {
        asUser(who);
        for (const key of ['a', 'b'] as const) {
          const stats: any = await getContactStats(contacts[key]);
          const all = await listFor({ contactId: contacts[key] });
          const open = await listFor({ contactId: contacts[key], showOpenOnly: true, statusId: undefined as any });
          expect(stats.totalTickets).toBe(all.totalCount);
          expect(stats.openTickets).toBe(open.totalCount);
        }
      }
    });

    it('client pulse service figures equal the open ticket list per client', async () => {
      for (const who of [restrictedId, unrestrictedId]) {
        asUser(who);
        for (const key of ['a', 'b'] as const) {
          const pulse: any = await getClientPulse(clients[key]);
          const open = await listFor({ clientId: clients[key], showOpenOnly: true, statusId: undefined as any });
          expect(pulse.service.openCount).toBe(open.totalCount);
        }
      }
    });

    it('dashboard tiles equal the open ticket list', async () => {
      for (const who of [restrictedId, unrestrictedId]) {
        asUser(who);
        const summary = await getAlgaDeskDashboardSummary();
        const open = await listFor({ showOpenOnly: true, statusId: undefined as any });
        const all = await listFor({});
        expect(summary.openTickets).toBe(open.totalCount);
        expect(summary.aging.under2Days + summary.aging.days2To7 + summary.aging.over7Days).toBe(open.totalCount);
        expect(summary.recentTickets.length).toBe(Math.min(5, all.totalCount));
        const readableIds = new Set(all.tickets.map((t) => t.ticket_id));
        for (const recent of summary.recentTickets) expect(readableIds.has(recent.ticketId)).toBe(true);
      }
    });

    it('bundle child statistics count only children the subject can read', async () => {
      for (const who of [restrictedId, unrestrictedId]) {
        asUser(who);
        const children: any = await fetchBundleChildrenForMaster(master);
        const childRows: any[] = children.rows ?? children.tickets ?? children;
        const openChildren = childRows.filter((row) => !row.closed_at).length;

        const bundled = await listFor({ bundleView: 'bundled' });
        const masterRow = bundled.tickets.find((t) => t.ticket_id === master);
        expect(masterRow).toBeTruthy();
        expect(masterRow.bundle_child_count).toBe(childRows.length);
        expect(masterRow.bundle_open_child_count).toBe(openChildren);

        const context: any = await getBundleMasterClosedContextAction({ masterTicketId: master });
        expect(context.openChildrenCount).toBe(openChildren);
      }
      asUser(restrictedId);
      const restricted: any = await getBundleMasterClosedContextAction({ masterTicketId: master });
      expect(restricted.openChildrenCount).toBe(1);
      asUser(unrestrictedId);
      const full: any = await getBundleMasterClosedContextAction({ masterTicketId: master });
      expect(full.openChildrenCount).toBe(3);
    });

    it('the restricted subject\'s list holds no client B ticket, the unrestricted one holds both', async () => {
      asUser(restrictedId);
      const restricted = mine((await listFor({})).tickets);
      expect(restricted.every((t) => t.client_id === clients.a)).toBe(true);
      asUser(unrestrictedId);
      const full = mine((await listFor({})).tickets);
      expect(new Set(full.map((t) => t.client_id))).toEqual(new Set([clients.a, clients.b]));
    });
  });
});
