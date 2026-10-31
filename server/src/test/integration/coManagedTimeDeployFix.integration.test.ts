/**
 * L6a2 deploy-fix round: drawer payload, co_managed time sheets, operational no-service save, shared-ticket Quick Invoice, against real rows in a migrated Postgres
 * (connectL3cDb: set TEST_DB_NAME and L3C_DB_PORT to point at an already migrated database).
 * The fixture is an accepted relationship from the L3c onboarding seeds plus a customer ticket escalated
 * through the real handoff. Authentication is the only substitution: the acting user/session is switched per call.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { tenantDb, runWithTenant } from '@alga-psa/db';

const actor = vi.hoisted(() => ({ user: null as any, session: null as any }));
const dbRef = vi.hoisted(() => ({ db: null as any }));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
  getSecret: async (_n: string, e?: string, f = '') => (e ? process.env[e] : undefined) ?? f,
}));
vi.mock('@alga-psa/db', async importOriginal => {
  const real = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...real, getConnection: async () => dbRef.db, getAdminConnection: async () => dbRef.db,
    createTenantKnex: async (tenant?: string) => ({ knex: dbRef.db, tenant: tenant ?? actor.user?.tenant }) };
});
vi.mock('@alga-psa/auth', async importOriginal => {
  const real = await importOriginal<typeof import('@alga-psa/auth')>();
  return { ...real, withAuth: (handler: any) => (...args: any[]) => handler(actor.user, { tenant: actor.user.tenant }, ...args),
    getSession: async () => actor.session, getApiKeyUserOverride: () => null };
});

import { configureL3cDbEnv, connectL3cDb, seedL3cWorld, seedL3cProject, shareProject, cleanupL3cTenants, type L3cWorld } from './helpers/coManagedL3cFixture';
import { configureL3cDbEnv, connectL3cDb, seedL3cWorld, cleanupL3cTenants } from './helpers/coManagedL3cFixture';
import { buildTimeFixture, type Session } from './helpers/coManagedTimeFixture';
import { registerCoManagedTimeSource } from '../../lib/co-managed/timeSource';
import { registerCoManagedTimeEntryWorkContributor } from '../../lib/co-managed/timeWorkContext';
import { registerFeatureFlagChecker } from '../../../../packages/core/src/lib/features';
import { clearCapabilityCache } from '../../../../packages/core/src/capability/testing';

let db: Knex;
const tenants: string[] = [];

beforeAll(async () => {
  configureL3cDbEnv();
  process.env.CAPABILITY_CACHE_TTL_MS = '0';
  db = await connectL3cDb();
  dbRef.db = db;
  registerFeatureFlagChecker(async () => true);
  registerCoManagedTimeSource();
  registerCoManagedTimeEntryWorkContributor();
}, 180_000);

afterEach(() => { clearCapabilityCache(); delete process.env.FORCE_CAPABILITIES; });
afterAll(async () => { await cleanupL3cTenants(tenants); await db?.destroy().catch(() => undefined); });

const hooks = {
  actAs: (user: any, session: Session) => {
    actor.user = user;
    actor.session = { session_id: session.sessionId, user: { id: user.user_id, tenant: user.tenant, user_type: user.user_type } };
  },
  loadUser: async (session: Session) => tenantDb(db, session.tenant).table('users').where('user_id', session.userId).first(),
};

async function withTime(work: (f: any) => Promise<void>) {
  const w = await seedL3cWorld(db);
  tenants.push(...w.tenants);
  const escalationBoardId = randomUUID();
  await tenantDb(db, w.sponsor).table('boards').insert({ tenant: w.sponsor, board_id: escalationBoardId, board_name: 'Escalations', is_inactive: false });
  await tenantDb(db, w.customer).table('co_management_relationships').where('relationship_id', w.relationshipId).update({ escalation_board_id: escalationBoardId });
  const customerAdmin: Session = { kind: 'session', tenant: w.customer, userId: w.customerStaff.userId, sessionId: w.customerStaff.sessionId };
  const f: any = await buildTimeFixture(db, { sponsorTenant: w.sponsor, customerTenant: w.customer, relationshipId: w.relationshipId,
    sponsorClientId: w.sponsorClientId, escalationBoardId, customerAdmin }, hooks);
  await work(f);
}

const sponsorRows = (f: any, entryId: string) => f.sponsor.table('time_entries').where('entry_id', entryId).first();

describe.sequential('L6a2 deploy-fix round', () => {
  it('fix 1: the exact drawer payload (every blank field is an empty string) saves a commercial co_managed entry', () => withTime(async f => {
    const { saveTimeEntry } = await import('../../../../packages/scheduling/src/actions/timeEntryCrudActions');
    f.as(f.principal);
    await f.as(f.principal);
    const saved: any = await (saveTimeEntry as any)({
      entry_id: '', work_item_id: f.referenceId, work_item_type: 'co_managed', user_id: '', time_sheet_id: '', approval_status: '',
      service_id: f.serviceId, contract_line_id: '', tax_region: '', tax_rate_id: '', notes: 'drawer payload',
      start_time: '2026-08-08T10:00:00Z', end_time: '2026-08-08T10:30:00Z', billable_duration: 30,
    });
    expect(saved?.entry_id, JSON.stringify(saved)).toBeTruthy();
    const row = await sponsorRows(f, saved.entry_id);
    expect(row).toMatchObject({ billing_mode: 'commercial', work_item_type: 'co_managed', user_id: f.userId, billable_duration: 30, service_id: f.serviceId });
    const reference = await f.sponsor.table('co_managed_time_work_references').where('entry_id', saved.entry_id).first();
    expect(reference).toBeTruthy();
    expect(reference.ticket_number).toBeTruthy();
    expect(reference.title).toBe('Shared billable ticket');
    expect(await f.effort()).toMatchObject({ mspMinutes: 30 });
  }));

  it('fix 2: a time sheet holding a co_managed entry loads, submits and is approved, and the entry then invoices', () => withTime(async f => {
    const periodId = randomUUID(), sheetId = randomUUID();
    await f.sponsor.table('time_periods').insert({ tenant: f.base.sponsorTenant, period_id: periodId, start_date: '2026-08-03', end_date: '2026-08-16', is_closed: false });
    await f.sponsor.table('time_sheets').insert({ tenant: f.base.sponsorTenant, id: sheetId, user_id: f.userId, period_id: periodId, approval_status: 'DRAFT' });
    const extra = randomUUID();
    await f.sponsor.table('roles').insert({ tenant: f.base.sponsorTenant, role_id: extra, role_name: `sheet ${extra}`, description: 't', msp: true, client: false });
    for (const action of ['read', 'submit', 'approve']) {
      const permissionId = randomUUID();
      await f.sponsor.table('permissions').insert({ tenant: f.base.sponsorTenant, permission_id: permissionId, resource: 'time_sheet', action, msp: true, client: false });
      await f.sponsor.table('role_permissions').insert({ tenant: f.base.sponsorTenant, role_id: extra, permission_id: permissionId });
    }
    await f.sponsor.table('user_roles').insert({ tenant: f.base.sponsorTenant, user_id: f.userId, role_id: extra });

    const saved = await f.save({ time_sheet_id: sheetId });
    const { fetchTimeEntriesForTimeSheet } = await import('../../../../packages/scheduling/src/actions/timeSheetActions');
    const { submitTimeSheet } = await import('../../../../packages/scheduling/src/actions/timeSheetOperations');
    const { approveTimeSheet } = await import('../../../../packages/scheduling/src/actions/timeSheetActions');
    const { getTimeEntryById } = await import('../../../../packages/scheduling/src/actions/timeEntryCrudActions');
    const { fetchWorkItemsForTimeSheet } = await import('../../../../packages/scheduling/src/actions/timeEntryWorkItemActions');
    await f.as(f.principal);
    const entries: any = await (fetchTimeEntriesForTimeSheet as any)(sheetId);
    expect(Array.isArray(entries), JSON.stringify(entries)).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0].work_item_type).toBe('co_managed');
    const entry: any = await (getTimeEntryById as any)(saved.entry_id);
    expect(entry?.entry_id, JSON.stringify(entry)).toBe(saved.entry_id);
    const items: any = await (fetchWorkItemsForTimeSheet as any)(sheetId);
    expect(items.map((i: any) => i.type)).toContain('co_managed');
    expect(items.find((i: any) => i.type === 'co_managed').name).toBe('Shared billable ticket');

    const submitted: any = await (submitTimeSheet as any)(sheetId);
    expect(submitted?.approval_status, JSON.stringify(submitted)).toBe('SUBMITTED');
    const approved: any = await runWithTenant(f.base.sponsorTenant, () => (approveTimeSheet as any)(sheetId, f.userId));
    expect(approved?.error ?? approved?.permissionError, JSON.stringify(approved)).toBeUndefined();
    expect((await sponsorRows(f, saved.entry_id)).approval_status).toBe('APPROVED');
    const invoice = await f.generateInvoice();
    expect(invoice).toBeTruthy();
  }));

  it('fix 3: customer staff save operational time with no service; the MSP sees "Customer team"; the drawer answer is per work item', () => withTime(async f => {
    const { isServiceOptionalForWorkItem } = await import('../../../../packages/scheduling/src/actions/timeEntryWorkItemActions');
    await f.as(f.customerPrincipal);
    expect(await (isServiceOptionalForWorkItem as any)('ticket', f.ticketId)).toBe(true);
    const saved = await f.logOperational(30);
    const row = await f.customer.table('time_entries').where('entry_id', saved.entry_id).first();
    expect(row).toMatchObject({ billing_mode: 'operational', billable_duration: 0, service_id: null });
    expect(await f.effort()).toMatchObject({ customerMinutes: 30 });
    // The MSP's own commercial work is never service-optional.
    await f.as(f.principal);
    expect(await (isServiceOptionalForWorkItem as any)('co_managed', f.referenceId)).toBe(false);
  }));

  it('fix 3 neutrality: native work still requires a service, and a workspace with co-managed forced off cannot save a service-less customer entry', () => withTime(async f => {
    const { saveTimeEntry } = await import('../../../../packages/scheduling/src/actions/timeEntryCrudActions');
    const { isServiceOptionalForWorkItem } = await import('../../../../packages/scheduling/src/actions/timeEntryWorkItemActions');
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    clearCapabilityCache();
    await f.as(f.customerPrincipal);
    expect(await (isServiceOptionalForWorkItem as any)('ticket', f.ticketId)).toBe(false);
    await expect((async () => {
      const result: any = await (saveTimeEntry as any)({ work_item_type: 'ticket', work_item_id: f.ticketId, notes: 'x', service_id: '', user_id: f.customerPrincipal.userId,
        approval_status: 'DRAFT', billable_duration: 30, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        start_time: '2026-08-08T12:00:00Z', end_time: '2026-08-08T12:30:00Z' });
      if (!result?.entry_id) throw new Error(JSON.stringify(result));
    })()).rejects.toThrow(/service/i);
    expect(await f.customer.table('time_entries').where('notes', 'x').first()).toBeUndefined();
  }));

  it('fix 4: Quick Invoice on the shared ticket bills only approved commercial minutes, once, and never operational minutes', () => withTime(async f => {
    const commercial = await f.save({ end_time: '2026-08-08T10:45:00Z', billable_duration: 45 });
    const operational = await f.logOperational(30);
    await f.approve(commercial.entry_id);
    await f.customer.table('time_entries').where('entry_id', operational.entry_id).update({ approval_status: 'APPROVED' });
    const { getTicketBillableItems, generateTicketInvoice } = await import('../../../../packages/billing/src/actions/ticketInvoiceActions');
    await f.as(f.principal);
    const items: any = await (getTicketBillableItems as any)(f.resource.id);
    expect(items.timeItems, JSON.stringify(items)).toHaveLength(1);
    expect(items.timeItems[0]).toMatchObject({ id: commercial.entry_id, billableMinutes: 45 });
    const first: any = await (generateTicketInvoice as any)({ ticketId: f.resource.id, timeEntryIds: [commercial.entry_id, operational.entry_id] });
    expect(first.success, JSON.stringify(first)).toBe(false); // an operational id is foreign to the work: rejected before any invoice row exists
    const created: any = await (generateTicketInvoice as any)({ ticketId: f.resource.id, timeEntryIds: [commercial.entry_id] });
    expect(created.success, JSON.stringify(created)).toBe(true);
    expect((await sponsorRows(f, commercial.entry_id)).invoiced).toBe(true);
    expect((await f.customer.table('time_entries').where('entry_id', operational.entry_id).first()).invoiced).toBe(false);
    const after: any = await (getTicketBillableItems as any)(f.resource.id);
    expect(after.timeItems).toHaveLength(0);
    const again: any = await (generateTicketInvoice as any)({ ticketId: f.resource.id, timeEntryIds: [commercial.entry_id] });
    expect(again.success).toBe(false);
    const invoices = await f.sponsor.table('invoices').where('client_id', f.clientId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].ticket_id ?? null).toBeNull();
  }));
});
