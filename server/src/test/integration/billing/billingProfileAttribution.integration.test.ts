import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import Invoice from '@alga-psa/billing/models/invoice';
import { Temporal } from '@js-temporal/polyfill';
import { formatInvoiceCalendarDate } from '../../../../../packages/billing/src/actions/invoiceCalendarDate';
import { PER_PROFILE_INVOICING_FLAG } from '../../../../../packages/billing/src/lib/billing/billingProfileInvoiceScope';
import { buildContractCadenceDueSelectionInput } from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import { getAvailableRecurringDueWork } from '@alga-psa/billing/actions/billingAndTax';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import {
  assignServiceTaxRate,
  createFixedPlanAssignment,
  createTestService,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings,
  setupClientTaxConfiguration,
  unwrapInvoiceResult,
} from '../../../../test-utils/billingTestHelpers';
import {
  assignContractToProfile,
  convertLineToHourly,
  createApprovedTimeEntry,
  createBillingProfile,
  createTicket,
  ensureDefaultBillingProfile,
  ensureUsdServicePrice,
  seedBillingCycle,
} from '../../../../test-utils/billingProfileTestHelpers';

/**
 * S2 — charge attribution and payment-method snapshots (T004, T010, T014, T016, T017).
 *
 * The exit criterion of the resolver slice is a property, not an example:
 * **every row written to `invoice_charges` carries a non-null
 * `billing_profile_id` and `billing_profile_source`.** T010 asserts exactly
 * that over a full generation run; the shape scenarios then pin the precedence
 * that makes the property useful rather than merely satisfied.
 */

// Hoisted module mocks: the billing engine resolves its own knex/tenant, so the
// fixture's connection and tenant have to be what it finds.
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
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      transactionControl.useRealTransactions
        ? (knexOrTrx as Knex).transaction(callback)
        : callback(knexOrTrx as unknown as Knex.Transaction),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/billing/src/lib/authHelpers')>(
    '../../../../../packages/billing/src/lib/authHelpers',
  );
  return {
    ...actual,
    getCurrentUserAsync: vi.fn(async () => ({
      user_id: userId,
      tenant: tenantId,
      username: 'profile-attribution-tester',
      email: 'profile-attribution@profiles.test',
      user_type: 'internal',
      roles: [{ role_name: 'Admin' }],
    })),
    hasPermissionAsync: vi.fn(async () => true),
  };
});

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        { user_id: userId, tenant: tenantId, roles: [{ role_name: 'Admin' }] } as any,
        { tenant: tenantId },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

const HOOK_TIMEOUT = 300_000;
const transactionControl = vi.hoisted(() => ({ useRealTransactions: false }));
let perProfileFlagSpy: { mockRestore(): void } | null = null;
let perProfileInvoicingEnabledInTest = false;

// The contract starts in December and bills in arrears, so the January cycle
// bills the *December* service period — billable work is dated accordingly.
const JANUARY_START = '2025-01-01';
const FEBRUARY_START = '2025-02-01';
const HOURLY_RATE_CENTS = 12000;
const FIXED_RATE_CENTS = 25000;

let db: Knex;
let tenantId: string;
let userId: string;

let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration')['generateInvoice'];
let generateGroupedInvoicesAsRecurringBillingRun: typeof import('@alga-psa/billing/actions/recurringBillingRunActions')['generateGroupedInvoicesAsRecurringBillingRun'];
let syncRecurringServicePeriodsForContractLine:
  typeof import('@alga-psa/billing/actions/recurringServicePeriodSync')['syncRecurringServicePeriodsForContractLine'];

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

function tenantsUnscoped() {
  return tenantDb(db, tenantId).unscoped('tenants', 'test fixture creates tenant rows');
}

