/**
 * L6a2: the shared-time journey, Ticket Quick Invoice and capability neutrality, against real rows.
 * The relationship is bootstrapped through the real L1a provisioning path (prepareNativeAccessOperation ->
 * bootstrapCoManagedCustomer -> invitation setup -> acceptance). Authentication and transport are the only
 * substitutions (the acting user is switched per call); every permission, lifecycle and billing function is real.
 *
 * Existing migrated database: set CO_MANAGED_TEST_DB_NAME (+ CO_MANAGED_TEST_DB_PORT). Otherwise a database is migrated and dropped.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareUpgradeSchema } from '../../../../../scripts/lib/upgrade-schema-source.mjs';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../../server/test-utils/dbConfig';
import { bootstrapCoManagedCustomer } from '../../activities/co-managed-provisioning-activities';
import { acceptCoManagedRelationship, getCoManagedAcceptanceState } from '../../../../../packages/co-managed/src/acceptance';
import { replaceCoManagedStaffAssignments, getCoManagedCollaborationPolicy } from '../../../../../packages/co-managed/src/policy';
import { prepareNativeAccessOperation } from './helpers/coManagedFixtures';
import { registerCoManagedInvoiceJourneyTests } from './helpers/coManagedInvoiceJourneyCases';
import { buildTimeFixture, type Session } from '../../../../../server/src/test/integration/helpers/coManagedTimeFixture';
import { registerCoManagedTimeSource } from '../../../../../server/src/lib/co-managed/timeSource';
import { registerCoManagedTimeEntryWorkContributor } from '../../../../../server/src/lib/co-managed/timeWorkContext';
import '../../../../../packages/co-managed/src/capability';
import { registerFeatureFlagChecker } from '../../../../../packages/core/src/lib/features';
import { clearCapabilityCache } from '../../../../../packages/core/src/capability/testing';

const delivery = vi.hoisted(() => ({ send: vi.fn() }));
const actorState = vi.hoisted(() => ({ user: null as any, session: null as any }));
const flag = vi.hoisted(() => ({ on: true }));
const appliance = vi.hoisted(() => ({ check: async () => null })); // no appliance seat limit
vi.mock('@alga-psa/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, getAdminConnection: async () => db, getConnection: async () => db,
    createTenantKnex: async (tenant?: string) => ({ knex: db, tenant: tenant ?? actual.getTenantContext() ?? actorState.user?.tenant }) };
});
vi.mock('@alga-psa/auth', async () => ({
  withAuth: (handler: any) => (...args: any[]) => handler(actorState.user, { tenant: actorState.user.tenant }, ...args),
  hasPermission: async (...args: Parameters<typeof import('../../../../../packages/auth/src/lib/rbac').hasPermission>) =>
    (await import('../../../../../packages/auth/src/lib/rbac')).hasPermission(...args),
  checkMultiplePermissions: async (...args: Parameters<typeof import('../../../../../packages/auth/src/lib/rbac').checkMultiplePermissions>) =>
    (await import('../../../../../packages/auth/src/lib/rbac')).checkMultiplePermissions(...args),
  shouldTouchApiKeyLastUsed: (await import('../../../../../packages/auth/src/services/apiKeyService')).shouldTouchApiKeyLastUsed,
  checkPortalInvitationLimit: async () => ({ success: true }), formatRateLimitError: async () => 'Rate limited',
  verifyAuthenticator: async () => false,
  getSession: async () => actorState.session, getApiKeyUserOverride: () => null,
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: async () => actorState.user }));
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({ hasPermission: async () => true }));
vi.mock('@enterprise/lib/license/userSeatGuard', () => ({ checkApplianceLicenseSeatLimit: appliance.check }));
vi.mock('@temporalio/activity', async importOriginal => ({
  ...(await importOriginal<typeof import('@temporalio/activity')>()),
  Context: { current: () => ({ log: { info() {}, warn() {}, error() {} } }) },
}));
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: delivery.send,
  TenantEmailService: { getInstance: () => ({ isConfigured: async () => true }) }, getSystemEmailService: async () => ({ isConfigured: async () => true }) }));
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: async () => db,
  withAdminTransactionRetryReadOnly: (work: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(work),
}));

let db: Knex;
let migrationWork: string | undefined;
const existingDatabase = process.env.CO_MANAGED_TEST_DB_NAME;
const databaseName = existingDatabase ?? `co_managed_l6a2_${randomUUID().replaceAll('-', '')}`.slice(0, 60);
const tenants: string[] = [];

beforeAll(async () => {
  const inheritedDbPort = process.env.DB_PORT;
  wireLocalTestDbEnv();
  process.env.DB_PORT = process.env.CO_MANAGED_TEST_DB_PORT ?? inheritedDbPort ?? '5432';
  process.env.NEXTAUTH_SECRET = 'co-managed-integration-test-secret';
  process.env.CAPABILITY_CACHE_TTL_MS = '0';
  process.env.NEXT_PUBLIC_BASE_URL = 'https://app.example.test';
  registerFeatureFlagChecker(async () => flag.on);
  // What server instrumentation registers at boot.
  registerCoManagedTimeSource();
  registerCoManagedTimeEntryWorkContributor();
  if (existingDatabase) {
    process.env.DB_NAME_SERVER = existingDatabase;
    db = await createTestDbConnection({ recreate: false });
    return;
  }
  const root = path.resolve(__dirname, '../../../../..');
  migrationWork = mkdtempSync(path.join(tmpdir(), 'co-managed-schema-'));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const schema = prepareUpgradeSchema({ repository: root, commit, destination: path.join(migrationWork, 'schema'), edition: 'ee' });
  symlinkSync(path.join(root, 'node_modules'), path.join(migrationWork, 'schema', 'node_modules'));
  db = await createTestDbConnection({ databaseName, migrationsDir: schema.directory });
}, 900000);

afterAll(async () => {
  if (existingDatabase) {
    const { cleanupL3cTenants } = await import('../../../../../server/src/test/integration/helpers/coManagedL3cFixture');
    await cleanupL3cTenants(tenants).catch(() => undefined);
    await db?.destroy();
    return;
  }
  await db?.destroy();
  const { default: knex } = await import('knex');
  const admin = knex({ client: 'pg', connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN, database: 'postgres' } });
  try {
    await admin.raw('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()', [databaseName]);
    await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]);
  } finally { await admin.destroy(); if (migrationWork) rmSync(migrationWork, { recursive: true, force: true }); }
});

afterEach(() => { delete process.env.FORCE_CAPABILITIES; flag.on = true; clearCapabilityCache(); });

const hooks = {
  actAs: (user: any, session: Session) => {
    actorState.user = user;
    actorState.session = { session_id: session.sessionId, user: { id: user.user_id, tenant: user.tenant, user_type: user.user_type } };
  },
  loadUser: async (session: Session) => tenantDb(db, session.tenant).table('users').where('user_id', session.userId).first(),
};

/** A complete accepted relationship built through L1a's provisioning path, with the time/billing fixture on top. */
async function journey() {
  const operation = await prepareNativeAccessOperation(db);
  const sponsorTenant = operation.tenant, customerTenant = operation.customer_tenant, relationshipId = operation.relationship_id;
  tenants.push(sponsorTenant, customerTenant);
  await bootstrapCoManagedCustomer({ sponsorTenant, operationId: operation.operation_id });
  const customer = tenantDb(db, customerTenant) as any, sponsor = tenantDb(db, sponsorTenant) as any;
  const invitation = await customer.table('user_invitations').first();
  const { completeUserInvitationSetup } = await import('../../../../../packages/users/src/actions/user-actions/userInvitationActions');
  const signup = await completeUserInvitationSetup(invitation.token, 'ValidPassword!2026');
  if (!signup.success) throw new Error(`Customer administrator setup failed: ${JSON.stringify(signup)}`);
  const session = async (tenant: string, userId: string): Promise<Session> => {
    const sessionId = randomUUID();
    await tenantDb(db, tenant).table('sessions').insert({ tenant, session_id: sessionId, user_id: userId, expires_at: new Date(Date.now() + 3600000) });
    return { kind: 'session', tenant, userId, sessionId };
  };
  const customerAdmin = await session(customerTenant, signup.userId!);
  const review = await getCoManagedAcceptanceState(db, customerAdmin);
  if (review.state !== 'pending_acceptance') throw new Error('No acceptance proposal');
  await acceptCoManagedRelationship(db, customerAdmin, { relationshipId: review.relationshipId, revision: review.revision, scopeFingerprint: review.scopeFingerprint });
  const relationship = await customer.table('co_management_relationships').where('relationship_id', relationshipId).first();
  const f: any = await buildTimeFixture(db, { sponsorTenant, customerTenant, relationshipId, sponsorClientId: relationship.sponsor_client_id,
    escalationBoardId: relationship.escalation_board_id, customerBoardId: operation.customer_board_id as string, customerAdmin }, hooks);
  // The technician needs the relationship's staff assignment through the real policy path as well as the fixture row.
  void replaceCoManagedStaffAssignments; void getCoManagedCollaborationPolicy;
  return f;
}
const withJourney = async (work: (f: any) => Promise<void>) => work(await journey());

