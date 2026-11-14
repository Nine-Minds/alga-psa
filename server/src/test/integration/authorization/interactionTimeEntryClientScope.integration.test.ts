/**
 * T012 (alga-2026-0003207, S10): client-restricted users see only their interactions and time entries.
 *
 *  - F016: interaction lists and interaction detail show a subject only the interactions of their in-scope
 *    clients; an interaction with no client is hidden from them.
 *  - F017: time-entry lists, ticket time summaries and timesheet entry reads show a subject only the entries
 *    whose work item belongs to an in-scope client. An entry whose work item has no client (ad hoc) is visible
 *    to its own user only.
 *
 * One file holds both halves (interaction half, time-entry half) because they share one fixture and one bundle.
 * Real DB, real kernel, real bundle resolution; only the session (withAuth), the DB handle and the coarse RBAC
 * grant are stood in for, so the record-level decision under test comes from the bundle rules.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../../test-utils/testDataFactory';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';

const ref = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '', user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
  getConnection: vi.fn(async () => ref.knex),
}));
vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
  getApiKeyUserOverride: () => null,
  getSession: async () => null,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

import {
  getInteractionById,
  getInteractionsForEntity,
  getInteractionsPage,
  getRecentInteractions,
} from '../../../../../packages/clients/src/actions/interactionActions';
import { getInteractionById as getInteractionByIdQuery } from '../../../../../packages/clients/src/actions/queryActions';
import { fetchTimeEntriesForTimeSheet as fetchEntriesForSheetCrud, getTimeEntryById } from '../../../../../packages/scheduling/src/actions/timeEntryCrudActions';
import { fetchTimeEntriesForTimeSheet as fetchEntriesForSheet } from '../../../../../packages/scheduling/src/actions/timeSheetActions';
import { fetchWorkItemsForTimeSheet } from '../../../../../packages/scheduling/src/actions/timeEntryWorkItemActions';
import { fetchTimeEntriesForTicket } from '../../../../../packages/scheduling/src/actions/timeEntryTicketActions';
import { resolveTimeEntryReadScope } from '../../../../../packages/scheduling/src/lib/timeEntryAuthorizationSql';

const isDenied = (result: unknown): boolean =>
  Boolean(result && typeof result === 'object' && ('permissionError' in result || 'actionError' in result));
async function outcome<T>(run: () => Promise<T>): Promise<{ value: T } | { threw: string }> {
  try {
    return { value: await run() };
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}
/** Refused, or answered "no such interaction": the same thing to a caller outside the scope. */
const hidden = (o: { value: unknown } | { threw: string }) => 'threw' in o || isDenied(o.value) || o.value == null;

