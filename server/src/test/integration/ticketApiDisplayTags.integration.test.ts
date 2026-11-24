import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getConnection: vi.fn(async () => dbRef.knex),
}));

vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getTicketAttributes: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: vi.fn(() => ({ publish: vi.fn() })),
  ServerEventPublisher: class {},
}));

vi.mock('@alga-psa/analytics', () => ({
  captureAnalytics: vi.fn(),
  ServerAnalyticsTracker: class {},
  analytics: { capture: vi.fn() },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('../../../../packages/tickets/src/lib/liveUpdates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishTicketUpdate: vi.fn(),
}));

import { TicketService } from '../../lib/api/services/TicketService';
import { ContactService } from '../../lib/api/services/ContactService';
import { ClientService } from '../../lib/api/services/ClientService';
import { tenantDb } from '@alga-psa/db';
import { createCloseRulesFixture, insertTicket, type CloseRulesFixture } from './helpers/closeRulesFixture';

const HOOK_TIMEOUT = 240_000;

let db: Knex;
let fixture: CloseRulesFixture;
let ticketId: string;

const defs = {
  contactVip: uuidv4(),
  contactBilling: uuidv4(),
  clientVip: uuidv4(),
  clientGold: uuidv4(),
};

/**
 * The REST ticket, contact and client reads are what the mobile app uses. They must carry the same
 * chip tags the web ticket list and pickers show (PR #3858): the party's tags restricted to the
 * caller audience's tag display rules, in rule order, and nothing when no rule exists.
 *
 * Fixture: the contact is tagged VIP (ruled) and Billing (unruled); the client is tagged VIP
 * (ruled) and Gold (unruled). Internal rules: contact [VIP], client [VIP].
 */
describe('REST chip tags (contact_tags / client_tags / display_tags)', () => {
  const serviceContext = () =>
    ({ tenant: fixture.tenantId, userId: fixture.userId, user: userRef.user }) as any;
  const ticketService = new TicketService();

  const tagged = (tags: any) => (tags as Array<{ tag_text: string }>).map((tag) => tag.tag_text);

  beforeAll(async () => {
    db = await createTestDbConnection();
    dbRef.knex = db;

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of seeded internal user for chip tag integration')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    dbRef.tenant = seededUser.tenant;
    userRef.user = {
      user_id: seededUser.user_id,
      user_type: 'internal',
      first_name: seededUser.first_name ?? 'Test',
      last_name: seededUser.last_name ?? 'User',
      username: seededUser.username,
    };

    fixture = await createCloseRulesFixture(db, seededUser.tenant, seededUser.user_id);
    const tenant = fixture.tenantId;
    await db('tag_definitions').insert([
      { tenant, tag_id: defs.contactVip, tag_text: 'VIP', tagged_type: 'contact', background_color: '#fef3c7', text_color: '#92400e' },
      { tenant, tag_id: defs.contactBilling, tag_text: 'Billing', tagged_type: 'contact' },
      { tenant, tag_id: defs.clientVip, tag_text: 'VIP', tagged_type: 'client' },
      { tenant, tag_id: defs.clientGold, tag_text: 'Gold', tagged_type: 'client' },
    ]);
    await db('tag_mappings').insert([
      { tenant, tag_id: defs.contactVip, tagged_id: fixture.contactId, tagged_type: 'contact' },
      { tenant, tag_id: defs.contactBilling, tagged_id: fixture.contactId, tagged_type: 'contact' },
      { tenant, tag_id: defs.clientVip, tagged_id: fixture.clientId, tagged_type: 'client' },
      { tenant, tag_id: defs.clientGold, tagged_id: fixture.clientId, tagged_type: 'client' },
    ]);
    await db('tag_display_rules').insert([
      { tenant, tagged_type: 'contact', audience: 'internal', tag_id: defs.contactVip, position: 0 },
      { tenant, tagged_type: 'client', audience: 'internal', tag_id: defs.clientVip, position: 0 },
    ]);
    ticketId = await insertTicket(db, fixture);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (db && fixture) {
      const tenant = fixture.tenantId;
      const ids = Object.values(defs);
      // Rules are tenant-wide: leave none behind for the other suites sharing this tenant.
      await db('tag_display_rules').where({ tenant }).whereIn('tag_id', ids).del();
      await db('tag_mappings').where({ tenant }).whereIn('tag_id', ids).del();
      await db('tag_definitions').where({ tenant }).whereIn('tag_id', ids).del();
    }
    await db?.destroy().catch(() => undefined);
  });

  const listRow = async (fields: string[]) => {
    const result = await ticketService.list(
      { page: 1, limit: 100, filters: { board_id: fixture.boardId } as any, fields },
      serviceContext()
    );
    const row = (result.data as any[]).find((ticket) => ticket.ticket_id === ticketId);
    expect(row).toBeTruthy();
    return row;
  };

  it('mobile_list rows carry only the ruled contact and client tags, with their colors', async () => {
    const row = await listRow(['mobile_list']);
    expect(row.contact_tags).toEqual([
      expect.objectContaining({ tag_id: defs.contactVip, tag_text: 'VIP', background_color: '#fef3c7', text_color: '#92400e' }),
    ]);
    expect(tagged(row.client_tags)).toEqual(['VIP']);
  });

  it('chip tags are opt-in: a narrower field selection does not load them', async () => {
    const row = await listRow(['ticket_id', 'title']);
    expect(row).not.toHaveProperty('contact_tags');
    expect(row).not.toHaveProperty('client_tags');
  });

  it('the ticket detail, contact and client reads carry the same chips', async () => {
    const detail: any = await ticketService.getById(ticketId, serviceContext());
    expect(tagged(detail.contact_tags)).toEqual(['VIP']);
    expect(tagged(detail.client_tags)).toEqual(['VIP']);

    const contact: any = await new ContactService().getById(fixture.contactId, serviceContext());
    expect(contact.display_tags.map((tag: any) => tag.tag_id)).toEqual([defs.contactVip]);

    const client: any = await new ClientService().getById(fixture.clientId, serviceContext());
    expect(client.display_tags.map((tag: any) => tag.tag_id)).toEqual([defs.clientVip]);
  });

  it('the contact and client lists (picker rows) carry display_tags per row', async () => {
    const contacts = await new ContactService().list(
      { page: 1, limit: 100, filters: { client_id: fixture.clientId } as any },
      serviceContext()
    );
    const contactRow: any = contacts.data.find((row: any) => row.contact_name_id === fixture.contactId);
    expect(contactRow).toBeTruthy();
    expect(contactRow.display_tags.map((tag: any) => tag.tag_id)).toEqual([defs.contactVip]);

    const clients = await new ClientService().list(
      { page: 1, limit: 1000, filters: {} as any, sort: 'created_at', order: 'desc' },
      serviceContext()
    );
    const clientRow: any = clients.data.find((row: any) => row.client_id === fixture.clientId);
    expect(clientRow).toBeTruthy();
    expect(clientRow.display_tags.map((tag: any) => tag.tag_id)).toEqual([defs.clientVip]);
  });

  it('rule order decides the chip order, and no rules means no chips', async () => {
    await db('tag_display_rules').insert({
      tenant: fixture.tenantId, tagged_type: 'client', audience: 'internal', tag_id: defs.clientGold, position: 1,
    });
    try {
      const row = await listRow(['mobile_list']);
      expect(row.client_tags.map((tag: any) => tag.tag_id)).toEqual([defs.clientVip, defs.clientGold]);
    } finally {
      await db('tag_display_rules').where({ tenant: fixture.tenantId, tag_id: defs.clientGold }).del();
    }

    const rules = await db('tag_display_rules').where({ tenant: fixture.tenantId }).whereIn('tag_id', Object.values(defs));
    await db('tag_display_rules').where({ tenant: fixture.tenantId }).whereIn('tag_id', Object.values(defs)).del();
    try {
      const row = await listRow(['mobile_list']);
      expect(row.contact_tags).toEqual([]);
      expect(row.client_tags).toEqual([]);
      const contact: any = await new ContactService().getById(fixture.contactId, serviceContext());
      expect(contact.display_tags).toEqual([]);
    } finally {
      await db('tag_display_rules').insert(rules);
    }
  });
});
