import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  createTestService,
  createFixedPlanAssignment,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings,
} from '../../../../test-utils/billingTestHelpers';

// P0 journey (docs: journey-first testing pivot): the AR through-line an MSP
// actually walks — a recurring invoice generates as a draft, payment against a
// draft is refused, the admin finalizes it (draft → sent), a partial payment
// lands (sent → partially_applied), the closing payment lands (→ paid), and
// every payment leaves an invoice_payments row plus a 'payment' transaction so
// the ledger reconciles to a zero balance. The bricks (invoice timing, payment
// status math) are covered elsewhere; this asserts the seams between them.

let db: Knex;
let tenantId: string;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let finalizeInvoice: typeof import('@alga-psa/billing/actions/invoiceModification').finalizeInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;
let recordExternalPayment: typeof import('@alga-psa/billing/services/accountingSync/recordExternalPayment').recordExternalPayment;
let computeBalanceDue: typeof import('@alga-psa/billing/services/accountingSync/recordExternalPayment').computeBalanceDue;

function tenantTable<Row extends object = Record<string, unknown>>(
  connection: Knex,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(connection, tenant).table<Row>(tableExpression);
}

function tenantRows(connection: Knex): Knex.QueryBuilder<Record<string, unknown>, Record<string, unknown>[]> {
  return tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
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
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: 'journey-test-user',
          tenant: tenantId,
          roles: [{ role_name: 'Admin' }],
        } as any,
        { tenant: tenantId },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

const HOOK_TIMEOUT = 180_000;

const DECEMBER_START = '2024-12-01';
const JANUARY_START = '2025-01-01';
const FEBRUARY_START = '2025-02-01';

const BASE_RATE_CENTS = 25000;
const PARTIAL_PAYMENT_CENTS = 10000;