describe('T012: client-restricted users see only their interactions and time entries', () => {
  let db: Knex;
  let tenant: string;
  const mark = uuidv4().slice(0, 8);
  const ids = {
    clientA: uuidv4(), clientB: uuidv4(), clientC: uuidv4(),
    board: uuidv4(), status: uuidv4(), priority: uuidv4(), projectStatus: uuidv4(),
    ticketA: uuidv4(), ticketB: uuidv4(), ticketC: uuidv4(),
    projectA: uuidv4(), projectB: uuidv4(), projectC: uuidv4(),
    phaseA: uuidv4(), phaseB: uuidv4(), phaseC: uuidv4(),
    taskA: uuidv4(), taskB: uuidv4(), taskC: uuidv4(),
    interactionA: uuidv4(), interactionB: uuidv4(), interactionC: uuidv4(), interactionNone: uuidv4(),
    period: uuidv4(), sheetNarrowed: uuidv4(), sheetUnrestricted: uuidv4(),
    admin: '', narrowed: '', colleague: '', unrestricted: '',
  };
  const entry: Record<string, string> = {};
  const allEntryIds = () => Object.values(entry);
  let interactionTypeId = '';

  const insertEntry = async (key: string, userId: string, sheetId: string, workItemType: string, workItemId: string, hour: number) => {
    entry[key] = uuidv4();
    await db('time_entries').insert({
      tenant, entry_id: entry[key], user_id: userId, time_sheet_id: sheetId,
      work_item_type: workItemType, work_item_id: workItemId,
      start_time: new Date(Date.UTC(2026, 0, 6, hour, 0, 0)), end_time: new Date(Date.UTC(2026, 0, 6, hour + 1, 0, 0)),
      work_date: '2026-01-06', work_timezone: 'UTC', billable_duration: 60, notes: `${key}-${mark}`, approval_status: 'DRAFT',
    });
  };

  beforeAll(async () => {
    db = await createTestDbConnection();
    ref.knex = db;
    tenant = await createTenant(db, `Interaction time scope ${mark}`);
    ref.tenant = tenant;
    ids.admin = await createUser(db, tenant, { first_name: 'Ada', last_name: 'Admin' });
    ids.narrowed = await createUser(db, tenant, { user_type: 'internal', first_name: 'Nora', last_name: 'Narrowed' });
    ids.colleague = await createUser(db, tenant, { user_type: 'internal', first_name: 'Cole', last_name: 'Colleague' });
    ids.unrestricted = await createUser(db, tenant, { user_type: 'internal', first_name: 'Uma', last_name: 'Unrestricted' });

    const clients = [[ids.clientA, 'A'], [ids.clientB, 'B'], [ids.clientC, 'C']] as const;
    for (const [clientId, name] of clients) {
      await db('clients').insert({ tenant, client_id: clientId, client_name: `Client ${name} ${mark}`, billing_cycle: 'monthly', is_tax_exempt: false });
    }
    await db('boards').insert({ tenant, board_id: ids.board, board_name: 'Support', is_default: true, is_inactive: false });
    await db('priorities').insert({ tenant, priority_id: ids.priority, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: ids.admin });
    await db('statuses').insert({ tenant, status_id: ids.status, board_id: ids.board, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: ids.admin });
    await db('statuses').insert({ tenant, status_id: ids.projectStatus, name: 'Active', status_type: 'project', is_closed: false, is_default: true, order_number: 10, created_by: ids.admin });

    const perClient = [
      ['A', ids.clientA, ids.ticketA, ids.projectA, ids.phaseA, ids.taskA],
      ['B', ids.clientB, ids.ticketB, ids.projectB, ids.phaseB, ids.taskB],
      ['C', ids.clientC, ids.ticketC, ids.projectC, ids.phaseC, ids.taskC],
    ] as const;
    for (const [label, clientId, ticketId, projectId, phaseId, taskId] of perClient) {
      await db('tickets').insert({
        tenant, ticket_id: ticketId, ticket_number: `T-${mark}-${label}`, title: `Ticket ${label} ${mark}`,
        client_id: clientId, board_id: ids.board, status_id: ids.status, priority_id: ids.priority, entered_by: ids.admin,
      });
      const wbs = `1${label.charCodeAt(0) - 64}`;
      await db('projects').insert({
        tenant, project_id: projectId, project_name: `Project ${label} ${mark}`, client_id: clientId, status: ids.projectStatus,
        wbs_code: wbs, project_number: `P-${mark}-${label}`, is_inactive: false,
      });
      await db('project_phases').insert({ tenant, phase_id: phaseId, project_id: projectId, phase_name: `Phase ${label}`, status: 'active', order_number: 1, wbs_code: `${wbs}.1` });
      await db('project_tasks').insert({ tenant, task_id: taskId, phase_id: phaseId, task_name: `Task ${label}`, wbs_code: `${wbs}.1.1` });
    }

    // Interactions on A, B, C and one with no client.
    interactionTypeId = (await db('system_interaction_types').first('type_id')).type_id;
    for (const [interactionId, clientId, label] of [
      [ids.interactionA, ids.clientA, 'A'], [ids.interactionB, ids.clientB, 'B'],
      [ids.interactionC, ids.clientC, 'C'], [ids.interactionNone, null, 'NONE'],
    ] as const) {
      await db('interactions').insert({
        tenant, interaction_id: interactionId, type_id: interactionTypeId, client_id: clientId, user_id: ids.admin,
        title: `Interaction ${label} ${mark}`, notes: `notes-${label}`, interaction_date: new Date('2026-01-06T10:00:00Z'),
      });
    }

    // Time: one period, one sheet per user, entries on every kind of work item.
    await db('time_periods').insert({ tenant, period_id: ids.period, start_date: '2026-01-05', end_date: '2026-01-12' });
    await db('time_sheets').insert({ tenant, id: ids.sheetNarrowed, user_id: ids.narrowed, period_id: ids.period, approval_status: 'DRAFT' });
    await db('time_sheets').insert({ tenant, id: ids.sheetUnrestricted, user_id: ids.unrestricted, period_id: ids.period, approval_status: 'DRAFT' });
    const sheet = ids.sheetNarrowed;
    let hour = 0;
    for (const [label, ticketId, taskId] of [['A', ids.ticketA, ids.taskA], ['B', ids.ticketB, ids.taskB], ['C', ids.ticketC, ids.taskC]] as const) {
      await insertEntry(`ticket${label}`, ids.narrowed, sheet, 'ticket', ticketId, hour++);
      await insertEntry(`ticket${label}ByColleague`, ids.colleague, sheet, 'ticket', ticketId, hour++);
      await insertEntry(`task${label}`, ids.narrowed, sheet, 'project_task', taskId, hour++);
    }
    await insertEntry('interactionA', ids.narrowed, sheet, 'interaction', ids.interactionA, hour++);
    await insertEntry('interactionC', ids.narrowed, sheet, 'interaction', ids.interactionC, hour++);
    await insertEntry('interactionNoneByColleague', ids.colleague, sheet, 'interaction', ids.interactionNone, hour++);
    await insertEntry('adHocOwn', ids.narrowed, sheet, 'ad_hoc', uuidv4(), hour++);
    await insertEntry('adHocColleague', ids.colleague, sheet, 'ad_hoc', uuidv4(), hour++);
    await insertEntry('nonBillableColleague', ids.colleague, sheet, 'non_billable_category', uuidv4(), hour++);

    // Narrowed subject: interactions and time entries limited to clients A and B.
    const bundle = await createAuthorizationBundle(db, { tenant, name: `clients-ab-${mark}`, actorUserId: ids.admin });
    for (const resourceType of ['interaction', 'time_entry']) {
      await upsertBundleRule(db, {
        tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType, action: 'read', templateKey: 'selected_clients', config: { selectedClientIds: [ids.clientA, ids.clientB] }, actorUserId: ids.admin,
      });
    }
    await publishBundleRevision(db as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: ids.admin });
    await createBundleAssignment(db, { tenant, bundleId: bundle.bundleId, targetType: 'user', targetId: ids.narrowed, actorUserId: ids.admin });
  }, 900_000);

  afterAll(async () => {
    if (!db) return;
    try {
      const { rows } = await db.raw(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant'`);
      let pending: string[] = rows.map((r: any) => r.table_name);
      for (let pass = 0; pass < 12 && pending.length; pass++) {
        const blocked: string[] = [];
        for (const table of pending) {
          try { await db.raw('DELETE FROM ?? WHERE tenant = ?::uuid', [table, tenant]); } catch { blocked.push(table); }
        }
        if (blocked.length === pending.length) break;
        pending = blocked;
      }
    } catch {
      // best-effort cleanup of a disposable tenant
    }
    await db.destroy();
  }, 120_000);

  const actAs = (userId: string) => { ref.user = { user_id: userId, user_type: 'internal', tenant, email: `${userId}@example.com` }; };
  const userRef = (userId: string) => ({ user_id: userId, user_type: 'internal', tenant }) as any;
  // The session carries the tenant in async context; the summary reads managed users through it.
  const ticketSummary = (ticketId: string): Promise<any> => runWithTenant(tenant, () => fetchTimeEntriesForTicket(ticketId));
  const titles = (rows: any) => (rows as any[]).map((row) => row.title as string).sort();

  describe('F016 interactions', () => {
    it('shows the narrowed subject only in-scope interactions, in every list', async () => {
      actAs(ids.narrowed);
      const expected = [`Interaction A ${mark}`, `Interaction B ${mark}`];

      expect(titles(await getRecentInteractions({}))).toEqual(expected);
      const page = await getInteractionsPage({ pageSize: 50 }) as any;
      expect(titles(page.interactions)).toEqual(expected);
      expect(page.total).toBe(2);
      // Searching for the hidden interaction's own words finds nothing.
      expect(((await getInteractionsPage({ search: 'Interaction C' }) as any).total)).toBe(0);
      expect(((await getInteractionsPage({ search: 'Interaction NONE' }) as any).total)).toBe(0);

      expect(titles(await getInteractionsForEntity(ids.clientA, 'client'))).toEqual([`Interaction A ${mark}`]);
      expect(await getInteractionsForEntity(ids.clientC, 'client')).toEqual([]);
    });

    it('refuses detail for an out-of-scope interaction and for the one with no client', async () => {
      actAs(ids.narrowed);
      expect(hidden(await outcome(() => getInteractionByIdQuery(ids.interactionC)))).toBe(true);
      expect(hidden(await outcome(() => getInteractionById(ids.interactionC)))).toBe(true);
      expect(hidden(await outcome(() => getInteractionByIdQuery(ids.interactionNone)))).toBe(true);
      expect(hidden(await outcome(() => getInteractionByIdQuery(ids.interactionA)))).toBe(false);
      expect(hidden(await outcome(() => getInteractionByIdQuery(ids.interactionB)))).toBe(false);
    });

    it('leaves an unrestricted internal user in the same tenant with everything', async () => {
      actAs(ids.unrestricted);
      expect(titles(await getRecentInteractions({}))).toHaveLength(4);
      expect(((await getInteractionsPage({ pageSize: 50 }) as any).total)).toBe(4);
      expect(hidden(await outcome(() => getInteractionByIdQuery(ids.interactionC)))).toBe(false);
      expect(hidden(await outcome(() => getInteractionByIdQuery(ids.interactionNone)))).toBe(false);
    });
  });

  describe('F017 time entries', () => {
    const inScopeForNarrowed = () => [
      'ticketA', 'ticketAByColleague', 'taskA', 'ticketB', 'ticketBByColleague', 'taskB', 'interactionA', 'adHocOwn',
    ];

    it('the SQL scope keeps exactly the in-scope entries and the subject\'s own client-less ones', async () => {
      const scope = await resolveTimeEntryReadScope(db, tenant, userRef(ids.narrowed));
      expect(scope.narrowed).toBe(true);
      const query = db('time_entries').where({ tenant }).select('entry_id');
      scope.apply(query);
      const visible = new Set((await query).map((row: any) => row.entry_id));
      expect([...visible].sort()).toEqual(inScopeForNarrowed().map((key) => entry[key]).sort());
      // The three leaks the rule exists to stop.
      expect(visible.has(entry.adHocOwn)).toBe(true);
      expect(visible.has(entry.adHocColleague)).toBe(false);
      expect(visible.has(entry.nonBillableColleague)).toBe(false);
      expect(visible.has(entry.interactionNoneByColleague)).toBe(false);
    });

    it('timesheet entry reads contain nothing from client C and only the subject\'s own client-less entries', async () => {
      actAs(ids.narrowed);
      const want = inScopeForNarrowed().map((key) => entry[key]).sort();

      const viaCrud = await fetchEntriesForSheetCrud(ids.sheetNarrowed) as any[];
      expect(viaCrud.map((row) => row.entry_id).sort()).toEqual(want);
      const viaSheet = await fetchEntriesForSheet(ids.sheetNarrowed) as any[];
      expect(viaSheet.map((row) => row.entry_id).sort()).toEqual(want);

      // The work items the sheet lists are those of in-scope entries only.
      const workItems = await fetchWorkItemsForTimeSheet(ids.sheetNarrowed) as any[];
      const names = workItems.map((item) => item.name);
      expect(names).toEqual(expect.arrayContaining([`Ticket A ${mark}`, `Ticket B ${mark}`, 'Task A', 'Task B']));
      expect(names.join('|')).not.toMatch(/Ticket C|Task C/);
      expect(workItems.map((item) => item.work_item_id)).not.toContain(ids.interactionC);
      expect(workItems.map((item) => item.work_item_id)).not.toContain(ids.interactionNone);

      expect(hidden(await outcome(() => getTimeEntryById(entry.ticketC)))).toBe(true);
      expect(hidden(await outcome(() => getTimeEntryById(entry.taskC)))).toBe(true);
      expect(hidden(await outcome(() => getTimeEntryById(entry.adHocColleague)))).toBe(true);
      expect(hidden(await outcome(() => getTimeEntryById(entry.adHocOwn)))).toBe(false);
      expect(hidden(await outcome(() => getTimeEntryById(entry.ticketA)))).toBe(false);
    });

    it('ticket time summaries are computed over readable entries only', async () => {
      actAs(ids.narrowed);
      const summaryA = await ticketSummary(ids.ticketA);
      // In-scope ticket: unchanged. The reader's own entry is listed; the colleague's stays behind the existing
      // own-or-managed rule and is counted as hidden, exactly as before this slice.
      expect(summaryA.entries.map((e) => e.entry_id)).toEqual([entry.ticketA]);
      expect(summaryA).toMatchObject({ totalMinutes: 120, ownEntryCount: 1, othersEntryCount: 1, othersHiddenCount: 1 });

      // Ticket C: two entries exist (own and colleague's); none are readable, so nothing is listed or counted.
      const summaryC = await ticketSummary(ids.ticketC);
      expect(summaryC.entries).toEqual([]);
      expect(summaryC).toMatchObject({
        totalMinutes: 0, ownTotalMinutes: 0, ownEntryCount: 0,
        othersTotalMinutes: 0, othersEntryCount: 0, othersHiddenCount: 0, othersHiddenMinutes: 0,
      });
    });

    it('leaves an unrestricted internal user in the same tenant with everything', async () => {
      actAs(ids.unrestricted);
      const scope = await resolveTimeEntryReadScope(db, tenant, userRef(ids.unrestricted));
      expect(scope.narrowed).toBe(false);

      const sheet = await fetchEntriesForSheetCrud(ids.sheetNarrowed) as any[];
      expect(sheet.map((row) => row.entry_id).sort()).toEqual(allEntryIds().sort());
      const summaryC = await ticketSummary(ids.ticketC);
      // Same two entries, none of them the reader's own: counted and hidden by the existing own-or-managed rule.
      expect(summaryC).toMatchObject({ totalMinutes: 120, othersEntryCount: 2, othersHiddenCount: 2, entries: [] });
      expect(hidden(await outcome(() => getTimeEntryById(entry.adHocColleague)))).toBe(false);
    });
  });

  describe('neutrality', () => {
    it('a tenant with no published bundle takes the fast path: no subject, no rule loading, no extra statement beyond the tenant probe', async () => {
      const bareTenant = await createTenant(db, `Bare ${mark}`);
      const user = await createUser(db, bareTenant, { user_type: 'internal' });
      const statements: string[] = [];
      const record = (q: any) => statements.push(String(q.sql));
      db.on('query', record);
      try {
        const scope = await resolveTimeEntryReadScope(db, bareTenant, { user_id: user, user_type: 'internal' });
        expect(scope.narrowed).toBe(false);
      } finally {
        db.removeListener('query', record);
      }
      expect(statements).toHaveLength(1);
      await db.raw('DELETE FROM users WHERE tenant = ?::uuid', [bareTenant]).catch(() => undefined);
    });
  });
});
