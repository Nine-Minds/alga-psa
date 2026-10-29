import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

/**
 * Ticket watchers against a real Postgres: the ticket_watchers table is the
 * source of truth, tickets.attributes.watch_list a derived mirror rewritten in the
 * same transaction under SELECT ... FOR UPDATE on the ticket row.
 *
 * Covers: contact / user / bare-email adds, case-insensitive idempotence, 422 / 404
 * mapping, pause / resume / remove, silent flag on the published event, UI server
 * actions, generic ticket update not bypassing the table, concurrent writers,
 * create-time seeding, and the migration backfill.
 */

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const userRef = vi.hoisted(() => ({ user: null as any }));
const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));
const publishWorkflowEventMock = vi.hoisted(() => vi.fn(async (..._args: any[]) => undefined));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getConnection: vi.fn(async () => dbRef.knex),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: hasPermissionMock }));
vi.mock('@alga-psa/auth/actions', () => ({ getTicketAttributes: vi.fn(async () => ({})) }));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: publishWorkflowEventMock,
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { tenantDb, withTransaction } from '@alga-psa/db';
import {
  TicketWatcherError,
  TicketWatcherService,
} from '../../../../shared/services/tickets/ticketWatcherService';
import { TicketService } from '../../lib/api/services/TicketService';
import { NotFoundError, UnprocessableEntityError } from '../../lib/api/middleware/apiMiddleware';
import {
  addTicketWatchers,
  removeTicketWatcher,
  setTicketWatcherActive,
} from '../../../../packages/tickets/src/actions/ticketWatcherActions';

const HOOK_TIMEOUT = 300_000;

let db: Knex;
let tenantId: string;
let otherTenantId: string;
let actorId: string;
let clientId: string;
let boardId: string;
let statusId: string;
let contactId: string;
let contactNoEmailId: string;
let otherTenantContactId: string;
let ticketId: string;
let dorothyEmail: string;
const service = new TicketService();

function scoped(table: string, tenant: string = tenantId) {
  return tenantDb(db, tenant).table(table);
}

async function insertTicket(attributes: unknown = null, tenant: string = tenantId): Promise<string> {
  const id = uuidv4();
  await scoped('tickets', tenant).insert({
    tenant,
    ticket_id: id,
    ticket_number: `TW-${id.slice(0, 8)}`,
    title: 'Watcher fixture ticket',
    client_id: clientId,
    board_id: tenant === tenantId ? boardId : null,
    status_id: tenant === tenantId ? statusId : null,
    entered_by: tenant === tenantId ? actorId : null,
    entered_at: new Date(),
    is_closed: false,
    attributes: attributes === null ? null : JSON.stringify(attributes),
  });
  return id;
}

async function tableRows(ticket: string = ticketId) {
  return scoped('ticket_watchers').where({ ticket_id: ticket }).orderBy('email').select('*');
}

async function mirror(ticket: string = ticketId): Promise<any[]> {
  const row = await scoped('tickets').where({ ticket_id: ticket }).first('attributes');
  const attrs = typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes;
  return attrs?.watch_list ?? [];
}

/** The mirror must always be exactly what the table says. */
async function expectMirrorMatchesTable(ticket: string = ticketId) {
  const rows = await tableRows(ticket);
  const list = await mirror(ticket);
  expect(list.map((e) => [e.email, e.active]).sort()).toEqual(rows.map((r) => [r.email, r.active]).sort());
}

const ctx = () => ({ userId: actorId, tenant: tenantId });

