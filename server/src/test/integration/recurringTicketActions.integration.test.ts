import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * The recurring-ticket server actions against a real migrated database: validation, the
 * resume/no-backfill rules, archive read-only, history, preview and the permission each action asks for.
 */
const session = vi.hoisted(() => ({
  user: null as any,
  checks: [] as Array<{ resource: string; action: string }>,
  deny: new Set<string>(),
}));
let testDb: Knex;

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: testDb, tenant: session.user?.tenant }),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  const { runWithTenant: run } = await import('@alga-psa/db');
  return {
    ...actual,
    withAuth: (fn: any) => (...args: any[]) =>
      run(session.user.tenant, () => fn(session.user, { tenant: session.user.tenant }, ...args)),
    hasPermission: async (_user: unknown, resource: string, action: string) => {
      session.checks.push({ resource, action });
      return !session.deny.has(`${resource}:${action}`);
    },
  };
});

type Actions = typeof import('@alga-psa/tickets/actions/recurringTicketActions');
let actions: Actions;

interface Fixture {
  tenant: string;
  clientId: string;
  otherClientId: string;
  userId: string;
  boardId: string;
  otherBoardId: string;
  priorityId: string;
  categoryId: string;
}

const weekly = { frequency: 'weekly', interval: 1, weekdays: ['mon'], end: { type: 'never' } };

