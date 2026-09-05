import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
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
 * S2 — charge attribution (T010, T014, T016, T017).
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
      callback(knexOrTrx as unknown as Knex.Transaction),
    ),
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

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

const HOOK_TIMEOUT = 300_000;

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

describe('billing profiles S2 — charge attribution (T010, T014, T016, T017)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    // A dedicated database: the shared `test_database` is recreated by every
    // other integration suite, including ones running concurrently in sibling
    // worktrees, which drops this suite's connection mid-run.
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profiles' });

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
    ({ syncRecurringServicePeriodsForContractLine } = await import(
      '@alga-psa/billing/actions/recurringServicePeriodSync'
    ));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

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
