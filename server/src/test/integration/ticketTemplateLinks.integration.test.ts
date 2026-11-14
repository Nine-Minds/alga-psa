import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * Documentation links on ticket templates (docs/plans/2026-11-09-hudu-doc-links-plan.md) against a real,
 * migrated database:
 *  - the relationship-scoped uniqueness migration (two tickets may cite one record; a duplicate mirror
 *    still fails with 23505),
 *  - the done criterion: a recurring definition whose template carries a Hudu link generates tickets
 *    for two clients across two occurrences, each showing the link; a rerun adds nothing; and
 *    generation never touches Hudu.
 */
const session = vi.hoisted(() => ({ user: null as any }));
const huduSpy = vi.hoisted(() => ({ calls: 0 }));
const publishSpy = vi.hoisted(() => ({ events: [] as Array<{ eventType: string; payload: any }> }));
let db: Knex;

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: db, tenant: session.user?.tenant }),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  const { runWithTenant: run } = await import('@alga-psa/db');
  return {
    ...actual,
    withAuth: (fn: any) => (...args: any[]) =>
      run(session.user.tenant, () => fn(session.user, { tenant: session.user.tenant }, ...args)),
    hasPermission: async () => true,
  };
});

vi.mock('@alga-psa/event-bus/publishers', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/event-bus/publishers')>('@alga-psa/event-bus/publishers');
  return {
    ...actual,
    publishEvent: vi.fn(async (event: any) => { publishSpy.events.push({ eventType: event.eventType, payload: event.payload }); }),
    publishWorkflowEvent: vi.fn(async (event: any) => { publishSpy.events.push({ eventType: event.eventType, payload: event.payload }); }),
  };
});

// Generation must never call Hudu: any client construction is a failure.
vi.mock('../../../../ee/server/src/lib/integrations/hudu/huduClient', () => ({
  createHuduClient: vi.fn(async () => { huduSpy.calls += 1; throw new Error('Hudu must not be called'); }),
}));

const TZ = 'America/New_York';
const at = (iso: string) => new Date(iso);
const monthlyOn1 = { frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 1 }, end: { type: 'never' } };
const HUDU_URL = 'https://docs.example.hudu.com/a/runbook-123';

let generate: typeof import('@alga-psa/tickets/lib/recurring/generateRecurringTicketsForTenant').generateRecurringTicketsForTenant;
let templateActions: typeof import('@alga-psa/tickets/actions/ticketTemplateActions');
let instantiate: typeof import('@alga-psa/tickets/lib/instantiateTicketTemplate').instantiateTicketTemplate;
let persistLinks: typeof import('@alga-psa/shared/services/tickets/externalLinkPersistence').persistExternalLinksForCreate;

interface Fixture {
  tenant: string;
  clientId: string;
  clientTwoId: string;
  userId: string;
  boardId: string;
  priorityId: string;
}