async function createFixture(): Promise<Fixture> {
  const tenant = await createTenant(testDb, `Actions ${uuidv4().slice(0, 6)}`);
  const clientId = await createClient(testDb, tenant, 'Acme Corp');
  const otherClientId = await createClient(testDb, tenant, 'Globex');
  const userId = await createUser(testDb, tenant);
  const scoped = tenantDb(testDb, tenant);
  const boardId = uuidv4();
  const otherBoardId = uuidv4();
  await scoped.table('boards').insert([
    { tenant, board_id: boardId, board_name: 'Patching', is_default: true },
    { tenant, board_id: otherBoardId, board_name: 'Projects' },
  ]);
  await scoped.table('statuses').insert([
    { tenant, status_id: uuidv4(), board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false },
    { tenant, status_id: uuidv4(), board_id: otherBoardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false },
  ]);
  const priorityId = uuidv4();
  await scoped.table('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: userId });
  const categoryId = uuidv4();
  await scoped.table('categories').insert({ tenant, category_id: categoryId, category_name: 'Maintenance', board_id: otherBoardId, created_by: userId });
  await scoped.table('tenant_settings').insert({ tenant, settings: JSON.stringify({ timezone: 'America/New_York' }) }).onConflict('tenant').merge();
  return { tenant, clientId, otherClientId, userId, boardId, otherBoardId, priorityId, categoryId };
}

const definitionInput = (f: Fixture, overrides: Record<string, unknown> = {}) => ({
  name: 'Monthly patching',
  title_template: '{{client}} patching {{month}} {{year}}',
  board_id: f.boardId,
  priority_id: f.priorityId,
  recurrence: weekly,
  start_date: '2026-01-05',
  ...overrides,
});

const isError = (value: unknown): value is { actionError: string; messageKey?: string } =>
  typeof value === 'object' && value !== null && 'actionError' in value;
const isPermissionError = (value: unknown) => typeof value === 'object' && value !== null && 'permissionError' in value;

async function createDefinition(f: Fixture, overrides: Record<string, unknown> = {}): Promise<string> {
  const result = await actions.createRecurringTicketDefinition(definitionInput(f, overrides) as any);
  if (isError(result) || isPermissionError(result)) throw new Error(`fixture definition failed: ${JSON.stringify(result)}`);
  return (result as { definition_id: string }).definition_id;
}

const clientRows = (f: Fixture, definitionId: string) =>
  tenantDb(testDb, f.tenant).table('recurring_ticket_definition_clients').where({ definition_id: definitionId });

describe('recurring ticket actions (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    testDb = await createTestDbConnection();
    actions = await import('@alga-psa/tickets/actions/recurringTicketActions');
  }, 900_000);

  afterAll(async () => {
    await testDb?.destroy();
  });

  beforeEach(async () => {
    f = await createFixture();
    session.user = { user_id: f.userId, tenant: f.tenant };
    session.checks.length = 0;
    session.deny.clear();
  });

  describe('permissions', () => {
    it('asks for the documented permission on every action and writes nothing when denied', async () => {
      const definitionId = await createDefinition(f);
      await actions.addClientsToRecurringTicketDefinition(definitionId, [f.clientId]);
      const [clientRow] = await clientRows(f, definitionId);

      const calls: Array<[string, () => Promise<unknown>]> = [
        ['read', () => actions.listRecurringTicketDefinitions('all')],
        ['read', () => actions.getRecurringTicketDefinition(definitionId)],
        ['create', () => actions.createRecurringTicketDefinition(definitionInput(f) as any)],
        ['update', () => actions.updateRecurringTicketDefinition(definitionId, definitionInput(f, { name: 'Changed' }) as any)],
        ['update', () => actions.setRecurringTicketDefinitionActive(definitionId, false)],
        ['delete', () => actions.archiveRecurringTicketDefinition(definitionId)],
        ['update', () => actions.addClientsToRecurringTicketDefinition(definitionId, [f.otherClientId])],
        ['update', () => actions.updateRecurringTicketClient(clientRow.definition_client_id, { overrides: {}, contact_id: null, location_id: null, asset_ids: [] })],
        ['update', () => actions.setRecurringTicketClientActive(clientRow.definition_client_id, false)],
        ['update', () => actions.removeClientFromRecurringTicketDefinition(clientRow.definition_client_id)],
        ['read', () => actions.listRecurringTicketOccurrences(definitionId, {})],
        ['read', () => actions.listRecurringTicketsForClient(f.clientId)],
      ];

      for (const [action, call] of calls) {
        session.checks.length = 0;
        session.deny = new Set([`recurring_ticket:${action}`]);
        const result = await call();
        expect(session.checks).toContainEqual({ resource: 'recurring_ticket', action });
        expect(isPermissionError(result)).toBe(true);
      }

      // None of the denied writes took effect.
      const definition = await tenantDb(testDb, f.tenant).table('recurring_ticket_definitions').where({ definition_id: definitionId }).first();
      expect(definition).toMatchObject({ name: 'Monthly patching', is_active: true, archived_at: null });
      expect(await clientRows(f, definitionId)).toHaveLength(1);
      expect((await tenantDb(testDb, f.tenant).table('recurring_ticket_definitions')).length).toBe(1);
    });

    it('returns no source (instead of failing the ticket page) when the viewer cannot read recurring tickets', async () => {
      session.deny = new Set(['recurring_ticket:read']);
      expect(await actions.getRecurringSourceForTicket(uuidv4())).toBeNull();
    });
  });

  describe('create and update validation', () => {
    it('rejects an unknown title token with a localizable error that names it', async () => {
      const result = await actions.createRecurringTicketDefinition(definitionInput(f, { title_template: '{{client}} {{quarter}}' }) as any);
      expect(isError(result)).toBe(true);
      expect((result as any).actionError).toContain('{{quarter}}');
      expect((result as any).messageKey).toBe('features/tickets:recurring.errors.unknownTitleTokens');
    });

    it('rejects an inactive board, a status from another board and a category from another board', async () => {
      await tenantDb(testDb, f.tenant).table('boards').where({ board_id: f.boardId }).update({ is_inactive: true });
      const inactive = await actions.createRecurringTicketDefinition(definitionInput(f) as any);
      expect((inactive as any).actionError).toContain('inactive');

      await tenantDb(testDb, f.tenant).table('boards').where({ board_id: f.boardId }).update({ is_inactive: false });
      const wrongCategory = await actions.createRecurringTicketDefinition(definitionInput(f, { category_id: f.categoryId }) as any);
      expect((wrongCategory as any).actionError).toContain('does not belong to the selected board');
      expect((await tenantDb(testDb, f.tenant).table('recurring_ticket_definitions')).length).toBe(0);
    });

    it('rejects a subcategory without a category and an out-of-range lead time', async () => {
      const noCategory = await actions.createRecurringTicketDefinition(definitionInput(f, { subcategory_id: uuidv4() }) as any);
      expect((noCategory as any).messageKey).toBe('features/tickets:recurring.errors.subcategoryNeedsCategory');
      const badLead = await actions.createRecurringTicketDefinition(definitionInput(f, { lead_days: 400 }) as any);
      expect(isError(badLead)).toBe(true);
    });

    it('round-trips a definition and applies defaults', async () => {
      const definitionId = await createDefinition(f, { tags: ['patching'], notify_client_on_create: undefined });
      const detail: any = await actions.getRecurringTicketDefinition(definitionId);
      expect(detail.definition).toMatchObject({
        name: 'Monthly patching',
        is_active: true,
        recurrence: weekly,
        start_date: '2026-01-05',
        create_time: '08:00',
        due_time: '17:00',
        lead_days: 0,
        non_business_day_policy: 'keep',
        open_previous_policy: 'always_create',
        notify_client_on_create: false,
        tags: ['patching'],
        board_id: f.boardId,
      });
      expect(detail.next_due_at).toBeTruthy();

      await actions.updateRecurringTicketDefinition(definitionId, definitionInput(f, { name: 'Renamed', lead_days: 2 }) as any);
      const updated: any = await actions.getRecurringTicketDefinition(definitionId);
      expect(updated.definition).toMatchObject({ name: 'Renamed', lead_days: 2 });
    });

    it('reports a missing definition as a localizable error', async () => {
      const result: any = await actions.getRecurringTicketDefinition(uuidv4());
      expect(result.messageKey).toBe('features/tickets:recurring.errors.definitionNotFound');
    });
  });

  describe('clients, pause/resume and archive', () => {
    it('adds clients idempotently with a fresh watermark and rejects unknown clients', async () => {
      const definitionId = await createDefinition(f);
      const before = Date.now();
      expect(await actions.addClientsToRecurringTicketDefinition(definitionId, [f.clientId, f.clientId])).toEqual({ added: 1 });
      expect(await actions.addClientsToRecurringTicketDefinition(definitionId, [f.clientId, f.otherClientId])).toEqual({ added: 1 });

      const rows = await clientRows(f, definitionId);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(new Date(row.evaluated_through).getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(row.is_active).toBe(true);
      }
      const unknown: any = await actions.addClientsToRecurringTicketDefinition(definitionId, [uuidv4()]);
      expect(unknown.messageKey).toBe('features/tickets:recurring.errors.clientNotFound');
    });

    it('resuming a definition or client resets the no-backfill watermark; pausing does not', async () => {
      const definitionId = await createDefinition(f);
      await actions.addClientsToRecurringTicketDefinition(definitionId, [f.clientId, f.otherClientId]);
      const [first, second] = await clientRows(f, definitionId).orderBy('client_id');
      const longAgo = new Date('2026-01-01T00:00:00Z');
      await clientRows(f, definitionId).update({ evaluated_through: longAgo });

      await actions.setRecurringTicketDefinitionActive(definitionId, false);
      expect(new Date((await clientRows(f, definitionId).first()).evaluated_through).getTime()).toBe(longAgo.getTime());

      await actions.setRecurringTicketClientActive(second.definition_client_id, false);
      const resumedAt = Date.now();
      await actions.setRecurringTicketDefinitionActive(definitionId, true);
      const afterResume = await clientRows(f, definitionId);
      const byId = new Map(afterResume.map((row) => [row.definition_client_id, row]));
      expect(new Date(byId.get(first.definition_client_id).evaluated_through).getTime()).toBeGreaterThanOrEqual(resumedAt - 1000);
      // The individually paused client keeps its old watermark until it is resumed itself.
      expect(new Date(byId.get(second.definition_client_id).evaluated_through).getTime()).toBe(longAgo.getTime());

      await actions.setRecurringTicketClientActive(second.definition_client_id, true);
      const resumedClient = await clientRows(f, definitionId).where({ definition_client_id: second.definition_client_id }).first();
      expect(new Date(resumedClient.evaluated_through).getTime()).toBeGreaterThan(longAgo.getTime());
    });

    it('archives a definition, making it read-only and inactive', async () => {
      const definitionId = await createDefinition(f);
      await actions.addClientsToRecurringTicketDefinition(definitionId, [f.clientId]);
      const [row] = await clientRows(f, definitionId);
      await actions.archiveRecurringTicketDefinition(definitionId);

      const stored = await tenantDb(testDb, f.tenant).table('recurring_ticket_definitions').where({ definition_id: definitionId }).first();
      expect(stored.archived_at).not.toBeNull();
      expect(stored.is_active).toBe(false);

      for (const result of [
        await actions.updateRecurringTicketDefinition(definitionId, definitionInput(f, { name: 'Nope' }) as any),
        await actions.setRecurringTicketDefinitionActive(definitionId, true),
        await actions.addClientsToRecurringTicketDefinition(definitionId, [f.otherClientId]),
        await actions.setRecurringTicketClientActive(row.definition_client_id, false),
        await actions.removeClientFromRecurringTicketDefinition(row.definition_client_id),
      ]) {
        expect((result as any).messageKey).toBe('features/tickets:recurring.errors.definitionArchived');
      }
      expect(await clientRows(f, definitionId)).toHaveLength(1);
    });

    it('removing a client keeps its occurrence history and linked assets go with the client row', async () => {
      const definitionId = await createDefinition(f);
      await actions.addClientsToRecurringTicketDefinition(definitionId, [f.clientId]);
      const [row] = await clientRows(f, definitionId);
      await tenantDb(testDb, f.tenant).table('recurring_ticket_occurrences').insert({
        tenant: f.tenant,
        occurrence_id: uuidv4(),
        definition_id: definitionId,
        definition_client_id: row.definition_client_id,
        client_id: f.clientId,
        occurrence_date: '2026-03-02',
        due_date: '2026-03-02',
        status: 'missed',
      });

      await actions.removeClientFromRecurringTicketDefinition(row.definition_client_id);
      expect(await clientRows(f, definitionId)).toHaveLength(0);
      const history: any = await actions.listRecurringTicketOccurrences(definitionId, {});
      expect(history.total).toBe(1);
      expect(history.items[0]).toMatchObject({ status: 'missed', occurrence_date: '2026-03-02', client_name: 'Acme Corp' });
    });
  });

  describe('per-client settings', () => {
    it('saves overrides, contact, location and assets, and replaces assets on the next save', async () => {
      const definitionId = await createDefinition(f);
      await actions.addClientsToRecurringTicketDefinition(definitionId, [f.clientId]);
      const [row] = await clientRows(f, definitionId);
      const scoped = tenantDb(testDb, f.tenant);
      const contactId = uuidv4();
      await scoped.table('contacts').insert({ tenant: f.tenant, contact_name_id: contactId, full_name: 'Casey', email: 'casey@example.com', client_id: f.clientId });
      const assetA = uuidv4();
      const assetB = uuidv4();
      await scoped.table('assets').insert([
        { tenant: f.tenant, asset_id: assetA, asset_type: 'workstation', client_id: f.clientId, asset_tag: 'A', name: 'A', status: 'active' },
        { tenant: f.tenant, asset_id: assetB, asset_type: 'workstation', client_id: f.clientId, asset_tag: 'B', name: 'B', status: 'active' },
      ]);

      const saved = await actions.updateRecurringTicketClient(row.definition_client_id, {
        overrides: { priority: { priority_id: f.priorityId } },
        contact_id: contactId,
        location_id: null,
        asset_ids: [assetA],
      });
      expect(isError(saved)).toBe(false);
      await actions.updateRecurringTicketClient(row.definition_client_id, {
        overrides: { priority: { priority_id: f.priorityId } },
        contact_id: contactId,
        location_id: null,
        asset_ids: [assetB],
      });

      const detail: any = await actions.getRecurringTicketDefinition(definitionId);
      expect(detail.clients[0]).toMatchObject({
        client_name: 'Acme Corp',
        contact_id: contactId,
        asset_ids: [assetB],
        overrides: { priority: { priority_id: f.priorityId } },
      });
    });

    it("rejects another client's contact and a board override the inherited category does not fit", async () => {
      const definitionId = await createDefinition(f);
      await actions.addClientsToRecurringTicketDefinition(definitionId, [f.clientId]);
      const [row] = await clientRows(f, definitionId);
      const foreignContact = uuidv4();
      await tenantDb(testDb, f.tenant).table('contacts').insert({ tenant: f.tenant, contact_name_id: foreignContact, full_name: 'Gil', email: 'gil@example.com', client_id: f.otherClientId });

      const wrongContact: any = await actions.updateRecurringTicketClient(row.definition_client_id, {
        overrides: {}, contact_id: foreignContact, location_id: null, asset_ids: [],
      });
      expect(wrongContact.actionError).toContain('does not belong to this client');

      // The category belongs to the "Projects" board; overriding only the board to "Patching" must be rejected.
      const definitionWithCategory = await createDefinition(f, { board_id: f.otherBoardId, category_id: f.categoryId });
      await actions.addClientsToRecurringTicketDefinition(definitionWithCategory, [f.clientId]);
      const [categoryRow] = await clientRows(f, definitionWithCategory);
      const wrongBoard: any = await actions.updateRecurringTicketClient(categoryRow.definition_client_id, {
        overrides: { board: { board_id: f.boardId, status_id: null } }, contact_id: null, location_id: null, asset_ids: [],
      });
      expect(wrongBoard.actionError).toContain('does not belong to the selected board');
    });
  });

  describe('list, history, preview and cross-feature reads', () => {
    it('lists status, client count, next due and the failure warning', async () => {
      const active = await createDefinition(f, { name: 'Active one' });
      const paused = await createDefinition(f, { name: 'Paused one', is_active: false });
      const failing = await createDefinition(f, { name: 'Failing one' });
      await actions.addClientsToRecurringTicketDefinition(active, [f.clientId, f.otherClientId]);
      await actions.addClientsToRecurringTicketDefinition(paused, [f.clientId]);
      await actions.addClientsToRecurringTicketDefinition(failing, [f.clientId]);
      const [failingClient] = await clientRows(f, failing);
      await tenantDb(testDb, f.tenant).table('recurring_ticket_occurrences').insert({
        tenant: f.tenant, occurrence_id: uuidv4(), definition_id: failing, definition_client_id: failingClient.definition_client_id,
        client_id: f.clientId, occurrence_date: '2026-03-02', due_date: '2026-03-02', status: 'failed', reason: 'Board is inactive', attempts: 1,
      });

      const all: any[] = (await actions.listRecurringTicketDefinitions('all')) as any;
      const byName = new Map(all.map((row) => [row.name, row]));
      expect(byName.get('Active one')).toMatchObject({ status: 'active', client_count: 2, has_failure: false });
      expect(byName.get('Active one').next_due_at).toBeTruthy();
      expect(byName.get('Paused one')).toMatchObject({ status: 'paused', client_count: 1, next_due_at: null });
      expect(byName.get('Failing one').has_failure).toBe(true);

      expect(((await actions.listRecurringTicketDefinitions('paused')) as any[]).map((row) => row.name)).toEqual(['Paused one']);
      await actions.archiveRecurringTicketDefinition(paused);
      expect(((await actions.listRecurringTicketDefinitions('archived')) as any[]).map((row) => row.name)).toEqual(['Paused one']);
      expect(((await actions.listRecurringTicketDefinitions('active')) as any[]).map((row) => row.name).sort()).toEqual(['Active one', 'Failing one']);
    });

    it('filters and pages the occurrence history, newest first', async () => {
      const definitionId = await createDefinition(f);
      await actions.addClientsToRecurringTicketDefinition(definitionId, [f.clientId, f.otherClientId]);
      const [first, second] = await clientRows(f, definitionId).orderBy('client_id');
      const scoped = tenantDb(testDb, f.tenant);
      const rows = ['2026-03-02', '2026-03-09', '2026-03-16'].map((date, index) => ({
        tenant: f.tenant, occurrence_id: uuidv4(), definition_id: definitionId,
        definition_client_id: index === 2 ? second.definition_client_id : first.definition_client_id,
        client_id: index === 2 ? second.client_id : first.client_id,
        occurrence_date: date, due_date: date, due_at: new Date(`${date}T21:00:00Z`),
        status: index === 1 ? 'failed' : 'missed',
      }));
      await scoped.table('recurring_ticket_occurrences').insert(rows);

      const page: any = await actions.listRecurringTicketOccurrences(definitionId, { page: 1, pageSize: 2 });
      expect(page.total).toBe(3);
      expect(page.items.map((item: any) => item.occurrence_date)).toEqual(['2026-03-16', '2026-03-09']);
      const failed: any = await actions.listRecurringTicketOccurrences(definitionId, { status: 'failed' });
      expect(failed.items.map((item: any) => item.occurrence_date)).toEqual(['2026-03-09']);
      const byClient: any = await actions.listRecurringTicketOccurrences(definitionId, { clientId: second.client_id });
      expect(byClient.total).toBe(1);
    });

    it('previews the next five due dates in the tenant timezone and names the business-day calendar', async () => {
      const preview: any = await actions.previewRecurringTicketOccurrences({
        recurrence: { frequency: 'daily', interval: 1, end: { type: 'never' } },
        start_date: '2026-01-01',
        create_time: '08:00',
        due_time: '17:00',
        lead_days: 0,
        non_business_day_policy: 'next',
      });
      expect(preview.time_zone).toBe('America/New_York');
      expect(preview.occurrences).toHaveLength(5);
      expect(preview.calendar).toEqual({ source: 'fallback', schedule_name: null });
      const dues = preview.occurrences.map((occurrence: any) => new Date(occurrence.due_at).getTime());
      expect([...dues].sort((a, b) => a - b)).toEqual(dues);
      // "next" never lands on a weekend (Mon-Fri fallback calendar).
      for (const occurrence of preview.occurrences) {
        const day = new Date(`${occurrence.due}T12:00:00Z`).getUTCDay();
        expect([0, 6]).not.toContain(day);
      }

      const keep: any = await actions.previewRecurringTicketOccurrences({
        recurrence: weekly, start_date: '2026-01-05', create_time: '08:00', due_time: '17:00', lead_days: 0, non_business_day_policy: 'keep',
      });
      expect(keep.calendar).toBeNull();
    });

    it('lists the definitions that include a client, and resolves the source of a generated ticket', async () => {
      const definitionId = await createDefinition(f);
      await createDefinition(f, { name: 'Unrelated' });
      await actions.addClientsToRecurringTicketDefinition(definitionId, [f.clientId]);
      const [row] = await clientRows(f, definitionId);

      const forClient: any[] = (await actions.listRecurringTicketsForClient(f.clientId)) as any;
      expect(forClient).toHaveLength(1);
      expect(forClient[0]).toMatchObject({ definition_id: definitionId, name: 'Monthly patching', status: 'active', is_client_active: true });
      expect(await actions.listRecurringTicketsForClient(f.otherClientId)).toEqual([]);

      const ticketId = uuidv4();
      const scoped = tenantDb(testDb, f.tenant);
      const status = await scoped.table('statuses').where({ board_id: f.boardId }).first();
      await scoped.table('tickets').insert({
        tenant: f.tenant, ticket_id: ticketId, ticket_number: 'RT-1', title: 'Generated', client_id: f.clientId,
        board_id: f.boardId, status_id: status.status_id, priority_id: f.priorityId, ticket_origin: 'recurring',
      });
      await scoped.table('recurring_ticket_occurrences').insert({
        tenant: f.tenant, occurrence_id: uuidv4(), definition_id: definitionId, definition_client_id: row.definition_client_id,
        client_id: f.clientId, occurrence_date: '2026-03-02', due_date: '2026-03-02', status: 'created', ticket_id: ticketId,
      });

      expect(await actions.getRecurringSourceForTicket(ticketId)).toEqual({ definition_id: definitionId, name: 'Monthly patching' });
      expect(await actions.getRecurringSourceForTicket(uuidv4())).toBeNull();
    });
  });
});