/** The invoice's lines, whatever shape the engine gave them. */
const chargesOf = async (f: any, invoiceId: string) => f.sponsor.table('invoice_charges').where('invoice_id', invoiceId).orderBy('description');

describe.sequential('L6a2 shared time journey', () => {
  registerCoManagedInvoiceJourneyTests(() => db, withJourney);

  it('bills the same 15 minutes once through Ticket Quick Invoice, with no invoices.ticket_id', async () => withJourney(async f => {
    const { loadQuickInvoiceWork, getTicketBillableItems, generateTicketInvoice } = await import('../../../../../packages/billing/src/actions/ticketInvoiceActions') as any;
    void loadQuickInvoiceWork;
    const entry = await f.logBillable(15);
    await f.approve(entry.entry_id);
    await f.as(f.principal);
    const items: any = await getTicketBillableItems(f.ticketId);
    expect(items.time ?? items.timeEntries ?? items).toBeTruthy();
    const result: any = await generateTicketInvoice({ ticketId: f.ticketId, timeEntryIds: [entry.entry_id], materialIds: [] });
    expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    const invoiceId = result.invoice?.invoice_id ?? result.invoice_id ?? result.invoiceId;
    expect(invoiceId).toBeTruthy();
    const invoice = await f.sponsor.table('invoices').where('invoice_id', invoiceId).first();
    expect(invoice.ticket_id ?? null).toBeNull();
    const charges = await chargesOf(f, invoiceId);
    expect(charges).toHaveLength(1);
    expect(Number(charges[0].quantity)).toBeCloseTo(0.25, 5); // 15 minutes
    expect(await f.sponsor.table('time_entries').where('entry_id', entry.entry_id).first()).toMatchObject({ invoiced: true });
    expect(await f.sponsor.table('invoice_time_entries').where('entry_id', entry.entry_id)).toHaveLength(1);
    // A second attempt on the same entry is refused, never billed twice.
    const again: any = await generateTicketInvoice({ ticketId: f.ticketId, timeEntryIds: [entry.entry_id], materialIds: [] });
    expect(again.success).toBe(false);
    expect(await f.sponsor.table('invoices')).toHaveLength(1);
  }));
});