describe('journey: invoice lifecycle → payment', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureTenant(db);
    setupCommonMocks({ tenantId, userId: 'journey-test-user', permissionCheck: () => true });
    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ finalizeInvoice } = await import('@alga-psa/billing/actions/invoiceModification'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
    ({ recordExternalPayment, computeBalanceDue } = await import(
      '@alga-psa/billing/services/accountingSync/recordExternalPayment'
    ));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('walks a generated invoice from draft through finalize, partial payment, and closing payment to paid', async () => {
    // --- a client with a billing cycle, tax config, and a billing address ---
    const clientId = uuidv4();
    await tenantTable(db, tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Journey AR Client ${clientId.slice(0, 8)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    await tenantTable(db, tenantId, 'client_locations').insert({
      location_id: uuidv4(),
      tenant: tenantId,
      client_id: clientId,
      location_name: 'Billing',
      address_line1: '1 Receivables Row',
      city: 'Testville',
      state_province: 'NY',
      postal_code: '10001',
      country_code: 'US',
      country_name: 'United States',
      email: `${clientId.slice(0, 8)}@journey.test`,
      is_default: true,
      is_billing_address: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    const contextLike = { db, tenantId, clientId } as const;
    await ensureDefaultBillingSettings(contextLike as any);
    await ensureClientPlanBundlesTable(contextLike as any);
    await ensureInvoicePaymentsTable(db);
    await setupClientTaxConfiguration(contextLike as any, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'New York Tax',
      startDate: '2024-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });

    const januaryCycleId = uuidv4();
    await tenantTable(db, tenantId, 'client_billing_cycles').insert({
      billing_cycle_id: januaryCycleId,
      tenant: tenantId,
      client_id: clientId,
      billing_cycle: 'monthly',
      effective_date: `${JANUARY_START}T00:00:00Z`,
      period_start_date: `${JANUARY_START}T00:00:00Z`,
      period_end_date: `${FEBRUARY_START}T00:00:00Z`,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // --- a fixed contract line; arrears by default, so a December start
    // lands the service period on the January cycle's invoice window ---
    const serviceId = await createTestService(contextLike as any, {
      service_name: 'Journey Lifecycle Support',
      billing_method: 'fixed',
      default_rate: BASE_RATE_CENTS,
      unit_of_measure: 'month',
      tax_region: 'US-NY'
    });
    // The service was created after the initial '*' assignment — pick it up.
    await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });

    const line = await createFixedPlanAssignment(contextLike as any, serviceId, {
      planName: 'Journey Lifecycle Plan',
      billingFrequency: 'monthly',
      baseRateCents: BASE_RATE_CENTS,
      startDate: DECEMBER_START,
      endDate: null,
      billingTiming: 'arrears',
      clientId,
      enableProration: false
    });

    await db.transaction(async (trx) => {
      await syncRecurringServicePeriodsForContractLine(trx, {
        tenant: tenantId,
        contractLineId: line.contractLineId,
        sourceRunPrefix: 'journey-test',
      });
    });

    // --- the invoice generates as a draft with the contract's numbers ---
    const generated = await generateInvoice(januaryCycleId);
    expect(generated, JSON.stringify(generated)).toBeTruthy();
    expect(generated?.invoice_id, JSON.stringify(generated)).toBeDefined();
    const invoiceId = generated!.invoice_id;

    expect(Number(generated?.subtotal)).toBe(BASE_RATE_CENTS);
    expect(Number(generated?.tax)).toBeGreaterThan(0);
    expect(Number(generated?.total_amount)).toBe(Number(generated?.subtotal) + Number(generated?.tax));

    const draftRow = await tenantTable(db, tenantId, 'invoices')
      .where({ tenant: tenantId, invoice_id: invoiceId })
      .first();
    expect(draftRow?.status).toBe('draft');
    expect(draftRow?.finalized_at).toBeNull();
    const totalAmount = Number(draftRow?.total_amount);
    expect(totalAmount).toBe(Number(generated?.total_amount));

    // Seam 1: money cannot land on a draft — payment recording refuses it.
    const premature = await recordExternalPayment(db, tenantId, {
      invoiceId,
      amount: PARTIAL_PAYMENT_CENTS,
      provider: 'check',
      referenceNumber: 'CHK-EARLY'
    });
    expect(premature.success).toBe(false);
    expect(premature.paymentRecorded).toBe(false);
    expect(premature.error).toContain('draft');
    expect(
      await tenantTable(db, tenantId, 'invoice_payments').where({ tenant: tenantId, invoice_id: invoiceId })
    ).toHaveLength(0);
    expect(
      await tenantTable(db, tenantId, 'transactions')
        .where({ tenant: tenantId, invoice_id: invoiceId, type: 'payment' })
    ).toHaveLength(0);

    // Seam 2: finalize flips draft → sent and stamps finalized_at; no client
    // credit exists, so the document total is untouched.
    const finalizeResult = await finalizeInvoice(invoiceId);
    expect(finalizeResult, JSON.stringify(finalizeResult)).toEqual({ success: true });

    const sentRow = await tenantTable(db, tenantId, 'invoices')
      .where({ tenant: tenantId, invoice_id: invoiceId })
      .first();
    expect(sentRow?.status).toBe('sent');
    expect(sentRow?.finalized_at).not.toBeNull();
    expect(Number(sentRow?.credit_applied ?? 0)).toBe(0);
    expect(Number(sentRow?.total_amount)).toBe(totalAmount);

    // Seam 3: a partial payment books and the status reflects the open balance.
    const partial = await recordExternalPayment(db, tenantId, {
      invoiceId,
      amount: PARTIAL_PAYMENT_CENTS,
      provider: 'check',
      referenceNumber: 'CHK-1001',
      notes: 'first installment'
    });
    expect(partial.success, JSON.stringify(partial)).toBe(true);
    expect(partial.paymentRecorded).toBe(true);
    expect(partial.newStatus).toBe('partially_applied');
    expect(partial.totalPaid).toBe(PARTIAL_PAYMENT_CENTS);
    expect(partial.clientId).toBe(clientId);

    const partiallyPaidRow = await tenantTable(db, tenantId, 'invoices')
      .where({ tenant: tenantId, invoice_id: invoiceId })
      .first();
    expect(partiallyPaidRow?.status).toBe('partially_applied');
    expect(
      computeBalanceDue({
        totalAmount,
        creditApplied: Number(partiallyPaidRow?.credit_applied ?? 0),
        totalPaid: PARTIAL_PAYMENT_CENTS
      })
    ).toBe(totalAmount - PARTIAL_PAYMENT_CENTS);

    const partialTransactions = await tenantTable(db, tenantId, 'transactions')
      .where({ tenant: tenantId, invoice_id: invoiceId, type: 'payment' });
    expect(partialTransactions).toHaveLength(1);
    expect(Number(partialTransactions[0].amount)).toBe(PARTIAL_PAYMENT_CENTS);
    expect(partialTransactions[0].status).toBe('completed');
    expect(partialTransactions[0].client_id).toBe(clientId);

    // Seam 4: the closing payment zeroes the balance and flips the status to paid.
    const remainder = totalAmount - PARTIAL_PAYMENT_CENTS;
    const closing = await recordExternalPayment(db, tenantId, {
      invoiceId,
      amount: remainder,
      provider: 'check',
      referenceNumber: 'CHK-1002',
      notes: 'closing installment'
    });
    expect(closing.success, JSON.stringify(closing)).toBe(true);
    expect(closing.newStatus).toBe('paid');
    expect(closing.totalPaid).toBe(totalAmount);

    const paidRow = await tenantTable(db, tenantId, 'invoices')
      .where({ tenant: tenantId, invoice_id: invoiceId })
      .first();
    expect(paidRow?.status).toBe('paid');
    expect(
      computeBalanceDue({
        totalAmount,
        creditApplied: Number(paidRow?.credit_applied ?? 0),
        totalPaid: closing.totalPaid!
      })
    ).toBe(0);

    // The AR trail reconciles: two payment rows and two payment transactions
    // covering the document total, references intact.
    const paymentRows = await tenantTable(db, tenantId, 'invoice_payments')
      .where({ tenant: tenantId, invoice_id: invoiceId })
      .orderBy('created_at', 'asc');
    expect(paymentRows).toHaveLength(2);
    expect(paymentRows.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(totalAmount);
    expect(paymentRows.map((row) => row.payment_method)).toEqual(['check', 'check']);
    expect(paymentRows.map((row) => row.reference_number).sort()).toEqual(['CHK-1001', 'CHK-1002']);

    const paymentTransactions = await tenantTable(db, tenantId, 'transactions')
      .where({ tenant: tenantId, invoice_id: invoiceId, type: 'payment' });
    expect(paymentTransactions).toHaveLength(2);
    expect(paymentTransactions.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(totalAmount);
    for (const row of paymentTransactions) {
      expect(row.status).toBe('completed');
      expect(row.client_id).toBe(clientId);
    }
  }, HOOK_TIMEOUT);
});

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantRows(connection).first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }
  const newTenantId = uuidv4();
  await tenantRows(connection).insert({
    tenant: newTenantId,
    client_name: 'Journey Integration Tenant',
    email: 'journeys@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
}
// invoice_payments ships from an EE migration
// (ee/server/migrations/20251203120000_create_invoice_payments_table.cjs); the
// CE chain this test DB runs never creates it, even though the payment landing
// (recordExternalPayment) lives in the CE billing package. Mirror the EE schema
// here, the way ensureClientPlanBundlesTable does for plan bundles.
async function ensureInvoicePaymentsTable(connection: Knex): Promise<void> {
  await connection.raw(`
    CREATE TABLE IF NOT EXISTS invoice_payments (
      payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant UUID NOT NULL,
      invoice_id UUID NOT NULL,
      amount BIGINT NOT NULL,
      payment_method VARCHAR(100),
      payment_date TIMESTAMPTZ DEFAULT NOW(),
      reference_number VARCHAR(255),
      notes TEXT,
      status VARCHAR(50) DEFAULT 'completed',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
