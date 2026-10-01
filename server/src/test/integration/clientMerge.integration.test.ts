import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import {
  assignServiceTaxRate,
  createFixedPlanAssignment,
  createTestService,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings,
  setupClientTaxConfiguration,
  unwrapInvoiceResult,
} from '../../../test-utils/billingTestHelpers';
import {
  createBillingProfile,
  ensureDefaultBillingProfile,
  seedBillingCycle,
} from '../../../test-utils/billingProfileTestHelpers';

/**
 * Merging a client into a parent as a billing profile — against a real database.
 *
 * The engine's unit tests prove which tables it writes. What only a real
 * database can prove is the part the feature exists for: that absorbing a client
 * does not disturb the parent's money, that the absorbed client's own billing
 * keeps producing the same invoice from the other side of the merge, and that
 * the portal grant a site manager holds means the same thing before and after.
 * Those are TM010, TM011 and TM012. TM016 covers the other thing only a real
 * database has: the partial unique indexes a merge collides with — two clients
 * that each have a logo.
 *
 * The nullable-profile history case is here rather than only in the unit tests
 * on purpose: `invoices`, `transactions` and `credit_tracking` allow a null
 * `billing_profile_id` by design (20260818050000, 20260818060000) and live write
 * paths still produce one, so the fixture inserts exactly what a sales-order
 * invoice and a credit transfer leave behind and the real schema accepts it.
 */

// The billing engine resolves its own knex and tenant; the fixture's connection
// has to be what it finds.
vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    // A *real* transaction when handed the root connection, unlike the
    // pass-through most billing suites use: the one-default-profile-per-client
    // guard is a DEFERRABLE INITIALLY DEFERRED constraint trigger
    // (20260817000000), so a merge that auto-commits statement by statement
    // trips it halfway through on a state production never commits.
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) => {
      const candidate = knexOrTrx as unknown as Knex.Transaction;
      if (typeof (candidate as { isCompleted?: unknown }).isCompleted === 'function') {
        return callback(candidate);
      }
      return knexOrTrx.transaction((trx) => callback(trx));
    }),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        { user_id: userId, tenant: tenantId, roles: [{ role_name: 'Admin' }] } as any,
        { tenant: tenantId },
        ...args,
      ),
}));

// The merge server action is wrapped in the real withAuth; this keeps its
// permission gate and its user/tenant resolution wired to setupCommonMocks.
vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

/** The workflow events published so far, read off the mock itself. */
async function publishedWorkflowEvents(): Promise<Array<{ eventType: string; payload: any }>> {
  const { publishWorkflowEvent } = await import('@alga-psa/event-bus/publishers');
  return vi.mocked(publishWorkflowEvent).mock.calls.map(([event]) => event as any);
}

const HOOK_TIMEOUT = 300_000;

// The lines bill in arrears, so the January cycle bills December and the
// February cycle bills January.
const DECEMBER_START = '2024-12-01';
const JANUARY_START = '2025-01-01';
const FEBRUARY_START = '2025-02-01';
const MARCH_START = '2025-03-01';
const FIXED_RATE_CENTS = 25000;

let db: Knex;
let tenantId: string;
let userId: string;

let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration')['generateInvoice'];
let finalizeInvoice: typeof import('@alga-psa/billing/actions/invoiceModification')['finalizeInvoice'];
let syncRecurringServicePeriodsForContractLine:
  typeof import('@alga-psa/billing/actions/recurringServicePeriodSync')['syncRecurringServicePeriodsForContractLine'];
let executeClientMerge: typeof import('@alga-psa/clients/lib/clientMergeEngine')['executeClientMerge'];
let previewClientMerge: typeof import('@alga-psa/clients/lib/clientMergeEngine')['previewClientMerge'];
let mergeClientIntoParent: typeof import('@alga-psa/clients/actions/clientMergeActions')['mergeClientIntoParent'];
let getClientContactVisibilityContext:
  typeof import('@alga-psa/tickets/lib/clientPortalVisibility.server')['getClientContactVisibilityContext'];
let applyTicketVisibilityFilter:
  typeof import('@alga-psa/tickets/lib/clientPortalVisibility')['applyTicketVisibilityFilter'];

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