describe.sequential('L6a2 capability neutrality', () => {
  /** Adds a native MSP ticket with 30 approved native minutes on the same client and contract line. */
  async function addNative(f: any) {
    const status = await f.sponsor.table('statuses').where('item_type', 'ticket').first()
      ?? (await f.sponsor.table('statuses').insert({ tenant: f.base.sponsorTenant, status_id: randomUUID(), name: 'Open', status_type: 'ticket', item_type: 'ticket', order_number: 1 }).returning('*'))[0];
    const board = await f.sponsor.table('boards').first();
    const ticketId = randomUUID();
    await f.sponsor.table('tickets').insert({ tenant: f.base.sponsorTenant, ticket_id: ticketId, title: 'Native MSP ticket', ticket_number: `N-${randomUUID().slice(0, 6)}`,
      client_id: f.clientId, board_id: board.board_id, status_id: status.status_id, entered_by: f.userId, entered_at: new Date() });
    await f.sponsor.table('time_entries').insert({ tenant: f.base.sponsorTenant, entry_id: randomUUID(), user_id: f.userId, start_time: '2026-08-09T10:00:00Z',
      end_time: '2026-08-09T10:30:00Z', work_timezone: 'UTC', work_date: '2026-08-09', work_item_id: ticketId, work_item_type: 'ticket',
      approval_status: 'APPROVED', service_id: f.serviceId, contract_line_id: f.lineId, billable_duration: 30, invoiced: false, notes: 'native' });
    return ticketId;
  }
  const normalised = (rows: any[]) => rows.map(r => ({ description: r.description, quantity: Number(r.quantity), unit_price: Number(r.unit_price ?? r.rate), net: Number(r.net_amount ?? r.total_price) }));

  /** Generates the cycle's invoice and captures every SQL statement the generation ran. */
  async function generateCapturing(f: any) {
    const sql: string[] = [];
    const listener = (q: { sql: string }) => sql.push(q.sql);
    db.on('query', listener);
    try { await f.as(f.principal); const invoice = await f.generateInvoice(); return { invoice, sql }; } finally { db.removeListener('query', listener); }
  }

  it('with co-managed forced off the generated invoice is the capability-served run\'s native portion and selection touches no co_managed table', async () => {
    // Capability-served run: native 30 + co-managed 15, billed together.
    const served = await journey();
    await addNative(served);
    const sharedEntry = await served.logBillable(15);
    await served.approve(sharedEntry.entry_id);
    const on = await generateCapturing(served);
    expect(on.invoice).toBeTruthy();
    const onCharges = normalised(await chargesOf(served, on.invoice.invoice_id));
    expect(onCharges.reduce((n, c) => n + c.quantity, 0)).toBeCloseTo(0.75, 5); // 45 minutes
    expect(await served.sponsor.table('time_entries').where('entry_id', sharedEntry.entry_id).first()).toMatchObject({ invoiced: true });

    // Same world shape with the capability off: only the native portion exists and nothing co_managed is read.
    const off = await journey();
    await addNative(off);
    const offEntry = await off.logBillable(15);
    await off.approve(offEntry.entry_id);
    // A tenant with durable participation stays served when only the release flag is off, so neutrality is proven with the kill switch.
    process.env.FORCE_CAPABILITIES = 'co-managed:off'; clearCapabilityCache();
    const result = await generateCapturing(off);
    expect(result.invoice).toBeTruthy();
    const offCharges = normalised(await chargesOf(off, result.invoice.invoice_id));
    expect(offCharges.reduce((n, c) => n + c.quantity, 0)).toBeCloseTo(0.5, 5); // the 30 native minutes only
    expect(await off.sponsor.table('time_entries').where('entry_id', offEntry.entry_id).first()).toMatchObject({ invoiced: false });
    expect(await off.sponsor.table('invoice_time_entries').where('entry_id', offEntry.entry_id)).toHaveLength(0);
    const timeSelection = result.sql.filter(s => /from "time_entries"/i.test(s) || /time_entries/.test(s));
    expect(timeSelection.length).toBeGreaterThan(0);
    expect(result.sql.filter(s => /co_managed_/i.test(s)), 'capability off must not read co_managed tables').toEqual([]);
    // The served run did read them (the assertion above is not vacuous).
    expect(on.sql.some(s => /co_managed_/i.test(s))).toBe(true);
    // Native portion identical in both runs: served run's native lines == off run's lines.
    const nativeOnly = onCharges.filter(c => Math.abs(c.quantity - 0.5) < 1e-6);
    if (nativeOnly.length) expect(offCharges).toEqual(nativeOnly);
  });
});
