import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TestContext } from '../../../../test-utils/testContext';
import { createClient, createUser } from '../../../../test-utils/testDataFactory';
import { setUserClientPortfolio } from '@alga-psa/authorization/portfolios/service';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import {
  createScheduleEntryReadScope,
  isScheduleEntryReadable,
  unreadableScheduleEntryIds,
} from '@alga-psa/authorization/scheduleEntryReadAuthorization';
import {
  dropForeignTenant,
  seedPolymorphicFixture,
  type PolymorphicFixture,
} from './polymorphicClientFixture';

// T013 (S11, alga-2026-0003208). A subject restricted to clients A and B; a colleague has a schedule entry on a
// ticket of client C. The schedule read returns that entry as busy time (times intact, no title, no work item),
// and work item search and the ticket lookup do not return client C's ticket. An unrestricted user sees it all.

const auth = vi.hoisted(() => ({ user: null as any, db: null as any }));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    withAuth: (action: any) => async (...args: unknown[]) => action(auth.user, { tenant: auth.user.tenant }, ...args),
    hasPermission: vi.fn(async () => true),
  };
});

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, createTenantKnex: async () => ({ knex: auth.db, tenant: auth.user.tenant }) };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;

describe('schedule, dispatch and ticket lookups respect client scope (T013)', () => {
  let ctx: TestContext;
  let fx: PolymorphicFixture;
  let clientC: string;
  let ticketC: string;
  let colleague: string;
  const entry: Record<string, string> = {};
  const day = new Date('2031-03-10T09:00:00.000Z');
  const range = { start: new Date('2031-03-10T00:00:00.000Z'), end: new Date('2031-03-11T00:00:00.000Z') };

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'schedule_entry_assignees', 'user_client_portfolios',
        'authorization_bundle_assignments', 'authorization_bundles',
      ],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    fx = await seedPolymorphicFixture(ctx.db, ctx.tenantId, ctx.userId);
    clientC = await createClient(ctx.db, ctx.tenantId, 'Polymorphic C');
    ticketC = randomUUID();
    await ctx.db('tickets').insert({ tenant: ctx.tenantId, ticket_id: ticketC, ticket_number: `T-C-${ticketC.slice(0, 8)}`, title: 'Ticket C secret', client_id: clientC });
    await ctx.db('tickets').where({ tenant: ctx.tenantId, ticket_id: fx.a.ticketId }).update({ title: 'Ticket A' });
    await ctx.db('tickets').where({ tenant: ctx.tenantId, ticket_id: fx.b.ticketId }).update({ title: 'Ticket B' });

    // The searches default to open tickets, which need a status.
    const statusId = randomUUID();
    await ctx.db('statuses').insert({ tenant: ctx.tenantId, status_id: statusId, name: `Open ${statusId.slice(0, 6)}`, status_type: 'ticket', order_number: 1, is_closed: false });
    await ctx.db('tickets').where({ tenant: ctx.tenantId }).whereIn('ticket_id', [fx.a.ticketId, fx.b.ticketId, ticketC]).update({ status_id: statusId });

    colleague = await createUser(ctx.db, ctx.tenantId);
    const mk = async (label: string, type: string, workItemId: string | null) => {
      const [row] = await ctx.db('schedule_entries').insert({
        tenant: ctx.tenantId, title: `Title ${label}`, notes: `Notes ${label}`, status: 'scheduled',
        work_item_id: workItemId, work_item_type: type,
        scheduled_start: day, scheduled_end: new Date(day.getTime() + 3_600_000),
      }).returning('entry_id');
      entry[label] = String(row.entry_id);
      await ctx.db('schedule_entry_assignees').insert({ tenant: ctx.tenantId, entry_id: entry[label], user_id: colleague });
    };
    await mk('A', 'ticket', fx.a.ticketId);
    await mk('B', 'ticket', fx.b.ticketId);
    await mk('C', 'ticket', ticketC);
    await mk('adHoc', 'ad_hoc', null);
    await mk('deleted', 'ticket', randomUUID());
    await mk('foreign', 'ticket', fx.foreignTicketId);

    auth.db = ctx.db;
    auth.user = { ...ctx.user, tenant: ctx.tenantId, user_type: 'internal', roles: [] };
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await dropForeignTenant(ctx.db, fx);
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  /** Restrict the signed-in user to clients A and B: portfolio rows plus a published ticket:read client_portfolio bundle. */
  async function restrictToAAndB(redactField?: string): Promise<void> {
    await setUserClientPortfolio(ctx.db, { tenant: ctx.tenantId, userId: ctx.userId, clientIds: [fx.a.clientId, fx.b.clientId] });
    const created = await createAuthorizationBundle(ctx.db, { tenant: ctx.tenantId, name: `Scoped-${randomUUID()}`, actorUserId: ctx.userId });
    await upsertBundleRule(ctx.db, {
      tenant: ctx.tenantId, bundleId: created.bundleId, revisionId: created.revisionId,
      resourceType: 'ticket', action: 'read', templateKey: 'client_portfolio', actorUserId: ctx.userId,
      ...(redactField ? { constraintKey: 'hide_sensitive_fields', config: { redactedFields: [redactField] } } : { config: {} }),
    });
    await publishBundleRevision(ctx.db as any, { tenant: ctx.tenantId, bundleId: created.bundleId, revisionId: created.revisionId, actorUserId: ctx.userId });
    await createBundleAssignment(ctx.db, { tenant: ctx.tenantId, bundleId: created.bundleId, targetType: 'user', targetId: ctx.userId, actorUserId: ctx.userId });
  }

  const scheduleRead = async () => {
    const { getScheduleEntries } = await import('@alga-psa/scheduling/actions/scheduleActions');
    const result: any = await getScheduleEntries(range.start, range.end);
    expect(result.success).toBe(true);
    return new Map<string, any>((result.entries as any[]).map((e) => [e.entry_id, e]));
  };
  const picker = async () => {
    const { searchPickerWorkItems } = await import('@alga-psa/scheduling/actions/workItemActions');
    const result: any = await searchPickerWorkItems({ searchTerm: 'Ticket', type: 'ticket', statusFilter: 'all_open' } as any);
    return result.items.map((i: any) => i.work_item_id).sort();
  };
  const dispatchSearch = async () => {
    const { searchDispatchWorkItems } = await import('@alga-psa/scheduling/actions/workItemActions');
    const result: any = await searchDispatchWorkItems({ searchTerm: 'Ticket', statusFilter: 'all_open' } as any);
    return result.items.map((i: any) => i.work_item_id).sort();
  };

  it('masks the colleague entry for a restricted viewer, keeps times, and narrows searches and lookups', async () => {
    await restrictToAAndB();
    const { hasPermission } = await import('@alga-psa/auth');
    // Entries of other users are visible to the viewer as a dispatcher (user_schedule:update), but not necessarily readable.
    vi.mocked(hasPermission).mockImplementation(async () => true);

    const entries = await scheduleRead();

    const masked = entries.get(entry.C);
    expect(masked).toBeDefined();
    expect(masked.access).toBe('busy');
    expect(masked.title).toBe('Busy');
    expect(masked.notes).toBe('');
    expect(masked.work_item_id).toBeNull();
    expect(masked.work_item_type).toBe('ad_hoc');
    expect(new Date(masked.scheduled_start).toISOString()).toBe(day.toISOString());
    expect(new Date(masked.scheduled_end).toISOString()).toBe(new Date(day.getTime() + 3_600_000).toISOString());
    expect(masked.assigned_user_ids).toContain(colleague);
    expect(JSON.stringify(masked)).not.toContain(ticketC);

    // In-scope entries stay whole.
    for (const label of ['A', 'B'] as const) {
      expect(entries.get(entry[label]).title).toBe(`Title ${label}`);
      expect(entries.get(entry[label]).work_item_type).toBe('ticket');
    }
    // Entries with no client by design are internal calendar items and stay whole.
    expect(entries.get(entry.adHoc).title).toBe('Title adHoc');
    // Fail closed: a deleted work item and another tenant's ticket resolve to no client.
    for (const label of ['deleted', 'foreign'] as const) {
      expect(entries.get(entry[label]).access).toBe('busy');
      expect(entries.get(entry[label]).title).toBe('Busy');
    }

    // Single entry read: same decision through the row facet.
    const { getScheduleEntryById } = await import('@alga-psa/scheduling/actions/scheduleActions');
    const single: any = await getScheduleEntryById(entry.C);
    expect(single.title).toBe('Busy');
    expect(single.work_item_id).toBeNull();
    expect(((await getScheduleEntryById(entry.A)) as any).title).toBe('Title A');

    // Work item search and ticket lookup.
    expect(await picker()).toEqual([fx.a.ticketId, fx.b.ticketId].sort());
    expect(await dispatchSearch()).toEqual([fx.a.ticketId, fx.b.ticketId].sort());
    const { getSchedulingTicketById } = await import('@alga-psa/scheduling/actions/ticketLookupActions');
    expect(await getSchedulingTicketById(ticketC)).toBeNull();
    expect((await getSchedulingTicketById(fx.a.ticketId))?.ticket_id).toBe(fx.a.ticketId);
    const { getWorkItemById } = await import('@alga-psa/scheduling/actions/workItemActions');
    expect(((await getWorkItemById(ticketC, 'ticket')) as any)).toBeNull();
    expect(((await getWorkItemById(fx.b.ticketId, 'ticket')) as any)?.work_item_id).toBe(fx.b.ticketId);
  }, HOOK_TIMEOUT);

  it('a policy the SQL compiler cannot express falls back to the per-row kernel and still narrows the query', async () => {
    await restrictToAAndB('internal_cost');
    expect(await picker()).toEqual([fx.a.ticketId, fx.b.ticketId].sort());
    expect(await dispatchSearch()).toEqual([fx.a.ticketId, fx.b.ticketId].sort());
    const { getSchedulingTicketById } = await import('@alga-psa/scheduling/actions/ticketLookupActions');
    expect(await getSchedulingTicketById(ticketC)).toBeNull();
    expect((await getSchedulingTicketById(fx.a.ticketId))?.ticket_id).toBe(fx.a.ticketId);
  }, HOOK_TIMEOUT);

  it('control: an unrestricted user sees the full entry and every ticket', async () => {
    const entries = await scheduleRead();
    expect(entries.get(entry.C).title).toBe('Title C');
    expect(entries.get(entry.C).work_item_id).toBe(ticketC);
    expect(entries.get(entry.deleted).title).toBe('Title deleted');
    expect(await picker()).toEqual([fx.a.ticketId, fx.b.ticketId, ticketC].sort());
    expect(await dispatchSearch()).toEqual([fx.a.ticketId, fx.b.ticketId, ticketC].sort());
    const { getSchedulingTicketById } = await import('@alga-psa/scheduling/actions/ticketLookupActions');
    expect((await getSchedulingTicketById(ticketC))?.ticket_id).toBe(ticketC);
  }, HOOK_TIMEOUT);

  it('fail closed: unknown work item types, deleted work items and other tenants resolve to unreadable; no-client items do not', async () => {
    await restrictToAAndB();
    const scope = await createScheduleEntryReadScope(ctx.db, ctx.tenantId, auth.user);
    expect(scope.restricted).toBe(true);

    // Row facet.
    const readable = (type: string, id: string | null) =>
      isScheduleEntryReadable(ctx.db, scope, { entry_id: randomUUID(), work_item_type: type, work_item_id: id });
    expect(await readable('ticket', fx.a.ticketId)).toBe(true);
    expect(await readable('ticket', ticketC)).toBe(false);
    expect(await readable('ticket', randomUUID())).toBe(false); // deleted
    expect(await readable('ticket', fx.foreignTicketId)).toBe(false); // another tenant's id
    expect(await readable('project_task', fx.a.ticketId)).toBe(false); // right id, wrong kind
    expect(await readable('co_managed', fx.a.ticketId)).toBe(false); // a type nobody registered
    expect(await readable('ad_hoc', null)).toBe(true); // no client by design
    expect(await readable('ad_hoc', fx.a.ticketId)).toBe(true);

    // SQL facet agrees with the row facet on every stored entry.
    const refs = Object.values(entry).map((id) => ({ entry_id: id }));
    const rows = await ctx.db('schedule_entries').where({ tenant: ctx.tenantId }).whereIn('entry_id', refs.map((r) => r.entry_id)).select('entry_id', 'work_item_id', 'work_item_type');
    const sqlUnreadable = await unreadableScheduleEntryIds(ctx.db, scope, rows);
    const rowUnreadable = new Set<string>();
    for (const r of rows) if (!(await isScheduleEntryReadable(ctx.db, scope, r))) rowUnreadable.add(r.entry_id);
    expect([...sqlUnreadable].sort()).toEqual([...rowUnreadable].sort());
    expect(sqlUnreadable).toEqual(new Set([entry.C, entry.deleted, entry.foreign]));
  }, HOOK_TIMEOUT);
});