function tenantsUnscoped() {
  return tenantDb(db, tenantId).unscoped('tenants', 'test fixture creates tenant rows');
}

async function seedClient(name: string): Promise<string> {
  const clientId = uuidv4();
  await table('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: name,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    billing_email: `billing-${clientId.slice(0, 8)}@merge.test`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await table('client_locations').insert({
    location_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    location_name: 'Billing',
    address_line1: '1 Merge Way',
    city: 'Testville',
    state_province: 'NY',
    postal_code: '10001',
    country_code: 'US',
    country_name: 'United States',
    email: `billing-${clientId.slice(0, 8)}@merge.test`,
    is_default: true,
    is_billing_address: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await setupClientTaxConfiguration({ db, tenantId, clientId } as any, {
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'New York Tax',
    startDate: '2024-01-01T00:00:00.000Z',
    taxPercentage: 8.875,
  });
  return clientId;
}

/** A fixed monthly line, with its recurring service periods materialized. */
async function seedFixedLine(
  clientId: string,
  serviceName: string,
  options: { startDate?: string; endDate?: string | null } = {},
): Promise<{ contractLineId: string; clientContractId: string }> {
  const context = { db, tenantId, clientId } as any;
  const serviceId = await createTestService(context, {
    service_name: serviceName,
    billing_method: 'fixed',
    default_rate: FIXED_RATE_CENTS,
    unit_of_measure: 'month',
    tax_region: 'US-NY',
  });
  await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });

  const line = await createFixedPlanAssignment(context, serviceId, {
    planName: serviceName,
    billingFrequency: 'monthly',
    baseRateCents: FIXED_RATE_CENTS,
    startDate: options.startDate ?? DECEMBER_START,
    endDate: options.endDate ?? null,
    billingTiming: 'arrears',
    clientId,
    enableProration: false,
  });
  // Generation refuses to bill a window with no materialized service periods.
  await db.transaction(async (trx) => {
    await syncRecurringServicePeriodsForContractLine(trx, {
      tenant: tenantId,
      contractLineId: line.contractLineId,
      sourceRunPrefix: 'client-merge',
    });
  });
  return { contractLineId: line.contractLineId, clientContractId: line.clientContractId };
}

