import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { TICKET_STATUS_FILTER_ALL } from '@alga-psa/tickets/lib';
import type { ITicketListFilters } from '@alga-psa/types';

/**
 * Chip tag hydration (T019, T020): list rows and expanded bundle children carry contact_tags and
 * client_tags restricted to the caller audience's display rules, in rule order.
 *
 * Fixture: client c1 tagged VIP (ruled) and Gold (unruled); contact k1 tagged VIP (ruled) and
 * Billing (unruled); contact k2 untagged. Internal rules: contact [VIP], client [VIP]. No client rules.
 *   A  c1/k1      B  c1/k2      M master (c1/k2) with child CH (c1/k1, ticket tag urgent)
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

const ids = { tenant: uuidv4(), actor: uuidv4(), c1: uuidv4(), k1: uuidv4(), k2: uuidv4(), A: uuidv4(), B: uuidv4(), M: uuidv4(), CH: uuidv4() };
const defs = {
  contactVip: uuidv4(), contactBilling: uuidv4(), clientVip: uuidv4(), clientGold: uuidv4(), urgent: uuidv4(),
};

const base: ITicketListFilters = {
  boardFilterState: 'all',
  statusId: TICKET_STATUS_FILTER_ALL,
  showOpenOnly: false,
  bundleView: 'individual',
};

async function seed() {
  const { tenant, actor } = ids;
  await db('tenants').insert({ tenant, client_name: `Chips ${tenant.slice(0, 8)}`, email: `chips-${tenant.slice(0, 8)}@example.com`, product_code: 'psa' });
  await db('users').insert({
    tenant, user_id: actor, username: `actor-${actor.slice(0, 8)}`, hashed_password: 'not-used',
    email: `actor-${actor.slice(0, 8)}@example.com`, first_name: 'Actor', last_name: 'Chips',
    user_type: 'internal', is_inactive: false, timezone: 'UTC',
  });
  const board = uuidv4();
  const status = uuidv4();
  const priority = uuidv4();
  await db('boards').insert({ tenant, board_id: board, board_name: 'B', is_default: true, is_inactive: false });
  await db('statuses').insert({ tenant, status_id: status, board_id: board, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, created_by: actor, order_number: 10 });
  await db('priorities').insert({ tenant, priority_id: priority, priority_name: 'High', created_by: actor, order_number: 10 });
  await db('clients').insert({ tenant, client_id: ids.c1, client_name: 'Client One', is_inactive: false });
  await db('contacts').insert([
    { tenant, contact_name_id: ids.k1, client_id: ids.c1, full_name: 'Kay One', email: 'k1@example.com' },
    { tenant, contact_name_id: ids.k2, client_id: ids.c1, full_name: 'Kay Two', email: 'k2@example.com' },
  ]);
  await db('tag_definitions').insert([
    { tenant, tag_id: defs.contactVip, tag_text: 'VIP', tagged_type: 'contact', background_color: '#fef3c7', text_color: '#92400e' },
    { tenant, tag_id: defs.contactBilling, tag_text: 'Billing', tagged_type: 'contact' },
    { tenant, tag_id: defs.clientVip, tag_text: 'VIP', tagged_type: 'client' },
    { tenant, tag_id: defs.clientGold, tag_text: 'Gold', tagged_type: 'client' },
    { tenant, tag_id: defs.urgent, tag_text: 'urgent', tagged_type: 'ticket' },
  ]);
  await db('tag_mappings').insert([
    { tenant, tag_id: defs.contactVip, tagged_id: ids.k1, tagged_type: 'contact' },
    { tenant, tag_id: defs.contactBilling, tagged_id: ids.k1, tagged_type: 'contact' },
    { tenant, tag_id: defs.clientVip, tagged_id: ids.c1, tagged_type: 'client' },
    { tenant, tag_id: defs.clientGold, tagged_id: ids.c1, tagged_type: 'client' },
  ]);
  await db('tag_display_rules').insert([
    { tenant, tagged_type: 'contact', audience: 'internal', tag_id: defs.contactVip, position: 0 },
    { tenant, tagged_type: 'client', audience: 'internal', tag_id: defs.clientVip, position: 0 },
  ]);
  const t = (id: string, n: number, contact: string, extra: Record<string, unknown> = {}) => ({
    tenant, ticket_id: id, ticket_number: `CH-${n}`, title: `Ticket ${n}`, client_id: ids.c1, contact_name_id: contact,
    board_id: board, status_id: status, priority_id: priority, entered_by: actor,
    entered_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)), ...extra,
  });
  await db('tickets').insert([t(ids.M, 1, ids.k2), t(ids.A, 2, ids.k1), t(ids.B, 3, ids.k2)]);
  await db('tickets').insert(t(ids.CH, 4, ids.k1, { master_ticket_id: ids.M }));
  await db('tag_mappings').insert({ tenant, tag_id: defs.urgent, tagged_id: ids.CH, tagged_type: 'ticket' });
}

describeDb('ticket chip tag hydration (DB)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ runSeeds: false });
    optimized = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    await seed();
    authMocks.hasPermission.mockImplementation(async () => true);
    authMocks.tenant = ids.tenant;
    authMocks.user = { user_id: ids.actor, user_type: 'internal', tenant: ids.tenant };
  }, 300000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, 60000);

  const rowsById = async () => {
    const result: any = await optimized.getTicketsForList(base, 1, 50);
    expect(result.tickets).toBeDefined();
    return new Map<string, any>(result.tickets.map((row: any) => [row.ticket_id, row]));
  };

  it('T019: rows carry only the internal-ruled contact and client tags, with colors', async () => {
    const rows = await rowsById();
    const a = rows.get(ids.A);
    expect(a.contact_tags).toEqual([expect.objectContaining({ tag_id: defs.contactVip, tag_text: 'VIP', background_color: '#fef3c7', text_color: '#92400e' })]);
    expect(a.client_tags.map((t: any) => t.tag_text)).toEqual(['VIP']);
    const b = rows.get(ids.B);
    expect(b.contact_tags).toEqual([]);
    expect(b.client_tags.map((t: any) => t.tag_text)).toEqual(['VIP']);
  });

  it('T019: a client-audience load returns no chip tags without a client rule, and follows one once it exists', async () => {
    const { loadDisplayTagsForEntities, displayTagKey } = await import('../../../../packages/tags/src/lib/loadDisplayTags');
    const { displayAudienceForUser } = await import('../../../../packages/tags/src/lib/tagDisplayRules');
    const audience = displayAudienceForUser({ user_type: 'client' });
    expect(audience).toBe('client');
    const refs = [
      { taggedType: 'contact' as const, ids: [ids.k1] },
      { taggedType: 'client' as const, ids: [ids.c1] },
    ];

    // Same tagged entities as the internal test above; the internal rules must not leak to clients.
    expect((await loadDisplayTagsForEntities(db, ids.tenant, audience, refs)).size).toBe(0);

    await db('tag_display_rules').insert({ tenant: ids.tenant, tagged_type: 'client', audience: 'client', tag_id: defs.clientGold, position: 0 });
    try {
      const loaded = await loadDisplayTagsForEntities(db, ids.tenant, audience, refs);
      expect(loaded.get(displayTagKey('client', ids.c1))?.map((t) => t.tag_text)).toEqual(['Gold']);
      expect(loaded.has(displayTagKey('contact', ids.k1))).toBe(false);
    } finally {
      await db('tag_display_rules').where({ tenant: ids.tenant, audience: 'client' }).del();
    }
  });

  it('T019: rows served to a client-portal user never carry the internal chip tags', async () => {
    const portalUser = uuidv4();
    await db('users').insert({
      tenant: ids.tenant, user_id: portalUser, username: `portal-${portalUser.slice(0, 8)}`, hashed_password: 'not-used',
      email: `portal-${portalUser.slice(0, 8)}@example.com`, first_name: 'Portal', last_name: 'User', user_type: 'client', is_inactive: false,
    });
    authMocks.user = { user_id: portalUser, user_type: 'client', clientId: ids.c1, tenant: ids.tenant };
    try {
      const rows = await rowsById();
      for (const row of rows.values()) {
        expect(row.contact_tags).toEqual([]);
        expect(row.client_tags).toEqual([]);
      }
    } finally {
      authMocks.user = { user_id: ids.actor, user_type: 'internal', tenant: ids.tenant };
    }
  });

  it('T020: expanded bundle children include contact name, avatar and logo fields, ticket tags and chip tags', async () => {
    const result: any = await optimized.fetchBundleChildrenForMaster(ids.M);
    expect(result.tickets).toHaveLength(1);
    const child = result.tickets[0];
    expect(child.ticket_id).toBe(ids.CH);
    expect(child.contact_name).toBe('Kay One');
    expect(child).toHaveProperty('contact_avatar_url');
    expect(child).toHaveProperty('client_logo_url');
    expect(child.contact_tags.map((t: any) => t.tag_text)).toEqual(['VIP']);
    expect(child.client_tags.map((t: any) => t.tag_text)).toEqual(['VIP']);
    expect(result.metadata.ticketTags[ids.CH].map((t: any) => t.tag_text)).toEqual(['urgent']);
  });
});