/** One client, its own cycle, and the fixtures generation needs. */
async function seedClient(name: string): Promise<{ clientId: string; cycleId: string }> {
  const clientId = uuidv4();
  await table('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: name,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    billing_email: `billing-${clientId.slice(0, 8)}@profiles.test`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await table('client_locations').insert({
    location_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    location_name: 'Billing',
    address_line1: '1 Profile Way',
    city: 'Testville',
    state_province: 'NY',
    postal_code: '10001',
    country_code: 'US',
    country_name: 'United States',
    email: `billing-${clientId.slice(0, 8)}@profiles.test`,
    is_default: true,
    is_billing_address: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  const context = { db, tenantId, clientId } as any;
  await setupClientTaxConfiguration(context, {
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'New York Tax',
    startDate: '2024-01-01T00:00:00.000Z',
    taxPercentage: 8.875,
  });

  const cycleId = uuidv4();
  await seedBillingCycle(db, tenantId, {
    billing_cycle_id: cycleId,
    tenant: tenantId,
    client_id: clientId,
    billing_cycle: 'monthly',
    effective_date: `${JANUARY_START}T00:00:00Z`,
    period_start_date: `${JANUARY_START}T00:00:00Z`,
    period_end_date: `${FEBRUARY_START}T00:00:00Z`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { clientId, cycleId };
}

async function createHourlyLine(
  clientId: string,
  serviceName: string,
): Promise<{ serviceId: string; contractLineId: string; clientContractId: string }> {
  const context = { db, tenantId, clientId } as any;
  const serviceId = await createTestService(context, {
    service_name: serviceName,
    billing_method: 'per_unit',
    default_rate: HOURLY_RATE_CENTS,
    unit_of_measure: 'hour',
    tax_region: 'US-NY',
  });
  await ensureUsdServicePrice({ db, tenantId }, serviceId, HOURLY_RATE_CENTS);

  const line = await createFixedPlanAssignment(context, serviceId, {
    planName: serviceName,
    billingFrequency: 'monthly',
    baseRateCents: HOURLY_RATE_CENTS,
    startDate: '2024-12-01',
    endDate: null,
    billingTiming: 'arrears',
    clientId,
    enableProration: false,
  });
  await convertLineToHourly(
    { db, tenantId },
    { contractLineId: line.contractLineId, serviceId, hourlyRateCents: HOURLY_RATE_CENTS },
  );
  // Generation refuses to bill a window with no materialized service periods.
  await db.transaction(async (trx) => {
    await syncRecurringServicePeriodsForContractLine(trx, {
      tenant: tenantId,
      contractLineId: line.contractLineId,
      sourceRunPrefix: 's2-attribution',
    });
  });
  return {
    serviceId,
    contractLineId: line.contractLineId,
    clientContractId: line.clientContractId,
  };
}

async function chargesFor(invoiceId: string) {
  return table('invoice_charges')
    .where({ invoice_id: invoiceId })
    .select('item_id', 'description', 'net_amount', 'billing_profile_id', 'billing_profile_source');
}

describe('billing profiles S2 — charge attribution and snapshots (T004, T010, T014, T016, T017)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    // Dedicated to this feature's recurring profile acceptance fixture. Never
    // use the shared `test_database`, which other worktrees recreate.
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profile_recurring_acceptance' });
    const databaseResult = await db.raw<{ database_name: string }[]>('select current_database() as database_name');
    expect(databaseResult.rows[0]?.database_name).toBe('test_db_billing_profile_recurring_acceptance');

    tenantId = uuidv4();
    await tenantsUnscoped().insert({
      tenant: tenantId,
      client_name: 'Billing Profiles S2 Fixture',
      email: `s2-${tenantId.slice(0, 8)}@profiles.test`,
    });

    userId = uuidv4();
    await table('users').insert({
      user_id: userId,
      tenant: tenantId,
      username: 'profile-attribution-tester',
      email: 'profile-attribution@profiles.test',
      hashed_password: 'test_hash',
      first_name: 'Profile',
      last_name: 'Tester',
      user_type: 'internal',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    setupCommonMocks({ tenantId, userId, permissionCheck: () => true });
    await ensureDefaultBillingSettings({ db, tenantId } as any);
    await ensureClientPlanBundlesTable({ db, tenantId } as any);

    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ generateGroupedInvoicesAsRecurringBillingRun } = await import('@alga-psa/billing/actions/recurringBillingRunActions'));
    ({ syncRecurringServicePeriodsForContractLine } = await import(
      '@alga-psa/billing/actions/recurringServicePeriodSync'
    ));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  afterEach(() => {
    transactionControl.useRealTransactions = false;
    perProfileInvoicingEnabledInTest = false;
    perProfileFlagSpy?.mockRestore();
    perProfileFlagSpy = null;
  });

  // T054 — the S1 backfill only covers clients that existed when it ran. A
  // client created afterwards, by any path including a direct insert, must
  // still resolve a default profile or every charge it generates is
  // unattributable.
  it('T054: a client created after the backfill still resolves a default billing profile', async () => {
    const clientId = uuidv4();
    await table('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'T054 Post-Backfill Client',
      billing_cycle: 'monthly',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // Nothing provisioned a profile for this client.
    expect(
      await table('client_billing_profiles').where({ client_id: clientId }).first(),
    ).toBeUndefined();

    const { getClientDefaultBillingProfileId } = await import(
      '@alga-psa/billing/lib/billing/billingProfileLookup'
    );
    const profileId = await getClientDefaultBillingProfileId(db, tenantId, clientId);
    expect(profileId).toBeTruthy();

    const profiles = await table('client_billing_profiles').where({ client_id: clientId });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      billing_profile_id: profileId,
      is_default: true,
      is_system_managed_default: true,
      name: 'T054 Post-Backfill Client',
    });

    // Idempotent: a second resolution reuses the provisioned profile.
    expect(await getClientDefaultBillingProfileId(db, tenantId, clientId)).toBe(profileId);
    expect(await table('client_billing_profiles').where({ client_id: clientId })).toHaveLength(1);
  }, HOOK_TIMEOUT);

  // T010 — the S2 exit criterion, asserted as a property over the whole run.
  it('T010: every generated charge carries a non-null billing profile and source', async () => {
    const { clientId, cycleId } = await seedClient('T010 Mixed Charges Client');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId, { name: 'T010 Mixed Charges Client' });

    // A fixed line (stops at the contract step) and an hourly line whose time
    // entries can reach the work-item step — two different depths on one invoice.
    const fixedService = await createTestService({ db, tenantId, clientId } as any, {
      service_name: 'T010 Monitoring',
      billing_method: 'fixed',
      default_rate: FIXED_RATE_CENTS,
      unit_of_measure: 'month',
      tax_region: 'US-NY',
    });
    await ensureUsdServicePrice({ db, tenantId }, fixedService, FIXED_RATE_CENTS);
    const fixedLine = await createFixedPlanAssignment({ db, tenantId, clientId } as any, fixedService, {
      planName: 'T010 Monitoring Plan',
      billingFrequency: 'monthly',
      baseRateCents: FIXED_RATE_CENTS,
      startDate: '2024-12-01',
      endDate: null,
      billingTiming: 'arrears',
      clientId,
      enableProration: false,
    });

    const hourly = await createHourlyLine(clientId, 'T010 Support');
    await assignServiceTaxRate({ db, tenantId, clientId } as any, '*', 'US-NY', { onlyUnset: true });

    const ticketId = await createTicket({ db, tenantId }, {
      clientId,
      title: 'T010 work',
      ticketNumber: 'T010-1',
    });
    await createApprovedTimeEntry({ db, tenantId }, {
      userId,
      ticketId,
      serviceId: hourly.serviceId,
      contractLineId: hourly.contractLineId,
      workDate: '2024-12-15',
      minutes: 120,
    });

    await db.transaction(async (trx) => {
      await syncRecurringServicePeriodsForContractLine(trx, {
        tenant: tenantId,
        contractLineId: fixedLine.contractLineId,
        sourceRunPrefix: 's2-attribution',
      });
    });

    const invoice = unwrapInvoiceResult<{ invoice_id: string }>(await generateInvoice(cycleId));
    const charges = await chargesFor(invoice.invoice_id);

    expect(charges.length).toBeGreaterThan(1);
    for (const charge of charges) {
      expect(
        charge.billing_profile_id,
        `charge "${charge.description}" has no billing profile`,
      ).toBeTruthy();
      expect(
        charge.billing_profile_source,
        `charge "${charge.description}" has no attribution source`,
      ).toBeTruthy();
    }
  }, HOOK_TIMEOUT);

  it('T004: generated invoices snapshot each profile payment method and keep it after profile edits', async () => {
    const { clientId, cycleId: cardCycleId } = await seedClient('T004 Payment Method Snapshot Client');
    await table('clients').where({ client_id: clientId }).update({
      preferred_payment_method: 'credit_card',
      payment_terms: 'net_30',
    });

    const cardProfileId = await ensureDefaultBillingProfile(
      { db, tenantId },
      clientId,
      { name: 'Card Site' },
    );
    const checkProfileId = await createBillingProfile(
      { db, tenantId },
      clientId,
      'Check Site',
    );
    await table('client_billing_profiles')
      .where({ billing_profile_id: checkProfileId })
      .update({ preferred_payment_method: 'check', payment_terms: 'due_on_receipt', bills_separately: true });
    const inheritingDefaultProfile = await table('client_billing_profiles')
      .where({ billing_profile_id: cardProfileId })
      .first('preferred_payment_method', 'payment_terms');
    expect(inheritingDefaultProfile).toMatchObject({ preferred_payment_method: null, payment_terms: null });

    const checkCycleId = uuidv4();
    await seedBillingCycle(db, tenantId, {
      billing_cycle_id: checkCycleId,
      tenant: tenantId,
      client_id: clientId,
      billing_profile_id: checkProfileId,
      billing_cycle: 'monthly',
      effective_date: `${JANUARY_START}T00:00:00Z`,
      period_start_date: `${JANUARY_START}T00:00:00Z`,
      period_end_date: `${FEBRUARY_START}T00:00:00Z`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await assignServiceTaxRate({ db, tenantId, clientId } as any, '*', 'US-NY', {
      onlyUnset: true,
    });

    const reportingProfileId = await createBillingProfile(
      { db, tenantId },
      clientId,
      'Reporting Only Site',
    );
    await table('client_billing_profiles')
      .where({ billing_profile_id: reportingProfileId })
      .update({ bills_separately: false });

    const selectors: Array<{
      billingCycleId: string;
      selectorInput: ReturnType<typeof buildContractCadenceDueSelectionInput>;
    }> = [];
    for (const profile of [
      { id: cardProfileId, suffix: 'Card' },
      { id: checkProfileId, suffix: 'Check' },
      { id: reportingProfileId, suffix: 'Reporting' },
    ]) {
      const serviceId = await createTestService({ db, tenantId, clientId } as any, {
        service_name: `T004 ${profile.suffix} Service`,
        billing_method: 'fixed',
        default_rate: FIXED_RATE_CENTS,
        unit_of_measure: 'month',
        tax_region: 'US-NY',
      });
      await ensureUsdServicePrice({ db, tenantId }, serviceId, FIXED_RATE_CENTS);
      const assignment = await createFixedPlanAssignment(
        { db, tenantId, clientId } as any,
        serviceId,
        {
          planName: `T004 ${profile.suffix} Plan`,
          billingFrequency: 'monthly',
          baseRateCents: FIXED_RATE_CENTS,
          startDate: '2024-12-01',
          endDate: null,
          billingTiming: 'arrears',
          cadenceOwner: 'contract',
          clientId,
          enableProration: false,
        },
      );
      // Both contracts point at the default/Card profile. The Check contract
      // deliberately overrides that inherited assignment at the line level.
      await assignContractToProfile({ db, tenantId }, assignment.clientContractId, cardProfileId);
      if (profile.id === checkProfileId) {
        await table('contract_lines')
          .where({ contract_line_id: assignment.contractLineId })
          .update({ billing_profile_id: checkProfileId });
      } else if (profile.id === reportingProfileId) {
        await assignContractToProfile({ db, tenantId }, assignment.clientContractId, reportingProfileId);
      }
      await db.transaction(async (trx) => {
        await syncRecurringServicePeriodsForContractLine(trx, {
          tenant: tenantId,
          contractLineId: assignment.contractLineId,
          sourceRunPrefix: 't004-payment-method-snapshot',
        });
      });
      selectors.push({
        billingCycleId: profile.id === cardProfileId ? cardCycleId : checkCycleId,
        selectorInput: buildContractCadenceDueSelectionInput({
          clientId,
          contractId: assignment.contractId,
          contractLineId: assignment.contractLineId,
          windowStart: JANUARY_START,
          windowEnd: FEBRUARY_START,
        }),
      });
    }

    const checkLineAssignment = await table('contract_lines as cl')
      .join('client_contracts as cc', 'cc.contract_id', 'cl.contract_id')
      .where({
        'cl.contract_line_id': selectors[1].selectorInput.executionWindow.contractLineId,
        'cc.client_id': clientId,
      })
      .first('cl.billing_profile_id as line_profile_id', 'cc.billing_profile_id as contract_profile_id');
    expect(checkLineAssignment).toMatchObject({
      line_profile_id: checkProfileId,
      contract_profile_id: cardProfileId,
    });

    const core = await import('@alga-psa/core/server');
    const originalIsEnabled = core.featureFlags.isEnabled.bind(core.featureFlags);
    perProfileFlagSpy = vi.spyOn(core.featureFlags, 'isEnabled').mockImplementation(async (flag, context) => {
      if (flag === PER_PROFILE_INVOICING_FLAG) return perProfileInvoicingEnabledInTest;
      return originalIsEnabled(flag, context);
    });
    perProfileInvoicingEnabledInTest = true;
    transactionControl.useRealTransactions = true;

    const generateSelectedRows = async (
      selectorInputs: ReturnType<typeof buildContractCadenceDueSelectionInput>[],
      expectedProfileId: string,
      expectedDescription: string,
      groupKey: string,
    ) => {
      const run = await generateGroupedInvoicesAsRecurringBillingRun({
        groupedTargets: [{
          groupKey,
          selectorInputs,
          // Contract-cadence rows from Generate have no client cycle bridge.
          // The chosen row's execution identity must determine its profile.
          billingCycleId: null,
        }],
      });
      expect(run).toMatchObject({ invoicesCreated: 1, failedCount: 0 });
      const persistedCharge = await table('invoice_charges as ic')
        .join('invoices as i', 'i.invoice_id', 'ic.invoice_id')
        .where({ 'i.client_id': clientId, 'i.billing_profile_id': expectedProfileId })
        .where('ic.description', expectedDescription)
        .orderBy('i.created_at', 'desc')
        .select('ic.invoice_id')
        .first();
      expect(persistedCharge?.invoice_id).toBeTruthy();
      return { invoice_id: persistedCharge.invoice_id as string };
    };

    const invoiceCountBeforeFailure = await table('invoices').where({ client_id: clientId }).count<{ count: string }[]>('* as count');
    const malformedCheckSelector = {
      ...selectors[1].selectorInput,
      executionWindow: {
        ...selectors[1].selectorInput.executionWindow,
        contractLineId: uuidv4(),
      },
    };
    const failedRun = await generateGroupedInvoicesAsRecurringBillingRun({
      groupedTargets: [{ groupKey: 'T004-invalid-selected-line', selectorInputs: [malformedCheckSelector] }],
    });
    expect(failedRun).toMatchObject({ invoicesCreated: 0, failedCount: 1 });
    const invoiceCountAfterFailure = await table('invoices').where({ client_id: clientId }).count<{ count: string }[]>('* as count');
    expect(invoiceCountAfterFailure[0].count).toBe(invoiceCountBeforeFailure[0].count);
    const untouchedPeriods = await table('recurring_service_periods')
      .whereIn('obligation_id', selectors.slice(0, 2).map((selector) => selector.selectorInput.executionWindow.contractLineId!))
      .where({ invoice_window_start: JANUARY_START, invoice_window_end: FEBRUARY_START })
      .select('lifecycle_state', 'invoice_id', 'invoice_charge_id');
    expect(untouchedPeriods.length).toBeGreaterThan(0);
    expect(untouchedPeriods.every((period) =>
      period.lifecycle_state !== 'billed' && period.invoice_id == null && period.invoice_charge_id == null,
    )).toBe(true);

    const reportingInvoice = await generateSelectedRows(
      [selectors[2].selectorInput],
      cardProfileId,
      'T004 Reporting Plan',
      'T004-reporting-only-row',
    );
    const checkInvoice = await generateSelectedRows(
      [selectors[0].selectorInput, selectors[1].selectorInput],
      checkProfileId,
      'T004 Check Plan',
      'T004-mixed-default-and-check-rows',
    );
    const excludedCardPeriods = await table('recurring_service_periods')
      .where({ obligation_id: selectors[0].selectorInput.executionWindow.contractLineId })
      .where({ invoice_window_start: JANUARY_START, invoice_window_end: FEBRUARY_START })
      .select('lifecycle_state', 'invoice_id', 'invoice_charge_id');
    expect(excludedCardPeriods.length).toBeGreaterThan(0);
    expect(excludedCardPeriods.every((period) =>
      period.lifecycle_state !== 'billed' && period.invoice_id == null && period.invoice_charge_id == null,
    )).toBe(true);
    const cardInvoice = await generateSelectedRows(
      [selectors[0].selectorInput],
      cardProfileId,
      'T004 Card Plan',
      'T004-default-card-row',
    );
    const checkPeriods = await table('recurring_service_periods')
      .where({ obligation_id: selectors[1].selectorInput.executionWindow.contractLineId })
      .where({ invoice_window_start: JANUARY_START, invoice_window_end: FEBRUARY_START })
      .select('lifecycle_state', 'invoice_id', 'invoice_charge_id');
    const snapshotFor = (invoiceId: string) => table('invoices')
      .where({ invoice_id: invoiceId })
      .select(
        'billing_profile_id',
        'payment_method',
        db.raw('invoice_date::text as invoice_date'),
        db.raw('due_date::text as due_date'),
        db.raw('pg_typeof(invoice_date)::text as invoice_date_type'),
      )
      .first();

    const cardSnapshot = await snapshotFor(cardInvoice.invoice_id);
    const checkSnapshot = await snapshotFor(checkInvoice.invoice_id);
    expect(cardSnapshot).toMatchObject({
      billing_profile_id: cardProfileId,
      payment_method: 'credit_card',
    });
    expect(['date', 'timestamp with time zone']).toContain(cardSnapshot.invoice_date_type);
    expect(checkSnapshot).toMatchObject({
      billing_profile_id: checkProfileId,
      payment_method: 'check',
    });

    // SQL's canonical text rendering provides the stored calendar day. Compare
    // it to the formatter's output.
    const calendarDate = (value: unknown): string => String(value).slice(0, 10);
    const displayDate = (value: string): string => new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${value}T00:00:00Z`));
    const cardInvoiceDate = Temporal.PlainDate.from(calendarDate(cardSnapshot.invoice_date));
    const cardDueDate = Temporal.PlainDate.from(calendarDate(cardSnapshot.due_date));
    expect(cardDueDate.since(cardInvoiceDate).days).toBe(30);
    expect(calendarDate(checkSnapshot.due_date)).toBe(calendarDate(checkSnapshot.invoice_date));

    // getInvoiceForRendering delegates to Invoice.getFullInvoiceById, which
    // returns Date objects in this database boundary. Other invoiceQueries
    // paths explicitly convert date strings to Temporal.PlainDate.
    const originalTimezone = process.env.TZ;
    try {
      for (const timezone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
        process.env.TZ = timezone;
        const fullInvoice = await Invoice.getFullInvoiceById(db, tenantId, cardInvoice.invoice_id);
        expect(fullInvoice.invoice_date).toBeInstanceOf(Date);
        expect(fullInvoice.due_date).toBeInstanceOf(Date);
        expect(formatInvoiceCalendarDate(fullInvoice.invoice_date as Date, 'en-US'))
          .toBe(displayDate(calendarDate(cardSnapshot.invoice_date)));
        expect(formatInvoiceCalendarDate(fullInvoice.due_date as Date, 'en-US'))
          .toBe(displayDate(calendarDate(cardSnapshot.due_date)));
      }
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }

    const cardCharges = await chargesFor(cardInvoice.invoice_id);
    const checkCharges = await chargesFor(checkInvoice.invoice_id);
    const reportingCharges = await chargesFor(reportingInvoice.invoice_id);
    expect(cardCharges.length).toBeGreaterThan(0);
    expect(checkCharges.length).toBeGreaterThan(0);
    expect(cardCharges.every((charge) => charge.billing_profile_id === cardProfileId)).toBe(true);
    expect(checkCharges.every((charge) => charge.billing_profile_id === checkProfileId)).toBe(true);
    expect(cardCharges.map((charge) => charge.description)).toEqual(['T004 Card Plan']);
    expect(checkCharges.map((charge) => charge.description)).toEqual(['T004 Check Plan']);
    expect(Number(checkCharges[0].net_amount)).toBe(FIXED_RATE_CENTS);
    expect(reportingCharges.map((charge) => charge.description)).toEqual(['T004 Reporting Plan']);
    expect(reportingCharges.every((charge) => charge.billing_profile_id === reportingProfileId)).toBe(true);
    expect(await snapshotFor(reportingInvoice.invoice_id)).toMatchObject({
      billing_profile_id: cardProfileId,
      payment_method: 'credit_card',
    });

    expect(checkPeriods.length).toBeGreaterThan(0);
    expect(checkPeriods.every((period) =>
      period.lifecycle_state === 'billed'
      && period.invoice_id === checkInvoice.invoice_id
      && period.invoice_charge_id
      && checkCharges.some((charge) => charge.item_id === period.invoice_charge_id),
    )).toBe(true);

    await table('client_billing_profiles')
      .where({ billing_profile_id: cardProfileId })
      .update({ preferred_payment_method: 'bank_transfer', payment_terms: 'due_on_receipt' });
    await table('client_billing_profiles')
      .where({ billing_profile_id: checkProfileId })
      .update({ preferred_payment_method: 'credit_card', payment_terms: 'net_30' });

    expect(await snapshotFor(cardInvoice.invoice_id)).toMatchObject({
      billing_profile_id: cardProfileId,
      payment_method: 'credit_card',
      invoice_date: cardSnapshot.invoice_date,
      due_date: cardSnapshot.due_date,
    });
    expect(await snapshotFor(checkInvoice.invoice_id)).toMatchObject({
      billing_profile_id: checkProfileId,
      payment_method: 'check',
      invoice_date: checkSnapshot.invoice_date,
      due_date: checkSnapshot.due_date,
    });

    const nextWindowStart = '2025-02-01';
    const nextWindowEnd = '2025-03-01';
    const nextWindowSelectors = selectors.slice(0, 2).map(({ selectorInput }) =>
      buildContractCadenceDueSelectionInput({
        clientId,
        contractId: selectorInput.executionWindow.contractId!,
        contractLineId: selectorInput.executionWindow.contractLineId!,
        windowStart: nextWindowStart,
        windowEnd: nextWindowEnd,
      }),
    );
    for (const selector of nextWindowSelectors) {
      await db.transaction(async (trx) => {
        await syncRecurringServicePeriodsForContractLine(trx, {
          tenant: tenantId,
          contractLineId: selector.executionWindow.contractLineId!,
          sourceRunPrefix: 't004-flag-off-rollup',
        });
      });
    }
    perProfileInvoicingEnabledInTest = false;
    const flagOffInvoice = await generateSelectedRows(
      nextWindowSelectors,
      cardProfileId,
      'T004 Card Plan',
      'T004-flag-off-mixed-profiles',
    );
    const flagOffCharges = await chargesFor(flagOffInvoice.invoice_id);
    expect(flagOffCharges.map((charge) => charge.description).sort()).toEqual([
      'T004 Card Plan',
      'T004 Check Plan',
    ]);
    expect(flagOffCharges.find((charge) => charge.description === 'T004 Card Plan')?.billing_profile_id)
      .toBe(cardProfileId);
    expect(flagOffCharges.find((charge) => charge.description === 'T004 Check Plan')?.billing_profile_id)
      .toBe(checkProfileId);
    expect(await snapshotFor(flagOffInvoice.invoice_id)).toMatchObject({
      billing_profile_id: cardProfileId,
      payment_method: 'bank_transfer',
    });
    for (let index = 0; index < nextWindowSelectors.length; index += 1) {
      const periodRows = await table('recurring_service_periods')
        .where({
          obligation_id: nextWindowSelectors[index].executionWindow.contractLineId,
          invoice_window_start: nextWindowStart,
          invoice_window_end: nextWindowEnd,
        })
        .select('lifecycle_state', 'invoice_id', 'invoice_charge_id');
      expect(periodRows.length).toBeGreaterThan(0);
      expect(periodRows.every((period) =>
        period.lifecycle_state === 'billed'
        && period.invoice_id === flagOffInvoice.invoice_id
        && period.invoice_charge_id
        && flagOffCharges.some((charge) => charge.item_id === period.invoice_charge_id),
      )).toBe(true);
    }
  }, HOOK_TIMEOUT);

  it('T004: client-cadence due-reader selectors resolve obligations, scope duplicates, and roll back failures', async () => {
    const { clientId } = await seedClient('T004 Reader Shaped Client Cadence');
    await table('clients').where({ client_id: clientId }).update({
      preferred_payment_method: 'credit_card',
      payment_terms: 'net_30',
    });
    const cardProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId, { name: 'Reader Card' });
    const checkProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Reader Check');
    await table('client_billing_profiles').where({ billing_profile_id: checkProfileId })
      .update({ preferred_payment_method: 'check', payment_terms: 'due_on_receipt', bills_separately: true });

    const assignments: Array<{ label: string; profileId: string; contractLineId: string }> = [];
    for (const entry of [
      { label: 'Card', profileId: cardProfileId },
      { label: 'Check', profileId: checkProfileId },
    ]) {
      const serviceId = await createTestService({ db, tenantId, clientId } as any, {
        service_name: `T004 Reader ${entry.label} Service`, billing_method: 'fixed',
        default_rate: FIXED_RATE_CENTS, unit_of_measure: 'month', tax_region: 'US-NY',
      });
      await ensureUsdServicePrice({ db, tenantId }, serviceId, FIXED_RATE_CENTS);
      const assignment = await createFixedPlanAssignment({ db, tenantId, clientId } as any, serviceId, {
        planName: `T004 Reader ${entry.label} Plan`, billingFrequency: 'monthly',
        baseRateCents: FIXED_RATE_CENTS, startDate: '2024-12-01', endDate: null,
        billingTiming: 'arrears', cadenceOwner: 'client', clientId, enableProration: false,
      });
      await assignContractToProfile(
        { db, tenantId },
        assignment.clientContractId,
        entry.label === 'Check' ? cardProfileId : entry.profileId,
      );
      if (entry.label === 'Check') {
        await table('contract_lines').where({ contract_line_id: assignment.contractLineId })
          .update({ billing_profile_id: checkProfileId });
      }
      await db.transaction(async (trx) => syncRecurringServicePeriodsForContractLine(trx, {
        tenant: tenantId, contractLineId: assignment.contractLineId, sourceRunPrefix: 't004-client-cadence-reader',
      }));
      assignments.push({ label: entry.label, profileId: entry.profileId, contractLineId: assignment.contractLineId });
    }

    const dueWork = await getAvailableRecurringDueWork({
      dateRange: { from: JANUARY_START, to: FEBRUARY_START }, pageSize: 100,
    } as any) as any;
    const members = dueWork.invoiceCandidates.flatMap((candidate: any) => candidate.members)
      .filter((member: any) => member.clientId === clientId
        && member.servicePeriodStart === JANUARY_START
        && member.servicePeriodEnd === FEBRUARY_START);
    expect(members).toHaveLength(2);
    const selectors = members.map((member: any) => member.selectorInput);
    for (const selector of selectors) {
      expect(selector.executionWindow).toMatchObject({ kind: 'client_cadence_window', cadenceOwner: 'client' });
      expect(selector.executionWindow.scheduleKey).toBeTruthy();
      expect(selector.executionWindow.periodKey).toBeTruthy();
      expect(selector.executionWindow.contractLineId).toBeUndefined();
      expect(selector.executionWindow.contractId).toBeUndefined();
    }

    const core = await import('@alga-psa/core/server');
    const originalIsEnabled = core.featureFlags.isEnabled.bind(core.featureFlags);
    perProfileFlagSpy = vi.spyOn(core.featureFlags, 'isEnabled').mockImplementation(async (flag, context) => {
      if (flag === PER_PROFILE_INVOICING_FLAG) return perProfileInvoicingEnabledInTest;
      return originalIsEnabled(flag, context);
    });
    perProfileInvoicingEnabledInTest = true;
    transactionControl.useRealTransactions = true;

    const invoiceCountBefore = Number((await table('invoices').where({ client_id: clientId })
      .count<{ count: string }[]>('* as count'))[0].count);
    const checkSelector = selectors.find((selector: any) => {
      const member = members.find((candidate: any) => candidate.selectorInput.executionWindow.scheduleKey === selector.executionWindow.scheduleKey);
      return member?.contractLineName === 'T004 Reader Check Plan';
    });
    const cardSelector = selectors.find((selector: any) => selector !== checkSelector);
    expect(checkSelector).toBeTruthy();
    const triggerName = 't004_fail_charge_persistence';
    const functionName = 't004_fail_charge_persistence_fn';
    await db.raw(`CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        IF NEW.tenant::text = TG_ARGV[0] THEN
          RAISE EXCEPTION 'T004 injected charge persistence failure';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await db.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON invoice_charges`);
    await db.raw(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON invoice_charges
      FOR EACH ROW EXECUTE FUNCTION ${functionName}('${tenantId}')`);
    let badRun: any;
    try {
      badRun = await generateGroupedInvoicesAsRecurringBillingRun({
        groupedTargets: [{ groupKey: 'T004-reader-rollback', selectorInputs: [checkSelector], billingCycleId: null }],
      });
    } finally {
      await db.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON invoice_charges`);
      await db.raw(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
    expect(badRun).toMatchObject({ invoicesCreated: 0, failedCount: 1 });
    expect(Number((await table('invoices').where({ client_id: clientId }).count<{ count: string }[]>('* as count'))[0].count))
      .toBe(invoiceCountBefore);
    expect(await table('invoice_charges as ic').join('invoices as i', 'i.invoice_id', 'ic.invoice_id')
      .where('i.client_id', clientId)).toHaveLength(0);
    const periodState = async () => table('recurring_service_periods')
      .whereIn('obligation_id', assignments.map((item) => item.contractLineId))
      .where({ invoice_window_start: selectors[0].windowStart, invoice_window_end: selectors[0].windowEnd })
      .select('lifecycle_state', 'invoice_id', 'invoice_charge_id');
    expect((await periodState()).every((row: any) => row.lifecycle_state !== 'billed'
      && row.invoice_id == null && row.invoice_charge_id == null)).toBe(true);

    const generateOne = async (selectorInputs: any[], groupKey: string) => {
      const result = await generateGroupedInvoicesAsRecurringBillingRun({
        groupedTargets: [{ groupKey, selectorInputs, billingCycleId: null }],
      });
      expect(result).toMatchObject({ invoicesCreated: 1, failedCount: 0 });
      return table('invoices').where({ client_id: clientId }).orderBy('created_at', 'desc').first();
    };

    // The mixed selection resolves to the separately billed Check profile.
    // Card is excluded from that invoice and remains independently billable.
    const checkInvoice = await generateOne(selectors, 'T004-reader-mixed');
    expect(checkInvoice).toMatchObject({ billing_profile_id: checkProfileId, payment_method: 'check' });
    expect(await periodState()).toEqual(expect.arrayContaining([
      expect.objectContaining({ lifecycle_state: 'billed', invoice_id: checkInvoice.invoice_id }),
      expect.objectContaining({ lifecycle_state: expect.not.stringMatching(/^billed$/), invoice_id: null }),
    ]));
    expect(String(checkInvoice.due_date).slice(0, 10)).toBe(String(checkInvoice.invoice_date).slice(0, 10));
    const checkCharges = await chargesFor(checkInvoice.invoice_id);
    expect(checkCharges).toHaveLength(1);
    expect(Number(checkCharges[0].net_amount)).toBe(FIXED_RATE_CENTS);
    expect(checkCharges[0].billing_profile_id).toBe(checkProfileId);
    const checkPeriods = await table('recurring_service_periods')
      .where({ obligation_id: assignments.find((item) => item.label === 'Check')!.contractLineId,
        invoice_window_start: selectors[0].windowStart, invoice_window_end: selectors[0].windowEnd })
      .select('lifecycle_state', 'invoice_id', 'invoice_charge_id');
    expect(checkPeriods.length).toBeGreaterThan(0);
    expect(checkPeriods.every((row: any) => row.lifecycle_state === 'billed'
      && row.invoice_id === checkInvoice.invoice_id
      && checkCharges.some((charge) => charge.item_id === row.invoice_charge_id))).toBe(true);

    const cardInvoice = await generateOne([cardSelector], 'T004-reader-independent-card');
    expect(cardInvoice).toMatchObject({ billing_profile_id: cardProfileId, payment_method: 'credit_card' });

    // A persisted invoice link remains authoritative if an administrator
    // later changes the selected line's profile assignment.
    await table('contract_lines')
      .where({ contract_line_id: assignments.find((item) => item.label === 'Check')!.contractLineId })
      .update({ billing_profile_id: cardProfileId });
    const duplicate = await generateGroupedInvoicesAsRecurringBillingRun({
      groupedTargets: [{ groupKey: 'T004-reader-real-duplicate', selectorInputs: [checkSelector], billingCycleId: null }],
    });
    expect(duplicate).toMatchObject({ invoicesCreated: 0, failedCount: 0 });
    expect(Number((await table('invoices').where({ client_id: clientId }).count<{ count: string }[]>('* as count'))[0].count))
      .toBe(invoiceCountBefore + 2);
    await table('contract_lines')
      .where({ contract_line_id: assignments.find((item) => item.label === 'Check')!.contractLineId })
      .update({ billing_profile_id: checkProfileId });

    const nextDueWork = await getAvailableRecurringDueWork({
      dateRange: { from: FEBRUARY_START, to: '2025-03-01' }, pageSize: 100,
    } as any) as any;
    const nextMembers = nextDueWork.invoiceCandidates.flatMap((candidate: any) => candidate.members)
      .filter((member: any) => member.clientId === clientId
        && member.servicePeriodStart === FEBRUARY_START
        && member.servicePeriodEnd === '2025-03-01');
    const nextCheckSelector = nextMembers.find((member: any) => member.contractLineName === 'T004 Reader Check Plan')?.selectorInput;
    expect(nextMembers).toHaveLength(2);
    expect(nextCheckSelector?.executionWindow).toMatchObject({ kind: 'client_cadence_window' });
    const checkOnly = await generateOne([nextCheckSelector], 'T004-reader-check-only');
    expect(checkOnly).toMatchObject({ billing_profile_id: checkProfileId, payment_method: 'check' });
    expect(String(checkOnly.due_date).slice(0, 10)).toBe(String(checkOnly.invoice_date).slice(0, 10));
    const checkOnlyCharges = await chargesFor(checkOnly.invoice_id);
    expect(checkOnlyCharges).toHaveLength(1);
    expect(Number(checkOnlyCharges[0].net_amount)).toBe(FIXED_RATE_CENTS);
    expect(checkOnlyCharges[0].billing_profile_id).toBe(checkProfileId);
    const checkOnlyPeriods = await table('recurring_service_periods')
      .where({ obligation_id: assignments.find((item) => item.label === 'Check')!.contractLineId,
        invoice_window_start: nextCheckSelector.windowStart, invoice_window_end: nextCheckSelector.windowEnd })
      .select('lifecycle_state', 'invoice_id', 'invoice_charge_id');
    expect(checkOnlyPeriods.length).toBeGreaterThan(0);
    expect(checkOnlyPeriods.every((row: any) => row.lifecycle_state === 'billed'
      && row.invoice_id === checkOnly.invoice_id
      && checkOnlyCharges.some((charge) => charge.item_id === row.invoice_charge_id))).toBe(true);
  }, HOOK_TIMEOUT);

  // T014 / D4 — shape A (multi-site group). The contract owns the segment, and
  // it must beat the work item: a charge cannot land on Profile A's invoice
  // when Profile B's contract priced it.
  it('T014: a contract profile assignment beats a conflicting work-item assignment', async () => {
    const { clientId, cycleId } = await seedClient('T014 Multi-Site Group');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId, { name: 'Head Office' });
    const siteA = await createBillingProfile({ db, tenantId }, clientId, 'Site A');
    const siteB = await createBillingProfile({ db, tenantId }, clientId, 'Site B');

    const hourly = await createHourlyLine(clientId, 'T014 Support');
    await assignServiceTaxRate({ db, tenantId, clientId } as any, '*', 'US-NY', { onlyUnset: true });
    await assignContractToProfile({ db, tenantId }, hourly.clientContractId, siteA);

    // The ticket says Site B; the contract that prices the work says Site A.
    const ticketId = await createTicket({ db, tenantId }, {
      clientId,
      title: 'T014 work',
      ticketNumber: 'T014-1',
      billingProfileId: siteB,
    });
    await createApprovedTimeEntry({ db, tenantId }, {
      userId,
      ticketId,
      serviceId: hourly.serviceId,
      contractLineId: hourly.contractLineId,
      workDate: '2024-12-16',
      minutes: 60,
    });

    const invoice = unwrapInvoiceResult<{ invoice_id: string }>(await generateInvoice(cycleId));
    const timeCharges = (await chargesFor(invoice.invoice_id)).filter(
      (row: any) => row.billing_profile_source === 'contract',
    );

    expect(timeCharges.length).toBeGreaterThan(0);
    for (const charge of timeCharges) {
      expect(charge.billing_profile_id).toBe(siteA);
    }
  }, HOOK_TIMEOUT);

  // T016 / shape C — one legal entity, many facilities: a single shared contract
  // with no profile assignment, so attribution falls through to the work item.
  // T017 rides along: two tickets on different segments, billed through the
  // *same* hourly line, must resolve to different profiles — the pre-existing
  // coarse attribution this feature corrects.
  it('T016/T017: an unassigned contract attributes time by work item, per entry', async () => {
    const { clientId, cycleId } = await seedClient('T016 Multi-Facility Entity');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId, { name: 'Corporate' });
    const northPlant = await createBillingProfile({ db, tenantId }, clientId, 'North Plant');
    const southPlant = await createBillingProfile({ db, tenantId }, clientId, 'South Plant');

    const hourly = await createHourlyLine(clientId, 'T016 Support');
    await assignServiceTaxRate({ db, tenantId, clientId } as any, '*', 'US-NY', { onlyUnset: true });
    // Deliberately no contract or contract-line profile assignment.

    for (const [index, [profileId, label]] of [
      [northPlant, 'North'],
      [southPlant, 'South'],
    ].entries()) {
      const ticketId = await createTicket({ db, tenantId }, {
        clientId,
        title: `T016 ${label} work`,
        ticketNumber: `T016-${index + 1}`,
        billingProfileId: profileId as string,
      });
      await createApprovedTimeEntry({ db, tenantId }, {
        userId,
        ticketId,
        serviceId: hourly.serviceId,
        contractLineId: hourly.contractLineId,
        workDate: `2024-12-1${index + 7}`,
        minutes: 60,
      });
    }

    const invoice = unwrapInvoiceResult<{ invoice_id: string }>(await generateInvoice(cycleId));
    const workItemCharges = (await chargesFor(invoice.invoice_id)).filter(
      (row: any) => row.billing_profile_source === 'work_item',
    );

    expect(workItemCharges).toHaveLength(2);
    expect(new Set(workItemCharges.map((row: any) => row.billing_profile_id))).toEqual(
      new Set([northPlant, southPlant]),
    );
  }, HOOK_TIMEOUT);
});