async function seedCycle(clientId: string, start: string, end: string, billingProfileId?: string): Promise<string> {
  const cycleId = uuidv4();
  await seedBillingCycle(db, tenantId, {
    billing_cycle_id: cycleId,
    tenant: tenantId,
    client_id: clientId,
    ...(billingProfileId ? { billing_profile_id: billingProfileId } : {}),
    billing_cycle: 'monthly',
    effective_date: `${start}T00:00:00Z`,
    period_start_date: `${start}T00:00:00Z`,
    period_end_date: `${end}T00:00:00Z`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return cycleId;
}

/**
 * The money an invoice represents, with everything nondeterministic removed:
 * ids, invoice numbers and now()-derived dates are excluded rather than pinned,
 * so a diff is always a change in what was billed.
 */
async function invoiceMoneyProjection(invoiceId: string): Promise<string> {
  const invoice = await table('invoices').where({ invoice_id: invoiceId }).first();
  if (!invoice) throw new Error(`invoice ${invoiceId} not found`);
  const charges = await table('invoice_charges').where({ invoice_id: invoiceId });
  return JSON.stringify(
    {
      status: String(invoice.status),
      invoice_type: String(invoice.invoice_type),
      currency_code: String(invoice.currency_code),
      subtotal: Number(invoice.subtotal ?? 0),
      tax: Number(invoice.tax ?? 0),
      total_amount: Number(invoice.total_amount ?? 0),
      credit_applied: Number(invoice.credit_applied ?? 0),
      charges: [...charges]
        .sort((left, right) => String(left.description).localeCompare(String(right.description), 'en'))
        .map((charge) => ({
          description: String(charge.description),
          quantity: String(charge.quantity),
          unit_price: Number(charge.unit_price ?? 0),
          net_amount: Number(charge.net_amount ?? 0),
          tax_amount: Number(charge.tax_amount ?? 0),
          tax_rate: String(charge.tax_rate),
          tax_region: charge.tax_region ?? null,
        })),
    },
    null,
    2,
  );
}

/** A client avatar, as entityImageService files one: a document plus a flagged association. */
async function seedLogo(clientId: string, fileName: string, variant: string): Promise<string> {
  const documentId = uuidv4();
  await table('documents').insert({
    tenant: tenantId,
    document_id: documentId,
    document_name: fileName,
    user_id: userId,
    created_by: userId,
    mime_type: 'image/png',
    entered_at: db.fn.now(),
  });
  await table('document_associations').insert({
    tenant: tenantId,
    association_id: uuidv4(),
    document_id: documentId,
    entity_id: clientId,
    entity_type: 'client',
    is_entity_logo: true,
    entity_logo_variant: variant,
  });
  return documentId;
}

async function visibleTicketIds(contactId: string): Promise<string[]> {
  return db.transaction(async (trx) => {
    const visibility = await getClientContactVisibilityContext(trx, tenantId, contactId);
    const query = tenantDb(trx, tenantId).table('tickets as t')
      .where({ 't.client_id': visibility.clientId })
      .select('t.ticket_id');
    applyTicketVisibilityFilter(query, visibility, {
      boardColumn: 't.board_id',
      contactColumn: 't.contact_name_id',
      billingProfileColumn: 't.billing_profile_id',
    });
    const rows = await query;
    return rows.map((row: { ticket_id: string }) => row.ticket_id).sort();
  });
}

describe('client merge into a billing profile (TM010, TM011, TM012, TM016)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    // A dedicated database: the shared `test_database` is recreated by every
    // other integration suite, which would drop this suite's connection.
    db = await createTestDbConnection({ databaseName: 'test_db_client_merge' });

    tenantId = uuidv4();
    await tenantsUnscoped().insert({
      tenant: tenantId,
      client_name: 'Client Merge Fixture',
      email: `merge-${tenantId.slice(0, 8)}@merge.test`,
    });

    userId = uuidv4();
    await table('users').insert({
      user_id: userId,
      tenant: tenantId,
      username: 'client-merge-tester',
      email: 'client-merge@merge.test',
      hashed_password: 'test_hash',
      first_name: 'Merge',
      last_name: 'Tester',
      user_type: 'internal',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    setupCommonMocks({ tenantId, userId, permissionCheck: () => true });
    await ensureDefaultBillingSettings({ db, tenantId } as any);
    await ensureClientPlanBundlesTable({ db, tenantId } as any);

    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ finalizeInvoice } = await import('@alga-psa/billing/actions/invoiceModification'));
    ({ syncRecurringServicePeriodsForContractLine } = await import(
      '@alga-psa/billing/actions/recurringServicePeriodSync'
    ));
    ({ executeClientMerge, previewClientMerge } = await import('@alga-psa/clients/lib/clientMergeEngine'));
    ({ mergeClientIntoParent } = await import('@alga-psa/clients/actions/clientMergeActions'));
    ({ getClientContactVisibilityContext } = await import(
      '@alga-psa/tickets/lib/clientPortalVisibility.server'
    ));
    ({ applyTicketVisibilityFilter } = await import('@alga-psa/tickets/lib/clientPortalVisibility'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('TM010: carries the whole billing history across, including rows that never had a profile', async () => {
    const target = await seedClient('History Group');
    const source = await seedClient('History North');
    const targetDefault = await ensureDefaultBillingProfile({ db, tenantId }, target);
    const sourceDefault = await ensureDefaultBillingProfile({ db, tenantId }, source);
    const sourceSite = await createBillingProfile({ db, tenantId }, source, 'North Plant');

    // A profile-attributed invoice, produced by the real engine.
    await seedFixedLine(source, 'History Monitoring');
    const attributedCycle = await seedCycle(source, JANUARY_START, FEBRUARY_START, sourceDefault);
    const attributed = unwrapInvoiceResult<{ invoice_id: string }>(await generateInvoice(attributedCycle));

    // What a sales order leaves behind: an invoice and its ledger transaction
    // with no profile at all (salesOrderInvoicingActions), plus a transferred
    // credit (creditActions). Nullable by design on these three tables.
    const orphanInvoiceId = uuidv4();
    await table('invoices').insert({
      tenant: tenantId,
      invoice_id: orphanInvoiceId,
      client_id: source,
      invoice_number: `MERGE-SO-${orphanInvoiceId.slice(0, 8)}`,
      invoice_date: `${JANUARY_START}T00:00:00Z`,
      due_date: `${FEBRUARY_START}T00:00:00Z`,
      subtotal: 10000,
      tax: 0,
      total_amount: 10000,
      status: 'draft',
      billing_profile_id: null,
    });
    const transferTransactionId = uuidv4();
    await table('transactions').insert({
      tenant: tenantId,
      transaction_id: transferTransactionId,
      client_id: source,
      type: 'credit_transfer',
      amount: 5000,
      billing_profile_id: null,
    });
    const transferCreditId = uuidv4();
    await table('credit_tracking').insert({
      tenant: tenantId,
      credit_id: transferCreditId,
      client_id: source,
      transaction_id: transferTransactionId,
      amount: 5000,
      remaining_amount: 5000,
      billing_profile_id: null,
    });

    // An unattributed ticket and a domain, to show the operational side moves.
    const ticketId = uuidv4();
    await table('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `MERGE-T-${ticketId.slice(0, 8)}`,
      title: 'Unattributed work',
      client_id: source,
      billing_profile_id: null,
      entered_at: db.fn.now(),
    });
    await table('client_inbound_email_domains').insert({
      tenant: tenantId,
      id: uuidv4(),
      client_id: source,
      domain: `north-${source.slice(0, 8)}.test`,
    });

    const preview = await db.transaction((trx) =>
      previewClientMerge(trx, tenantId, { sourceClientId: source, targetClientId: target }));
    expect(preview.blockers).toEqual([]);
    expect(preview.counts.invoice).toBe(2);
    expect(preview.counts.credit).toBe(1);

    // Driven through the server action rather than the engine, so the
    // permission gate, the CLIENT_MERGED publish and the audit row are all on
    // the path this asserts.
    const actionResult = await mergeClientIntoParent({ sourceClientId: source, targetClientId: target });
    if (!actionResult || !('mergeId' in (actionResult as Record<string, unknown>))) {
      throw new Error(`merge refused: ${JSON.stringify(actionResult)}`);
    }
    const result = actionResult as Awaited<ReturnType<typeof executeClientMerge>>;

    // The dry run and the merge agree — the preview counted by client, and with
    // the nulls stamped that is exactly what moved.
    expect(result.counts.invoice).toBe(preview.counts.invoice);
    expect(result.counts.credit).toBe(preview.counts.credit);

    // Profiles keep their ids, lose their default status, and the source's
    // default takes the source client's name.
    const movedProfiles = await table('client_billing_profiles')
      .whereIn('billing_profile_id', [sourceDefault, sourceSite]);
    expect(movedProfiles.map((row: any) => row.client_id)).toEqual([target, target]);
    expect(movedProfiles.every((row: any) => row.is_default === false)).toBe(true);
    expect(movedProfiles.find((row: any) => row.billing_profile_id === sourceDefault)?.name)
      .toBe('History North');

    // Nothing billing-related is left pointing at the tombstone, and the rows
    // that had no profile now name the moved default rather than the parent's.
    expect(await table('invoices').where({ client_id: source })).toEqual([]);
    expect(await table('transactions').where({ client_id: source })).toEqual([]);
    expect(await table('credit_tracking').where({ client_id: source })).toEqual([]);
    for (const [tableName, column, id] of [
      ['invoices', 'invoice_id', orphanInvoiceId],
      ['transactions', 'transaction_id', transferTransactionId],
      ['credit_tracking', 'credit_id', transferCreditId],
    ] as const) {
      expect(await table(tableName).where({ [column]: id }).first()).toMatchObject({
        client_id: target,
        billing_profile_id: sourceDefault,
      });
    }
    // The attributed invoice keeps the profile it was produced against.
    expect(await table('invoices').where({ invoice_id: attributed.invoice_id }).first()).toMatchObject({
      client_id: target,
      billing_profile_id: sourceDefault,
    });
    // And the target's own default profile was not the destination of any of it.
    expect(await table('invoices').where({ billing_profile_id: targetDefault })).toEqual([]);

    expect(await table('tickets').where({ ticket_id: ticketId }).first()).toMatchObject({
      client_id: target,
      billing_profile_id: sourceDefault,
    });
    expect(await table('client_inbound_email_domains').where({ client_id: source })).toEqual([]);

    // The archived shell keeps exactly one default profile (F002) and points at
    // its target; the audit row and the workflow event record the merge.
    const shellProfiles = await table('client_billing_profiles').where({ client_id: source });
    expect(shellProfiles).toHaveLength(1);
    expect(shellProfiles[0]).toMatchObject({ is_default: true, is_system_managed_default: true });
    expect(await table('clients').where({ client_id: source }).first()).toMatchObject({
      is_inactive: true,
      merged_into_client_id: target,
    });
    const audit = await table('client_merges').where({ merge_id: result.mergeId }).first();
    expect(audit).toMatchObject({
      source_client_id: source,
      target_client_id: target,
      source_client_name: 'History North',
      strategy: 'merge_into_billing_profile',
      merged_by: userId,
    });
    const events = await publishedWorkflowEvents();
    expect(events.map((event) => event.eventType)).toContain('CLIENT_MERGED');
    expect(events.find((event) => event.eventType === 'CLIENT_MERGED')?.payload).toMatchObject({
      sourceClientId: source,
      targetClientId: target,
    });

    // Re-merging the tombstone is refused.
    await expect(db.transaction((trx) =>
      executeClientMerge(trx, tenantId, userId, { sourceClientId: source, targetClientId: target })))
      .rejects.toThrow(/already been merged/);
  }, HOOK_TIMEOUT);

  it('TM011: the parent\'s invoice is unchanged and a moved cycle regenerates the same invoice', async () => {
    const target = await seedClient('Billing Group');
    const source = await seedClient('Billing North');
    const sourceDefault = await ensureDefaultBillingProfile({ db, tenantId }, source);
    await ensureDefaultBillingProfile({ db, tenantId }, target);

    // The parent's line ends with January, so it is active for the January
    // cycle below and has nothing left for the February one. Per-profile
    // invoicing is off by default, so a parent charge leaking into the moved
    // cycle's invoice would surface both as a projection diff and as a charge
    // carrying the parent's profile.
    await seedFixedLine(target, 'Group Oversight', { endDate: '2025-01-31' });
    await seedFixedLine(source, 'North Monitoring');

    const parentCycle = await seedCycle(target, JANUARY_START, FEBRUARY_START);
    const parentInvoice = unwrapInvoiceResult<{ invoice_id: string }>(await generateInvoice(parentCycle));
    expect(await finalizeInvoice(parentInvoice.invoice_id)).toEqual({ success: true });
    const parentBefore = await invoiceMoneyProjection(parentInvoice.invoice_id);

    // The absorbed client's own January invoice, produced before the merge.
    const sourceJanuaryCycle = await seedCycle(source, JANUARY_START, FEBRUARY_START, sourceDefault);
    const sourceInvoice = unwrapInvoiceResult<{ invoice_id: string }>(await generateInvoice(sourceJanuaryCycle));
    const sourceBefore = await invoiceMoneyProjection(sourceInvoice.invoice_id);

    // An open cycle, which the merge moves intact rather than refusing.
    const sourceFebruaryCycle = await seedCycle(source, FEBRUARY_START, MARCH_START, sourceDefault);

    await db.transaction((trx) =>
      executeClientMerge(trx, tenantId, userId, { sourceClientId: source, targetClientId: target }));

    // T013-shaped invariant: absorbing a client rewrites none of the parent's
    // money.
    expect(await invoiceMoneyProjection(parentInvoice.invoice_id)).toBe(parentBefore);

    // The moved cycle still belongs to the profile it was created for, and
    // billing it produces the same invoice the pre-merge cycle produced.
    expect(await table('client_billing_cycles').where({ billing_cycle_id: sourceFebruaryCycle }).first())
      .toMatchObject({ client_id: target, billing_profile_id: sourceDefault });

    const regenerated = unwrapInvoiceResult<{ invoice_id: string }>(await generateInvoice(sourceFebruaryCycle));
    expect(await invoiceMoneyProjection(regenerated.invoice_id)).toBe(sourceBefore);
    expect(await table('invoices').where({ invoice_id: regenerated.invoice_id }).first()).toMatchObject({
      client_id: target,
      billing_profile_id: sourceDefault,
    });
    // Every charge on it is attributed to the absorbed client's segment, not to
    // the parent's default profile.
    const charges = await table('invoice_charges').where({ invoice_id: regenerated.invoice_id });
    expect(charges.length).toBeGreaterThan(0);
    expect(charges.every((charge: any) => charge.billing_profile_id === sourceDefault)).toBe(true);
  }, HOOK_TIMEOUT);

  it('TM012: a granted profile manager keeps the profile\'s tickets, and no more, across the merge', async () => {
    const target = await seedClient('Portal Group');
    const source = await seedClient('Portal North');
    const sourceDefault = await ensureDefaultBillingProfile({ db, tenantId }, source);
    const targetDefault = await ensureDefaultBillingProfile({ db, tenantId }, target);
    const sourceSite = await createBillingProfile({ db, tenantId }, source, 'Portal Plant');

    const boardId = uuidv4();
    await table('boards').insert({
      tenant: tenantId,
      board_id: boardId,
      board_name: 'Portal Support',
      client_portal_visible: true,
    });

    // Own-tickets scope: what almost every portal user has.
    const groupId = uuidv4();
    await table('client_portal_visibility_groups').insert({
      tenant: tenantId,
      group_id: groupId,
      client_id: source,
      name: 'Site staff',
      ticket_scope: 'contact',
    });
    await table('client_portal_visibility_group_boards').insert({
      tenant: tenantId,
      group_id: groupId,
      board_id: boardId,
    });

    const manager = uuidv4();
    const colleague = uuidv4();
    await table('contacts').insert([
      {
        tenant: tenantId,
        contact_name_id: manager,
        client_id: source,
        full_name: 'Dana Manager',
        email: `dana-${manager.slice(0, 8)}@merge.test`,
        portal_visibility_group_id: groupId,
        is_client_admin: false,
      },
      {
        tenant: tenantId,
        contact_name_id: colleague,
        client_id: source,
        full_name: 'Eli Colleague',
        email: `eli-${colleague.slice(0, 8)}@merge.test`,
        portal_visibility_group_id: groupId,
        is_client_admin: false,
      },
    ]);

    const ownTicket = uuidv4();
    const profileTicket = uuidv4();
    const otherProfileTicket = uuidv4();
    const parentTicket = uuidv4();
    await table('tickets').insert([
      {
        tenant: tenantId,
        ticket_id: ownTicket,
        ticket_number: `PORTAL-OWN-${ownTicket.slice(0, 8)}`,
        title: 'Dana own ticket',
        client_id: source,
        contact_name_id: manager,
        board_id: boardId,
        billing_profile_id: sourceDefault,
        entered_at: db.fn.now(),
      },
      {
        tenant: tenantId,
        ticket_id: profileTicket,
        ticket_number: `PORTAL-SEG-${profileTicket.slice(0, 8)}`,
        title: 'Colleague ticket on the managed profile',
        client_id: source,
        contact_name_id: colleague,
        board_id: boardId,
        billing_profile_id: sourceDefault,
        entered_at: db.fn.now(),
      },
      {
        tenant: tenantId,
        ticket_id: otherProfileTicket,
        ticket_number: `PORTAL-OTH-${otherProfileTicket.slice(0, 8)}`,
        title: 'Colleague ticket on another profile',
        client_id: source,
        contact_name_id: colleague,
        board_id: boardId,
        billing_profile_id: sourceSite,
        entered_at: db.fn.now(),
      },
      {
        tenant: tenantId,
        ticket_id: parentTicket,
        ticket_number: `PORTAL-PAR-${parentTicket.slice(0, 8)}`,
        title: 'Parent client ticket',
        client_id: target,
        board_id: boardId,
        billing_profile_id: targetDefault,
        entered_at: db.fn.now(),
      },
    ]);

    // The grant: opt-in, and only for one profile.
    await table('billing_profile_contacts').insert({
      tenant: tenantId,
      billing_profile_id: sourceDefault,
      contact_name_id: manager,
      is_manager: true,
      can_view_profile_tickets: true,
    });

    expect(await visibleTicketIds(manager)).toEqual([ownTicket, profileTicket].sort());
    // No grant: own tickets only, which is every other portal user.
    expect(await visibleTicketIds(colleague)).toEqual([profileTicket, otherProfileTicket].sort());

    await db.transaction((trx) =>
      executeClientMerge(trx, tenantId, userId, { sourceClientId: source, targetClientId: target }));

    // Same two tickets after the merge: the grant follows the profile, and it
    // does not widen to the parent's own ticket.
    expect(await visibleTicketIds(manager)).toEqual([ownTicket, profileTicket].sort());
    expect(await visibleTicketIds(manager)).not.toContain(parentTicket);
    expect(await visibleTicketIds(colleague)).toEqual([profileTicket, otherProfileTicket].sort());
  }, HOOK_TIMEOUT);

  it('TM016: merges two clients that both have a logo, and the target keeps its own', async () => {
    const target = await seedClient('Logo Group');
    const source = await seedClient('Logo North');
    await ensureDefaultBillingProfile({ db, tenantId }, target);
    await ensureDefaultBillingProfile({ db, tenantId }, source);

    const sourceLogo = await seedLogo(source, 'north-logo.png', 'default');
    const targetLogo = await seedLogo(target, 'group-logo.png', 'default');
    // A wide variant only the absorbed client has: a different slot in
    // uq_document_associations_single_true_logo, so it is free to arrive.
    const sourceWideLogo = await seedLogo(source, 'north-wide.png', 'wide');

    // Both logos are `is_entity_logo` rows on their own client, which is the
    // state that used to abort the merge with "duplicate key value violates
    // unique constraint uq_document_associations_single_true_logo".
    await db.transaction((trx) =>
      executeClientMerge(trx, tenantId, userId, { sourceClientId: source, targetClientId: target }));

    const associations = await table('document_associations').where({ entity_id: target });
    expect(associations.map((row: any) => row.document_id).sort())
      .toEqual([sourceLogo, targetLogo, sourceWideLogo].sort());
    // The target's branding is untouched and the absorbed one arrives as a
    // plain document that can be re-flagged from the UI.
    expect(associations.find((row: any) => row.document_id === targetLogo))
      .toMatchObject({ is_entity_logo: true, entity_logo_variant: 'default' });
    expect(associations.find((row: any) => row.document_id === sourceLogo))
      .toMatchObject({ is_entity_logo: false });
    expect(associations.find((row: any) => row.document_id === sourceWideLogo))
      .toMatchObject({ is_entity_logo: true, entity_logo_variant: 'wide' });
  }, HOOK_TIMEOUT);

  it('TM019: accounts for every client-keyed table in the schema', async () => {
    // A table nobody thought about does not fail loudly — its rows just stay on
    // the archived client, keeping a live write path aimed at a tombstone. The
    // schema is the only honest source for that list, so it is read rather than
    // remembered, and a new client-keyed table has to be classified before this
    // passes again.
    const {
      CLIENT_OWNED_MOVE_TABLES,
      PROFILE_HISTORY_TABLES,
      CLIENT_KEYED_TABLES_LEFT_BEHIND,
      CLIENT_KEYED_TABLES_HANDLED_EXPLICITLY,
    } = await import('@alga-psa/clients/lib/clientMergePlan');

    const { rows } = await db.raw(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid
        AND a.attname = 'client_id' AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relkind = 'r'
      ORDER BY c.relname
    `);

    const accounted = new Set<string>([
      ...CLIENT_OWNED_MOVE_TABLES.map((entry) => entry.table),
      ...PROFILE_HISTORY_TABLES.map((entry) => entry.table),
      ...CLIENT_KEYED_TABLES_LEFT_BEHIND.map((entry) => entry.table),
      ...CLIENT_KEYED_TABLES_HANDLED_EXPLICITLY,
    ]);

    const unaccounted = (rows as Array<{ table_name: string }>)
      .map((row) => row.table_name)
      .filter((name) => !accounted.has(name));

    expect(unaccounted).toEqual([]);

    // Every table the merge claims to move has to still be there, or the merge
    // aborts the transaction on a missing relation. The edition-optional ones
    // are exempt: that is what the flag means.
    const required = CLIENT_OWNED_MOVE_TABLES.filter((entry) => !entry.editionOptional).map((entry) => entry.table);
    const present = new Set((rows as Array<{ table_name: string }>).map((row) => row.table_name));
    expect(required.filter((name) => !present.has(name))).toEqual([]);
  }, HOOK_TIMEOUT);
});
