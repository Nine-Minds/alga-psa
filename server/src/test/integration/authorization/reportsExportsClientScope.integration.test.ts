/**
 * T017 (alga-2026-0003213, S16): reports and exports honor client scope.
 *
 *  - F026: the report engine narrows every client-owned table a definition names (found through the S3 ownership
 *    declaration) to the subject's clients, and refuses a report it cannot narrow, with a typed reason. A subject
 *    nothing narrows runs every report exactly as before.
 *  - F027: the client, contact, time-entry and ticket CSV exports produce only records the subject may read.
 *
 * Fixture: clients A, B, C, each with a contact, a ticket and a project task; time entries on every ticket plus ad hoc
 * entries; one contact with no client. One internal user has a portfolio of {A, B} and a bundle that narrows by
 * `client_portfolio`; a second has no restriction. Real kernel, real bundle service, real DB; only the session seam
 * (withAuth), the DB handle and the coarse RBAC grant are stood in for.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../../test-utils/testDataFactory';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { setUserClientPortfolio } from '@alga-psa/authorization/portfolios/service';
import { TICKET_STATUS_FILTER_ALL } from '@alga-psa/tickets/lib';
import type { ITicketListFilters } from '@alga-psa/types';

const ref = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '', user: null as any }));

vi.mock('next/cache', async (importOriginal) => ({ ...(await importOriginal<any>()), revalidatePath: vi.fn() }));
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
vi.mock('../../../../../packages/user-composition/src/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/tenancy/actions', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getHierarchicalLocaleAction: vi.fn(async () => 'en'),
}));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/formatting/avatarUtils', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getContactAvatarUrl: vi.fn().mockResolvedValue(null),
  getContactAvatarUrlsBatch: vi.fn().mockResolvedValue(new Map()),
  getClientLogoUrl: vi.fn().mockResolvedValue(null),
  getUserAvatarUrl: vi.fn().mockResolvedValue(null),
  getClientLogoUrlsBatch: vi.fn().mockResolvedValue(new Map()),
  getEntityImageUrlsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import { ReportEngine } from '../../../../../packages/reporting/src/lib/reports/core/ReportEngine';
import { ReportClientScopeRefusedError, type ReportDefinition } from '../../../../../packages/reporting/src/lib/reports/core/types';
import { executeReport } from '../../../../../packages/reporting/src/lib/reports/actions/executeReport';
import { getTicketWorkloadReport, getEmailChannelHealthReport } from '../../../../../packages/reporting/src/actions/helpdeskReportActions';
import { getDeferredRevenueReport } from '../../../../../packages/reporting/src/actions/report-actions/getDeferredRevenueReport';
import { getRecentClientInvoices } from '../../../../../packages/reporting/src/actions/report-actions/getRecentClientInvoices';
import { fetchClientsForDropdown } from '../../../../../packages/reporting/src/actions/clientDropdownActions';
import { exportClientsToCSV } from '../../../../../packages/clients/src/actions/clientActions';
import { exportTicketsToCSV } from '../../../../../packages/tickets/src/actions/ticketExportActions';
import { ContactService } from '../../../lib/api/services/ContactService';
import { TimeEntryService } from '../../../lib/api/services/TimeEntryService';

const HOOK_TIMEOUT = 900_000;
const isRefusal = (value: unknown): value is { actionError: string; messageKey?: string } =>
  Boolean(value && typeof value === 'object' && (typeof (value as any).actionError === 'string' || typeof (value as any).permissionError === 'string'));

describe('T017: reports and exports honor client scope (real kernel, real DB)', () => {
  let db: Knex;
  let tenant: string;
  const mark = uuidv4().slice(0, 8);
  const clients = { a: uuidv4(), b: uuidv4(), c: uuidv4() };
  const contacts = { a: uuidv4(), b: uuidv4(), c: uuidv4(), orphan: uuidv4() };
  const ids = { admin: '', restricted: '', colleague: '', unrestricted: '', board: '', status: '', priority: '', projectStatus: '', period: uuidv4(), sheetRestricted: uuidv4(), sheetUnrestricted: uuidv4() };
  const tickets = { a: uuidv4(), b: uuidv4(), c: uuidv4() };
  const entry: Record<string, string> = {};
  const nameOf = (key: 'a' | 'b' | 'c') => `Client ${key.toUpperCase()} ${mark}`;

  const asUser = (userId: string) => {
    ref.tenant = tenant;
    ref.user = { user_id: userId, user_type: 'internal', tenant, roles: [{ role_name: 'admin' }], email: `${userId}@example.com` };
  };
  const subject = (userId: string) => ({ user_id: userId, user_type: 'internal', tenant }) as any;
  const serviceContext = (userId: string) => ({ tenant, userId, user: subject(userId) }) as any;

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
    tenant = await createTenant(db, `Reports exports scope ${mark}`);
    ref.tenant = tenant;
    ids.admin = await createUser(db, tenant, { first_name: 'Ada', last_name: 'Admin' });
    ids.restricted = await createUser(db, tenant, { user_type: 'internal', first_name: 'Nora', last_name: 'Narrowed' });
    ids.colleague = await createUser(db, tenant, { user_type: 'internal', first_name: 'Cole', last_name: 'Colleague' });
    ids.unrestricted = await createUser(db, tenant, { user_type: 'internal', first_name: 'Uma', last_name: 'Unrestricted' });

    for (const key of ['a', 'b', 'c'] as const) {
      await db('clients').insert({ tenant, client_id: clients[key], client_name: nameOf(key), billing_cycle: 'monthly', is_tax_exempt: false });
      await db('contacts').insert({ tenant, contact_name_id: contacts[key], full_name: `Contact ${key.toUpperCase()} ${mark}`, client_id: clients[key], email: `${key}-${mark}@example.com`, is_inactive: false });
    }
    await db('contacts').insert({ tenant, contact_name_id: contacts.orphan, full_name: `Contact ORPHAN ${mark}`, client_id: null, email: `orphan-${mark}@example.com`, is_inactive: false });

    ids.board = uuidv4(); ids.status = uuidv4(); ids.priority = uuidv4(); ids.projectStatus = uuidv4();
    await db('boards').insert({ tenant, board_id: ids.board, board_name: 'Support', is_default: true, is_inactive: false });
    await db('priorities').insert({ tenant, priority_id: ids.priority, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: ids.admin });
    await db('statuses').insert({ tenant, status_id: ids.status, board_id: ids.board, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: ids.admin });
    await db('statuses').insert({ tenant, status_id: ids.projectStatus, name: 'Active', status_type: 'project', is_closed: false, is_default: true, order_number: 10, created_by: ids.admin });

    for (const [label, key] of [['A', 'a'], ['B', 'b'], ['C', 'c']] as const) {
      await db('tickets').insert({
        tenant, ticket_id: tickets[key], ticket_number: `T-${mark}-${label}`, title: `Ticket ${label} ${mark}`,
        client_id: clients[key], contact_name_id: contacts[key], board_id: ids.board, status_id: ids.status, priority_id: ids.priority, entered_by: ids.admin,
      });
      const projectId = uuidv4(); const phaseId = uuidv4(); const wbs = `1${label.charCodeAt(0) - 64}`;
      await db('projects').insert({ tenant, project_id: projectId, project_name: `Project ${label} ${mark}`, client_id: clients[key], status: ids.projectStatus, wbs_code: wbs, project_number: `P-${mark}-${label}`, is_inactive: false });
      await db('project_phases').insert({ tenant, phase_id: phaseId, project_id: projectId, phase_name: `Phase ${label}`, status: 'active', order_number: 1, wbs_code: `${wbs}.1` });
      await db('project_tasks').insert({ tenant, task_id: uuidv4(), phase_id: phaseId, task_name: `Task ${label} ${mark}`, wbs_code: `${wbs}.1.1` });
    }

    await db('time_periods').insert({ tenant, period_id: ids.period, start_date: '2026-01-05', end_date: '2026-01-12' });
    await db('time_sheets').insert({ tenant, id: ids.sheetRestricted, user_id: ids.restricted, period_id: ids.period, approval_status: 'DRAFT' });
    await db('time_sheets').insert({ tenant, id: ids.sheetUnrestricted, user_id: ids.unrestricted, period_id: ids.period, approval_status: 'DRAFT' });
    let hour = 0;
    for (const key of ['a', 'b', 'c'] as const) {
      await insertEntry(`ticket${key.toUpperCase()}`, ids.restricted, ids.sheetRestricted, 'ticket', tickets[key], hour++);
    }
    await insertEntry('adHocOwn', ids.restricted, ids.sheetRestricted, 'ad_hoc', uuidv4(), hour++);
    await insertEntry('adHocColleague', ids.colleague, ids.sheetRestricted, 'ad_hoc', uuidv4(), hour++);

    // The "starter" shape: a portfolio-driven bundle. The user's portfolio is {A, B}; the bundle narrows every read the
    // reports and exports touch by `client_portfolio`.
    const bundle = await createAuthorizationBundle(db, { tenant, name: `portfolio-${mark}`, actorUserId: ids.admin });
    for (const resourceType of ['client', 'contact', 'ticket', 'time_entry']) {
      await upsertBundleRule(db, {
        tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType, action: 'read', templateKey: 'client_portfolio', actorUserId: ids.admin,
      });
    }
    await publishBundleRevision(db as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: ids.admin });
    await createBundleAssignment(db, { tenant, bundleId: bundle.bundleId, targetType: 'user', targetId: ids.restricted, actorUserId: ids.admin });
    await setUserClientPortfolio(db, { tenant, userId: ids.restricted, clientIds: [clients.a, clients.b] });
  }, HOOK_TIMEOUT);

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

  // ------------------------------------------------------------------ F026: reports

  const metric = (id: string, query: ReportDefinition['metrics'][number]['query']) => ({ id, name: id, type: 'count' as const, query });
  const reportOf = (id: string, metrics: ReportDefinition['metrics']): ReportDefinition => ({
    id, name: id, description: id, category: 'operations', version: '1.0.0', metrics,
    permissions: { roles: ['admin'], resources: [] },
  });
  const countOf = async (definition: ReportDefinition, userId: string | null) => {
    const result = await ReportEngine.execute(definition, {}, userId ? { scopeSubject: subject(userId) } : {}, tenant);
    return Object.fromEntries(Object.entries(result.metrics).map(([key, value]) => [key, Number(value)]));
  };

  const ownedTablesReport = () => reportOf('test.owned', [
    // column ownership
    metric('tickets', { table: 'tickets', aggregation: 'count', filters: [{ field: 'ticket_number', operator: 'like', value: `T-${mark}-%` }] }),
    metric('clients', { table: 'clients', aggregation: 'count', filters: [{ field: 'client_name', operator: 'like', value: `%${mark}` }] }),
    // parent-chain ownership (project_tasks -> project_phases -> projects)
    metric('tasks', { table: 'project_tasks', aggregation: 'count', filters: [{ field: 'task_name', operator: 'like', value: `%${mark}` }] }),
    // resolver ownership (time_entries -> work item -> client); ad hoc entries are visible to their own user only
    metric('timeEntries', { table: 'time_entries', aggregation: 'count', filters: [{ field: 'notes', operator: 'like', value: `%-${mark}` }] }),
    // a join: every inner-joined client-owned table is narrowed, so the join cannot bring C back in
    metric('ticketsWithClient', {
      table: 'tickets', aggregation: 'count',
      joins: [{ type: 'inner', table: 'clients', on: [{ left: 'tickets.client_id', right: 'clients.client_id' }, { left: 'tickets.tenant', right: 'clients.tenant' }] }],
      filters: [{ field: 'tickets.ticket_number', operator: 'like', value: `T-${mark}-%` }],
    }),
  ]);

  it('narrows every client-owned table of an engine report for a restricted user (column, chain, resolver, join)', async () => {
    const restricted = await countOf(ownedTablesReport(), ids.restricted);
    expect(restricted).toEqual({
      tickets: 2, clients: 2, tasks: 2, ticketsWithClient: 2,
      // tickets A and B (own entries) + the restricted user's own ad hoc entry; the colleague's ad hoc entry and C are out
      timeEntries: 3,
    });
  }, HOOK_TIMEOUT);

  it('leaves an unrestricted user, and a system caller, with every row', async () => {
    const everything = { tickets: 3, clients: 3, tasks: 3, ticketsWithClient: 3, timeEntries: 5 };
    expect(await countOf(ownedTablesReport(), ids.unrestricted)).toEqual(everything);
    expect(await countOf(ownedTablesReport(), null)).toEqual(everything);
  }, HOOK_TIMEOUT);

  it('refuses a report it cannot narrow for the restricted user, naming the reason, and still runs it for others', async () => {
    const undeclared = reportOf('test.undeclared', [metric('lines', { table: 'contract_lines', aggregation: 'count' })]);
    const raw = reportOf('test.raw', [metric('raw', { table: 'raw_sql', fields: ['SELECT 1 AS one'] })]);

    const refusalOf = async (definition: ReportDefinition) => {
      try {
        await ReportEngine.execute(definition, {}, { scopeSubject: subject(ids.restricted) }, tenant);
      } catch (error) {
        return error;
      }
      return null;
    };
    const undeclaredRefusal = await refusalOf(undeclared);
    expect(undeclaredRefusal).toBeInstanceOf(ReportClientScopeRefusedError);
    expect((undeclaredRefusal as ReportClientScopeRefusedError).refusal).toMatchObject({ code: 'undeclared_table', table: 'contract_lines', reportId: 'test.undeclared', metricId: 'lines' });
    expect(((await refusalOf(raw)) as ReportClientScopeRefusedError).refusal).toMatchObject({ code: 'raw_sql', metricId: 'raw' });

    // Not run at all: one refused metric refuses the report; there is no partial, un-narrowed answer.
    const mixed = reportOf('test.mixed', [...ownedTablesReport().metrics, ...undeclared.metrics]);
    expect(await refusalOf(mixed)).toBeInstanceOf(ReportClientScopeRefusedError);

    // The same reports run for the unrestricted user.
    expect(await countOf(undeclared, ids.unrestricted)).toHaveProperty('lines');
    expect(await countOf(raw, ids.unrestricted)).toHaveProperty('raw');
  }, HOOK_TIMEOUT);

  it('shows the refusal through the reporting error path for a registered report, and runs it for the unrestricted user', async () => {
    asUser(ids.restricted);
    const refused = await executeReport({ reportId: 'contracts.revenue' });
    expect(isRefusal(refused)).toBe(true);
    expect((refused as any).messageKey).toMatch(/^msp\/reports:errors\.report\.clientScopeRefused\./);
    expect((refused as any).actionError).toMatch(/cannot be limited to your clients/);

    asUser(ids.unrestricted);
    const ran = await executeReport({ reportId: 'contracts.revenue' });
    expect(isRefusal(ran)).toBe(false);
    expect((ran as any).reportId).toBe('contracts.revenue');
  }, HOOK_TIMEOUT);

  it('narrows the hand-written ticket workload report and refuses reports it cannot narrow', async () => {
    asUser(ids.restricted);
    const restricted: any = await getTicketWorkloadReport(90);
    expect(isRefusal(restricted)).toBe(false);
    expect(restricted.summary.open).toBe(2);
    expect(isRefusal(await getEmailChannelHealthReport(90))).toBe(true);
    expect(isRefusal(await getDeferredRevenueReport({ month: '2026-01' }))).toBe(true);

    asUser(ids.unrestricted);
    expect(((await getTicketWorkloadReport(90)) as any).summary.open).toBe(3);
    expect(isRefusal(await getEmailChannelHealthReport(90))).toBe(false);
    expect(isRefusal(await getDeferredRevenueReport({ month: '2026-01' }))).toBe(false);
  }, HOOK_TIMEOUT);

  it('refuses a per-client report for a client outside the scope and lists only readable clients in the dropdown', async () => {
    asUser(ids.restricted);
    expect(isRefusal(await getRecentClientInvoices({ clientId: clients.c }))).toBe(true);
    expect(isRefusal(await getRecentClientInvoices({ clientId: clients.a }))).toBe(false);
    const dropdown = (await fetchClientsForDropdown()) as Array<{ id: string; name: string }>;
    expect(dropdown.filter((row) => row.name.endsWith(mark)).map((row) => row.name).sort()).toEqual([nameOf('a'), nameOf('b')]);

    asUser(ids.unrestricted);
    expect(isRefusal(await getRecentClientInvoices({ clientId: clients.c }))).toBe(false);
    expect(((await fetchClientsForDropdown()) as any[]).filter((row) => row.name.endsWith(mark))).toHaveLength(3);
  }, HOOK_TIMEOUT);

  // ------------------------------------------------------------------ F027: exports

  describe('F027 exports', () => {
    const asInput = (...keys: Array<'a' | 'b' | 'c'>) => keys.map((key) => ({ client_id: clients[key], client_name: `FORGED ${key}` })) as any;

    it('client export: no C rows, even when the caller passes C; values come from the database, not the browser', async () => {
      asUser(ids.restricted);
      const csv = (await exportClientsToCSV(asInput('a', 'b', 'c'))) as string;
      expect(csv).toContain(nameOf('a'));
      expect(csv).toContain(nameOf('b'));
      expect(csv).not.toContain(nameOf('c'));
      expect(csv).not.toContain('FORGED');
      expect(((await exportClientsToCSV(asInput('c'))) as string)).not.toContain(nameOf('c'));

      asUser(ids.unrestricted);
      const all = (await exportClientsToCSV(asInput('a', 'b', 'c'))) as string;
      for (const key of ['a', 'b', 'c'] as const) expect(all).toContain(nameOf(key));
    }, HOOK_TIMEOUT);

    it('contact export: no C contacts and no contact without a client', async () => {
      const service = new ContactService();
      vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant });
      const names = async (userId: string) =>
        ((JSON.parse(await service.exportContacts({}, 'json', serviceContext(userId))) as any[]).map((row) => row.full_name as string))
          .filter((name) => name.endsWith(mark)).sort();

      expect(await names(ids.restricted)).toEqual([`Contact A ${mark}`, `Contact B ${mark}`]);
      expect(await names(ids.unrestricted)).toEqual([`Contact A ${mark}`, `Contact B ${mark}`, `Contact C ${mark}`, `Contact ORPHAN ${mark}`]);
      const csv = await service.exportContacts({}, 'csv', serviceContext(ids.restricted));
      expect(csv).not.toContain(`Contact C ${mark}`);
      expect(csv).not.toContain(`Contact ORPHAN ${mark}`);
    }, HOOK_TIMEOUT);

    it('time-entry export: nothing on C, and ad hoc entries only for their own user', async () => {
      const service = new TimeEntryService();
      vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant });
      const keys = async (userId: string) => {
        const rows = (await service.exportTimeEntries({ format: 'json' } as any, serviceContext(userId))) as any[];
        const byId = new Map(Object.entries(entry).map(([key, id]) => [id, key]));
        return rows.map((row) => byId.get(row.entry_id)).filter(Boolean).sort();
      };

      expect(await keys(ids.restricted)).toEqual(['adHocOwn', 'ticketA', 'ticketB']);
      expect(await keys(ids.unrestricted)).toEqual(['adHocColleague', 'adHocOwn', 'ticketA', 'ticketB', 'ticketC']);
    }, HOOK_TIMEOUT);

    it('ticket export: no C tickets for the restricted user, all of them for the unrestricted one', async () => {
      const filters: ITicketListFilters = { boardFilterState: 'all', statusId: TICKET_STATUS_FILTER_ALL, showOpenOnly: false, bundleView: 'individual' } as any;
      asUser(ids.restricted);
      const restricted: any = await exportTicketsToCSV(filters);
      expect(restricted.csv).toContain(`T-${mark}-A`);
      expect(restricted.csv).toContain(`T-${mark}-B`);
      expect(restricted.csv).not.toContain(`T-${mark}-C`);

      asUser(ids.unrestricted);
      const all: any = await exportTicketsToCSV(filters);
      expect(all.csv).toContain(`T-${mark}-C`);
    }, HOOK_TIMEOUT);
  });
});
