import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import pg from 'pg';

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

  it('display rules add no database round trips to listing or opening tickets', async () => {
    // Warm module/auth caches before measuring the real PostgreSQL calls across all pools.
    await rowsById();
    await optimized.getConsolidatedTicketData(ids.A);
    const rules = await db('tag_display_rules').where({ tenant: ids.tenant });
    const queries = vi.spyOn(pg.Client.prototype, 'query');
    const read = async () => {
      queries.mockClear();
      const rows = await rowsById();
      const listStatements = queries.mock.calls.length;
      queries.mockClear();
      const detail = await optimized.getConsolidatedTicketData(ids.A);
      const openStatements = queries.mock.calls.length;
      expect(listStatements).toBeGreaterThan(0);
      expect(openStatements).toBeGreaterThan(0);
      expect(detail.ticket.ticket_id).toBe(ids.A);
      return { rows, detail, listStatements, openStatements };
    };
    try {
      const enabled = await read();
      expect(enabled.rows.get(ids.A).contact_tags.map((t: any) => t.tag_id)).toEqual([defs.contactVip]);
      expect(enabled.detail.displayTags.contact.map((t: any) => t.tag_id)).toEqual([defs.contactVip]);
      expect(enabled.detail.displayTags.client.map((t: any) => t.tag_id)).toEqual([defs.clientVip]);
      expect(enabled.detail.contacts.find((c: any) => c.contact_name_id === ids.k1).displayTags)
        .toEqual(enabled.detail.displayTags.contact);
      expect(enabled.detail.contacts.find((c: any) => c.contact_name_id === ids.k2).displayTags).toEqual([]);

      await db('tag_display_rules').where({ tenant: ids.tenant }).del();
      const disabled = await read();
      expect(disabled.detail.displayTags).toEqual({ contact: [], client: [] });
      for (const row of disabled.rows.values()) {
        expect(row.contact_tags).toEqual([]);
        expect(row.client_tags).toEqual([]);
      }
      expect(enabled.listStatements).toBe(disabled.listStatements);
      expect(enabled.openStatements).toBe(disabled.openStatements);
    } finally {
      queries.mockRestore();
      await db('tag_display_rules').where({ tenant: ids.tenant }).del();
      await db('tag_display_rules').insert(rules);
    }
  });

  it('by-id loads preserve list rows and metadata, request order, deduplication and filters', async () => {
    const listed: any = await optimized.getTicketsForList(base, 1, 50);
    expect(listed.tickets).toHaveLength(4);
    const reloaded: any = await optimized.loadTicketListItemsByIds(base, [ids.CH, ids.A, ids.CH, uuidv4()]);
    expect(reloaded.tickets).toEqual([ids.CH, ids.A].map(id =>
      listed.tickets.find((row: any) => row.ticket_id === id)
    ));
    expect(reloaded.metadata).toEqual(listed.metadata);
    expect(reloaded.metadata.ticketTags[ids.CH]).toEqual([
      expect.objectContaining({ tag_text: 'urgent', tagged_id: ids.CH, tagged_type: 'ticket' }),
    ]);
    const filtered: any = await optimized.loadTicketListItemsByIds(
      { ...base, contactId: ids.k2 }, [ids.A, ids.B, ids.CH]
    );
    expect(filtered.tickets).toEqual([listed.tickets.find((row: any) => row.ticket_id === ids.B)]);

    authMocks.hasPermission.mockResolvedValue(false);
    try {
      expect(await optimized.loadTicketListItemsByIds(base, [ids.A]))
        .toMatchObject({ permissionError: expect.any(String) });
    } finally {
      authMocks.hasPermission.mockResolvedValue(true);
    }
  });

  it('projected tags follow rule order on list rows, reloaded rows and ticket details', async () => {
    await db('tag_display_rules').insert({
      tenant: ids.tenant, tagged_type: 'client', audience: 'internal', tag_id: defs.clientGold, position: 1,
    });
    try {
      const rows = await rowsById();
      const reloaded: any = await optimized.loadTicketListItemsByIds(base, [ids.A]);
      const detail = await optimized.getConsolidatedTicketData(ids.A);
      const expected = [defs.clientVip, defs.clientGold];
      expect(rows.get(ids.A).client_tags.map((t: any) => t.tag_id)).toEqual(expected);
      expect(reloaded.tickets[0].client_tags.map((t: any) => t.tag_id)).toEqual(expected);
      expect(detail.displayTags.client.map((t: any) => t.tag_id)).toEqual(expected);
    } finally {
      await db('tag_display_rules').where({ tenant: ids.tenant, tag_id: defs.clientGold }).del();
    }
  });

  it('display-tag projections and batch loads isolate tenants even when entity and tag ids collide', async () => {
    const { displayTagsForEntityQuery } = await import('../../../../packages/tags/src/lib/displayTagsQuery');
    const { loadDisplayTagsForEntities, displayTagKey } = await import('../../../../packages/tags/src/lib/loadDisplayTags');
    const trx = await db.transaction();
    try {
      const otherTenant = uuidv4();
      await trx('tenants').insert({ tenant: otherTenant, client_name: 'Other tenant', email: 'other@example.com', product_code: 'psa' });
      await trx('tag_definitions').insert({ tenant: otherTenant, tag_id: defs.clientVip, tag_text: 'Other VIP', tagged_type: 'client' });
      await trx('tag_mappings').insert({ tenant: otherTenant, tag_id: defs.clientVip, tagged_id: ids.c1, tagged_type: 'client' });
      await trx('tag_display_rules').insert({ tenant: otherTenant, tagged_type: 'client', audience: 'internal', tag_id: defs.clientVip, position: 0 });

      for (const [tenant, text] of [[ids.tenant, 'VIP'], [otherTenant, 'Other VIP']]) {
        const entity = trx.select(trx.raw('?::uuid as client_id', [ids.c1])).as('c');
        const projected = await trx.from(entity)
          .select(displayTagsForEntityQuery(trx, tenant, 'internal', 'client', 'c.client_id').as('tags')).first();
        const loaded = await loadDisplayTagsForEntities(trx, tenant, 'internal', [{ taggedType: 'client', ids: [ids.c1] }]);
        expect(projected.tags.map((t: any) => t.tag_text)).toEqual([text]);
        expect(projected.tags).toEqual(loaded.get(displayTagKey('client', ids.c1)));
      }
    } finally {
      await trx.rollback();
    }
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
    const groupId = uuidv4();
    const { board_id } = await db('tickets').where({ tenant: ids.tenant, ticket_id: ids.A }).first('board_id');
    await db('client_portal_visibility_groups').insert({
      tenant: ids.tenant, group_id: groupId, client_id: ids.c1, name: 'Own tickets', ticket_scope: 'contact',
    });
    await db('client_portal_visibility_group_boards').insert({ tenant: ids.tenant, group_id: groupId, board_id });
    await db('contacts').where({ tenant: ids.tenant, contact_name_id: ids.k1 })
      .update({ portal_visibility_group_id: groupId });
    await db('users').insert({
      tenant: ids.tenant, user_id: portalUser, username: `portal-${portalUser.slice(0, 8)}`, hashed_password: 'not-used',
      email: `portal-${portalUser.slice(0, 8)}@example.com`, first_name: 'Portal', last_name: 'User', user_type: 'client', is_inactive: false, contact_id: ids.k1,
    });
    authMocks.user = { user_id: portalUser, user_type: 'client', clientId: ids.c1, contact_id: ids.k1, tenant: ids.tenant };
    try {
      const rows = await rowsById();
      expect(rows.has(ids.A)).toBe(true);
      expect(rows.has(ids.B)).toBe(false);
      for (const row of rows.values()) {
        expect(row.contact_tags).toEqual([]);
        expect(row.client_tags).toEqual([]);
      }
      const reloaded: any = await optimized.loadTicketListItemsByIds(base, [ids.A, ids.B]);
      expect(reloaded.tickets).toEqual([ids.A, ids.B]
        .filter(id => rows.has(id)).map(id => rows.get(id)));
      const detail = await optimized.getConsolidatedTicketData(ids.A);
      expect(detail.displayTags).toEqual({ contact: [], client: [] });
      expect(detail.contacts.every((c: any) => c.displayTags.length === 0)).toBe(true);

      await db('tag_display_rules').insert({ tenant: ids.tenant, tagged_type: 'client', audience: 'client', tag_id: defs.clientGold, position: 0 });
      const withClientRule = await rowsById();
      expect(withClientRule.get(ids.A).client_tags.map((t: any) => t.tag_id)).toEqual([defs.clientGold]);
      const clientDetail = await optimized.getConsolidatedTicketData(ids.A);
      expect(clientDetail.displayTags.client.map((t: any) => t.tag_id)).toEqual([defs.clientGold]);
      expect(clientDetail.displayTags.contact).toEqual([]);
    } finally {
      await db('tag_display_rules').where({ tenant: ids.tenant, audience: 'client' }).del();
      await db('contacts').where({ tenant: ids.tenant, contact_name_id: ids.k1 })
        .update({ portal_visibility_group_id: null });
      await db('client_portal_visibility_group_boards').where({ tenant: ids.tenant, group_id: groupId }).del();
      await db('client_portal_visibility_groups').where({ tenant: ids.tenant, group_id: groupId }).del();
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