async function createFixture(): Promise<Fixture> {
  const tenant = await createTenant(db, `TplLinks ${uuidv4().slice(0, 6)}`);
  const clientId = await createClient(db, tenant, 'Acme Corp');
  const clientTwoId = await createClient(db, tenant, 'Globex');
  const userId = await createUser(db, tenant);
  const scoped = tenantDb(db, tenant);
  const boardId = uuidv4();
  const priorityId = uuidv4();
  await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Patching', is_default: true });
  await scoped.table('statuses').insert({ tenant, status_id: uuidv4(), board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false });
  await scoped.table('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: userId });
  await scoped.table('tenant_settings').insert({ tenant, settings: JSON.stringify({ timezone: TZ }) }).onConflict('tenant').merge();
  return { tenant, clientId, clientTwoId, userId, boardId, priorityId };
}

async function insertTemplateWithLink(f: Fixture): Promise<string> {
  const templateId = uuidv4();
  const scoped = tenantDb(db, f.tenant);
  await scoped.table('ticket_templates').insert({
    tenant: f.tenant, template_id: templateId, name: 'Patching', title: '{{client}} patching — {{month}} {{year}}',
    board_id: f.boardId, priority_id: f.priorityId, tags: JSON.stringify([]), custom_fields: JSON.stringify({}), offer_for_manual_use: false,
  });
  await scoped.table('ticket_template_links').insert({
    tenant: f.tenant, template_id: templateId, system: 'hudu', external_id: '123', url: HUDU_URL, title: 'Patching runbook', order_number: 0,
  });
  return templateId;
}

async function insertDefinition(f: Fixture, templateId: string) {
  const scoped = tenantDb(db, f.tenant);
  const definitionId = uuidv4();
  await scoped.table('recurring_ticket_definitions').insert({
    tenant: f.tenant, definition_id: definitionId, name: 'Monthly patching', is_active: true, ticket_template_id: templateId,
    overrides: JSON.stringify({}), additional_agent_ids: JSON.stringify([]), recurrence: JSON.stringify(monthlyOn1),
    start_date: '2026-01-01', create_time: '08:00', due_time: '17:00', lead_days: 0, non_business_day_policy: 'keep',
    open_previous_policy: 'always_create', notify_client_on_create: false,
  });
  for (const clientId of [f.clientId, f.clientTwoId]) {
    await scoped.table('recurring_ticket_definition_clients').insert({
      tenant: f.tenant, definition_client_id: uuidv4(), definition_id: definitionId, client_id: clientId, is_active: true,
      overrides: JSON.stringify({}), evaluated_through: at('2026-01-31T12:00:00Z'),
    });
  }
  return definitionId;
}

const sweep = (f: Fixture, now: string) =>
  runWithTenant(f.tenant, () => generate(db, f.tenant, { timeZone: TZ, locale: 'en', now: at(now) }));

const linksOf = (f: Fixture, ticketId: string) =>
  tenantDb(db, f.tenant).table('external_entity_links').where({ entity_type: 'ticket', entity_id: ticketId });

describe('ticket template documentation links (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    db = await createTestDbConnection();
    ({ generateRecurringTicketsForTenant: generate } = await import('@alga-psa/tickets/lib/recurring/generateRecurringTicketsForTenant'));
    templateActions = await import('@alga-psa/tickets/actions/ticketTemplateActions');
    ({ instantiateTicketTemplate: instantiate } = await import('@alga-psa/tickets/lib/instantiateTicketTemplate'));
    ({ persistExternalLinksForCreate: persistLinks } = await import('@alga-psa/shared/services/tickets/externalLinkPersistence'));
  }, 900_000);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    f = await createFixture();
    session.user = { user_id: f.userId, tenant: f.tenant, user_type: 'internal' };
    huduSpy.calls = 0;
    publishSpy.events = [];
  });

  describe('uniqueness migration', () => {
    async function insertTicket(clientId: string) {
      const ticketId = uuidv4();
      await tenantDb(db, f.tenant).table('tickets').insert({
        tenant: f.tenant, ticket_id: ticketId, ticket_number: `T-${ticketId.slice(0, 8)}`, title: 't', client_id: clientId, board_id: f.boardId,
        status_id: (await tenantDb(db, f.tenant).table('statuses').where({ board_id: f.boardId }).first()).status_id,
        priority_id: f.priorityId, entered_at: new Date(), updated_at: new Date(),
      });
      return ticketId;
    }
    const link = (ticketId: string, relationship: string, externalId = '123') => ({
      tenant: f.tenant, link_id: uuidv4(), entity_type: 'ticket', entity_id: ticketId, ticket_id: ticketId, system: 'hudu', external_id: externalId, relationship, portal_visible: false,
    });

    it('lets two tickets share one reference to a record', async () => {
      const [a, b] = [await insertTicket(f.clientId), await insertTicket(f.clientTwoId)];
      const scoped = tenantDb(db, f.tenant);
      await scoped.table('external_entity_links').insert(link(a, 'reference'));
      await scoped.table('external_entity_links').insert(link(b, 'reference'));
      expect(await scoped.table('external_entity_links').where({ system: 'hudu', external_id: '123' })).toHaveLength(2);
    });

    it('still rejects a duplicate mirror of the same record with 23505', async () => {
      const [a, b] = [await insertTicket(f.clientId), await insertTicket(f.clientTwoId)];
      const scoped = tenantDb(db, f.tenant);
      await scoped.table('external_entity_links').insert(link(a, 'mirror'));
      await expect(scoped.table('external_entity_links').insert(link(b, 'mirror'))).rejects.toMatchObject({ code: '23505' });
    });

    it('still rejects a second ticket claiming the same origin record with 23505', async () => {
      const [a, b] = [await insertTicket(f.clientId), await insertTicket(f.clientTwoId)];
      const scoped = tenantDb(db, f.tenant);
      await scoped.table('external_entity_links').insert(link(a, 'origin'));
      await expect(scoped.table('external_entity_links').insert(link(b, 'origin'))).rejects.toMatchObject({ code: '23505' });
    });

    // The application pre-check applies the same rule as the indexes and refuses with a structured error.
    const appLink = (relationship: 'origin' | 'mirror' | 'reference') => [
      { system: 'github', realm: 'acme/repo', external_id: 'issue-7', relationship },
    ];
    const persistOn = (ticketId: string, relationship: 'origin' | 'mirror' | 'reference') =>
      db.transaction((trx) => persistLinks(trx, f.tenant, ticketId, appLink(relationship), { type: 'user', userId: f.userId }));

    it.each(['origin', 'mirror'] as const)('refuses linking the same %s record to a second ticket (app path), writing nothing', async (relationship) => {
      const [a, b] = [await insertTicket(f.clientId), await insertTicket(f.clientTwoId)];
      await persistOn(a, relationship);
      await expect(persistOn(b, relationship)).rejects.toMatchObject({ name: 'ExternalLinkValidationError', code: 'duplicate_external_link' });
      expect(await linksOf(f, b)).toHaveLength(0);
    });

    it('lets a second ticket cite a record another ticket mirrors (app path)', async () => {
      const [a, b] = [await insertTicket(f.clientId), await insertTicket(f.clientTwoId)];
      await persistOn(a, 'mirror');
      await persistOn(b, 'reference');
      expect(await linksOf(f, b)).toHaveLength(1);
    });

    it('down restores the tenant-wide rule (deduping shared references); up splits it again', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const migration = require('../../../migrations/20261109120000_ticket_template_links.cjs');
      const [a, b, c] = [await insertTicket(f.clientId), await insertTicket(f.clientTwoId), await insertTicket(f.clientId)];
      const scoped = () => tenantDb(db, f.tenant).table('external_entity_links');
      await scoped().insert(link(a, 'reference'));
      await scoped().insert(link(b, 'reference'));
      try {
        await migration.down(db);
        // The oldest citation survives; the tenant-wide index is back, so a third ticket cannot cite the record.
        expect(await scoped().where({ system: 'hudu', external_id: '123' }).pluck('entity_id')).toHaveLength(1);
        await expect(scoped().insert(link(c, 'reference'))).rejects.toMatchObject({ code: '23505' });
        await expect(migration.down(db)).resolves.not.toThrow();
      } finally {
        await migration.up(db);
      }
      await scoped().insert(link(c, 'reference'));
      expect(await scoped().where({ system: 'hudu', external_id: '123' })).toHaveLength(2);
      await expect(migration.up(db)).resolves.not.toThrow();
    });

    it('rejects the same reference twice on one ticket', async () => {
      const a = await insertTicket(f.clientId);
      const scoped = tenantDb(db, f.tenant);
      await scoped.table('external_entity_links').insert(link(a, 'reference'));
      await expect(scoped.table('external_entity_links').insert(link(a, 'reference'))).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe('template CRUD', () => {
    it('stores links on create, returns them on read, and replaces them wholesale on update', async () => {
      const created: any = await templateActions.createTicketTemplate({
        name: 'With links', title: 'T', links: [
          { system: 'hudu', external_id: '1', url: HUDU_URL, title: 'One' },
          { system: 'hudu', external_id: '2', url: `${HUDU_URL}-2`, title: 'Two' },
        ],
      } as any);
      const read: any = await templateActions.getTicketTemplate(created.template_id);
      expect(read.links.map((l: any) => [l.external_id, l.title])).toEqual([['1', 'One'], ['2', 'Two']]);

      await templateActions.updateTicketTemplate(created.template_id, { name: 'With links', title: 'T', links: [{ system: 'hudu', external_id: '3', url: `${HUDU_URL}-3` }] } as any);
      const after: any = await templateActions.getTicketTemplate(created.template_id);
      expect(after.links.map((l: any) => l.external_id)).toEqual(['3']);
    });

    it('rejects a link whose system does not resolve or whose destination is unsafe', async () => {
      const unknown: any = await templateActions.createTicketTemplate({ name: 'Bad', title: 'T', links: [{ system: 'custom:nope', external_id: '1', url: HUDU_URL }] } as any);
      expect(unknown.actionError).toMatch(/Unknown external system/);
      const unsafe: any = await templateActions.createTicketTemplate({ name: 'Bad2', title: 'T', links: [{ system: 'hudu', external_id: '1', url: 'javascript:alert(1)' }] } as any);
      expect(unsafe.actionError ?? unsafe.messageKey).toBeTruthy();
      expect(await tenantDb(db, f.tenant).table('ticket_templates').whereIn('name', ['Bad', 'Bad2'])).toHaveLength(0);
    });
  });

  describe('instantiate path (REST / MCP)', () => {
    it('copies the template link onto each ticket instantiated from it, for two tickets in a row', async () => {
      const templateId = await insertTemplateWithLink(f);
      const ticketIds: string[] = [];
      for (const clientId of [f.clientId, f.clientTwoId]) {
        const { ticketId } = await runWithTenant(f.tenant, () =>
          db.transaction((trx) =>
            instantiate(trx, f.tenant, {
              templateId,
              client: { client_id: clientId },
              overrides: [],
              dispatch: { status_id: null, assigned_to: null, assigned_team_id: null, additional_agent_ids: [] },
              actor: { type: 'user', userId: f.userId },
              titleContext: { clientName: 'Client', contactName: null, dueDate: null, locale: 'en' },
              origin: { ticket_origin: 'api', source: 'api' },
            })
          )
        );
        ticketIds.push(ticketId);
      }
      for (const ticketId of ticketIds) {
        const links = await linksOf(f, ticketId);
        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({ system: 'hudu', external_id: '123', url: HUDU_URL, title: 'Patching runbook', relationship: 'reference', created_by: f.userId });
      }
    });
  });

  describe('recurring generation (done criterion)', () => {
    it('shows the Hudu link (URL and title) on every generated ticket, adds nothing on rerun, and never calls Hudu', async () => {
      const templateId = await insertTemplateWithLink(f);
      const definitionId = await insertDefinition(f, templateId);

      await sweep(f, '2026-02-01T14:00:00Z');
      await sweep(f, '2026-03-01T14:00:00Z');

      // Every occurrence created its ticket: none rolled back on the shared reference.
      const occurrences = await tenantDb(db, f.tenant).table('recurring_ticket_occurrences').where({ definition_id: definitionId });
      expect(occurrences.map((o: any) => o.status)).toEqual(['created', 'created', 'created', 'created']);

      const tickets = await tenantDb(db, f.tenant).table('tickets').whereIn('client_id', [f.clientId, f.clientTwoId]).select('ticket_id');
      expect(tickets).toHaveLength(4);
      for (const { ticket_id } of tickets) {
        const links = await linksOf(f, ticket_id);
        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({ system: 'hudu', external_id: '123', url: HUDU_URL, title: 'Patching runbook', relationship: 'reference', portal_visible: false, created_by: null });
      }

      // The rerun reprocesses nothing: no new tickets and no new links.
      await sweep(f, '2026-03-01T14:00:00Z');
      expect(await tenantDb(db, f.tenant).table('tickets').whereIn('client_id', [f.clientId, f.clientTwoId])).toHaveLength(4);
      expect(await tenantDb(db, f.tenant).table('external_entity_links').where({ system: 'hudu' })).toHaveLength(4);

      expect(huduSpy.calls).toBe(0);
      expect(publishSpy.events.filter((e) => e.eventType === 'TICKET_EXTERNAL_LINK_ADDED')).toHaveLength(4);
      expect(definitionId).toBeTruthy();
    });
  });
});