describe('ticket watchers', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    dbRef.knex = db;

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of a seeded internal user for the ticket watchers integration suite')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    tenantId = seededUser.tenant;
    dbRef.tenant = tenantId;
    actorId = seededUser.user_id;
    userRef.user = {
      user_id: seededUser.user_id,
      user_type: 'internal',
      first_name: seededUser.first_name ?? 'Test',
      last_name: seededUser.last_name ?? 'User',
      username: seededUser.username,
      tenant: tenantId,
    };

    const suffix = uuidv4().slice(0, 8);
    clientId = uuidv4();
    await scoped('clients').insert({ tenant: tenantId, client_id: clientId, client_name: `Watcher Client ${suffix}` });

    boardId = uuidv4();
    await scoped('boards').insert({
      tenant: tenantId,
      board_id: boardId,
      board_name: `Watcher Board ${suffix}`,
      is_default: false,
      is_inactive: false,
      display_order: 997,
    });
    statusId = uuidv4();
    await scoped('statuses').insert({
      tenant: tenantId,
      status_id: statusId,
      board_id: boardId,
      name: 'Open',
      status_type: 'ticket',
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: actorId,
    });

    dorothyEmail = `Dorothy.Gale.${suffix}@Client.example`;
    contactId = uuidv4();
    contactNoEmailId = uuidv4();
    await scoped('contacts').insert([
      { tenant: tenantId, contact_name_id: contactId, full_name: 'Dorothy Gale', email: dorothyEmail, client_id: clientId },
      { tenant: tenantId, contact_name_id: contactNoEmailId, full_name: 'No Email', email: '', client_id: clientId },
    ]);

    otherTenantId = uuidv4();
    await db('tenants').insert({
      tenant: otherTenantId,
      client_name: `Other Tenant ${suffix}`,
      email: `other-${suffix}@example.test`,
    });
    const otherClientId = uuidv4();
    await scoped('clients', otherTenantId).insert({
      tenant: otherTenantId,
      client_id: otherClientId,
      client_name: `Other Client ${suffix}`,
    });
    otherTenantContactId = uuidv4();
    await scoped('contacts', otherTenantId).insert({
      tenant: otherTenantId,
      contact_name_id: otherTenantContactId,
      full_name: 'Other Tenant Contact',
      email: 'other@other-tenant.example',
      client_id: otherClientId,
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  beforeEach(async () => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    publishWorkflowEventMock.mockClear();
    ticketId = await insertTicket();
    // BaseService resolves its connection through packages/db's own createTenantKnex.
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  });

  describe('TicketWatcherService', () => {
    it('adds a client contact by contact_id, resolving email, name and entity server-side', async () => {
      const result = await withTransaction(db, (trx) =>
        TicketWatcherService.add(trx, tenantId, ticketId, { contact_id: contactId, source: 'manual' }, actorId));

      expect(result.changed).toBe(true);
      expect(result.watchers).toEqual([
        {
          email: dorothyEmail.toLowerCase(),
          name: 'Dorothy Gale',
          active: true,
          entity_type: 'contact',
          entity_id: contactId,
          source: 'manual',
        },
      ]);
      await expectMirrorMatchesTable();
      const [mirrored] = await mirror();
      expect(mirrored).toMatchObject({ email: dorothyEmail.toLowerCase(), entity_type: 'contact', entity_id: contactId });
    });

    it('adds an internal user by user_id and a bare external mailbox by email', async () => {
      await withTransaction(db, async (trx) => {
        await TicketWatcherService.add(trx, tenantId, ticketId, { user_id: actorId }, actorId);
        await TicketWatcherService.add(trx, tenantId, ticketId, { email: 'Ops@Vendor.Example', name: 'Vendor Ops' }, actorId);
      });

      const watchers = await withTransaction(db, (trx) => TicketWatcherService.list(trx, tenantId, ticketId));
      expect(watchers).toHaveLength(2);
      expect(watchers.find((w) => w.email === 'ops@vendor.example')).toMatchObject({
        name: 'Vendor Ops',
        entity_type: null,
        entity_id: null,
        active: true,
      });
      expect(watchers.find((w) => w.entity_type === 'user')).toMatchObject({ entity_id: actorId });
      await expectMirrorMatchesTable();
    });

    it('is an idempotent set-add keyed on case-insensitive email', async () => {
      const first = await withTransaction(db, (trx) =>
        TicketWatcherService.add(trx, tenantId, ticketId, { email: 'dup@vendor.example' }, actorId));
      const again = await withTransaction(db, (trx) =>
        TicketWatcherService.add(trx, tenantId, ticketId, { email: 'DUP@Vendor.example' }, actorId));
      const viaContact = await withTransaction(db, async (trx) => {
        await TicketWatcherService.add(trx, tenantId, ticketId, { email: dorothyEmail.toUpperCase() }, actorId);
        return TicketWatcherService.add(trx, tenantId, ticketId, { contact_id: contactId }, actorId);
      });

      expect(first.changed).toBe(true);
      expect(again.changed).toBe(false);
      expect(await tableRows()).toHaveLength(2);
      // Adding the same mailbox by contact_id fills in the entity instead of duplicating.
      expect(viaContact.watchers.find((w) => w.email === dorothyEmail.toLowerCase())).toMatchObject({
        entity_type: 'contact',
        entity_id: contactId,
      });
      await expectMirrorMatchesTable();
    });

    it('rejects unknown, other-tenant and email-less contacts / users without writing', async () => {
      const attempt = (input: Record<string, unknown>) =>
        withTransaction(db, (trx) => TicketWatcherService.add(trx, tenantId, ticketId, input as any, actorId));

      await expect(attempt({ contact_id: uuidv4() })).rejects.toMatchObject({ kind: 'contact_not_found' });
      await expect(attempt({ contact_id: otherTenantContactId })).rejects.toMatchObject({ kind: 'contact_not_found' });
      await expect(attempt({ contact_id: contactNoEmailId })).rejects.toMatchObject({ kind: 'entity_missing_email' });
      await expect(attempt({ user_id: uuidv4() })).rejects.toMatchObject({ kind: 'user_not_found' });
      await expect(attempt({ email: 'not-an-email' })).rejects.toMatchObject({ kind: 'invalid_email' });
      await expect(attempt({ contact_id: contactId })).resolves.toBeTruthy();
      expect(await tableRows()).toHaveLength(1);
    });

    it('treats a ticket from another tenant or a missing ticket as not found', async () => {
      const otherTicket = await insertTicket(null, otherTenantId);
      await expect(
        withTransaction(db, (trx) => TicketWatcherService.add(trx, tenantId, otherTicket, { email: 'a@b.example' }, actorId))
      ).rejects.toMatchObject({ kind: 'ticket_not_found' });
      await expect(
        withTransaction(db, (trx) => TicketWatcherService.list(trx, tenantId, uuidv4()))
      ).rejects.toBeInstanceOf(TicketWatcherError);
      expect(await tableRows(otherTicket)).toHaveLength(0);
    });

    it('pauses, resumes and removes a watcher; unknown email is watcher_not_found', async () => {
      await withTransaction(db, (trx) => TicketWatcherService.add(trx, tenantId, ticketId, { email: 'p@vendor.example' }, actorId));

      const paused = await withTransaction(db, (trx) =>
        TicketWatcherService.setActive(trx, tenantId, ticketId, 'P@Vendor.Example', false, actorId));
      expect(paused.watchers[0].active).toBe(false);
      expect((await mirror())[0].active).toBe(false);

      const resumed = await withTransaction(db, (trx) =>
        TicketWatcherService.setActive(trx, tenantId, ticketId, 'p@vendor.example', true, actorId));
      expect(resumed.watchers[0].active).toBe(true);

      await expect(
        withTransaction(db, (trx) => TicketWatcherService.setActive(trx, tenantId, ticketId, 'nobody@vendor.example', false, actorId))
      ).rejects.toMatchObject({ kind: 'watcher_not_found' });
      await expect(
        withTransaction(db, (trx) => TicketWatcherService.remove(trx, tenantId, ticketId, 'nobody@vendor.example', actorId))
      ).rejects.toMatchObject({ kind: 'watcher_not_found' });

      const removed = await withTransaction(db, (trx) =>
        TicketWatcherService.remove(trx, tenantId, ticketId, 'P@VENDOR.example', actorId));
      expect(removed.watchers).toEqual([]);
      expect(await mirror()).toEqual([]);
    });

    it('serializes concurrent writers on the ticket row: no lost watcher in table or mirror', async () => {
      const emails = Array.from({ length: 8 }, (_, i) => `racer${i}@vendor.example`);
      await Promise.all(
        emails.map((email) =>
          withTransaction(db, (trx) => TicketWatcherService.add(trx, tenantId, ticketId, { email }, actorId)))
      );

      expect((await tableRows()).map((r) => r.email)).toEqual([...emails].sort());
      expect((await mirror()).map((e) => e.email).sort()).toEqual([...emails].sort());
    });

    it('races the same email from several writers into a single row', async () => {
      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          withTransaction(db, (trx) =>
            TicketWatcherService.add(trx, tenantId, ticketId, { email: i % 2 ? 'Same@Vendor.example' : 'same@vendor.example' }, actorId)))
      );
      expect(await tableRows()).toHaveLength(1);
      expect(await mirror()).toHaveLength(1);
    });

    it('seeds the table from a create-time attributes.watch_list (normalized, deduped) and rewrites the mirror', async () => {
      const seededTicket = await insertTicket({
        description: 'kept',
        watch_list: [
          'Mixed@Case.example',
          { email: 'mixed@case.example', active: false, name: 'Mixed', source: 'inbound_cc' },
          { email: 'junk' },
        ],
      });
      await withTransaction(db, (trx) => TicketWatcherService.seedFromAttributes(trx, tenantId, seededTicket));

      const rows = await tableRows(seededTicket);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ email: 'mixed@case.example', active: true, name: 'Mixed', source: 'inbound_cc' });
      const row = await scoped('tickets').where({ ticket_id: seededTicket }).first('attributes');
      const attrs = typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes;
      expect(attrs.description).toBe('kept');
      expect(attrs.watch_list).toHaveLength(1);
    });
  });

  describe('REST layer (TicketService)', () => {
    const published = () => publishWorkflowEventMock.mock.calls.map((call) => call[0] as any);

    it('add returns the full list and publishes TICKET_UPDATED (non-silent)', async () => {
      await service.addWatcher(ticketId, { contact_id: contactId }, ctx());
      const list = await service.addWatcher(ticketId, { email: 'ops@vendor.example' }, ctx());

      expect(list.map((w) => w.email).sort()).toEqual([dorothyEmail.toLowerCase(), 'ops@vendor.example'].sort());
      const events = published().filter((e) => e.eventType === 'TICKET_UPDATED');
      expect(events).toHaveLength(2);
      expect(events[1].payload.changes).toEqual({});
      expect(events[1].payload.suppressContactNotifications).toBeFalsy();
      expect(events[1].payload.suppressInternalNotifications).toBeFalsy();
    });

    it('silent sets both suppression flags on the event and is never stored', async () => {
      await service.addWatcher(ticketId, { email: 'quiet@vendor.example', silent: true }, ctx());

      const [event] = published().filter((e) => e.eventType === 'TICKET_UPDATED');
      expect(event.payload.suppressContactNotifications).toBe(true);
      expect(event.payload.suppressInternalNotifications).toBe(true);
      const [stored] = await tableRows();
      expect(Object.keys(stored)).not.toContain('silent');
      expect(JSON.stringify(await mirror())).not.toContain('silent');
    });

    it('the published event: non-silent creates the in-app update notice, silent=true is skipped by the subscriber', async () => {
      const { internalNotificationSubscriberTestHarness } = await import(
        '../../lib/eventBus/subscribers/internalNotificationSubscriber'
      );
      // An assignee other than the actor receives staff 'ticket updated' notices.
      const [assignee] = await tenantDb(db, tenantId)
        .table('users')
        .where({ user_type: 'internal' })
        .whereNot({ user_id: actorId })
        .limit(1);
      if (!assignee) throw new Error('fixture needs a second internal user');
      await scoped('tickets').where({ ticket_id: ticketId }).update({ assigned_to: assignee.user_id });

      const countNotices = async () => {
        const row = await scoped('internal_notifications')
          .where({ user_id: assignee.user_id })
          .whereRaw("link like ?", ['%' + ticketId + '%'])
          .count<{ count: string }[]>('* as count')
          .first();
        return Number(row?.count ?? 0);
      };
      const deliver = async (event: any) =>
        internalNotificationSubscriberTestHarness.handleTicketUpdated(
          { id: uuidv4(), eventType: 'TICKET_UPDATED', timestamp: new Date().toISOString(), payload: { ...event.payload, tenantId } } as any,
          { db, propagateErrors: true }
        );

      await service.addWatcher(ticketId, { email: 'loud@vendor.example' }, ctx());
      await service.addWatcher(ticketId, { email: 'quiet@vendor.example', silent: true }, ctx());
      const [loud, quiet] = published().filter((e) => e.eventType === 'TICKET_UPDATED');

      const before = await countNotices();
      await deliver(quiet);
      expect(await countNotices()).toBe(before);
      await deliver(loud);
      expect(await countNotices()).toBe(before + 1);
    });

    it('does not publish for an idempotent re-add', async () => {
      await service.addWatcher(ticketId, { email: 'once@vendor.example' }, ctx());
      publishWorkflowEventMock.mockClear();
      const list = await service.addWatcher(ticketId, { email: 'ONCE@vendor.example' }, ctx());
      expect(list).toHaveLength(1);
      expect(published()).toHaveLength(0);
    });

    it('PATCH toggles active and returns the list; DELETE returns the list and 404s a non-member', async () => {
      await service.addWatcher(ticketId, { email: 'toggle@vendor.example' }, ctx());
      const paused = await service.setWatcherActive(ticketId, { email: 'Toggle@vendor.example', active: false }, ctx());
      expect(paused).toEqual([expect.objectContaining({ email: 'toggle@vendor.example', active: false })]);

      const afterDelete = await service.removeWatcher(ticketId, 'toggle@vendor.example', true, ctx());
      expect(afterDelete).toEqual([]);
      await expect(service.removeWatcher(ticketId, 'toggle@vendor.example', undefined, ctx())).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        service.setWatcherActive(ticketId, { email: 'toggle@vendor.example', active: true }, ctx())
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('maps unknown / other-tenant / email-less contacts to 422 and a missing or foreign ticket to 404', async () => {
      await expect(service.addWatcher(ticketId, { contact_id: otherTenantContactId }, ctx())).rejects.toBeInstanceOf(UnprocessableEntityError);
      await expect(service.addWatcher(ticketId, { contact_id: contactNoEmailId }, ctx())).rejects.toBeInstanceOf(UnprocessableEntityError);
      await expect(service.addWatcher(ticketId, { user_id: uuidv4() }, ctx())).rejects.toBeInstanceOf(UnprocessableEntityError);

      const foreignTicket = await insertTicket(null, otherTenantId);
      await expect(service.addWatcher(uuidv4(), { email: 'a@b.example' }, ctx())).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.addWatcher(foreignTicket, { email: 'a@b.example' }, ctx())).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.listWatchers(foreignTicket, ctx())).rejects.toBeInstanceOf(NotFoundError);
      expect(published()).toHaveLength(0);
    });

    it('a generic ticket update (PUT) ignores attributes.watch_list and preserves the mirror', async () => {
      await service.addWatcher(ticketId, { email: 'keep@vendor.example' }, ctx());

      await service.update(
        ticketId,
        { attributes: { note: 'edited', watch_list: [{ email: 'smuggled@evil.example', active: true }] } } as any,
        ctx()
      );
      await service.update(ticketId, { attributes: { note: 'wiped' } } as any, ctx());
      await service.update(ticketId, { attributes: null } as any, ctx());

      expect((await tableRows()).map((r) => r.email)).toEqual(['keep@vendor.example']);
      expect((await mirror()).map((e) => e.email)).toEqual(['keep@vendor.example']);
      const row = await scoped('tickets').where({ ticket_id: ticketId }).first('attributes');
      const attrs = typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes;
      expect(attrs.watch_list).toHaveLength(1);
    });
  });

  describe('UI server actions', () => {
    it('add / pause / remove go through the table and never rewrite the whole attributes object', async () => {
      const withNote = await insertTicket({ note: 'untouched by watcher writes' });

      const added: any = await addTicketWatchers(withNote, [
        { contact_id: contactId },
        { email: 'ui@vendor.example' },
        { user_id: actorId },
      ]);
      expect(added.watchers).toHaveLength(3);

      const paused: any = await setTicketWatcherActive(withNote, 'UI@vendor.example', false);
      expect(paused.watchers.find((w: any) => w.email === 'ui@vendor.example').active).toBe(false);

      const removed: any = await removeTicketWatcher(withNote, 'ui@vendor.example');
      expect(removed.watchers).toHaveLength(2);

      const row = await scoped('tickets').where({ ticket_id: withNote }).first('attributes');
      const attrs = typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes;
      expect(attrs.note).toBe('untouched by watcher writes');
      expect(attrs.watch_list).toHaveLength(2);
      await expectMirrorMatchesTable(withNote);

      const events = publishWorkflowEventMock.mock.calls.map((c) => c[0] as any).filter((e) => e.eventType === 'TICKET_UPDATED');
      expect(events).toHaveLength(3);
    });

    it('returns an error result (not a throw) for an unknown contact and requires ticket:update', async () => {
      const bad: any = await addTicketWatchers(ticketId, [{ contact_id: uuidv4() }]);
      expect(bad.error ?? bad.message ?? JSON.stringify(bad)).toMatch(/not found/i);
      expect(await tableRows()).toHaveLength(0);

      hasPermissionMock.mockResolvedValue(false);
      await expect(addTicketWatchers(ticketId, [{ email: 'x@y.example' }])).rejects.toThrow(/Permission denied/);
      expect(await tableRows()).toHaveLength(0);
    });
  });

  describe('no-op writes leave tickets.updated_at / updated_by alone', () => {
    const PAST = new Date('2020-01-02T03:04:05.000Z');
    let pastUser: string;

    async function pinTicketStamp() {
      pastUser = actorId;
      await scoped('tickets').where({ ticket_id: ticketId }).update({ updated_at: PAST, updated_by: pastUser });
    }
    async function expectStampUntouched() {
      const row = await scoped('tickets').where({ ticket_id: ticketId }).first('updated_at', 'updated_by');
      expect(new Date(row.updated_at).toISOString()).toBe(PAST.toISOString());
      expect(row.updated_by).toBe(pastUser);
    }
    const inTrx = <T,>(fn: (trx: Knex.Transaction) => Promise<T>) => withTransaction(db, fn);

    beforeEach(async () => {
      // Seed with a real add, then pin the stamp to a known past value.
      await service.addWatcher(ticketId, { email: 'Steady@Vendor.example', name: 'Steady' }, ctx());
      await service.addWatcher(ticketId, { contact_id: contactId }, ctx());
      await pinTicketStamp();
      publishWorkflowEventMock.mockClear();
    });

    it('re-adding an existing watcher (same and different case) does not touch the ticket or the watcher row', async () => {
      const rowsBefore = await tableRows();
      for (const email of ['steady@vendor.example', 'STEADY@VENDOR.EXAMPLE']) {
        const result = await inTrx((trx) => TicketWatcherService.add(trx, tenantId, ticketId, { email, name: 'Steady' }, actorId));
        expect(result.changed).toBe(false);
      }
      await expectStampUntouched();
      expect((await tableRows()).map((r) => r.updated_at)).toEqual(rowsBefore.map((r) => r.updated_at));
    });

    it('setActive to the current value is a no-op', async () => {
      const result = await inTrx((trx) => TicketWatcherService.setActive(trx, tenantId, ticketId, 'Steady@Vendor.example', true, actorId));
      expect(result.changed).toBe(false);
      await expectStampUntouched();
    });

    it('addRecipients with an already-present set is a no-op', async () => {
      const result = await inTrx((trx) =>
        TicketWatcherService.addRecipients(trx, tenantId, ticketId, [{ email: 'steady@vendor.example', name: 'Steady' }, { email: dorothyEmail }], actorId)
      );
      expect(result.changed).toBe(false);
      await expectStampUntouched();
    });

    it('syncWatchListAttributes on an in-sync ticket writes nothing', async () => {
      await inTrx((trx) => TicketWatcherService.syncWatchListAttributes(trx, tenantId, ticketId, actorId));
      await expectStampUntouched();
    });

    it('REST add (re-POST) and PATCH with unchanged active return 200 data and leave the stamp alone', async () => {
      const posted = await service.addWatcher(ticketId, { email: 'steady@vendor.example' }, ctx());
      expect(posted.map((w) => w.email).sort()).toEqual(['steady@vendor.example', dorothyEmail.toLowerCase()].sort());
      const patched = await service.setWatcherActive(ticketId, { email: 'steady@vendor.example', active: true }, ctx());
      expect(patched).toHaveLength(2);
      expect(publishWorkflowEventMock).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'TICKET_UPDATED' }));
      await expectStampUntouched();
    });

    it('repairs a drifted mirror without stamping the ticket', async () => {
      await scoped('tickets').where({ ticket_id: ticketId }).update({ attributes: JSON.stringify({ watch_list: [{ email: 'junk@x.example', active: true }] }) });
      const result = await inTrx((trx) => TicketWatcherService.add(trx, tenantId, ticketId, { email: 'steady@vendor.example', name: 'Steady' }, actorId));
      expect(result.changed).toBe(false);
      await expectMirrorMatchesTable();
      await expectStampUntouched();
    });

    it('positive control: a real add stamps updated_by with the actor and advances updated_at', async () => {
      const other = (await scoped('users').whereNot({ user_id: actorId }).first('user_id'))?.user_id;
      const stampedBy = other ?? actorId;
      await scoped('tickets').where({ ticket_id: ticketId }).update({ updated_by: null });
      await service.addWatcher(ticketId, { email: 'brand-new@vendor.example' }, { userId: stampedBy, tenant: tenantId } as any);
      const row = await scoped('tickets').where({ ticket_id: ticketId }).first('updated_at', 'updated_by');
      expect(row.updated_by).toBe(stampedBy);
      expect(new Date(row.updated_at).getTime()).toBeGreaterThan(PAST.getTime());
    });
  });

  describe('migration 20261028140000_create_ticket_watchers backfill', () => {
    it('backfills from attributes.watch_list normalized and deduped like shared/lib/tickets/watchList.ts', async () => {
      const entityId = uuidv4();
      const t1 = await insertTicket({
        watch_list: [
          'Plain@Example.com',
          { email: 'Dup@Example.com', active: false, name: 'First Name', source: 'manual', entity_type: 'contact', entity_id: entityId },
          { email: 'dup@example.com', active: true, name: 'Second Name', source: 'inbound_cc' },
          { email: 'no-active@example.com' },
          { email: 'off@example.com', active: 'off' },
          { email: 'bad-entity@example.com', entity_type: 'robot', entity_id: 'not-a-uuid' },
          { email: 'not-an-email' },
          { name: 'no email at all' },
          42,
        ],
      });
      const t2 = await insertTicket({ watch_list: 'not-an-array' });
      const t3 = await insertTicket({ other: true });

      await scoped('ticket_watchers').whereIn('ticket_id', [t1, t2, t3]).delete();

      const require = createRequire(import.meta.url);
      const migration = require(path.resolve(__dirname, '../../../migrations/20261028140000_create_ticket_watchers.cjs'));
      await migration.up(db);
      // Re-running is a no-op (idempotent).
      await migration.up(db);

      const rows = Object.fromEntries((await tableRows(t1)).map((r) => [r.email, r]));
      expect(Object.keys(rows).sort()).toEqual([
        'bad-entity@example.com',
        'dup@example.com',
        'no-active@example.com',
        'off@example.com',
        'plain@example.com',
      ]);
      expect(rows['plain@example.com'].active).toBe(true);
      expect(rows['no-active@example.com'].active).toBe(true);
      expect(rows['off@example.com'].active).toBe(false);
      // Deduped: active = OR, first non-empty name/source/entity wins.
      expect(rows['dup@example.com']).toMatchObject({
        active: true,
        name: 'First Name',
        source: 'manual',
        entity_type: 'contact',
        entity_id: entityId,
      });
      expect(rows['bad-entity@example.com']).toMatchObject({ entity_type: null, entity_id: null });
      expect(await tableRows(t2)).toHaveLength(0);
      expect(await tableRows(t3)).toHaveLength(0);
    }, HOOK_TIMEOUT);

    it('enforces unique (tenant, ticket_id, lower(email)) and cascades with the ticket', async () => {
      await withTransaction(db, (trx) => TicketWatcherService.add(trx, tenantId, ticketId, { email: 'uniq@vendor.example' }, actorId));
      await expect(
        scoped('ticket_watchers').insert({ tenant: tenantId, ticket_id: ticketId, email: 'UNIQ@vendor.example' })
      ).rejects.toThrow(/ticket_watchers_ticket_email_unique|duplicate key/);

      await scoped('tickets').where({ ticket_id: ticketId }).delete();
      expect(await tableRows()).toHaveLength(0);
    });
  });
});
