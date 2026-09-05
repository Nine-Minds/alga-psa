import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import {
  createBillingProfile,
  ensureDefaultBillingProfile,
} from '../../../../test-utils/billingProfileTestHelpers';

/**
 * S4 — spend by billing profile (T022, T023, T024).
 *
 * The report is only trustworthy if its totals are provably the sum of the
 * charges it will show you when you open the row, so that is what these assert:
 * totals reconcile with `invoice_charges`, and the drill-down returns exactly
 * the summed set — not a similar-looking one.
 */

let db: Knex;
let tenantId: string;
let userId: string;

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

// T023 revokes the report permission through this ref. vi.mock factories are
// hoisted above module scope, so it has to be hoisted with them.
const permittedRef = vi.hoisted(() => ({ value: true }));

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

const HOOK_TIMEOUT = 300_000;

const PERIOD_START = '2025-03-01';
const PERIOD_END = '2025-04-01';

let getSpendByBillingProfile: typeof import('@alga-psa/billing/actions/billingProfileReportActions')['getSpendByBillingProfile'];
let getChargesForBillingProfile: typeof import('@alga-psa/billing/actions/billingProfileReportActions')['getChargesForBillingProfile'];

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function seedInvoiceWithCharges(
  clientId: string,
  invoiceDate: string,
  status: string,
  charges: Array<{ billingProfileId: string; net: number; tax: number; source: string; description: string }>,
): Promise<string> {
  const invoiceId = uuidv4();
  await table('invoices').insert({
    invoice_id: invoiceId,
    tenant: tenantId,
    client_id: clientId,
    invoice_number: `INV-${invoiceId.slice(0, 8)}`,
    invoice_date: invoiceDate,
    due_date: invoiceDate,
    status,
    subtotal: charges.reduce((sum, charge) => sum + charge.net, 0),
    tax: charges.reduce((sum, charge) => sum + charge.tax, 0),
    total_amount: charges.reduce((sum, charge) => sum + charge.net + charge.tax, 0),
    credit_applied: 0,
    is_manual: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  for (const charge of charges) {
    await table('invoice_charges').insert({
      item_id: uuidv4(),
      tenant: tenantId,
      invoice_id: invoiceId,
      description: charge.description,
      quantity: 1,
      unit_price: charge.net,
      net_amount: charge.net,
      tax_amount: charge.tax,
      total_price: charge.net + charge.tax,
      is_manual: true,
      is_discount: false,
      is_taxable: charge.tax > 0,
      billing_profile_id: charge.billingProfileId,
      billing_profile_source: charge.source,
      created_at: db.fn.now(),
    });
  }
  return invoiceId;
}

describe('billing profiles S4 — spend by profile (T022, T023, T024)', () => {
  let clientId: string;
  let corporateProfileId: string;
  let northProfileId: string;
  let southProfileId: string;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profiles' });

    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({
        tenant: tenantId,
        client_name: 'Spend Report Fixture',
        email: `spend-${tenantId.slice(0, 8)}@profiles.test`,
      });

    userId = uuidv4();
    await table('users').insert({
      user_id: userId,
      tenant: tenantId,
      username: 'spend-report-tester',
      email: 'spend-report@profiles.test',
      hashed_password: 'test_hash',
      first_name: 'Spend',
      last_name: 'Tester',
      user_type: 'internal',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    setupCommonMocks({
      tenantId,
      userId,
      // Everything is permitted except the report's own permission, which T023
      // revokes to prove the report is gated on it rather than on billing:read.
      permissionCheck: (_user, resource) =>
        resource === 'billing_profile_report' ? permittedRef.value : true,
    });

    clientId = uuidv4();
    await table('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Multi-Facility Entity',
      billing_cycle: 'monthly',
      default_currency_code: 'USD',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    corporateProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId, {
      name: 'Corporate',
    });
    northProfileId = await createBillingProfile({ db, tenantId }, clientId, 'North Plant');
    southProfileId = await createBillingProfile({ db, tenantId }, clientId, 'South Plant');

    // In period, reportable.
    await seedInvoiceWithCharges(clientId, '2025-03-05', 'sent', [
      { billingProfileId: northProfileId, net: 50000, tax: 4000, source: 'contract', description: 'North support' },
      { billingProfileId: southProfileId, net: 30000, tax: 2400, source: 'work_item', description: 'South support' },
      { billingProfileId: corporateProfileId, net: 10000, tax: 800, source: 'client_default', description: 'Unclaimed admin' },
    ]);
    await seedInvoiceWithCharges(clientId, '2025-03-20', 'paid', [
      { billingProfileId: northProfileId, net: 25000, tax: 2000, source: 'contract_line', description: 'North extras' },
    ]);
    // Draft — amounts still move, so it must not be counted.
    await seedInvoiceWithCharges(clientId, '2025-03-25', 'draft', [
      { billingProfileId: northProfileId, net: 99999, tax: 0, source: 'contract', description: 'Draft, not yet real' },
    ]);
    // Outside the period.
    await seedInvoiceWithCharges(clientId, '2025-02-10', 'sent', [
      { billingProfileId: northProfileId, net: 40000, tax: 3200, source: 'contract', description: 'February north' },
    ]);

    ({ getSpendByBillingProfile, getChargesForBillingProfile } = await import(
      '@alga-psa/billing/actions/billingProfileReportActions'
    ));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('T022: totals equal the sum of the underlying invoice_charges', async () => {
    const result: any = await getSpendByBillingProfile({
      clientId,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    const byId = new Map<string, any>(result.rows.map((row: any) => [row.billingProfileId, row]));

    expect(byId.get(northProfileId)).toMatchObject({
      profileName: 'North Plant',
      netAmount: 75000,
      taxAmount: 6000,
      total: 81000,
      chargeCount: 2,
    });
    expect(byId.get(southProfileId)).toMatchObject({ netAmount: 30000, chargeCount: 1 });
    expect(byId.get(corporateProfileId)).toMatchObject({
      netAmount: 10000,
      isDefaultProfile: true,
    });

    // The draft invoice and the February invoice are excluded, so no row can
    // include their amounts.
    const netTotal = result.rows.reduce((sum: number, row: any) => sum + row.netAmount, 0);
    expect(netTotal).toBe(115000);
  }, HOOK_TIMEOUT);

  it('T022: drill-down returns exactly the charges that were summed', async () => {
    const charges: any = await getChargesForBillingProfile({
      clientId,
      billingProfileId: northProfileId,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    expect(charges).toHaveLength(2);
    expect(charges.reduce((sum: number, row: any) => sum + row.netAmount, 0)).toBe(75000);
    expect(charges.map((row: any) => row.description).sort()).toEqual([
      'North extras',
      'North support',
    ]);
  }, HOOK_TIMEOUT);

  it('T024: charges that fell back to the client default are distinguishable', async () => {
    const result: any = await getSpendByBillingProfile({
      clientId,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    const byId = new Map<string, any>(result.rows.map((row: any) => [row.billingProfileId, row]));

    // Corporate's whole number is fallback; North's is none of it, even though
    // both are non-zero totals.
    expect(byId.get(corporateProfileId).clientDefaultFallbackAmount).toBe(10000);
    expect(byId.get(northProfileId).clientDefaultFallbackAmount).toBe(0);
    expect(byId.get(southProfileId).clientDefaultFallbackAmount).toBe(0);
  }, HOOK_TIMEOUT);

  it('T055: comparing two periods reports each period separately', async () => {
    const result: any = await getSpendByBillingProfile({
      clientId,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      comparisonPeriodStart: '2025-02-01',
      comparisonPeriodEnd: PERIOD_START,
    });

    expect(result.comparison.periodStart).toBe('2025-02-01');
    const priorNorth = result.comparison.rows.find(
      (row: any) => row.billingProfileId === northProfileId,
    );
    expect(priorNorth.netAmount).toBe(40000);
    // The current period is unaffected by the comparison window.
    const currentNorth = result.rows.find((row: any) => row.billingProfileId === northProfileId);
    expect(currentNorth.netAmount).toBe(75000);
  }, HOOK_TIMEOUT);

  it('T023: the report is refused without its own RBAC permission', async () => {
    permittedRef.value = false;
    try {
      const result: any = await getSpendByBillingProfile({
        clientId,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });
      expect(result).toMatchObject({ permissionError: expect.stringContaining('Permission denied') });

      const charges: any = await getChargesForBillingProfile({
        clientId,
        billingProfileId: northProfileId,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });
      expect(charges).toMatchObject({ permissionError: expect.stringContaining('Permission denied') });
    } finally {
      permittedRef.value = true;
    }
  }, HOOK_TIMEOUT);
});
