import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../actions/_dbTestUtils';
import { computePartialPeriodAmount } from '../lib/billing/compute/contractInvoiceAdjustments';
import { validateContractLineWindow } from '../lib/billing/contractLineWindow';
import { inspectInvoiceEditable } from './invoiceAdjustmentEditability';
import { BillingEngine } from '../lib/billing/billingEngine';
import Invoice from '../models/invoice';
import { buildPartialPeriodInvoiceDescription } from '../lib/billing/partialPeriodInvoiceDescription';

const actionContext = vi.hoisted(() => ({ db: null as Knex | null, tenant: null as string | null, userId: null as string | null }));

// Real-database coverage for contract invoice adjustments.
//
// The evaluator is unit-tested; these assertions prove the persisted behaviour:
// an invoice-wide automatic discount linked to the client's contract is
// re-applied against generated + manual charges without duplicating rows, a
// manual partial-period line survives draft refresh, and a foreign discount
// target aborts the write.

vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({
  generateInvoiceNumber: vi.fn(),
}));
vi.mock('../services/taxService', () => ({
  TaxService: class TaxService {},
}));
vi.mock('../lib/authHelpers', () => ({
  getCurrentUserAsync: vi.fn(),
  hasPermissionAsync: vi.fn(),
  getSessionAsync: vi.fn(),
  getAnalyticsAsync: vi.fn(),
}));
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: actionContext.db, tenant: actionContext.tenant }),
  };
});
vi.mock('@alga-psa/auth', () => ({
  withAuth: (handler: (...args: any[]) => unknown) => (...args: unknown[]) => handler(
    { user_id: actionContext.userId },
    { tenant: actionContext.tenant },
    ...args,
  ),
  getSession: async () => ({ user: { id: actionContext.userId } }),
}));
vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (handler: (...args: any[]) => unknown) => (...args: unknown[]) => handler(
    { user_id: actionContext.userId },
    { tenant: actionContext.tenant },
    ...args,
  ),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/integrations/lib/qbo/qboTaxSettings', () => ({ isQboAutomatedSalesTaxEnabled: async () => false }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));

const {
  persistManualInvoiceCharges,
  reconcileAutomaticInvoiceDiscounts,
  reconcileAutomaticInvoiceAdjustments,
  updateInvoiceTotalsAndRecordTransaction,
} = await import('./invoiceService');

let db: Knex;
let tenant: string;
let clientId: string;
let foreignClientId: string;
let serviceId: string;
let userId: string;
let contractId: string;
let contractLineId: string;
let clientContractId: string;
let configuredDiscountId: string;
let defaultBillingProfileId: string;
let smokeLocationId: string;

async function seedContractDiscount(): Promise<void> {
  contractId = uuidv4();
  contractLineId = uuidv4();
  clientContractId = uuidv4();
  configuredDiscountId = uuidv4();

  await db('contracts').insert({
    tenant,
    contract_id: contractId,
    contract_name: 'Managed Services',
    billing_frequency: 'monthly',
    is_active: true,
  });
  await db('contract_lines').insert({
    tenant,
    contract_line_id: contractLineId,
    contract_line_name: 'Recurring support',
    contract_id: contractId,
    billing_frequency: 'monthly',
    contract_line_type: 'fixed',
    is_active: true,
  });
  await db('client_contracts').insert({
    tenant,
    client_contract_id: clientContractId,
    client_id: clientId,
    contract_id: contractId,
    start_date: '2026-01-01T00:00:00.000Z',
    is_active: true,
  });
  await db('discounts').insert({
    tenant,
    discount_id: configuredDiscountId,
    discount_name: 'Loyalty 10%',
    discount_type: 'percentage',
    value: 0.1,
    start_date: '2026-01-01T00:00:00.000Z',
    end_date: null,
    is_active: true,
  });
  await db('contract_line_discounts').insert({
    tenant,
    discount_id: configuredDiscountId,
    contract_line_id: contractLineId,
    client_id: clientId,
    client_contract_id: clientContractId,
  });
}

interface InvoiceFixture {
  invoiceId: string;
  generatedChargeId: string;
  automaticDiscountItemId: string;
}

async function createDraftWithGeneratedChargeAndDiscount(
  currencyCode = 'USD',
): Promise<InvoiceFixture> {
  const invoiceId = uuidv4();
  const generatedChargeId = uuidv4();
  const automaticDiscountItemId = uuidv4();

  await db('invoices').insert({
    tenant,
    invoice_id: invoiceId,
    invoice_number: `ADJ-${invoiceId.slice(0, 8)}`,
    invoice_date: '2026-09-01T00:00:00.000Z',
    due_date: '2026-09-30T00:00:00.000Z',
    subtotal: 351000,
    tax: 0,
    total_amount: 351000,
    status: 'draft',
    client_id: clientId,
    currency_code: currencyCode,
    is_manual: false,
    client_contract_id: clientContractId,
  });

  await db('invoice_charges').insert({
    tenant,
    item_id: generatedChargeId,
    invoice_id: invoiceId,
    service_id: serviceId,
    description: 'Recurring support',
    quantity: 1,
    unit_price: 390000,
    net_amount: 390000,
    total_price: 390000,
    tax_amount: 0,
    tax_rate: 0,
    is_manual: false,
    is_discount: false,
    is_taxable: false,
    client_contract_id: clientContractId,
  });

  // A prior draft refresh already stamped this generated discount with its
  // source; reconciliation must update this row in place.
  await db('invoice_charges').insert({
    tenant,
    item_id: automaticDiscountItemId,
    invoice_id: invoiceId,
    description: 'Loyalty 10%',
    quantity: 1,
    unit_price: -39000,
    net_amount: -39000,
    total_price: -39000,
    tax_amount: 0,
    tax_rate: 0,
    is_manual: false,
    is_discount: true,
    is_taxable: false,
    discount_type: 'percentage',
    discount_percentage: 10,
    adjustment_source_kind: 'discount',
    adjustment_source_id: configuredDiscountId,
    adjustment_source_revision: 1,
    adjustment_scope: 'invoice',
    adjustment_base_amount: 390000,
  });

  return { invoiceId, generatedChargeId, automaticDiscountItemId };
}

// The same instance, but the automatic discount was persisted before adjustment
// provenance existed: `is_discount = true, is_manual = false` with no source
// kind/id. Reconciliation must adopt this row rather than append a second one.
async function createDraftWithGeneratedChargeAndLegacyDiscount(): Promise<InvoiceFixture> {
  const invoiceId = uuidv4();
  const generatedChargeId = uuidv4();
  const automaticDiscountItemId = uuidv4();

  await db('invoices').insert({
    tenant,
    invoice_id: invoiceId,
    invoice_number: `ADJ-LEGACY-${invoiceId.slice(0, 8)}`,
    invoice_date: '2026-09-01T00:00:00.000Z',
    due_date: '2026-09-30T00:00:00.000Z',
    subtotal: 351000,
    tax: 0,
    total_amount: 351000,
    status: 'draft',
    client_id: clientId,
    currency_code: 'USD',
    is_manual: false,
    client_contract_id: clientContractId,
  });

  await db('invoice_charges').insert({
    tenant,
    item_id: generatedChargeId,
    invoice_id: invoiceId,
    service_id: serviceId,
    description: 'Recurring support',
    quantity: 1,
    unit_price: 390000,
    net_amount: 390000,
    total_price: 390000,
    tax_amount: 0,
    tax_rate: 0,
    is_manual: false,
    is_discount: false,
    is_taxable: false,
    client_contract_id: clientContractId,
  });

  await db('invoice_charges').insert({
    tenant,
    item_id: automaticDiscountItemId,
    invoice_id: invoiceId,
    description: 'Loyalty 10%',
    quantity: 1,
    unit_price: -39000,
    net_amount: -39000,
    total_price: -39000,
    tax_amount: 0,
    tax_rate: 0,
    is_manual: false,
    is_discount: true,
    is_taxable: false,
    discount_type: 'percentage',
    discount_percentage: 10,
  });

  return { invoiceId, generatedChargeId, automaticDiscountItemId };
}

function automaticDiscountRows(invoiceId: string) {
  return db('invoice_charges')
    .where({ tenant, invoice_id: invoiceId, adjustment_source_kind: 'discount' })
    .orderBy('created_at', 'asc')
    .orderBy('item_id', 'asc');
}

async function insertManualPartialPeriodCharge(params: {
  invoiceId: string;
  generatedChargeId: string;
  description?: string;
  locationId?: string;
  billingProfileId?: string;
}): Promise<{ itemId: string; amount: number }> {
  const amount = computePartialPeriodAmount({
    units: 3,
    unitPrice: 10_000,
    coveredDays: 15,
    fullPeriodDays: 30,
  });
  const itemId = uuidv4();
  await db.transaction(async (trx) => {
    await persistManualInvoiceCharges(
      trx,
      params.invoiceId,
      [
        {
          item_id: itemId,
          service_id: serviceId,
          description: params.description ?? '3 × $100 × 15/30',
          quantity: 1,
          rate: amount,
          is_taxable: true,
          location_id: params.locationId,
          billing_profile_id: params.billingProfileId,
          manual_line_metadata: {
            partialPeriod: { units: 3, unitPrice: 10_000, coveredDays: 15, fullPeriodDays: 30 },
            reason: 'Mid-period seat addition',
          },
        },
      ],
      { client_id: clientId, region_code: null, default_currency_code: 'USD' },
      { user: { id: userId } } as never,
      tenant,
    );
  });
  return { itemId, amount };
}

async function sumChargeNet(invoiceId: string): Promise<{ gross: number; discounts: number; net: number }> {
  const rows = await db('invoice_charges').where({ tenant, invoice_id: invoiceId }).select('net_amount', 'is_discount');
  let gross = 0;
  let discounts = 0;
  for (const row of rows) {
    const amount = Number(row.net_amount);
    if (amount < 0) discounts += amount;
    else gross += amount;
  }
  return { gross, discounts, net: gross + discounts };
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();

  const seedTenant = await db('tenants').first('tenant');
  tenant = seedTenant.tenant;

  const client = await db('clients').where({ tenant }).first();
  const foreignClient = await db('clients')
    .where({ tenant })
    .whereNot({ client_id: client.client_id })
    .first();
  const service = await db('service_catalog').where({ tenant, item_kind: 'service', is_active: true }).first();
  const user = await db('users').where({ tenant }).first();
  clientId = client.client_id;
  foreignClientId = foreignClient.client_id;
  serviceId = service.service_id;
  userId = user.user_id;
  actionContext.db = db;
  actionContext.tenant = tenant;
  actionContext.userId = userId;

  const existingProfile = await db('client_billing_profiles')
    .where({ tenant, client_id: clientId, is_default: true })
    .first('billing_profile_id');
  if (!existingProfile) {
    await db('client_billing_profiles').insert({
      tenant,
      billing_profile_id: uuidv4(),
      client_id: clientId,
      name: 'Default',
      is_default: true,
      is_system_managed_default: true,
    });
  }
  const resolvedProfile = await db('client_billing_profiles')
    .where({ tenant, client_id: clientId, is_default: true })
    .first('billing_profile_id');
  defaultBillingProfileId = resolvedProfile.billing_profile_id;

  smokeLocationId = uuidv4();
  await db('client_locations').insert({
    tenant,
    location_id: smokeLocationId,
    client_id: clientId,
    location_name: 'Smoke location',
    address_line1: '1 Test Way',
    city: 'Testville',
    country_code: 'US',
    country_name: 'United States',
    is_default: false,
    is_active: true,
  });

  await seedContractDiscount();
});

afterAll(async () => {
  actionContext.db = null;
  actionContext.tenant = null;
  actionContext.userId = null;
  await db?.destroy().catch(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('contract invoice adjustments (DB-backed)', () => {
  const dateOnly = (value: unknown) => value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);

  it('requires a tenant service for manual charges but accepts serviceless quantity-derived credits', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const chargeId = uuidv4();
    await expect(db.transaction((trx) => persistManualInvoiceCharges(
      trx, fixture.invoiceId,
      [{ item_id: chargeId, description: 'Legacy service-less charge', quantity: 1, rate: 2500 }],
      { client_id: clientId, region_code: null, default_currency_code: 'USD' },
      { user: { id: userId } } as never, tenant,
    ))).rejects.toMatchObject({ code: 'SERVICE_REQUIRED' });
    expect(await db('invoice_charges').where({ tenant, item_id: chargeId }).first()).toBeUndefined();

    const creditId = uuidv4();
    await db.transaction((trx) => persistManualInvoiceCharges(
      trx, fixture.invoiceId,
      [{ item_id: creditId, description: 'Quantity-derived credit', quantity: 3, rate: -50 }],
      { client_id: clientId, region_code: null, default_currency_code: 'USD' },
      { user: { id: userId } } as never, tenant,
    ));
    const credit = await db('invoice_charges').where({ tenant, item_id: creditId }).first();
    expect(credit.is_discount).toBe(true);
    expect(credit.is_manual_credit).toBe(true);
    expect(Number(credit.quantity)).toBe(3);
    expect(Number(credit.net_amount)).toBe(-150);
  });

  it('persists an ordinary freeform Add Charge and reloads a calculator adjustment with contract attribution and its adjustment period', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const ordinaryId = uuidv4();
    const partialId = uuidv4();
    const detailId = uuidv4();
    const configId = uuidv4();
    await db('contract_line_service_configuration').insert({
      tenant, config_id: configId, contract_line_id: contractLineId, service_id: serviceId,
      configuration_type: 'Fixed', quantity: 1,
    });
    await db('invoice_charge_details').insert({
      tenant, item_detail_id: detailId, item_id: fixture.generatedChargeId,
      config_id: configId, service_id: serviceId, quantity: 1, rate: 10_000,
      service_period_start: '2026-09-01', service_period_end: '2026-09-30',
    });
    await db.transaction(async (trx) => {
      await persistManualInvoiceCharges(trx, fixture.invoiceId, [{
        item_id: ordinaryId, service_id: serviceId, description: 'Classified one-off', quantity: 1, rate: 2500,
      }], { client_id: clientId, region_code: null, default_currency_code: 'USD' }, { user: { id: userId } } as never, tenant);
      await persistManualInvoiceCharges(trx, fixture.invoiceId, [{
        item_id: partialId, service_id: serviceId, client_contract_id: clientContractId,
        description: 'One added unit for ten days', quantity: 1, rate: 3333,
        adjustment_period_start: '2026-09-21', adjustment_period_end: '2026-10-01',
        manual_line_metadata: { partialPeriod: { units: 1, unitPrice: 10_000, coveredDays: 10, fullPeriodDays: 30, resolved_amount: 3333 } },
      }], { client_id: clientId, region_code: null, default_currency_code: 'USD' }, { user: { id: userId } } as never, tenant);
    });

    const ordinary = await db('invoice_charges').where({ tenant, item_id: ordinaryId }).first();
    const partial = await db('invoice_charges').where({ tenant, item_id: partialId }).first();
    expect(Number(ordinary.net_amount)).toBe(2500);
    expect(Number(partial.quantity)).toBe(1);
    expect(Number(partial.unit_price)).toBe(3333);
    expect(Number(partial.net_amount)).toBe(3333);
    expect(partial.client_contract_id).toBe(clientContractId);
    expect(dateOnly(partial.adjustment_period_start)).toBe('2026-09-21');
    const reloaded = await Invoice.getInvoiceCharges(db, tenant, fixture.invoiceId);
    const reloadedPartial = reloaded.find((row) => row.item_id === partialId) as any;
    expect(reloadedPartial.client_contract_id).toBe(clientContractId);
    expect(dateOnly(reloadedPartial.service_period_start)).toBe('2026-09-21');
    expect(dateOnly(reloadedPartial.service_period_end)).toBe('2026-10-01');
    expect(Number(reloadedPartial.net_amount)).toBe(3333);
    await db.transaction(async (trx) => {
      await persistManualInvoiceCharges(trx, fixture.invoiceId, [{
        item_id: partialId, service_id: serviceId, client_contract_id: clientContractId,
        description: 'One added unit for ten days', quantity: 1, rate: 3333,
        adjustment_period_start: '2026-09-21', adjustment_period_end: '2026-10-01',
        manual_line_metadata: { partialPeriod: { units: 1, unitPrice: 10_000, coveredDays: 10, fullPeriodDays: 30, resolved_amount: 3333 } },
      }], { client_id: clientId, region_code: null, default_currency_code: 'USD' }, { user: { id: userId } } as never, tenant);
    });
    expect(await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, item_id: partialId })).toHaveLength(1);
  });

  it('reloads manual percentage discount type, value, and target for repeat saves', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const discountItemId = uuidv4();
    await db.transaction(async (trx) => {
      await persistManualInvoiceCharges(trx, fixture.invoiceId, [{
        item_id: discountItemId,
        description: 'Round-trip 10 percent discount',
        quantity: 1,
        rate: 0,
        is_discount: true,
        discount_type: 'percentage',
        discount_percentage: 10,
        applies_to_item_id: fixture.generatedChargeId,
      }], { client_id: clientId, region_code: null, default_currency_code: 'USD' }, { user: { id: userId } } as never, tenant);
    });

    const reloaded = (await Invoice.getInvoiceCharges(db, tenant, fixture.invoiceId))
      .find((row) => row.item_id === discountItemId) as any;
    expect(reloaded.discount_type).toBe('percentage');
    expect(Number(reloaded.discount_percentage)).toBe(10);
    expect(reloaded.applies_to_item_id).toBe(fixture.generatedChargeId);
  });

  it('persists manual percentages from the full generated and previously saved charge base before invoice recalculation', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });
    await db('invoice_charges').where({ tenant, item_id: fixture.automaticDiscountItemId }).delete();
    const client = { client_id: clientId, region_code: null, default_currency_code: 'USD' };
    const session = { user: { id: userId } } as never;
    const manualId = uuidv4();
    const discountIdForInvoice = uuidv4();
    await db.transaction((trx) => persistManualInvoiceCharges(trx, fixture.invoiceId, [{
      item_id: manualId, service_id: serviceId, description: 'Separate manual charge', quantity: 1, rate: 15000, is_taxable: false,
    }], client, session, tenant));
    await db.transaction((trx) => persistManualInvoiceCharges(trx, fixture.invoiceId, [{
      item_id: discountIdForInvoice, description: 'Invoice-wide 10% discount', quantity: 1, rate: 0,
      is_discount: true, discount_type: 'percentage', discount_percentage: 10,
    }], client, session, tenant));

    const savedDiscount = await db('invoice_charges').where({ tenant, item_id: discountIdForInvoice }).first();
    expect(Number(savedDiscount.net_amount)).toBe(-40500);
    await db.transaction((trx) => persistManualInvoiceCharges(trx, fixture.invoiceId, [{
      item_id: discountIdForInvoice, description: 'Invoice-wide 10% discount', quantity: 1, rate: 0,
      is_discount: true, discount_type: 'percentage', discount_percentage: 10,
    }], client, session, tenant));
    expect(await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, item_id: discountIdForInvoice })).toHaveLength(1);

    // A percentage discount in the same request as a new charge sees both that
    // charge and existing generated/manual lines exactly once.
    const sameSaveCharge = uuidv4();
    const sameSaveDiscount = uuidv4();
    await db.transaction((trx) => persistManualInvoiceCharges(trx, fixture.invoiceId, [
      { item_id: sameSaveCharge, service_id: serviceId, description: 'Same-save charge', quantity: 1, rate: 10000, is_taxable: false },
      { item_id: sameSaveDiscount, description: 'Same-save 10%', quantity: 1, rate: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10 },
    ], client, session, tenant));
    expect(Number((await db('invoice_charges').where({ tenant, item_id: sameSaveDiscount }).first()).net_amount)).toBe(-41500);
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
  });

  it.each(['pending_external', 'external'])('applies manual percentage discounts after later charges on %s-tax invoices', async (taxSource) => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    // This scenario is specifically the operator-authored discount path; remove
    // the fixture's configured automatic discount so the expected base is 390k.
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });
    await db('invoice_charges').where({ tenant, item_id: fixture.automaticDiscountItemId }).delete();
    await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).update({ subtotal: 390000, total_amount: 390000 });
    await db.transaction((trx) => updateInvoiceTotalsAndRecordTransaction(
      trx, fixture.invoiceId, { client_id: clientId }, tenant, 'MANUAL-DISCOUNT-DRAFT',
    ));

    const { updateInvoiceManualItems } = await import('../actions/invoiceModification');
    const manualChargeId = uuidv4();
    const manualDiscountId = uuidv4();
    const operationId = uuidv4();
    expect(await updateInvoiceManualItems(fixture.invoiceId, {
      newItems: [{ item_id: manualChargeId, service_id: serviceId, description: 'Separate manual charge', quantity: 1, rate: 15000, is_taxable: false } as any],
      updatedItems: [], removedItemIds: [],
    }, { operationId: uuidv4(), expectedRevision: 0 })).toMatchObject({ invoice_id: fixture.invoiceId });

    const discountSave = {
      newItems: [{ item_id: manualDiscountId, description: 'Invoice-wide 10% discount', quantity: 1, rate: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10, is_taxable: false } as any],
      updatedItems: [], removedItemIds: [],
    };
    expect(await updateInvoiceManualItems(fixture.invoiceId, discountSave, { operationId, expectedRevision: 1 }))
      .toMatchObject({ invoice_id: fixture.invoiceId });

    const assertFinancialState = async () => {
      const rows = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId });
      expect(rows.filter((row) => row.is_discount)).toHaveLength(1);
      expect(Number(rows.find((row) => row.item_id === manualDiscountId)?.net_amount)).toBe(-40500);
      const invoice = await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).first();
      expect(Number(invoice.subtotal)).toBe(364500);
      expect(Number(invoice.tax)).toBe(0);
      expect(Number(invoice.total_amount)).toBe(364500);
      expect(await sumChargeNet(fixture.invoiceId)).toEqual({ gross: 405000, discounts: -40500, net: 364500 });
    };
    await assertFinancialState();

    // Replay the exact operation, then reload through the real projection and
    // perform an ordinary repeat save. Neither path may duplicate the row or
    // post the invoice total again.
    expect(await updateInvoiceManualItems(fixture.invoiceId, discountSave, { operationId, expectedRevision: 1 }))
      .toMatchObject({ invoice_id: fixture.invoiceId });
    const reloaded = await Invoice.getFullInvoiceById(db, tenant, fixture.invoiceId);
    expect(reloaded).toBeTruthy();
    expect(await updateInvoiceManualItems(fixture.invoiceId, { newItems: [], updatedItems: [], removedItemIds: [] }))
      .toMatchObject({ invoice_id: fixture.invoiceId });
    await assertFinancialState();
    // Pending external tax skips the internal tax recalculation branch. A new
    // charge must still update the persisted percentage discount on this save.
    await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).update({ tax_source: taxSource });
    const laterChargeId = uuidv4();
    const laterChargeSave = { newItems: [{ item_id: laterChargeId, service_id: serviceId, description: 'Later charge', quantity: 1, rate: 100, is_taxable: false } as any], updatedItems: [], removedItemIds: [] };
    const laterChargeOperationId = uuidv4();
    expect(await updateInvoiceManualItems(fixture.invoiceId, laterChargeSave, { operationId: laterChargeOperationId, expectedRevision: 3 }))
      .toMatchObject({ invoice_id: fixture.invoiceId });
    const laterDiscount = await db('invoice_charges').where({ tenant, item_id: manualDiscountId }).first();
    const laterInvoice = await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).first();
    expect(Number(laterDiscount.net_amount)).toBe(-40510);
    expect(Number(laterInvoice.total_amount)).toBe(364590);
    expect(await updateInvoiceManualItems(fixture.invoiceId, laterChargeSave, { operationId: laterChargeOperationId, expectedRevision: 3 }))
      .toMatchObject({ invoice_id: fixture.invoiceId });
    expect(Number((await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).first()).total_amount)).toBe(364590);
    const generated = await db('transactions').where({ tenant, invoice_id: fixture.invoiceId, type: 'invoice_generated' });
    const adjustments = await db('transactions').where({ tenant, invoice_id: fixture.invoiceId, type: 'invoice_adjustment' });
    expect(generated).toHaveLength(1);
    expect(adjustments.map((row) => Number(row.amount))).toEqual([15000, -40500, 90]);
    expect(Number(generated[0].amount) + adjustments.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(364590);
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
  });

  it('recalculates a draft repeatedly without creating financial transactions', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();

    for (let pass = 0; pass < 2; pass += 1) {
      await db.transaction(async (trx) => {
        await new BillingEngine().recalculateInvoice(fixture.invoiceId, trx, tenant);
      });
    }

    expect(await db('transactions').where({ tenant, invoice_id: fixture.invoiceId })).toHaveLength(0);
    const invoice = await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).first();
    expect(Number(invoice.subtotal)).toBe(351_000);
    expect(Number(invoice.tax)).toBe(0);
    expect(Number(invoice.total_amount)).toBe(351_000);
  });

  it.each(['USD', 'EUR'])('reconciles a posted %s draft with signed deltas, preserving payments and no-op saves', async (currency) => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount(currency);
    // Exercise the same posting function used by contract invoice generation.
    await db.transaction(async (trx) => {
      await updateInvoiceTotalsAndRecordTransaction(
        trx, fixture.invoiceId, { client_id: clientId }, tenant, 'POSTED-DRAFT',
      );
    });
    const originalPosting = await db('transactions')
      .where({ tenant, invoice_id: fixture.invoiceId, type: 'invoice_generated' }).first();
    const paymentId = uuidv4();
    await db('transactions').insert({
      tenant, transaction_id: paymentId, client_id: clientId, invoice_id: fixture.invoiceId,
      type: 'payment', status: 'completed', amount: -1000,
      balance_after: Number(originalPosting.balance_after) - 1000,
      created_at: db.raw('clock_timestamp()'), currency_code: currency,
    });
    const payment = await db('transactions').where({ tenant, transaction_id: paymentId }).first();
    const { updateInvoiceManualItems } = await import('../actions/invoiceModification');
    const manualId = uuidv4();
    const operationId = uuidv4();
    const add = { newItems: [{ item_id: manualId, service_id: serviceId, description: 'One-time addition', quantity: 1, rate: 15000, is_taxable: false } as any], updatedItems: [], removedItemIds: [] };
    expect(await updateInvoiceManualItems(fixture.invoiceId, add, { operationId, expectedRevision: 0 })).toMatchObject({ invoice_id: fixture.invoiceId });
    expect(await updateInvoiceManualItems(fixture.invoiceId, add, { operationId, expectedRevision: 0 })).toMatchObject({ invoice_id: fixture.invoiceId });
    expect(await updateInvoiceManualItems(fixture.invoiceId, { newItems: [], updatedItems: [], removedItemIds: [] })).toMatchObject({ invoice_id: fixture.invoiceId });

    const adjustments = () => db('transactions')
      .where({ tenant, invoice_id: fixture.invoiceId, type: 'invoice_adjustment' }).orderBy('created_at');
    let rows = await adjustments();
    expect(rows.map((row) => Number(row.amount))).toEqual([13500]);
    expect(Number(rows[0].balance_after)).toBe(Number(payment.balance_after) + 13500);
    expect(rows[0].currency_code).toBe(currency);
    expect(Number((await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).first()).total_amount)).toBe(364500);

    expect(await updateInvoiceManualItems(fixture.invoiceId, { newItems: [], updatedItems: [], removedItemIds: [manualId] })).toMatchObject({ invoice_id: fixture.invoiceId });
    expect(await updateInvoiceManualItems(fixture.invoiceId, { newItems: [], updatedItems: [], removedItemIds: [] })).toMatchObject({ invoice_id: fixture.invoiceId });
    rows = await adjustments();
    expect(rows.map((row) => Number(row.amount))).toEqual([13500, -13500]);
    expect(Number(rows[1].balance_after)).toBe(Number(payment.balance_after));
    expect(await db('transactions').where({ tenant, transaction_id: originalPosting.transaction_id }).first()).toEqual(originalPosting);
    expect(await db('transactions').where({ tenant, transaction_id: paymentId }).first()).toEqual(payment);
    const invoice = await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).first();
    expect(Number(originalPosting.amount) + rows.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(Number(invoice.total_amount));
  });

  it('serializes concurrent recalculation of a posted draft into one adjustment', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    await db.transaction((trx) => updateInvoiceTotalsAndRecordTransaction(
      trx, fixture.invoiceId, { client_id: clientId }, tenant, 'CONCURRENT-DRAFT',
    ));
    await insertManualPartialPeriodCharge(fixture);
    await db.transaction((trx) => reconcileAutomaticInvoiceAdjustments(trx, tenant, fixture.invoiceId));
    await Promise.all([0, 1].map(() => db.transaction((trx) =>
      new BillingEngine().recalculateInvoice(fixture.invoiceId, trx, tenant),
    )));
    const adjustments = await db('transactions')
      .where({ tenant, invoice_id: fixture.invoiceId, type: 'invoice_adjustment' });
    expect(adjustments).toHaveLength(1);
    expect(Number(adjustments[0].amount)).toBe(13500);
    expect(Number((await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).first()).total_amount)).toBe(364500);
  });

  it('saves UI-shaped calculator metadata through updateInvoiceManualItems for increases, decreases, reload and edits', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    await db('invoice_charges').where({ tenant, item_id: fixture.generatedChargeId }).update({ unit_price: 10_000 });
    const sourceConfigId = uuidv4();
    await db('contract_line_service_configuration').insert({
      tenant, config_id: sourceConfigId, contract_line_id: contractLineId, service_id: serviceId,
      configuration_type: 'Fixed', quantity: 1,
    });
    await db('invoice_charge_details').insert({
      tenant, item_detail_id: uuidv4(), item_id: fixture.generatedChargeId,
      config_id: sourceConfigId, service_id: serviceId, quantity: 1, rate: 10_000,
      service_period_start: '2026-08-01', service_period_end: '2026-08-31',
    });
    const { updateInvoiceManualItems } = await import('../actions/invoiceModification');
    const makeUiRow = (id: string, direction: 'increase' | 'decrease') => {
      const sign = direction === 'decrease' ? -1 : 1;
      return {
        item_id: id,
        invoice_id: fixture.invoiceId,
        tenant,
        service_id: serviceId,
        description: buildPartialPeriodInvoiceDescription({
          sourceDescription: 'SMOKE Prod Users', direction, units: 3,
          start: '2026-08-16', exclusiveEnd: '2026-09-01', unitPrice: 10_000,
          coveredDays: 16, fullPeriodDays: 31, currencyCode: 'USD',
          formatCurrency: (amount) => `$${amount.toFixed(2)}`,
          describe: (kind, values) => kind === 'increase'
            ? `${values.description} — additional ${values.units} users, ${values.period} — ${values.calculation}`
            : `${values.description} — credit for ${values.units} fewer users, ${values.period} — ${values.calculation}`,
        }),
        quantity: 3,
        unit_price: 5_161 * sign,
        rate: 5_161 * sign,
        is_manual: true,
        is_discount: false,
        is_taxable: false,
        client_contract_id: clientContractId,
        adjustment_period_start: '2026-08-16',
        adjustment_period_end: '2026-09-01',
        manual_line_metadata: {
          partialPeriod: {
            version: 1,
            source_kind: 'invoice_charge',
            source_item_id: fixture.generatedChargeId,
            contract_line_id: contractLineId,
            direction,
            effective_date: '2026-08-16',
            source_period_start: '2026-08-01',
            source_period_end: '2026-09-01',
            units: 3,
            source_unit_price_minor: 10_000,
            covered_days: 16,
            full_period_days: 31,
            resolved_amount_minor: 15_483 * sign,
          },
          reason: 'seat change',
        },
      };
    };
    const increaseId = uuidv4();
    const increase = await updateInvoiceManualItems(fixture.invoiceId, {
      newItems: [makeUiRow(increaseId, 'increase') as any], updatedItems: [], removedItemIds: [],
    } as any);
    expect(increase).not.toHaveProperty('actionError');
    const persistedIncrease = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, item_id: increaseId }).first();
    expect(Number(persistedIncrease.quantity)).toBe(3);
    expect(Number(persistedIncrease.unit_price)).toBe(5_161);
    expect(Number(persistedIncrease.net_amount)).toBe(15_483);
    expect(persistedIncrease.manual_line_metadata.partialPeriod.direction).toBe('increase');
    expect(persistedIncrease.description).toBe('SMOKE Prod Users — additional 3 users, Aug 16–31, 2026 — 3 × $100.00 × 16/31');
    expect(persistedIncrease.manual_line_metadata.reason).toBe('seat change');

    const decreaseId = uuidv4();
    const decrease = await updateInvoiceManualItems(fixture.invoiceId, {
      newItems: [makeUiRow(decreaseId, 'decrease') as any], updatedItems: [], removedItemIds: [],
    } as any);
    expect(decrease).not.toHaveProperty('actionError');
    const persistedDecrease = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, item_id: decreaseId }).first();
    expect(Number(persistedDecrease.unit_price)).toBe(-5_161);
    expect(Number(persistedDecrease.net_amount)).toBe(-15_483);
    expect(persistedDecrease.is_manual_credit).toBe(true);
    expect(persistedDecrease.description).toBe('SMOKE Prod Users — credit for 3 fewer users, Aug 16–31, 2026 — 3 × $100.00 × 16/31');
    expect(persistedDecrease.manual_line_metadata.reason).toBe('seat change');

    const reloaded = await Invoice.getInvoiceCharges(db, tenant, fixture.invoiceId);
    const loadedIncrease = reloaded.find((row) => row.item_id === increaseId) as any;
    expect(reloaded.find((row) => row.item_id === fixture.generatedChargeId)?.contract_line_id).toBe(contractLineId);
    expect(reloaded.find((row) => row.item_id === fixture.generatedChargeId)?.client_contract_id).toBe(clientContractId);
    expect(loadedIncrease.manual_line_metadata.partialPeriod).toMatchObject({ direction: 'increase', units: 3 });
    expect(loadedIncrease.description).toBe('SMOKE Prod Users — additional 3 users, Aug 16–31, 2026 — 3 × $100.00 × 16/31');
    expect(loadedIncrease.manual_line_metadata.reason).toBe('seat change');
    const edited = await updateInvoiceManualItems(fixture.invoiceId, {
      newItems: [],
      updatedItems: [{
        item_id: increaseId, service_id: serviceId, client_contract_id: clientContractId,
        description: 'Revised reason text', quantity: 2, rate: 5_161,
        adjustment_period_start: '2026-08-16', adjustment_period_end: '2026-09-01',
        manual_line_metadata: {
          ...loadedIncrease.manual_line_metadata,
          partialPeriod: { ...loadedIncrease.manual_line_metadata.partialPeriod, units: 2, resolved_amount_minor: 10_322 },
          reason: 'revised reason',
        },
      } as any],
      removedItemIds: [],
    } as any);
    expect(edited).not.toHaveProperty('actionError');
    const editedRow = await db('invoice_charges').where({ tenant, item_id: increaseId }).first();
    expect(Number(editedRow.quantity)).toBe(2);
    expect(Number(editedRow.net_amount)).toBe(10_322);
    expect(editedRow.description).toBe('Revised reason text');

    const overlapItemId = uuidv4();
    await db('invoice_charges').insert({
      tenant, item_id: overlapItemId, invoice_id: fixture.invoiceId, service_id: serviceId,
      client_contract_id: clientContractId, description: 'Companion true-up', quantity: 1,
      unit_price: 1000, net_amount: 1000, total_price: 1000, tax_amount: 0,
      tax_rate: 0, is_manual: false, is_discount: false, is_taxable: false,
      adjustment_source_kind: 'contract_change', adjustment_source_id: uuidv4(),
      adjustment_source_revision: 1, adjustment_scope: 'service', adjustment_period_start: '2026-08-16',
      adjustment_period_end: '2026-09-01',
    });
    await db('invoice_charge_details').insert({
      tenant, item_detail_id: uuidv4(), item_id: overlapItemId, config_id: sourceConfigId,
      service_id: serviceId, quantity: 1, rate: 1000,
      service_period_start: '2026-08-01', service_period_end: '2026-08-31',
    });
    // Exercise the real companion writer shape: no detail row, only a
    // canonical revision -> line ledger. The legacy detail-backed case above
    // is also resolved by the shared reader.
    const displayedOverlap = (await Invoice.getInvoiceCharges(db, tenant, fixture.invoiceId)).find((row) => row.item_id === overlapItemId)!;
    expect(displayedOverlap).toMatchObject({ adjustment_source_kind: 'contract_change', contract_line_id: contractLineId });
    const overlapCalculatorId = uuidv4();
    const overlapCandidate = makeUiRow(overlapCalculatorId, 'increase') as any;
    const overlapResult = await updateInvoiceManualItems(fixture.invoiceId, {
      newItems: [overlapCandidate], updatedItems: [], removedItemIds: [],
    } as any);
    expect(overlapResult).toMatchObject({ success: false, code: 'SOURCE_NOT_ELIGIBLE' });
    expect((overlapResult as any).params).toMatchObject({ overlapConfirmationRequired: 'true', overlapItemIds: overlapItemId });
    // Missing client metadata must not bypass the source line's overlap guard.
    const omittedLineCandidate = makeUiRow(uuidv4(), 'increase') as any;
    delete omittedLineCandidate.manual_line_metadata.partialPeriod.contract_line_id;
    const omittedLineResult = await updateInvoiceManualItems(fixture.invoiceId, {
      newItems: [omittedLineCandidate], updatedItems: [], removedItemIds: [],
    } as any);
    expect(omittedLineResult).toMatchObject({ success: false, code: 'SOURCE_NOT_ELIGIBLE' });
    expect((omittedLineResult as any).params.overlapItemIds).toBe(overlapItemId);
    expect(await db('invoice_charges').where({ tenant, item_id: omittedLineCandidate.item_id })).toHaveLength(0);
    const confirmedOmittedLine = await updateInvoiceManualItems(fixture.invoiceId, {
      newItems: [{ ...omittedLineCandidate, manual_line_metadata: {
        ...omittedLineCandidate.manual_line_metadata, confirmed_overlap_item_ids: [overlapItemId],
      } }], updatedItems: [], removedItemIds: [],
    } as any);
    expect(confirmedOmittedLine).not.toHaveProperty('actionError');
    const derivedLineRow = await db('invoice_charges').where({ tenant, item_id: omittedLineCandidate.item_id }).first();
    expect(derivedLineRow.manual_line_metadata.partialPeriod.contract_line_id).toBe(contractLineId);

    const confirmedResult = await updateInvoiceManualItems(fixture.invoiceId, {
      newItems: [{ ...overlapCandidate, manual_line_metadata: { ...overlapCandidate.manual_line_metadata, confirmed_overlap_item_ids: [overlapItemId] } }],
      updatedItems: [], removedItemIds: [],
    } as any);
    expect(confirmedResult).not.toHaveProperty('actionError');
    expect(await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, item_id: overlapCalculatorId })).toHaveLength(1);
  });

  it('accepts decimal numeric(10,2) quantities and keeps signed half-cent rounding consistent', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    await db('invoice_charges').where({ tenant, item_id: fixture.generatedChargeId }).update({ unit_price: 10_000 });
    const sourceConfigId = uuidv4();
    await db('contract_line_service_configuration').insert({
      tenant, config_id: sourceConfigId, contract_line_id: contractLineId, service_id: serviceId,
      configuration_type: 'Fixed', quantity: 1,
    });
    await db('invoice_charge_details').insert({
      tenant, item_detail_id: uuidv4(), item_id: fixture.generatedChargeId,
      config_id: sourceConfigId, service_id: serviceId, quantity: 1, rate: 10_000,
      service_period_start: '2026-09-01', service_period_end: '2026-09-30',
    });
    const { updateInvoiceManualItems } = await import('../actions/invoiceModification');
    for (const [units, expectedIncrease, expectedDecrease] of [[1.1, 3666, -3666], [2.3, 7666, -7666], [0.29, 967, -967], [1.5, 5000, -4999]] as const) {
      for (const direction of ['increase', 'decrease'] as const) {
        const sign = direction === 'decrease' ? -1 : 1;
        const id = uuidv4();
        const expected = direction === 'decrease' ? expectedDecrease : expectedIncrease;
        const row = {
          item_id: id, invoice_id: fixture.invoiceId, tenant, service_id: serviceId,
          description: `decimal ${direction}`, quantity: units, rate: 3_333 * sign,
          is_manual: true, is_discount: false, is_taxable: false,
          client_contract_id: clientContractId,
          adjustment_period_start: '2026-09-21', adjustment_period_end: '2026-10-01',
          manual_line_metadata: { partialPeriod: {
            version: 1, source_kind: 'invoice_charge', source_item_id: fixture.generatedChargeId,
            contract_line_id: contractLineId, direction, effective_date: '2026-09-21',
            source_period_start: '2026-09-01', source_period_end: '2026-10-01', units,
            source_unit_price_minor: 10_000, covered_days: 10, full_period_days: 30,
            resolved_amount_minor: expected,
          } },
        };
        const result = await updateInvoiceManualItems(fixture.invoiceId, {
          newItems: [row as any], updatedItems: [], removedItemIds: [],
        } as any);
        expect(result).not.toHaveProperty('actionError');
        const stored = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, item_id: id }).first();
        expect(Number(stored.quantity)).toBe(units);
        expect(Number(stored.unit_price)).toBe(3_333 * sign);
        expect(Number(stored.net_amount)).toBe(expected);
      }
    }
  });

  it('reconciles one shared definition per contract attachment, scopes manual charges, refreshes edits and detachments idempotently', async () => {
    const assignmentA = uuidv4();
    const assignmentB = uuidv4();
    const sharedDiscountId = uuidv4();
    const secondClientContractId = uuidv4();
    await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId }).delete();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });
    await db('client_contracts').insert({
      tenant, client_contract_id: secondClientContractId, client_id: clientId,
      contract_id: contractId, start_date: '2026-01-01T00:00:00.000Z', is_active: true,
    });
    await db('discounts').insert({
      tenant, discount_id: sharedDiscountId, discount_name: 'Shared default',
      discount_type: 'percentage', value: 0.1, start_date: '2026-01-01T00:00:00.000Z', is_active: true,
      scope: 'contract', priority: 1,
    });
    await db('contract_discount_assignments').insert([
      { tenant, assignment_id: assignmentA, client_contract_id: clientContractId, discount_id: sharedDiscountId },
      { tenant, assignment_id: assignmentB, client_contract_id: secondClientContractId, discount_id: sharedDiscountId },
    ]);
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const attributedManualId = uuidv4();
    const otherContractChargeId = uuidv4();
    const unattributedManualId = uuidv4();
    await db('invoice_charges').insert([
      { tenant, item_id: attributedManualId, invoice_id: fixture.invoiceId, service_id: serviceId, description: 'Attributed manual charge', quantity: 1, unit_price: 10000, net_amount: 10000, total_price: 10000, tax_amount: 0, tax_rate: 0, is_manual: true, is_discount: false, is_taxable: false, client_contract_id: clientContractId, adjustment_source_kind: 'manual_adjustment' },
      { tenant, item_id: otherContractChargeId, invoice_id: fixture.invoiceId, service_id: serviceId, description: 'Second contract charge', quantity: 1, unit_price: 200000, net_amount: 200000, total_price: 200000, tax_amount: 0, tax_rate: 0, is_manual: false, is_discount: false, is_taxable: false, client_contract_id: secondClientContractId },
      { tenant, item_id: unattributedManualId, invoice_id: fixture.invoiceId, service_id: serviceId, description: 'Unattributed manual charge', quantity: 1, unit_price: 50000, net_amount: 50000, total_price: 50000, tax_amount: 0, tax_rate: 0, is_manual: true, is_discount: false, is_taxable: false, client_contract_id: null, adjustment_source_kind: 'manual_adjustment' },
    ]);

    await db.transaction(async (trx) => {
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
    });
    let settlements = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, adjustment_source_kind: 'discount' });
    expect(settlements.map((row) => [row.adjustment_source_id, Number(row.adjustment_base_amount), Number(row.net_amount)]).sort())
      .toEqual([[assignmentA, 400000, -40000], [assignmentB, 200000, -20000]].sort());
    const initialIds = new Map(settlements.map((row) => [row.adjustment_source_id, row.item_id]));

    await db.transaction(async (trx) => {
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
    });
    settlements = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, adjustment_source_kind: 'discount' });
    expect(settlements).toHaveLength(2);
    expect(new Map(settlements.map((row) => [row.adjustment_source_id, row.item_id]))).toEqual(initialIds);

    await db('discounts').where({ tenant, discount_id: sharedDiscountId }).update({ value: 0.2 });
    await db.transaction(async (trx) => { await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId); });
    settlements = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, adjustment_source_kind: 'discount' });
    expect(settlements.map((row) => [row.adjustment_source_id, Number(row.net_amount)]).sort())
      .toEqual([[assignmentA, -80000], [assignmentB, -40000]].sort());
    expect(new Map(settlements.map((row) => [row.adjustment_source_id, row.item_id]))).toEqual(initialIds);

    await db('contract_discount_assignments').where({ tenant, assignment_id: assignmentB }).delete();
    await db.transaction(async (trx) => { await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId); });
    settlements = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, adjustment_source_kind: 'discount' });
    expect(settlements).toHaveLength(1);
    expect(settlements[0].adjustment_source_id).toBe(assignmentA);
    const preservedManualCount = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId })
      .whereIn('item_id', [attributedManualId, unattributedManualId]).count('* as n').first();
    expect(Number(preservedManualCount?.n)).toBe(2);
    await db('contract_discount_assignments').where({ tenant, discount_id: sharedDiscountId }).delete();
    await db('discounts').where({ tenant, discount_id: sharedDiscountId }).delete();
    await db('client_contracts').where({ tenant, client_contract_id: secondClientContractId }).delete();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
  });

  it('re-applies the invoice-wide discount over generated + manual charges and preserves the manual line', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const acceptanceTemplateId = uuidv4();
    let copiedDiscountId: string | undefined;
    let originalAssignments: Record<string, unknown>[] = [];
    try {
    await db('contract_templates').insert({
      tenant, template_id: acceptanceTemplateId, template_name: 'Acceptance 10 percent',
      default_billing_frequency: 'monthly', template_status: 'published', template_metadata: {},
    });
    const { updateContract } = await import('../actions/contractActions');
    const authored = await updateContract(acceptanceTemplateId, {
      template_metadata: { default_discounts: [{
        discount_name: 'Template 10%', discount_type: 'percentage', value: 10,
        start_date: '2026-01-01', scope: 'contract', is_active: true,
      }] },
    } as any);
    originalAssignments = await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId });
    expect(authored).not.toHaveProperty('actionError');
    await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId }).delete();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });
    const { cloneTemplateDefaultDiscounts } = await import('../lib/billing/utils/templateClone');
    await db.transaction((trx) => cloneTemplateDefaultDiscounts(trx, {
      tenant, templateId: acceptanceTemplateId, clientContractId, clientId,
    }));
    const templateCopy = await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId }).orderBy('created_at', 'desc').first('discount_id', 'assignment_id');
    copiedDiscountId = templateCopy?.discount_id;
    expect(templateCopy).toBeTruthy();
    // This acceptance case authors the standing term from the template action;
    // drop the helper's seeded legacy 10% row so settlement proves the copied ID.
    await db('invoice_charges').where({ tenant, item_id: fixture.automaticDiscountItemId }).delete();
    await db('invoice_charges').where({ tenant, item_id: fixture.generatedChargeId }).update({
      unit_price: 10_000, location_id: smokeLocationId, billing_profile_id: defaultBillingProfileId,
    });
    const configId = uuidv4();
    const manualItemId = uuidv4();
    await db('contract_line_service_configuration').insert({ tenant, config_id: configId, contract_line_id: contractLineId, service_id: serviceId, configuration_type: 'Fixed', quantity: 1 });
    await db('invoice_charge_details').insert({ tenant, item_detail_id: uuidv4(), item_id: fixture.generatedChargeId, config_id: configId, service_id: serviceId, quantity: 1, rate: 10_000, service_period_start: '2026-09-01', service_period_end: '2026-09-30' });
    const { updateInvoiceManualItems } = await import('../actions/invoiceModification');
    const calculatorResult = await updateInvoiceManualItems(fixture.invoiceId, {
      newItems: [{
        item_id: manualItemId, invoice_id: fixture.invoiceId, tenant, service_id: serviceId,
        description: 'Three seats added for half a period', quantity: 3, unit_price: 5_000, rate: 5_000,
        is_manual: true, is_discount: false, is_taxable: false,
        client_contract_id: clientContractId, location_id: smokeLocationId, billing_profile_id: defaultBillingProfileId,
        adjustment_period_start: '2026-09-16', adjustment_period_end: '2026-10-01',
        manual_line_metadata: { reason: 'mid-period seat increase', partialPeriod: {
          version: 1, source_kind: 'invoice_charge', source_item_id: fixture.generatedChargeId,
          contract_line_id: contractLineId, direction: 'increase', effective_date: '2026-09-16',
          source_period_start: '2026-09-01', source_period_end: '2026-10-01', units: 3,
          source_unit_price_minor: 10_000, covered_days: 15, full_period_days: 30,
          resolved_amount_minor: 15_000,
        } },
      } as any], updatedItems: [], removedItemIds: [],
    } as any);
    expect(calculatorResult).not.toHaveProperty('actionError');
    const manual = { itemId: manualItemId, amount: 15_000 };

    await db.transaction(async (trx) => {
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
    });

    expect(manual.amount).toBe(15_000);

    const manualRow = await db('invoice_charges')
      .where({ tenant, invoice_id: fixture.invoiceId, item_id: manual.itemId })
      .first();
    expect(Number(manualRow.net_amount)).toBe(15_000);
    expect(manualRow.is_manual).toBe(true);
    expect(manualRow.manual_line_metadata?.partialPeriod).toMatchObject({
      units: 3, direction: 'increase', source_unit_price_minor: 10_000,
      covered_days: 15, full_period_days: 30, resolved_amount_minor: 15_000,
    });
    // Operator-chosen attribution survives the manual write, not just the
    // client-default fallback.
    expect(manualRow.location_id).toBe(smokeLocationId);
    expect(manualRow.billing_profile_id).toBe(defaultBillingProfileId);

    const discountRows = await db('invoice_charges')
      .where({ tenant, invoice_id: fixture.invoiceId, adjustment_source_kind: 'discount' });
    expect(discountRows).toHaveLength(1);
    expect(Number(discountRows[0].net_amount)).toBe(-40_500);
    expect(discountRows[0].adjustment_source_id).toBe(templateCopy.assignment_id);
    expect(Number(discountRows[0].adjustment_base_amount)).toBe(405_000);
    // The affected period and calculation reason are surfaced (the editor renders
    // `adjustment_reason`), not just persisted: with no service-period details the
    // window falls back to the invoice date.
    expect(String(discountRows[0].adjustment_reason)).toContain('2026-09-01');
    expect(String(discountRows[0].adjustment_reason)).toContain('405000');

    const totals = await sumChargeNet(fixture.invoiceId);
    expect(totals.gross).toBe(405_000);
    expect(totals.discounts).toBe(-40_500);
    expect(totals.net).toBe(364_500);
    } finally {
      if (copiedDiscountId) {
        await db('invoice_charges').where({ tenant, adjustment_source_id: copiedDiscountId }).delete();
        await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId, discount_id: copiedDiscountId }).delete();
        await db('contract_template_discount_copies').where({ tenant, client_contract_id: clientContractId, discount_id: copiedDiscountId }).delete();
        await db('discounts').where({ tenant, discount_id: copiedDiscountId }).delete();
      }
      await db('contract_templates').where({ tenant, template_id: acceptanceTemplateId }).delete();
      if (originalAssignments.length) await db('contract_discount_assignments').insert(originalAssignments);
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
    }
  });

  it('keeps a non-USD invoice settlement in the invoice currency minor units', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount('EUR');
    await insertManualPartialPeriodCharge({
      invoiceId: fixture.invoiceId,
      generatedChargeId: fixture.generatedChargeId,
    });

    await db.transaction(async (trx) => {
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
    });

    const invoice = await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).first();
    // The adjustment path is currency-agnostic: it never substitutes USD, and
    // the 10% discount stays the same integer minor-unit amount in EUR.
    expect(invoice.currency_code).toBe('EUR');
    const discountRows = await db('invoice_charges')
      .where({ tenant, invoice_id: fixture.invoiceId, adjustment_source_kind: 'discount' });
    expect(discountRows).toHaveLength(1);
    expect(Number(discountRows[0].net_amount)).toBe(-40_500);

    const totals = await sumChargeNet(fixture.invoiceId);
    expect(totals.gross).toBe(405_000);
    expect(totals.discounts).toBe(-40_500);
    expect(totals.net).toBe(364_500);
  });

  it('includes an already-prorated companion true-up in discount reconciliation without rewriting it', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const trueUpId = uuidv4();
    const revisionId = uuidv4();
    const configId = uuidv4();
    await db('contract_line_service_configuration').insert({
      tenant, config_id: configId, contract_line_id: contractLineId, service_id: serviceId,
      configuration_type: 'Fixed', quantity: 1,
    });
    await db('invoice_charges').insert({
      tenant, item_id: trueUpId, invoice_id: fixture.invoiceId, service_id: serviceId,
      client_contract_id: clientContractId, description: 'Companion mid-period increase',
      quantity: 1, unit_price: 15_000, net_amount: 15_000, total_price: 15_000, tax_amount: 0,
      tax_rate: 0, is_manual: false, is_discount: false, is_taxable: false,
      adjustment_source_kind: 'contract_change', adjustment_source_id: revisionId,
      adjustment_source_revision: 1, adjustment_scope: 'service', adjustment_base_amount: 15_000,
      adjustment_reason: 'seat increase', adjustment_period_start: '2026-09-21', adjustment_period_end: '2026-10-01',
    });
    await db('invoice_charge_details').insert({
      tenant, item_detail_id: uuidv4(), item_id: trueUpId, config_id: configId, service_id: serviceId,
      quantity: 1, rate: 15_000, service_period_start: '2026-09-01', service_period_end: '2026-09-30',
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await db.transaction((trx) => reconcileAutomaticInvoiceAdjustments(trx, tenant, fixture.invoiceId));
    }
    const trueUp = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, item_id: trueUpId }).first();
    expect(Number(trueUp.net_amount)).toBe(15_000);
    expect(new Date(trueUp.adjustment_period_start).toISOString().slice(0, 10)).toBe('2026-09-21');
    expect(new Date(trueUp.adjustment_period_end).toISOString().slice(0, 10)).toBe('2026-10-01');
    const discountRows = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, adjustment_source_kind: 'discount' });
    expect(discountRows).toHaveLength(1);
    expect(Number(discountRows[0].net_amount)).toBe(-40_500);
  });

  it('resolves detail-free companion ledger rows for display, line discounts and manual overlap checks', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const configId = uuidv4();
    const revisionId = uuidv4();
    const trueUpId = uuidv4();
    await db('contract_line_service_configuration').insert({ tenant, config_id: configId, contract_line_id: contractLineId, service_id: serviceId, configuration_type: 'Fixed', quantity: 1 });
    await db('invoice_charge_details').insert({ tenant, item_detail_id: uuidv4(), item_id: fixture.generatedChargeId, config_id: configId, service_id: serviceId, quantity: 39, rate: 10_000, service_period_start: '2026-09-01', service_period_end: '2026-09-30' });
    await db('invoice_charges').where({ tenant, item_id: fixture.generatedChargeId }).update({ unit_price: 10_000 });
    const originalDiscount = await db('discounts').where({ tenant, discount_id: configuredDiscountId }).first('scope');
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ scope: 'line' });
    // Only the consumer columns are needed here; the companion owns migration
    // and writer tests for its complete ledger. This database is suite-local.
    await db.schema.createTable('contract_recurring_unit_adjustments', (table) => {
      table.uuid('tenant'); table.uuid('revision_id'); table.uuid('contract_line_id');
    });
    try {
      await db('contract_recurring_unit_adjustments').insert([
        { tenant, revision_id: revisionId, contract_line_id: contractLineId },
        { tenant: uuidv4(), revision_id: revisionId, contract_line_id: uuidv4() },
      ]);
      await db('invoice_charges').insert({
        tenant, item_id: trueUpId, invoice_id: fixture.invoiceId, service_id: serviceId,
        client_contract_id: clientContractId, description: 'Ledger-only true-up',
        quantity: 3, unit_price: 10_000, net_amount: 15_000, total_price: 15_000, tax_amount: 0,
        tax_rate: 0, is_manual: false, is_discount: false, is_taxable: false,
        adjustment_source_kind: 'contract_change', adjustment_source_id: revisionId,
        adjustment_source_revision: 2, adjustment_scope: 'service',
        adjustment_period_start: '2026-09-16', adjustment_period_end: '2026-10-01',
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        await db.transaction((trx) => reconcileAutomaticInvoiceAdjustments(trx, tenant, fixture.invoiceId));
      }
      const displayed = (await Invoice.getInvoiceCharges(db, tenant, fixture.invoiceId)).find((row) => row.item_id === trueUpId)!;
      expect(displayed).toMatchObject({ contract_line_id: contractLineId, adjustment_source_kind: 'contract_change', adjustment_source_id: revisionId, adjustment_source_revision: 2, adjustment_period_start: '2026-09-16', adjustment_period_end: '2026-10-01' });
      expect(Number(displayed.net_amount)).toBe(15_000);
      const discounts = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, adjustment_source_kind: 'discount' });
      expect(discounts).toHaveLength(1);
      expect(Number(discounts[0].net_amount)).toBe(-40_500);
      const { updateInvoiceManualItems } = await import('../actions/invoiceModification');
      const result = await updateInvoiceManualItems(fixture.invoiceId, {
        newItems: [{ item_id: uuidv4(), service_id: serviceId, client_contract_id: clientContractId,
          description: 'Overlapping manual seats', quantity: 3, rate: 5_000, is_discount: false,
          manual_line_metadata: { partialPeriod: {
            version: 1, source_kind: 'invoice_charge', source_item_id: fixture.generatedChargeId,
            direction: 'increase', effective_date: '2026-09-16', units: 3,
            source_period_start: '2026-09-01', source_period_end: '2026-10-01',
          } },
        }], updatedItems: [], removedItemIds: [],
      } as any);
      expect(result).toMatchObject({ success: false, code: 'SOURCE_NOT_ELIGIBLE', params: { overlapConfirmationRequired: 'true', overlapItemIds: trueUpId } });
    } finally {
      await db.schema.dropTable('contract_recurring_unit_adjustments');
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ scope: originalDiscount.scope });
    }
  });

  it('is idempotent across repeated draft refreshes', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    await insertManualPartialPeriodCharge({
      invoiceId: fixture.invoiceId,
      generatedChargeId: fixture.generatedChargeId,
    });

    await db.transaction(async (trx) => {
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
    });

    const discountRows = await db('invoice_charges')
      .where({ tenant, invoice_id: fixture.invoiceId, adjustment_source_kind: 'discount' });
    expect(discountRows).toHaveLength(1);
    expect(Number(discountRows[0].net_amount)).toBe(-40_500);
  });

  it('adopts a pre-upgrade automatic discount once across first reconcile, manual save and repeat reconcile', async () => {
    const fixture = await createDraftWithGeneratedChargeAndLegacyDiscount();
    await insertManualPartialPeriodCharge({
      invoiceId: fixture.invoiceId,
      generatedChargeId: fixture.generatedChargeId,
    });

    // First reconciliation after upgrade claims the legacy row in place rather
    // than appending a second settlement.
    await db.transaction(async (trx) => {
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
    });

    let discounts = await automaticDiscountRows(fixture.invoiceId);
    expect(discounts).toHaveLength(1);
    expect(discounts[0].item_id).toBe(fixture.automaticDiscountItemId);
    expect(discounts[0].adjustment_source_id).toBe(configuredDiscountId);
    expect(Number(discounts[0].net_amount)).toBe(-40_500);
    expect(await sumChargeNet(fixture.invoiceId)).toEqual({
      gross: 405_000,
      discounts: -40_500,
      net: 364_500,
    });

    // A manual save adds a line and reconciles in the same transaction, exactly
    // as addManualItemsToInvoice does. There must still be one automatic row.
    await db.transaction(async (trx) => {
      await persistManualInvoiceCharges(
        trx,
        fixture.invoiceId,
        [
          {
            item_id: uuidv4(),
            service_id: serviceId, description: 'Extra manual charge',
            quantity: 1,
            rate: 10_000,
            is_taxable: false,
          },
        ],
        { client_id: clientId, region_code: null, default_currency_code: 'USD' },
        { user: { id: userId } } as never,
        tenant,
      );
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
    });

    discounts = await automaticDiscountRows(fixture.invoiceId);
    expect(discounts).toHaveLength(1);
    expect(discounts[0].item_id).toBe(fixture.automaticDiscountItemId);
    expect(Number(discounts[0].net_amount)).toBe(-41_500);
    expect(await sumChargeNet(fixture.invoiceId)).toEqual({
      gross: 415_000,
      discounts: -41_500,
      net: 373_500,
    });

    // Repeat reconciliation is idempotent.
    await db.transaction(async (trx) => {
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
    });

    discounts = await automaticDiscountRows(fixture.invoiceId);
    expect(discounts).toHaveLength(1);
    expect(Number(discounts[0].net_amount)).toBe(-41_500);
    expect(await sumChargeNet(fixture.invoiceId)).toEqual({
      gross: 415_000,
      discounts: -41_500,
      net: 373_500,
    });
  });

  it('adopts the legacy automatic row and leaves an authored manual discount alone', async () => {
    const fixture = await createDraftWithGeneratedChargeAndLegacyDiscount();
    const manualDiscountItemId = uuidv4();
    await db('invoice_charges').insert({
      tenant,
      item_id: manualDiscountItemId,
      invoice_id: fixture.invoiceId,
      description: 'Goodwill discount',
      quantity: 1,
      unit_price: -5_000,
      net_amount: -5_000,
      total_price: -5_000,
      tax_amount: 0,
      tax_rate: 0,
      is_manual: true,
      is_discount: true,
      is_taxable: false,
      discount_type: 'fixed',
    });

    await db.transaction(async (trx) => {
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
    });

    // Exactly one automatic settlement, adopted from the legacy row; the manual
    // discount is neither claimed nor removed.
    const automatic = await automaticDiscountRows(fixture.invoiceId);
    expect(automatic).toHaveLength(1);
    expect(automatic[0].item_id).toBe(fixture.automaticDiscountItemId);
    expect(Number(automatic[0].net_amount)).toBe(-39_000);

    const manual = await db('invoice_charges').where({ tenant, item_id: manualDiscountItemId }).first();
    expect(manual.is_manual).toBe(true);
    expect(manual.adjustment_source_kind).toBeNull();
    expect(Number(manual.net_amount)).toBe(-5_000);

    expect(await sumChargeNet(fixture.invoiceId)).toEqual({
      gross: 390_000,
      discounts: -44_000,
      net: 346_000,
    });
  });

  it('removes a stale pre-upgrade automatic discount when its sole source is deactivated, keeping manual discounts', async () => {
    const fixture = await createDraftWithGeneratedChargeAndLegacyDiscount();
    const manualDiscountItemId = uuidv4();
    await db('invoice_charges').insert({
      tenant,
      item_id: manualDiscountItemId,
      invoice_id: fixture.invoiceId,
      description: 'Goodwill discount',
      quantity: 1,
      unit_price: -5_000,
      net_amount: -5_000,
      total_price: -5_000,
      tax_amount: 0,
      tax_rate: 0,
      is_manual: true,
      is_discount: true,
      is_taxable: false,
      discount_type: 'fixed',
    });

    await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId }).delete();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });
    try {
      // First post-upgrade reconciliation has no desired settlement (the only
      // configured discount is inactive), yet it must still remove the stale
      // legacy automatic row and recompute totals.
      await db.transaction(async (trx) => {
        await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
        await new BillingEngine().recalculateInvoice(fixture.invoiceId, trx, tenant);
      });

      expect(await automaticDiscountRows(fixture.invoiceId)).toHaveLength(0);
      const legacy = await db('invoice_charges')
        .where({ tenant, item_id: fixture.automaticDiscountItemId })
        .first();
      expect(legacy).toBeUndefined();

      // The authored manual discount survives untouched.
      const manual = await db('invoice_charges').where({ tenant, item_id: manualDiscountItemId }).first();
      expect(manual.is_manual).toBe(true);
      expect(manual.adjustment_source_kind).toBeNull();
      expect(Number(manual.net_amount)).toBe(-5_000);

      expect(await sumChargeNet(fixture.invoiceId)).toEqual({
        gross: 390_000,
        discounts: -5_000,
        net: 385_000,
      });
      const invoice = await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).first();
      expect(Number(invoice.subtotal)).toBe(385_000);
      expect(Number(invoice.tax)).toBe(0);
      expect(Number(invoice.total_amount)).toBe(385_000);

      // A repeat reconciliation stays clean and idempotent.
      await db.transaction(async (trx) => {
        await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
      });
      expect(await automaticDiscountRows(fixture.invoiceId)).toHaveLength(0);
      expect(await sumChargeNet(fixture.invoiceId)).toEqual({
        gross: 390_000,
        discounts: -5_000,
        net: 385_000,
      });
    } finally {
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
    }
  });

  it('removes only its own automatic settlement when the source is deactivated', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const manual = await insertManualPartialPeriodCharge({
      invoiceId: fixture.invoiceId,
      generatedChargeId: fixture.generatedChargeId,
    });

    await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId }).delete();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });
    try {
      await db.transaction(async (trx) => {
        await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
      });

      const discountRows = await db('invoice_charges')
        .where({ tenant, invoice_id: fixture.invoiceId, adjustment_source_kind: 'discount' });
      expect(discountRows).toHaveLength(0);

      const manualRow = await db('invoice_charges')
        .where({ tenant, invoice_id: fixture.invoiceId, item_id: manual.itemId })
        .first();
      expect(manualRow).toBeTruthy();
      expect(Number(manualRow.net_amount)).toBe(15_000);
    } finally {
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
    }
  });

  it('leaves an authored manual discount without provenance untouched', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const legacyItemId = uuidv4();
    await db('invoice_charges').insert({
      tenant,
      item_id: legacyItemId,
      invoice_id: fixture.invoiceId,
      description: 'Authored manual discount',
      quantity: 1,
      unit_price: -5_000,
      net_amount: -5_000,
      total_price: -5_000,
      is_manual: true,
      is_discount: true,
      is_taxable: false,
      discount_type: 'fixed',
    });

    await db.transaction(async (trx) => {
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
    });

    const legacyRow = await db('invoice_charges').where({ tenant, item_id: legacyItemId }).first();
    expect(Number(legacyRow.net_amount)).toBe(-5_000);
  });

  it('creates a configured automatic discount on a contract draft that has none yet', async () => {
    const invoiceId = uuidv4();
    const chargeId = uuidv4();
    await db('invoices').insert({
      tenant,
      invoice_id: invoiceId,
      invoice_number: `ADJ-NEW-${invoiceId.slice(0, 8)}`,
      invoice_date: '2026-09-01T00:00:00.000Z',
      due_date: '2026-09-30T00:00:00.000Z',
      subtotal: 100000,
      tax: 0,
      total_amount: 100000,
      status: 'draft',
      client_id: clientId,
      currency_code: 'USD',
      is_manual: false,
    });
    await db('invoice_charges').insert({
      tenant,
      item_id: chargeId,
      invoice_id: invoiceId,
      service_id: serviceId,
      description: 'Recurring support',
      quantity: 1,
      unit_price: 100000,
      net_amount: 100000,
      total_price: 100000,
      tax_amount: 0,
      tax_rate: 0,
      is_manual: false,
      is_discount: false,
      is_taxable: false,
      client_contract_id: clientContractId,
    });

    await db.transaction(async (trx) => {
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, invoiceId);
    });

    const discountRows = await db('invoice_charges')
      .where({ tenant, invoice_id: invoiceId, adjustment_source_kind: 'discount' });
    expect(discountRows).toHaveLength(1);
    expect(Number(discountRows[0].net_amount)).toBe(-10_000);
    expect(Number(discountRows[0].adjustment_base_amount)).toBe(100_000);
  });

  it('does not add automatic discounts to a manual-origin invoice', async () => {
    const invoiceId = uuidv4();
    await db('invoices').insert({
      tenant,
      invoice_id: invoiceId,
      invoice_number: `ADJ-MAN-${invoiceId.slice(0, 8)}`,
      invoice_date: '2026-09-01T00:00:00.000Z',
      due_date: '2026-09-30T00:00:00.000Z',
      subtotal: 50000,
      tax: 0,
      total_amount: 50000,
      status: 'draft',
      client_id: clientId,
      currency_code: 'USD',
      is_manual: true,
    });
    await db('invoice_charges').insert({
      tenant,
      item_id: uuidv4(),
      invoice_id: invoiceId,
      description: 'Freeform manual charge',
      quantity: 1,
      unit_price: 50000,
      net_amount: 50000,
      total_price: 50000,
      tax_amount: 0,
      tax_rate: 0,
      is_manual: true,
      is_discount: false,
      is_taxable: false,
    });

    await db.transaction(async (trx) => {
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, invoiceId);
    });

    const discountRows = await db('invoice_charges')
      .where({ tenant, invoice_id: invoiceId, adjustment_source_kind: 'discount' });
    expect(discountRows).toHaveLength(0);
  });

  it('rejects a discount target that belongs to a different invoice', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const otherInvoiceId = uuidv4();
    const foreignItemId = uuidv4();
    await db('invoices').insert({
      tenant,
      invoice_id: otherInvoiceId,
      invoice_number: `ADJ-OTHER-${otherInvoiceId.slice(0, 8)}`,
      invoice_date: '2026-09-01T00:00:00.000Z',
      due_date: '2026-09-30T00:00:00.000Z',
      total_amount: 0,
      status: 'draft',
      client_id: clientId,
      currency_code: 'USD',
      is_manual: true,
    });
    await db('invoice_charges').insert({
      tenant,
      item_id: foreignItemId,
      invoice_id: otherInvoiceId,
      description: 'Foreign line',
      quantity: 1,
      unit_price: 50_000,
      net_amount: 50_000,
      total_price: 50_000,
      is_manual: true,
      is_discount: false,
    });

    await expect(
      db.transaction(async (trx) => {
        await persistManualInvoiceCharges(
          trx,
          fixture.invoiceId,
          [
            {
              item_id: uuidv4(),
              description: 'Discount on a foreign line',
              quantity: 1,
              rate: 5_000,
              is_discount: true,
              discount_type: 'fixed',
              applies_to_item_id: foreignItemId,
            },
          ],
          { client_id: clientId, region_code: null, default_currency_code: 'USD' },
          { user: { id: userId } } as never,
          tenant,
        );
      }),
    ).rejects.toMatchObject({ code: 'DISCOUNT_TARGET_NOT_FOUND' });
  });

  it('rejects a location and a billing profile that belong to another client', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();

    const foreignLocationId = uuidv4();
    await db('client_locations').insert({
      tenant,
      location_id: foreignLocationId,
      client_id: foreignClientId,
      location_name: 'Foreign office',
      address_line1: '9 Elsewhere',
      city: 'Faraway',
      country_code: 'US',
      country_name: 'United States',
      is_active: true,
    });

    await expect(
      db.transaction(async (trx) => {
        await persistManualInvoiceCharges(
          trx,
          fixture.invoiceId,
          [
            {
              item_id: uuidv4(),
              service_id: serviceId, description: 'Charge on a foreign location',
              quantity: 1,
              rate: 1_000,
              is_taxable: true,
              location_id: foreignLocationId,
            },
          ],
          { client_id: clientId, region_code: null, default_currency_code: 'USD' },
          { user: { id: userId } } as never,
          tenant,
        );
      }),
    ).rejects.toMatchObject({ code: 'LOCATION_NOT_FOUND' });

    const foreignProfileId = uuidv4();
    await db('client_billing_profiles').insert({
      tenant,
      billing_profile_id: foreignProfileId,
      client_id: foreignClientId,
      name: 'Foreign profile',
      // A per-client guard requires any client holding profiles to have exactly
      // one default, so the client's first profile must be the default.
      is_default: true,
    });

    await expect(
      db.transaction(async (trx) => {
        await persistManualInvoiceCharges(
          trx,
          fixture.invoiceId,
          [
            {
              item_id: uuidv4(),
              service_id: serviceId, description: 'Charge on a foreign billing profile',
              quantity: 1,
              rate: 1_000,
              is_taxable: true,
              billing_profile_id: foreignProfileId,
            },
          ],
          { client_id: clientId, region_code: null, default_currency_code: 'USD' },
          { user: { id: userId } } as never,
          tenant,
        );
      }),
    ).rejects.toMatchObject({ code: 'BILLING_PROFILE_NOT_FOUND' });

    // Both rejections happen before any insert, so no partial line leaks.
    const manualRows = await db('invoice_charges')
      .where({ tenant, invoice_id: fixture.invoiceId, is_manual: true });
    expect(manualRows).toHaveLength(0);
  });

  it('persists an explicit per-line tax treatment and rejects a tax rate outside the tenant', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();

    const region = await db('tax_regions').where({ tenant }).first('region_code');
    expect(region?.region_code).toBeTruthy();
    const taxRateId = uuidv4();
    await db('tax_rates').insert({
      tenant,
      tax_rate_id: taxRateId,
      region_code: region.region_code,
      tax_percentage: 8.5,
      description: 'Explicit treatment rate',
      start_date: '2026-01-01',
      is_active: true,
    });

    const taxableItemId = uuidv4();
    const exemptItemId = uuidv4();
    await db.transaction(async (trx) => {
      await persistManualInvoiceCharges(
        trx,
        fixture.invoiceId,
        [
          {
            item_id: taxableItemId,
            service_id: serviceId, description: 'Taxable freeform charge',
            quantity: 1,
            rate: 10_000,
            tax_rate_id: taxRateId,
            is_taxable: true,
          },
          {
            item_id: exemptItemId,
            service_id: serviceId, description: 'Exempt freeform charge',
            quantity: 1,
            rate: 5_000,
            tax_rate_id: null,
            is_taxable: false,
          },
        ],
        { client_id: clientId, region_code: null, default_currency_code: 'USD' },
        { user: { id: userId } } as never,
        tenant,
      );
    });

    // A serviceless freeform line becomes taxable in the chosen rate's region.
    const taxable = await db('invoice_charges')
      .where({ tenant, item_id: taxableItemId })
      .first();
    expect(taxable.is_taxable).toBe(true);
    expect(taxable.tax_region).toBe(region.region_code);

    // An explicitly non-taxable line is not dragged into the region fallback.
    const exempt = await db('invoice_charges')
      .where({ tenant, item_id: exemptItemId })
      .first();
    expect(exempt.is_taxable).toBe(false);

    // An unknown / foreign tax rate id is rejected before any row is written.
    const countBefore = await db('invoice_charges')
      .where({ tenant, invoice_id: fixture.invoiceId })
      .count<{ count: string }>('item_id as count')
      .first();
    await expect(
      db.transaction(async (trx) => {
        await persistManualInvoiceCharges(
          trx,
          fixture.invoiceId,
          [
            {
              item_id: uuidv4(),
              service_id: serviceId, description: 'Forged tax treatment',
              quantity: 1,
              rate: 1_000,
              tax_rate_id: uuidv4(),
              is_taxable: true,
            },
          ],
          { client_id: clientId, region_code: null, default_currency_code: 'USD' },
          { user: { id: userId } } as never,
          tenant,
        );
      }),
    ).rejects.toMatchObject({ code: 'TAX_RATE_NOT_FOUND' });
    const countAfter = await db('invoice_charges')
      .where({ tenant, invoice_id: fixture.invoiceId })
      .count<{ count: string }>('item_id as count')
      .first();
    expect(Number(countAfter?.count)).toBe(Number(countBefore?.count));
  });

  it('applies a configured service-scoped discount only to matching service rows', async () => {
    // The shared invoice-wide discount would mask the scoped one; disable it
    // for the duration of this fixture.
    await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId }).delete();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });
    const scopedDiscountId = uuidv4();
    await db('discounts').insert({
      tenant,
      discount_id: scopedDiscountId,
      discount_name: 'Service 50%',
      discount_type: 'percentage',
      value: 0.5,
      start_date: '2026-01-01T00:00:00.000Z',
      end_date: null,
      is_active: true,
      scope: 'service',
      scope_service_id: serviceId,
    });
    await db('contract_line_discounts').insert({
      tenant,
      discount_id: scopedDiscountId,
      contract_line_id: contractLineId,
      client_id: clientId,
      client_contract_id: clientContractId,
    });

    try {
      const invoiceId = uuidv4();
      await db('invoices').insert({
        tenant,
        invoice_id: invoiceId,
        invoice_number: `ADJ-SVC-${invoiceId.slice(0, 8)}`,
        invoice_date: '2026-09-01T00:00:00.000Z',
        due_date: '2026-09-30T00:00:00.000Z',
        total_amount: 490_000,
        status: 'draft',
        client_id: clientId,
        currency_code: 'USD',
        is_manual: false,
      });
      await db('invoice_charges').insert({
        tenant,
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: serviceId,
        description: 'In-scope recurring',
        quantity: 1,
        unit_price: 390_000,
        net_amount: 390_000,
        total_price: 390_000,
        tax_amount: 0,
        tax_rate: 0,
        is_manual: false,
        is_discount: false,
        is_taxable: false,
        client_contract_id: clientContractId,
      });
      await db('invoice_charges').insert({
        tenant,
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: null,
        description: 'Out-of-scope line',
        quantity: 1,
        unit_price: 100_000,
        net_amount: 100_000,
        total_price: 100_000,
        tax_amount: 0,
        tax_rate: 0,
        is_manual: false,
        is_discount: false,
        is_taxable: false,
        client_contract_id: clientContractId,
      });

      const result = await db.transaction(async (trx) =>
        reconcileAutomaticInvoiceAdjustments(trx, tenant, invoiceId),
      );

      // 50% of the in-scope $3,900 only; the $1,000 line is out of scope.
      expect(result.automaticDiscountAmount).toBe(195_000);
      const discountRows = await db('invoice_charges')
        .where({ tenant, invoice_id: invoiceId, adjustment_source_kind: 'discount' });
      expect(discountRows).toHaveLength(1);
      expect(Number(discountRows[0].net_amount)).toBe(-195_000);
      expect(discountRows[0].adjustment_scope).toBe('service');
      expect(Number(discountRows[0].adjustment_base_amount)).toBe(390_000);
    } finally {
      await db('contract_line_discounts').where({ tenant, discount_id: scopedDiscountId }).delete();
      await db('invoice_charges').where({ tenant, adjustment_source_id: scopedDiscountId }).delete();
      await db('discounts').where({ tenant, discount_id: scopedDiscountId }).delete();
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
    }
  });

  it('bills a configured fixed discount as its decimal currency value in USD and a non-USD currency', async () => {
    await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId }).delete();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });
    const fixedDiscountId = uuidv4();
    // `discounts.value` is decimal(10,2): 50.00 means $50.00, not 50 minor units.
    await db('discounts').insert({
      tenant,
      discount_id: fixedDiscountId,
      discount_name: 'Flat $50',
      discount_type: 'fixed',
      value: 50.0,
      start_date: '2026-01-01T00:00:00.000Z',
      end_date: null,
      is_active: true,
      scope: 'invoice',
    });
    await db('contract_line_discounts').insert({
      tenant,
      discount_id: fixedDiscountId,
      contract_line_id: contractLineId,
      client_id: clientId,
      client_contract_id: clientContractId,
    });

    const draftWithCharge = async (currencyCode: string): Promise<string> => {
      const invoiceId = uuidv4();
      await db('invoices').insert({
        tenant,
        invoice_id: invoiceId,
        invoice_number: `ADJ-FIXED-${invoiceId.slice(0, 8)}`,
        invoice_date: '2026-09-01T00:00:00.000Z',
        due_date: '2026-09-30T00:00:00.000Z',
        subtotal: 390000,
        tax: 0,
        total_amount: 390000,
        status: 'draft',
        client_id: clientId,
        currency_code: currencyCode,
        is_manual: false,
        client_contract_id: clientContractId,
      });
      await db('invoice_charges').insert({
        tenant,
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: serviceId,
        description: 'Recurring support',
        quantity: 1,
        unit_price: 390000,
        net_amount: 390000,
        total_price: 390000,
        tax_amount: 0,
        tax_rate: 0,
        is_manual: false,
        is_discount: false,
        is_taxable: false,
        client_contract_id: clientContractId,
      });
      return invoiceId;
    };

    try {
      for (const currency of ['USD', 'EUR']) {
        const invoiceId = await draftWithCharge(currency);
        const result = await db.transaction(async (trx) =>
          reconcileAutomaticInvoiceAdjustments(trx, tenant, invoiceId),
        );
        expect(result.automaticDiscountAmount).toBe(5_000);
        const rows = await db('invoice_charges')
          .where({ tenant, invoice_id: invoiceId, adjustment_source_kind: 'discount' });
        expect(rows).toHaveLength(1);
        expect(Number(rows[0].net_amount)).toBe(-5_000);
        expect(Number(rows[0].adjustment_base_amount)).toBe(390_000);
      }
    } finally {
      await db('contract_line_discounts').where({ tenant, discount_id: fixedDiscountId }).delete();
      await db('invoice_charges').where({ tenant, adjustment_source_id: fixedDiscountId }).delete();
      await db('invoice_charges').whereIn(
        'invoice_id',
        db('invoices').where({ tenant, client_id: clientId }).where('invoice_number', 'like', 'ADJ-FIXED-%').select('invoice_id'),
      ).delete();
      await db('invoices').where({ tenant, client_id: clientId }).where('invoice_number', 'like', 'ADJ-FIXED-%').delete();
      await db('discounts').where({ tenant, discount_id: fixedDiscountId }).delete();
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
    }
  });

  it('persists and applies a fractional percentage discount (12.5%) without rounding to two places', async () => {
    await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId }).delete();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });
    const fractionalDiscountId = uuidv4();
    await db('discounts').insert({
      tenant,
      discount_id: fractionalDiscountId,
      discount_name: 'Fractional 12.5%',
      discount_type: 'percentage',
      value: 0.125,
      start_date: '2026-01-01T00:00:00.000Z',
      end_date: null,
      is_active: true,
      scope: 'invoice',
    });
    await db('contract_line_discounts').insert({
      tenant,
      discount_id: fractionalDiscountId,
      contract_line_id: contractLineId,
      client_id: clientId,
      client_contract_id: clientContractId,
    });

    const invoiceId = uuidv4();
    await db('invoices').insert({
      tenant,
      invoice_id: invoiceId,
      invoice_number: `ADJ-FRAC-${invoiceId.slice(0, 8)}`,
      invoice_date: '2026-09-01T00:00:00.000Z',
      due_date: '2026-09-30T00:00:00.000Z',
      subtotal: 100_000,
      tax: 0,
      total_amount: 100_000,
      status: 'draft',
      client_id: clientId,
      currency_code: 'USD',
      is_manual: false,
      client_contract_id: clientContractId,
    });
    await db('invoice_charges').insert({
      tenant,
      item_id: uuidv4(),
      invoice_id: invoiceId,
      service_id: serviceId,
      description: 'Recurring support',
      quantity: 1,
      unit_price: 100_000,
      net_amount: 100_000,
      total_price: 100_000,
      tax_amount: 0,
      tax_rate: 0,
      is_manual: false,
      is_discount: false,
      is_taxable: false,
      client_contract_id: clientContractId,
    });

    try {
      // The widened column keeps 0.125 intact (0.125 = 12.5%, not 0.13).
      const stored = await db('discounts').where({ tenant, discount_id: fractionalDiscountId }).first('value');
      expect(Number(stored.value)).toBeCloseTo(0.125, 6);

      const result = await db.transaction(async (trx) =>
        reconcileAutomaticInvoiceAdjustments(trx, tenant, invoiceId),
      );
      // 12.5% of $1,000.00 = $125.00.
      expect(result.automaticDiscountAmount).toBe(12_500);
      const rows = await db('invoice_charges')
        .where({ tenant, invoice_id: invoiceId, adjustment_source_kind: 'discount' });
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].net_amount)).toBe(-12_500);
    } finally {
      await db('contract_line_discounts').where({ tenant, discount_id: fractionalDiscountId }).delete();
      await db('invoice_charges').where({ tenant, adjustment_source_id: fractionalDiscountId }).delete();
      await db('invoice_charges').where({ tenant, invoice_id: invoiceId }).delete();
      await db('invoices').where({ tenant, invoice_id: invoiceId }).delete();
      await db('discounts').where({ tenant, discount_id: fractionalDiscountId }).delete();
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
    }
  });

  it('keeps the discount value column at decimal(12,4) so the prior whole-number range survives', async () => {
    const bigDiscountId = uuidv4();
    const typeRow = await db.raw(
      `SELECT numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_name = 'discounts' AND column_name = 'value'`,
    );
    expect(Number(typeRow.rows[0].numeric_precision)).toBe(12);
    expect(Number(typeRow.rows[0].numeric_scale)).toBe(4);

    await db('discounts').insert({
      tenant,
      discount_id: bigDiscountId,
      discount_name: 'Large fixed',
      discount_type: 'fixed',
      // The largest value the old decimal(10,2) column could hold.
      value: 99_999_999.99,
      start_date: '2026-01-01T00:00:00.000Z',
      end_date: null,
      is_active: true,
      scope: 'invoice',
    });

    try {
      const stored = await db('discounts').where({ tenant, discount_id: bigDiscountId }).first('value');
      expect(Number(stored.value)).toBeCloseTo(99_999_999.99, 2);

      await db('discounts')
        .where({ tenant, discount_id: bigDiscountId })
        .update({ discount_type: 'percentage', value: 0.125 });
      const fractional = await db('discounts').where({ tenant, discount_id: bigDiscountId }).first('value');
      expect(Number(fractional.value)).toBeCloseTo(0.125, 6);
    } finally {
      await db('discounts').where({ tenant, discount_id: bigDiscountId }).delete();
    }
  });

  it('does not apply a configured discount from another contract of the same client', async () => {
    const otherContractId = uuidv4();
    const otherContractLineId = uuidv4();
    const otherClientContractId = uuidv4();
    const otherDiscountId = uuidv4();
    await db('contracts').insert({
      tenant,
      contract_id: otherContractId,
      contract_name: 'Unrelated contract',
      billing_frequency: 'monthly',
      is_active: true,
    });
    await db('contract_lines').insert({
      tenant,
      contract_line_id: otherContractLineId,
      contract_line_name: 'Unrelated line',
      contract_id: otherContractId,
      billing_frequency: 'monthly',
      contract_line_type: 'fixed',
      is_active: true,
    });
    await db('client_contracts').insert({
      tenant,
      client_contract_id: otherClientContractId,
      client_id: clientId,
      contract_id: otherContractId,
      start_date: '2026-01-01T00:00:00.000Z',
      is_active: true,
    });
    await db('discounts').insert({
      tenant,
      discount_id: otherDiscountId,
      discount_name: 'Unrelated 20%',
      discount_type: 'percentage',
      value: 0.2,
      start_date: '2026-01-01T00:00:00.000Z',
      end_date: null,
      is_active: true,
    });
    await db('contract_line_discounts').insert({
      tenant,
      discount_id: otherDiscountId,
      contract_line_id: otherContractLineId,
      client_id: clientId,
      client_contract_id: otherClientContractId,
    });

    // Disable the represented-contract discount so the only candidate is the
    // unrelated one; the invoice already carries a charge from clientContractId.
    await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId }).delete();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });
    try {
      const invoiceId = uuidv4();
      await db('invoices').insert({
        tenant,
        invoice_id: invoiceId,
        invoice_number: `ADJ-UNREL-${invoiceId.slice(0, 8)}`,
        invoice_date: '2026-09-01T00:00:00.000Z',
        due_date: '2026-09-30T00:00:00.000Z',
        total_amount: 390_000,
        status: 'draft',
        client_id: clientId,
        currency_code: 'USD',
        is_manual: false,
        client_contract_id: clientContractId,
      });
      await db('invoice_charges').insert({
        tenant,
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: serviceId,
        description: 'Recurring on the represented contract',
        quantity: 1,
        unit_price: 390_000,
        net_amount: 390_000,
        total_price: 390_000,
        tax_amount: 0,
        tax_rate: 0,
        is_manual: false,
        is_discount: false,
        is_taxable: false,
        client_contract_id: clientContractId,
      });

      const result = await db.transaction(async (trx) =>
        reconcileAutomaticInvoiceAdjustments(trx, tenant, invoiceId),
      );

      expect(result.automaticDiscountAmount).toBe(0);
      const discountRows = await db('invoice_charges')
        .where({ tenant, invoice_id: invoiceId, adjustment_source_kind: 'discount' });
      expect(discountRows).toHaveLength(0);
    } finally {
      await db('contract_line_discounts').where({ tenant, discount_id: otherDiscountId }).delete();
      await db('discounts').where({ tenant, discount_id: otherDiscountId }).delete();
      await db('client_contracts').where({ tenant, client_contract_id: otherClientContractId }).delete();
      await db('contract_lines').where({ tenant, contract_line_id: otherContractLineId }).delete();
      await db('contracts').where({ tenant, contract_id: otherContractId }).delete();
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
    }
  });

  it('uses a full invoice-date day when legacy charges have no detail periods', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    try {
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ start_date: '2026-09-01', end_date: null });
      const active = await db.transaction((trx) => reconcileAutomaticInvoiceAdjustments(trx, tenant, fixture.invoiceId));
      expect(active.automaticDiscountAmount).toBe(39_000);
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ start_date: '2026-09-02' });
      const future = await db.transaction((trx) => reconcileAutomaticInvoiceAdjustments(trx, tenant, fixture.invoiceId));
      expect(future.automaticDiscountAmount).toBe(0);
    } finally {
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ start_date: '2026-01-01', end_date: null });
    }
  });

  it('copies template default discounts into independent client-contract definitions', async () => {
    const templateId = uuidv4();
    const isolatedContractId = uuidv4();
    const isolatedLineId = uuidv4();
    const firstClientContractId = uuidv4();
    const secondClientContractId = uuidv4();
    await db('contracts').insert({
      tenant, contract_id: isolatedContractId, contract_name: `Template copy contract ${templateId.slice(0, 6)}`,
      billing_frequency: 'monthly', is_active: true,
    });
    await db('contract_lines').insert({
      tenant, contract_line_id: isolatedLineId, contract_id: isolatedContractId,
      contract_line_name: 'Template copy line', billing_frequency: 'monthly', contract_line_type: 'fixed', is_active: true,
    });
    await db('contract_templates').insert({
      tenant, template_id: templateId, template_name: `Discount template ${templateId.slice(0, 8)}`,
      default_billing_frequency: 'monthly', template_status: 'published',
      template_metadata: { default_discounts: [{
        discount_name: 'Template 10 percent', discount_type: 'percentage', value: 10,
        start_date: '2026-01-01', scope: 'contract', is_active: true,
      }, {
        discount_name: 'Template service credit', discount_type: 'fixed', value: 25.5,
        start_date: '2026-01-01', scope: 'service', scope_service_id: serviceId, is_active: true,
      }, {
        discount_name: 'Template line discount', discount_type: 'fixed', value: 5,
        start_date: '2026-01-01', scope: 'line', contract_line_id: isolatedLineId, is_active: true,
      }] },
    });
    const { updateContract } = await import('../actions/contractActions');
    const invalidTemplateSave = await updateContract(templateId, {
      template_metadata: { default_discounts: [{ discount_name: 'Impossible 101%', discount_type: 'percentage', value: 101, start_date: '2026-01-01', scope: 'contract' }] },
    } as any);
    expect(invalidTemplateSave).toHaveProperty('actionError');
    expect((await db('contract_templates').where({ tenant, template_id: templateId }).first()).template_metadata.default_discounts)
      .toHaveLength(3);
    await db('client_contracts').insert([
      { tenant, client_contract_id: firstClientContractId, client_id: clientId, contract_id: isolatedContractId, start_date: '2026-01-01', is_active: true },
      { tenant, client_contract_id: secondClientContractId, client_id: clientId, contract_id: isolatedContractId, start_date: '2026-01-01', is_active: true },
    ]);
    const { cloneTemplateDefaultDiscounts } = await import('../lib/billing/utils/templateClone');
    const unrelatedId = uuidv4();
    await db.transaction(async (trx) => {
      await cloneTemplateDefaultDiscounts(trx, {
        tenant, templateId, clientContractId: firstClientContractId, clientId,
        lineIdMap: { [isolatedLineId]: isolatedLineId },
      });
      // An unrelated pre-existing term cannot suppress template terms, and a
      // second copy pass must reuse the exact copied identities (including the
      // line-only ledger row).
      await trx('discounts').insert({ tenant, discount_id: unrelatedId, discount_name: 'Unrelated', discount_type: 'fixed', value: 1, start_date: '2026-01-01', is_active: true, scope: 'contract' });
      await trx('contract_discount_assignments').insert({ tenant, assignment_id: uuidv4(), client_contract_id: firstClientContractId, discount_id: unrelatedId, created_at: trx.fn.now() });
      await cloneTemplateDefaultDiscounts(trx, {
        tenant, templateId, clientContractId: firstClientContractId, clientId,
        lineIdMap: { [isolatedLineId]: isolatedLineId },
      });
      await cloneTemplateDefaultDiscounts(trx, {
        tenant, templateId, clientContractId: secondClientContractId, clientId,
        lineIdMap: { [isolatedLineId]: isolatedLineId },
      });
    });
    const firstAssignments = await db('contract_discount_assignments').where({ tenant, client_contract_id: firstClientContractId }).whereNot('discount_id', unrelatedId).orderBy('discount_id');
    const secondAssignments = await db('contract_discount_assignments').where({ tenant, client_contract_id: secondClientContractId }).orderBy('discount_id');
    expect(firstAssignments).toHaveLength(2);
    expect(secondAssignments).toHaveLength(2);
    expect(firstAssignments.map((row) => row.discount_id)).not.toEqual(secondAssignments.map((row) => row.discount_id));
    const firstDefinitions = await db('discounts').whereIn('discount_id', firstAssignments.map((row) => row.discount_id)).where({ tenant }).orderBy('discount_name');
    const secondDefinitions = await db('discounts').whereIn('discount_id', secondAssignments.map((row) => row.discount_id)).where({ tenant }).orderBy('discount_name');
    expect(firstDefinitions.map((row) => [row.discount_name, Number(row.value)])).toEqual(secondDefinitions.map((row) => [row.discount_name, Number(row.value)]));

    // Settle the contract-wide 10% copy for each independent client contract.
    // Two charge rows per invoice prove scope across multiple represented lines;
    // a second reconciliation must update the same one settlement row.
    const contractDiscounts = await Promise.all([firstClientContractId, secondClientContractId].map(async (ownerId) => {
      const assignment = await db('contract_discount_assignments as a')
        .join('discounts as d', function () { this.on('d.tenant', '=', 'a.tenant').andOn('d.discount_id', '=', 'a.discount_id'); })
        .where({ 'a.tenant': tenant, 'a.client_contract_id': ownerId, 'd.discount_name': 'Template 10 percent' })
        .first('a.assignment_id');
      return assignment.assignment_id as string;
    }));
    const acceptanceInvoices: Array<{ invoiceId: string; ownerId: string; ownerIndex: number }> = [];
    for (const [ownerIndex, ownerId] of [firstClientContractId, secondClientContractId].entries()) {
      const invoiceId = uuidv4();
      acceptanceInvoices.push({ invoiceId, ownerId, ownerIndex });
      await db('invoices').insert({
        tenant, invoice_id: invoiceId, invoice_number: `TEMPLATE-COPY-${invoiceId.slice(0, 8)}`,
        invoice_date: '2026-09-01T00:00:00.000Z', due_date: '2026-09-30T00:00:00.000Z',
        subtotal: 405_000, tax: 0, total_amount: 405_000, status: 'draft', client_id: clientId,
        currency_code: 'USD', is_manual: false, client_contract_id: ownerId,
      });
      for (const [lineIndex, amount] of [300_000, 105_000].entries()) {
        await db('invoice_charges').insert({
          tenant, item_id: uuidv4(), invoice_id: invoiceId, service_id: serviceId,
          description: `Contract line ${lineIndex + 1}`, quantity: 1, unit_price: amount,
          net_amount: amount, total_price: amount, tax_amount: 0, tax_rate: 0,
          is_manual: false, is_discount: false, is_taxable: false, client_contract_id: ownerId,
        });
      }
      await db.transaction((trx) => reconcileAutomaticInvoiceDiscounts(trx, tenant, invoiceId));
      await db.transaction((trx) => reconcileAutomaticInvoiceDiscounts(trx, tenant, invoiceId));
      const settlements = await db('invoice_charges').where({ tenant, invoice_id: invoiceId, adjustment_source_id: contractDiscounts[ownerIndex] });
      expect(settlements).toHaveLength(1);
      expect(Number(settlements[0].net_amount)).toBe(-40_500);
      expect(Number(settlements[0].adjustment_base_amount)).toBe(405_000);
    }
    await db('invoice_charges').where({ tenant }).whereIn('invoice_id', acceptanceInvoices.map((invoice) => invoice.invoiceId)).delete();
    await db('invoices').where({ tenant }).whereIn('invoice_id', acceptanceInvoices.map((invoice) => invoice.invoiceId)).delete();

    await db('discounts').where({ tenant, discount_id: firstAssignments[0].discount_id }).update({ is_active: false, discount_name: 'Edited one copy' });
    expect((await db('discounts').where({ tenant, discount_id: secondAssignments[0].discount_id }).first()).is_active).toBe(true);
    await db('contract_templates').where({ tenant, template_id: templateId }).update({
      template_metadata: { default_discounts: [{ discount_name: 'Edited template', discount_type: 'percentage', value: 5, start_date: '2026-01-01', scope: 'contract' }] },
    });
    expect((await db('discounts').where({ tenant, discount_id: secondAssignments[0].discount_id }).first()).discount_name).not.toBe('Edited template');
    const lineDiscounts = await db('contract_line_discounts as cld').where({ 'cld.tenant': tenant }).whereIn('cld.discount_id', function () {
      this.select('discount_id').from('discounts').where({ tenant, discount_name: 'Template line discount' });
    });
    expect(lineDiscounts).toHaveLength(2);
    const allDiscountIds = [...firstAssignments, ...secondAssignments].map((row) => row.discount_id);
    await db('contract_line_discounts').where({ tenant }).whereIn('discount_id', allDiscountIds).delete();
    await db('contract_discount_assignments').where({ tenant }).whereIn('assignment_id', [...firstAssignments, ...secondAssignments].map((row) => row.assignment_id)).delete();
    await db('discounts').where({ tenant }).whereIn('discount_id', allDiscountIds).delete();
    await db('contract_discount_assignments').where({ tenant, client_contract_id: firstClientContractId, discount_id: unrelatedId }).delete();
    await db('discounts').where({ tenant, discount_id: unrelatedId }).delete();
    await db('client_contracts').where({ tenant, client_contract_id: secondClientContractId }).delete();
    await db('client_contracts').where({ tenant, client_contract_id: firstClientContractId }).delete();
    await db('contract_templates').where({ tenant, template_id: templateId }).delete();
    await db('contract_lines').where({ tenant, contract_line_id: isolatedLineId }).delete();
    await db('contracts').where({ tenant, contract_id: isolatedContractId }).delete();
  });

  it.each(['Fixed', 'Hourly'] as const)('keeps fixed and %s template sources separate through creation and settlement', async (secondType) => {
    const templateId = uuidv4();
    const fixedTemplateLineId = uuidv4();
    const hourlyTemplateLineId = uuidv4();
    let createdContractId: string | undefined;
    const scopedInvoiceId = uuidv4();
    await db('contract_templates').insert({
      tenant, template_id: templateId, template_name: 'Repeated-service identity template',
      default_billing_frequency: 'monthly', template_status: 'published',
      template_metadata: { default_discounts: [
        { template_discount_key: uuidv4(), discount_name: 'Fixed source line', discount_type: 'percentage', value: 10, start_date: '2026-01-01', scope: 'line', contract_line_id: fixedTemplateLineId },
        { template_discount_key: uuidv4(), discount_name: 'Hourly source line', discount_type: 'percentage', value: 20, start_date: '2026-01-01', scope: 'line', contract_line_id: hourlyTemplateLineId },
      ] },
    });
    await db('contract_template_lines').insert([
      { tenant, template_line_id: fixedTemplateLineId, template_id: templateId, template_line_name: 'Fixed source', billing_frequency: 'monthly', line_type: 'Fixed', is_active: true },
      { tenant, template_line_id: hourlyTemplateLineId, template_id: templateId, template_line_name: 'Hourly source', billing_frequency: 'monthly', line_type: secondType, is_active: true },
    ]);
    try {
      const { createClientContractFromWizard } = await import('../actions/contractWizardActions');
      const { runWithTenant } = await import('@alga-psa/db');
      const created = await runWithTenant(tenant, () => createClientContractFromWizard({
        contract_name: 'Repeated service contract', client_id: clientId, start_date: '2026-09-01', currency_code: 'USD',
        enable_proration: false, template_id: templateId, fixed_base_rate: 10_000,
        fixed_services: [
          { service_id: serviceId, quantity: 1, source_template_line_id: fixedTemplateLineId },
          ...(secondType === 'Fixed' ? [{ service_id: serviceId, quantity: 1, source_template_line_id: hourlyTemplateLineId }] : []),
        ],
        hourly_services: secondType === 'Hourly' ? [{ service_id: serviceId, hourly_rate: 2_000, source_template_line_id: hourlyTemplateLineId }] : [],
      }, { isDraft: true }));
      expect(created).toHaveProperty('contract_id');
      createdContractId = (created as any).contract_id;
      const clientAssignment = await db('client_contracts').where({ tenant, contract_id: createdContractId }).first('client_contract_id');
      const copied = await db('contract_line_discounts as cld')
        .join('discounts as d', function () { this.on('d.tenant', '=', 'cld.tenant').andOn('d.discount_id', '=', 'cld.discount_id'); })
        .where({ 'cld.tenant': tenant, 'cld.client_contract_id': clientAssignment.client_contract_id })
        .select('d.discount_name', 'cld.contract_line_id');
      const [fixedTarget, hourlyTarget] = (created as any).contract_line_ids as string[];
      expect(copied).toEqual(expect.arrayContaining([
        { discount_name: 'Fixed source line', contract_line_id: fixedTarget },
        { discount_name: 'Hourly source line', contract_line_id: hourlyTarget },
      ]));
      expect(fixedTarget).not.toBe(hourlyTarget);
      const resave = await runWithTenant(tenant, () => createClientContractFromWizard({
        contract_id: createdContractId, contract_name: 'Attempted rewrite', client_id: clientId,
        start_date: '2026-09-01', currency_code: 'USD',
        fixed_services: [{ service_id: serviceId, quantity: 4 }], fixed_base_rate: 99_000, enable_proration: false,
      }, { isDraft: true }));
      expect(resave).toMatchObject({ actionError: expect.stringContaining('standing discount terms') });
      expect(await db('client_contracts').where({ tenant, client_contract_id: clientAssignment.client_contract_id }).first()).toBeDefined();
      const retainedTerms = await db('contract_line_discounts')
        .where({ tenant, client_contract_id: clientAssignment.client_contract_id }).pluck('discount_id');
      expect(retainedTerms).toHaveLength(2);
      const fixedConfigs = await db('contract_lines')
        .where({ tenant }).whereIn('contract_line_id', [fixedTarget, hourlyTarget]);
      expect(fixedConfigs.reduce((sum, row) => sum + Number(row.custom_rate), 0)).toBe(10_000);
      await db('invoices').insert({
        tenant, invoice_id: scopedInvoiceId, client_id: clientId,
        client_contract_id: clientAssignment.client_contract_id,
        invoice_number: `SOURCE-${scopedInvoiceId.slice(0, 8)}`, invoice_date: '2026-09-01',
        due_date: '2026-09-30', status: 'draft', subtotal: 30_000, tax: 0,
        total_amount: 30_000, currency_code: 'USD', is_manual: false,
      });
      for (const [index, target] of [fixedTarget, hourlyTarget].entries()) {
        const config = await db('contract_line_service_configuration')
          .where({ tenant, contract_line_id: target, service_id: serviceId }).first('config_id');
        const itemId = uuidv4();
        const amount = (index + 1) * 10_000;
        await db('invoice_charges').insert({
          tenant, item_id: itemId, invoice_id: scopedInvoiceId, service_id: serviceId,
          client_contract_id: clientAssignment.client_contract_id, description: `Source ${index}`,
          quantity: 1, unit_price: amount, net_amount: amount, total_price: amount,
          tax_amount: 0, is_manual: false, is_discount: false, is_taxable: false,
        });
        await db('invoice_charge_details').insert({
          tenant, item_detail_id: uuidv4(), item_id: itemId, service_id: serviceId,
          config_id: config.config_id, quantity: 1, rate: amount,
          service_period_start: '2026-09-01', service_period_end: '2026-09-30',
        });
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await db.transaction((trx) => reconcileAutomaticInvoiceAdjustments(trx, tenant, scopedInvoiceId));
        const settlements = await db('invoice_charges')
          .where({ tenant, invoice_id: scopedInvoiceId, is_discount: true }).orderBy('description');
        expect(settlements.map((row) => Number(row.net_amount))).toEqual([-1_000, -4_000]);
      }
    } finally {
      const chargeIds = await db('invoice_charges').where({ tenant, invoice_id: scopedInvoiceId }).pluck('item_id');
      await db('invoice_charge_details').where({ tenant }).whereIn('item_id', chargeIds).delete();
      await db('invoice_charges').where({ tenant, invoice_id: scopedInvoiceId }).delete();
      await db('invoices').where({ tenant, invoice_id: scopedInvoiceId }).delete();
      if (createdContractId) {
        const owner = await db('client_contracts').where({ tenant, contract_id: createdContractId }).first('client_contract_id');
        if (owner) {
          const copiedIds = await db('contract_line_discounts').where({ tenant, client_contract_id: owner.client_contract_id }).pluck('discount_id');
          await db('contract_line_discounts').where({ tenant, client_contract_id: owner.client_contract_id }).delete();
          await db('contract_discount_assignments').where({ tenant, client_contract_id: owner.client_contract_id }).delete();
          await db('discounts').where({ tenant }).whereIn('discount_id', copiedIds).delete();
          await db('client_contracts').where({ tenant, client_contract_id: owner.client_contract_id }).delete();
        }
        const createdLineIds = await db('contract_lines').where({ tenant, contract_id: createdContractId }).pluck('contract_line_id');
        const createdConfigIds = createdLineIds.length
          ? await db('contract_line_service_configuration').where({ tenant }).whereIn('contract_line_id', createdLineIds).pluck('config_id')
          : [];
        if (createdConfigIds.length) {
          await db('contract_line_service_bucket_config').where({ tenant }).whereIn('config_id', createdConfigIds).delete();
          await db('contract_line_service_hourly_configs').where({ tenant }).whereIn('config_id', createdConfigIds).delete();
          await db('contract_line_service_fixed_config').where({ tenant }).whereIn('config_id', createdConfigIds).delete();
          await db('contract_line_service_usage_config').where({ tenant }).whereIn('config_id', createdConfigIds).delete();
          await db('contract_line_service_rate_tiers').where({ tenant }).whereIn('config_id', createdConfigIds).delete();
          await db('contract_line_service_configuration').where({ tenant }).whereIn('config_id', createdConfigIds).delete();
        }
        if (createdLineIds.length) {
          await db('contract_line_services').where({ tenant }).whereIn('contract_line_id', createdLineIds).delete();
          await db('contract_lines').where({ tenant }).whereIn('contract_line_id', createdLineIds).delete();
        }
        await db('contracts').where({ tenant, contract_id: createdContractId }).delete();
      }
      await db('contract_template_lines').where({ tenant }).whereIn('template_line_id', [fixedTemplateLineId, hourlyTemplateLineId]).delete();
      await db('contract_templates').where({ tenant, template_id: templateId }).delete();
    }
  });

  it('excludes line and assignment discounts beginning at an invoice window exclusive end', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId }).delete();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });
    const configId = uuidv4();
    const assignmentDiscountId = uuidv4();
    const lineDiscountId = uuidv4();
    await db('contract_line_service_configuration').insert({
      tenant, config_id: configId, contract_line_id: contractLineId, service_id: serviceId,
      configuration_type: 'Fixed', quantity: 1,
    });
    await db('invoice_charge_details').insert({
      tenant, item_detail_id: uuidv4(), item_id: fixture.generatedChargeId, config_id: configId,
      service_id: serviceId, quantity: 1, rate: 390_000,
      service_period_start: '2026-09-01', service_period_end: '2026-09-30',
    });
    await db('discounts').insert([
      { tenant, discount_id: assignmentDiscountId, discount_name: 'Starts October', discount_type: 'percentage', value: 0.1, start_date: '2026-10-01T00:00:00.000Z', is_active: true, scope: 'contract' },
      { tenant, discount_id: lineDiscountId, discount_name: 'Line starts October', discount_type: 'percentage', value: 0.1, start_date: '2026-10-01T00:00:00.000Z', is_active: true, scope: 'line' },
    ]);
    const assignmentId = uuidv4();
    await db('contract_discount_assignments').insert({ tenant, assignment_id: assignmentId, client_contract_id: clientContractId, discount_id: assignmentDiscountId, created_at: db.fn.now() });
    await db('contract_line_discounts').insert({ tenant, discount_id: lineDiscountId, contract_line_id: contractLineId, client_id: clientId, client_contract_id: clientContractId });
    try {
      const result = await db.transaction((trx) => reconcileAutomaticInvoiceAdjustments(trx, tenant, fixture.invoiceId));
      expect(result.automaticDiscountAmount).toBe(0);
      expect(await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, adjustment_source_kind: 'discount' })).toHaveLength(0);
    } finally {
      await db('contract_line_discounts').where({ tenant, discount_id: lineDiscountId }).delete();
      await db('contract_discount_assignments').where({ tenant, assignment_id: assignmentId }).delete();
      await db('discounts').where({ tenant }).whereIn('discount_id', [assignmentDiscountId, lineDiscountId]).delete();
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
    }
  });

  it('isolates line-discount listing and settlement ownership between assignments of one contract', async () => {
    const ownerB = uuidv4();
    const discountA = uuidv4();
    const discountB = uuidv4();
    const invoiceA = uuidv4();
    const invoiceB = uuidv4();
    const chargeA = uuidv4();
    const chargeB = uuidv4();
    const configId = uuidv4();
    await db('client_contracts').insert({ tenant, client_contract_id: ownerB, client_id: clientId, contract_id: contractId, start_date: '2026-01-01', is_active: true });
    await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId }).delete();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });
    await db('discounts').insert([
      { tenant, discount_id: discountA, discount_name: 'Owner A line 10%', discount_type: 'percentage', value: 0.1, start_date: '2026-01-01', is_active: true, scope: 'line' },
      { tenant, discount_id: discountB, discount_name: 'Owner B line 10%', discount_type: 'percentage', value: 0.1, start_date: '2026-01-01', is_active: true, scope: 'line' },
    ]);
    await db('contract_line_discounts').insert([
      { tenant, discount_id: discountA, contract_line_id: contractLineId, client_id: clientId, client_contract_id: clientContractId },
      { tenant, discount_id: discountB, contract_line_id: contractLineId, client_id: clientId, client_contract_id: ownerB },
    ]);
    await db('contract_line_services').insert({ tenant, contract_line_id: contractLineId, service_id: serviceId }).onConflict(['tenant', 'contract_line_id', 'service_id']).ignore();
    await db('contract_line_service_configuration').insert({ tenant, config_id: configId, contract_line_id: contractLineId, service_id: serviceId, configuration_type: 'Fixed', quantity: 1 });
    const { getContractDiscounts, updateContractDiscount, setContractDiscountActive } = await import('../actions/discountActions');
    const listedA = await getContractDiscounts(contractId, clientContractId);
    const listedB = await getContractDiscounts(contractId, ownerB);
    expect(Array.isArray(listedA) && listedA.some((row) => row.discount_id === discountA)).toBe(true);
    expect(Array.isArray(listedA) && listedA.some((row) => row.discount_id === discountB)).toBe(false);
    expect(Array.isArray(listedB) && listedB.some((row) => row.discount_id === discountB)).toBe(true);
    expect(Array.isArray(listedB) && listedB.some((row) => row.discount_id === discountA)).toBe(false);
    const updatedA = await updateContractDiscount(contractId, discountA, {
      discount_name: 'Owner A edited', discount_type: 'percentage', value: 12.5,
      start_date: '2026-01-01', end_date: null, scope: 'line', contract_line_id: contractLineId, is_active: true,
    }, clientContractId);
    expect(updatedA).toMatchObject({ discount_id: discountA, discount_name: 'Owner A edited', value: 12.5 });
    await setContractDiscountActive(contractId, discountA, false, clientContractId);
    expect((await db('discounts').where({ tenant, discount_id: discountB }).first()).is_active).toBe(true);
    await setContractDiscountActive(contractId, discountA, true, clientContractId);
    const insertInvoiceAndCharge = async (invoiceId: string, itemId: string, ownerId: string) => {
      await db('invoices').insert({ tenant, invoice_id: invoiceId, invoice_number: `OWN-${invoiceId.slice(0, 8)}`, invoice_date: '2026-09-01', due_date: '2026-09-30', total_amount: 10_000, status: 'draft', client_id: clientId, currency_code: 'USD', is_manual: false, client_contract_id: ownerId });
      await db('invoice_charges').insert({ tenant, item_id: itemId, invoice_id: invoiceId, service_id: serviceId, description: 'Owned recurring service', quantity: 1, unit_price: 10_000, net_amount: 10_000, total_price: 10_000, tax_amount: 0, tax_rate: 0, is_manual: false, is_discount: false, is_taxable: false, client_contract_id: ownerId });
      await db('invoice_charge_details').insert({ tenant, item_detail_id: uuidv4(), item_id: itemId, config_id: configId, service_id: serviceId, quantity: 1, rate: 10_000, service_period_start: '2026-09-01', service_period_end: '2026-09-30' });
    };
    try {
      await insertInvoiceAndCharge(invoiceA, chargeA, clientContractId);
      await insertInvoiceAndCharge(invoiceB, chargeB, ownerB);
      for (const [invoiceId, ownDiscount, foreignDiscount] of [[invoiceA, discountA, discountB], [invoiceB, discountB, discountA]] as const) {
        const first = await db.transaction((trx) => reconcileAutomaticInvoiceAdjustments(trx, tenant, invoiceId));
        const repeated = await db.transaction((trx) => reconcileAutomaticInvoiceAdjustments(trx, tenant, invoiceId));
        expect(first.automaticDiscountAmount).toBe(invoiceId === invoiceA ? 1_250 : 1_000);
        expect(repeated.automaticDiscountAmount).toBe(invoiceId === invoiceA ? 1_250 : 1_000);
        const settled = await db('invoice_charges').where({ tenant, invoice_id: invoiceId, adjustment_source_kind: 'discount' }).select('adjustment_source_id');
        expect(settled).toEqual([{ adjustment_source_id: ownDiscount }]);
        expect(settled.some((row) => row.adjustment_source_id === foreignDiscount)).toBe(false);
      }
    } finally {
      await db('invoice_charge_details').where({ tenant }).whereIn('item_id', [chargeA, chargeB]).delete();
      await db('invoice_charges').where({ tenant }).andWhere((query) => query.whereIn('item_id', [chargeA, chargeB]).orWhereIn('invoice_id', [invoiceA, invoiceB])).delete();
      await db('invoices').where({ tenant }).whereIn('invoice_id', [invoiceA, invoiceB]).delete();
      await db('contract_line_service_configuration').where({ tenant, config_id: configId }).delete();
      await db('contract_line_services').where({ tenant, contract_line_id: contractLineId, service_id: serviceId }).delete();
      await db('contract_line_discounts').where({ tenant }).whereIn('discount_id', [discountA, discountB]).delete();
      await db('discounts').where({ tenant }).whereIn('discount_id', [discountA, discountB]).delete();
      await db('client_contracts').where({ tenant, client_contract_id: ownerB }).delete();
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
    }
  });

  it('excludes a discount linked only to an unbilled sibling contract line (detail-backed invoice)', async () => {
    // The only candidate should be the sibling-line discount.
    await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId }).delete();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });

    const siblingLineId = uuidv4();
    const siblingDiscountId = uuidv4();
    const configId = uuidv4();
    await db('contract_lines').insert({
      tenant,
      contract_line_id: siblingLineId,
      contract_line_name: 'Unbilled sibling line',
      contract_id: contractId,
      billing_frequency: 'monthly',
      contract_line_type: 'fixed',
      is_active: true,
    });
    await db('discounts').insert({
      tenant,
      discount_id: siblingDiscountId,
      discount_name: 'Sibling 25%',
      discount_type: 'percentage',
      value: 0.25,
      start_date: '2026-01-01T00:00:00.000Z',
      end_date: null,
      is_active: true,
    });
    await db('contract_line_discounts').insert({
      tenant,
      discount_id: siblingDiscountId,
      contract_line_id: siblingLineId,
      client_id: clientId,
      client_contract_id: clientContractId,
    });

    try {
      const invoiceId = uuidv4();
      const chargeId = uuidv4();
      await db('invoices').insert({
        tenant,
        invoice_id: invoiceId,
        invoice_number: `ADJ-SIB-${invoiceId.slice(0, 8)}`,
        invoice_date: '2026-09-01T00:00:00.000Z',
        due_date: '2026-09-30T00:00:00.000Z',
        subtotal: 390000,
        tax: 0,
        total_amount: 390000,
        status: 'draft',
        client_id: clientId,
        currency_code: 'USD',
        is_manual: false,
        client_contract_id: clientContractId,
      });
      await db('invoice_charges').insert({
        tenant,
        item_id: chargeId,
        invoice_id: invoiceId,
        service_id: serviceId,
        description: 'Recurring support (detail-backed)',
        quantity: 1,
        unit_price: 390000,
        net_amount: 390000,
        total_price: 390000,
        tax_amount: 0,
        tax_rate: 0,
        is_manual: false,
        is_discount: false,
        is_taxable: false,
        client_contract_id: clientContractId,
      });
      // Canonical detail link to the BILLED line. The contract now has a
      // concrete detail line, so the whole-contract fallback no longer applies
      // and the unbilled sibling line cannot be represented.
      await db('contract_line_service_configuration').insert({
        tenant,
        config_id: configId,
        service_id: serviceId,
        configuration_type: 'fixed',
        contract_line_id: contractLineId,
      });
      await db('invoice_charge_details').insert({
        tenant,
        item_id: chargeId,
        service_id: serviceId,
        config_id: configId,
        quantity: 1,
        rate: 390000,
      });

      const result = await db.transaction(async (trx) =>
        reconcileAutomaticInvoiceAdjustments(trx, tenant, invoiceId),
      );

      expect(result.automaticDiscountAmount).toBe(0);
      const discountRows = await db('invoice_charges')
        .where({ tenant, invoice_id: invoiceId, adjustment_source_kind: 'discount' });
      expect(discountRows).toHaveLength(0);

      // Positive control: moving the same discount onto the billed line makes it
      // apply, proving the fixture reaches the evaluator and the exclusion is
      // specifically the unbilled sibling link.
      await db('contract_line_discounts')
        .where({ tenant, discount_id: siblingDiscountId })
        .update({ contract_line_id: contractLineId });
      const applied = await db.transaction(async (trx) =>
        reconcileAutomaticInvoiceAdjustments(trx, tenant, invoiceId),
      );
      expect(applied.automaticDiscountAmount).toBe(97500);
    } finally {
      await db('invoice_charge_details').where({ tenant, config_id: configId }).delete();
      await db('contract_line_service_configuration').where({ tenant, config_id: configId }).delete();
      await db('contract_line_discounts').where({ tenant, discount_id: siblingDiscountId }).delete();
      await db('discounts').where({ tenant, discount_id: siblingDiscountId }).delete();
      await db('invoice_charges').where({ tenant, adjustment_source_id: siblingDiscountId }).delete();
      await db('contract_lines').where({ tenant, contract_line_id: siblingLineId }).delete();
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
    }
  });

  it('keeps a service-scoped, capped discount intact through tax and totals recalculation', async () => {
    // The plan's financial path: reconcile automatic settlements, then run the
    // shared tax/totals pass that calls recalculatePercentageDiscountInvoiceCharges.
    // Two 60% service-scoped discounts exceed the eligible base, so the second
    // is capped; an out-of-scope manual charge must never enter the base. A
    // legacy whole-invoice recalculation would overwrite both rows with 60% of
    // the 490000 subtotal and wipe the manual line.
    await db('contract_discount_assignments').where({ tenant, client_contract_id: clientContractId }).delete();
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: false });
    const firstDiscountId = uuidv4();
    const secondDiscountId = uuidv4();
    for (const [id, name, priority] of [
      [firstDiscountId, 'Service 60% (first)', 1],
      [secondDiscountId, 'Service 60% (second)', 2],
    ] as const) {
      await db('discounts').insert({
        tenant,
        discount_id: id,
        discount_name: name,
        discount_type: 'percentage',
        value: 0.6,
        start_date: '2026-01-01T00:00:00.000Z',
        end_date: null,
        is_active: true,
        scope: 'service',
        scope_service_id: serviceId,
        priority,
      });
      await db('contract_line_discounts').insert({
        tenant,
        discount_id: id,
        contract_line_id: contractLineId,
        client_id: clientId,
        client_contract_id: clientContractId,
      });
    }

    try {
      const invoiceId = uuidv4();
      await db('invoices').insert({
        tenant,
        invoice_id: invoiceId,
        invoice_number: `ADJ-CAP-${invoiceId.slice(0, 8)}`,
        invoice_date: '2026-09-01T00:00:00.000Z',
        due_date: '2026-09-30T00:00:00.000Z',
        subtotal: 490_000,
        tax: 0,
        total_amount: 490_000,
        status: 'draft',
        client_id: clientId,
        currency_code: 'USD',
        is_manual: false,
        client_contract_id: clientContractId,
      });
      await db('invoice_charges').insert({
        tenant,
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: serviceId,
        description: 'In-scope recurring',
        quantity: 1,
        unit_price: 390_000,
        net_amount: 390_000,
        total_price: 390_000,
        tax_amount: 0,
        tax_rate: 0,
        is_manual: false,
        is_discount: false,
        is_taxable: false,
        client_contract_id: clientContractId,
      });
      await db('invoice_charges').insert({
        tenant,
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: null,
        description: 'Out-of-scope manual',
        quantity: 1,
        unit_price: 100_000,
        net_amount: 100_000,
        total_price: 100_000,
        tax_amount: 0,
        tax_rate: 0,
        is_manual: true,
        is_discount: false,
        is_taxable: false,
      });

      await db.transaction(async (trx) => {
        await reconcileAutomaticInvoiceAdjustments(trx, tenant, invoiceId);
        await new BillingEngine().recalculateInvoice(invoiceId, trx, tenant);
      });

      const discountRows = await db('invoice_charges')
        .where({ tenant, invoice_id: invoiceId, adjustment_source_kind: 'discount' })
        .select('net_amount');
      expect(discountRows.map((row) => Number(row.net_amount)).sort((a, b) => a - b)).toEqual([
        -234_000,
        -156_000,
      ]);

      const invoice = await db('invoices').where({ tenant, invoice_id: invoiceId }).first();
      // 390000 + 100000 − 234000 − 156000 = 100000, and no discount exceeds the
      // eligible base. Tax is zero because both charges are non-taxable.
      expect(Number(invoice.subtotal)).toBe(100_000);
      expect(Number(invoice.tax)).toBe(0);
      expect(Number(invoice.total_amount)).toBe(100_000);

      const rows = await db('invoice_charges')
        .where({ tenant, invoice_id: invoiceId })
        .select('net_amount');
      const netSum = rows.reduce((sum, row) => sum + Number(row.net_amount), 0);
      expect(netSum).toBe(Number(invoice.subtotal));
    } finally {
      await db('contract_line_discounts')
        .whereIn('discount_id', [firstDiscountId, secondDiscountId])
        .delete();
      await db('invoice_charges')
        .whereIn('adjustment_source_id', [firstDiscountId, secondDiscountId])
        .delete();
      await db('discounts').whereIn('discount_id', [firstDiscountId, secondDiscountId]).delete();
      await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
    }
  });

  it('constrains authored line dates to the client contract period', async () => {
    // seedContractDiscount assigns the contract from 2026-01-01 with no end.
    await expect(
      validateContractLineWindow(db as never, tenant, contractId, { start_date: '2025-12-31' }),
    ).resolves.toMatch(/before the client contract starts/);

    await expect(
      validateContractLineWindow(db as never, tenant, contractId, {
        start_date: '2026-05-01',
        end_date: '2026-04-01',
      }),
    ).resolves.toMatch(/after the line start date/);

    await expect(
      validateContractLineWindow(db as never, tenant, contractId, { start_date: '2026-02-01' }),
    ).resolves.toBeNull();

    await expect(
      validateContractLineWindow(db as never, tenant, contractId, {}),
    ).resolves.toBeNull();
  });

  it('rejects a negative contract-line custom_rate at the database', async () => {
    const negativeLineId = uuidv4();
    await db('contract_lines').insert({
      tenant,
      contract_line_id: negativeLineId,
      contract_line_name: 'Negative rate line',
      contract_id: contractId,
      billing_frequency: 'monthly',
      contract_line_type: 'fixed',
      custom_rate: 0,
      is_active: true,
    });
    try {
      await expect(
        db('contract_lines')
          .where({ tenant, contract_line_id: negativeLineId })
          .update({ custom_rate: -1 }),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await db('contract_lines').where({ tenant, contract_line_id: negativeLineId }).delete();
    }
  });

  it('resolves the effective line coverage window, anchors on the assignment, and honors is_active', async () => {
    const windowContractId = uuidv4();
    const windowLineId = uuidv4();
    const assignmentOnlyLineId = uuidv4();
    const contractEndLineId = uuidv4();
    const windowAssignmentId = uuidv4();
    await db('contracts').insert({
      tenant,
      contract_id: windowContractId,
      contract_name: 'Window contract',
      billing_frequency: 'monthly',
      is_active: true,
    });
    await db('contract_lines').insert([
      {
        tenant,
        contract_line_id: windowLineId,
        contract_line_name: 'Window line',
        contract_id: windowContractId,
        billing_frequency: 'monthly',
        contract_line_type: 'fixed',
        is_active: true,
        start_date: '2026-02-10',
        end_date: '2026-03-15',
      },
      {
        tenant,
        contract_line_id: assignmentOnlyLineId,
        contract_line_name: 'Assignment-only line',
        contract_id: windowContractId,
        billing_frequency: 'monthly',
        contract_line_type: 'fixed',
        is_active: true,
      },
      {
        tenant,
        contract_line_id: contractEndLineId,
        contract_line_name: 'Contract-end line',
        contract_id: windowContractId,
        billing_frequency: 'monthly',
        contract_line_type: 'fixed',
        is_active: true,
        start_date: '2026-01-01',
        // Ends exactly at the assignment end; both paths must stop together.
        end_date: '2026-12-31',
      },
    ]);
    await db('client_contracts').insert({
      tenant,
      client_contract_id: windowAssignmentId,
      client_id: clientId,
      contract_id: windowContractId,
      start_date: '2026-01-01T00:00:00.000Z',
      end_date: '2026-12-31T00:00:00.000Z',
      is_active: true,
    });

    try {
      const engine = new BillingEngine();
      (engine as any).knex = db;
      (engine as any).tenant = tenant;
      const period = { startDate: '2026-02-01', endDate: '2026-03-01' };
      const lines = await (engine as any).getClientContractLinesForBillingPeriod(clientId, period);
      const byLine = new Map(
        (lines as Array<Record<string, any>>).map((row) => [row.contract_line_id, row]),
      );

      const line = byLine.get(windowLineId);
      expect(line).toBeTruthy();
      // Anchor stays the assignment start; coverage narrows to the authored line.
      expect(line!.start_date).toBe('2026-01-01');
      expect(line!.coverage_start_date).toBe('2026-02-10');
      expect(line!.coverage_end_date).toBe('2026-03-15');
      // Inclusive display end is the day before the half-open line end.
      expect(line!.end_date).toBe('2026-03-14');

      // Assignment-only and line-ending-at-contract-end both stop at the same
      // half-open boundary the materializer uses.
      for (const id of [assignmentOnlyLineId, contractEndLineId]) {
        const row = byLine.get(id);
        expect(row).toBeTruthy();
        expect(row!.coverage_end_date).toBe('2026-12-31');
        expect(row!.end_date).toBe('2026-12-30');
      }

      await db('contract_lines')
        .where({ tenant, contract_line_id: windowLineId })
        .update({ is_active: false });
      const inactiveLines = await (engine as any).getClientContractLinesForBillingPeriod(clientId, period);
      expect(
        (inactiveLines as Array<Record<string, any>>).find((row) => row.contract_line_id === windowLineId),
      ).toBeUndefined();
    } finally {
      await db('client_contracts').where({ tenant, client_contract_id: windowAssignmentId }).delete();
      await db('contract_lines').where({ tenant, contract_line_id: contractEndLineId }).delete();
      await db('contract_lines').where({ tenant, contract_line_id: assignmentOnlyLineId }).delete();
      await db('contract_lines').where({ tenant, contract_line_id: windowLineId }).delete();
      await db('contracts').where({ tenant, contract_id: windowContractId }).delete();
    }
  });
});

describe('invoice adjustment editability (DB-backed)', () => {
  async function insertInvoice(
    status: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const invoiceId = uuidv4();
    await db('invoices').insert({
      tenant,
      invoice_id: invoiceId,
      invoice_number: `EDIT-${invoiceId.slice(0, 8)}`,
      invoice_date: '2026-09-01T00:00:00.000Z',
      due_date: '2026-09-30T00:00:00.000Z',
      total_amount: 0,
      status,
      client_id: clientId,
      currency_code: 'USD',
      is_manual: true,
      ...overrides,
    });
    return invoiceId;
  }

  it('allows a plain draft', async () => {
    const invoiceId = await insertInvoice('draft');
    const { capability } = await inspectInvoiceEditable(db, tenant, invoiceId);
    expect(capability.editable).toBe(true);
    expect(capability.code).toBeNull();
  });

  it.each(['paid', 'cancelled'])('blocks a %s invoice', async (status) => {
    const invoiceId = await insertInvoice(status);
    const { capability } = await inspectInvoiceEditable(db, tenant, invoiceId);
    expect(capability.editable).toBe(false);
    expect(capability.code).toBe(status);
    expect(capability.reason).toBeTruthy();
  });

  it('blocks a finalized invoice', async () => {
    const invoiceId = await insertInvoice('draft', {
      finalized_at: '2026-09-15T00:00:00.000Z',
    });
    const { capability } = await inspectInvoiceEditable(db, tenant, invoiceId);
    expect(capability.editable).toBe(false);
    expect(capability.code).toBe('finalized');
  });

  it('blocks an invoice posted to an accounting system', async () => {
    const invoiceId = await insertInvoice('draft');
    await db('tenant_external_entity_mappings').insert({
      tenant,
      integration_type: 'quickbooks_online',
      alga_entity_type: 'invoice',
      alga_entity_id: invoiceId,
      external_entity_id: `QBO-${invoiceId.slice(0, 8)}`,
    });

    const { capability } = await inspectInvoiceEditable(db, tenant, invoiceId);
    expect(capability.editable).toBe(false);
    expect(capability.code).toBe('exported');
  });

  it('blocks a Xero mapping and delivered CSV batch evidence but ignores failed/cancelled batch membership', async () => {
    const xeroInvoice = await insertInvoice('draft');
    await db('tenant_external_entity_mappings').insert({
      tenant, integration_type: 'xero', alga_entity_type: 'invoice', alga_entity_id: xeroInvoice,
      external_entity_id: `XERO-${xeroInvoice.slice(0, 8)}`,
    });
    expect((await inspectInvoiceEditable(db, tenant, xeroInvoice)).capability.code).toBe('exported');

    const { updateInvoiceManualItems } = await import('../actions/invoiceModification');
    const assertWriterLocked = async (invoiceId: string) => {
      const before = await db('invoices').where({ tenant, invoice_id: invoiceId }).first('subtotal', 'total_amount', 'draft_adjustment_revision');
      const chargeRows = await db('invoice_charges').where({ tenant, invoice_id: invoiceId }).orderBy('item_id');
      const ledgerRows = await db('transactions').where({ tenant, invoice_id: invoiceId }).orderBy('transaction_id');
      const result = await updateInvoiceManualItems(invoiceId, {
        newItems: [{ item_id: uuidv4(), description: 'Should be rejected', quantity: 1, rate: 500 } as any],
        updatedItems: [], removedItemIds: [],
      }, { operationId: uuidv4(), expectedRevision: 0 });
      expect(result).not.toMatchObject({ invoice_id: invoiceId });
      expect(await db('invoices').where({ tenant, invoice_id: invoiceId }).first('subtotal', 'total_amount', 'draft_adjustment_revision')).toEqual(before);
      expect(await db('invoice_charges').where({ tenant, invoice_id: invoiceId }).orderBy('item_id')).toEqual(chargeRows);
      expect(await db('transactions').where({ tenant, invoice_id: invoiceId }).orderBy('transaction_id')).toEqual(ledgerRows);
    };
    await assertWriterLocked(xeroInvoice);

    const failedInvoice = await insertInvoice('draft');
    const failedBatch = uuidv4();
    const failedLine = uuidv4();
    await db('accounting_export_batches').insert({ tenant, batch_id: failedBatch, adapter_type: 'xero_csv', export_type: 'invoice', status: 'failed' });
    await db('accounting_export_lines').insert({ tenant, batch_id: failedBatch, line_id: failedLine, document_id: failedInvoice, amount_cents: 100, currency_code: 'USD', status: 'failed' });
    expect((await inspectInvoiceEditable(db, tenant, failedInvoice)).capability.editable).toBe(true);
    await db('accounting_export_batches').where({ tenant, batch_id: failedBatch }).update({ status: 'cancelled' });
    expect((await inspectInvoiceEditable(db, tenant, failedInvoice)).capability.editable).toBe(true);

    const deliveredInvoice = await insertInvoice('draft');
    const deliveredBatch = uuidv4();
    const deliveredLine = uuidv4();
    await db('accounting_export_batches').insert({ tenant, batch_id: deliveredBatch, adapter_type: 'quickbooks_csv', export_type: 'invoice', status: 'delivered' });
    await db('accounting_export_lines').insert({ tenant, batch_id: deliveredBatch, line_id: deliveredLine, document_id: deliveredInvoice, amount_cents: 100, currency_code: 'USD', status: 'delivered' });
    const locked = await inspectInvoiceEditable(db, tenant, deliveredInvoice);
    expect(locked.capability).toMatchObject({ editable: false, code: 'exported' });
    await assertWriterLocked(deliveredInvoice);
  });

  it('reports not_found for an unknown invoice', async () => {
    const { invoice, capability } = await inspectInvoiceEditable(db, tenant, uuidv4());
    expect(invoice).toBeNull();
    expect(capability.editable).toBe(false);
    expect(capability.code).toBe('not_found');
  });
});

describe('accounting adjustment export matrix', () => {
  it('reloads multiple delivered artifacts byte-for-byte and rejects a foreign-tenant artifact id', async () => {
    const batchId = uuidv4();
    const artifactIds = [uuidv4(), uuidv4()];
    const contents = [Buffer.from('Amount,Description\r\n-4.05,discount\r\n', 'utf8'), Buffer.from('TRNS\tINV\tINVOICE\t-4.05\r\n', 'utf8')];
    await db('accounting_export_batches').insert({ tenant, batch_id: batchId, adapter_type: 'quickbooks_desktop', export_type: 'invoice', status: 'delivered' });
    await db('accounting_export_artifacts').insert(artifactIds.map((artifact_id, index) => ({
      tenant, artifact_id, batch_id: batchId, file_id: null,
      filename: index ? 'export.iif' : 'export.csv', content_type: index ? 'text/plain' : 'text/csv',
      content: contents[index], storage_fallback: true,
    })));
    const foreignTenant = uuidv4();
    await db('accounting_export_batches').insert({ tenant: foreignTenant, batch_id: batchId, adapter_type: 'quickbooks_desktop', export_type: 'invoice', status: 'delivered' });
    await db('accounting_export_artifacts').insert({
      tenant: foreignTenant, artifact_id: uuidv4(), batch_id: batchId, file_id: null,
      filename: 'private.iif', content_type: 'text/plain', content: Buffer.from('private'), storage_fallback: true,
    });

    const { getAccountingExportBatch, downloadAccountingExportArtifact } = await import('../actions/accountingExportActions');
    const detail = await getAccountingExportBatch(batchId) as any;
    expect(detail.artifacts.map((artifact: any) => artifact.filename)).toEqual(['export.csv', 'export.iif']);
    for (let index = 0; index < artifactIds.length; index += 1) {
      const downloaded = await downloadAccountingExportArtifact(batchId, artifactIds[index]) as any;
      expect(Buffer.from(downloaded.contentBase64, 'base64')).toEqual(contents[index]);
    }
    const foreignArtifactId = await db('accounting_export_artifacts').where({ tenant: foreignTenant, batch_id: batchId }).first('artifact_id');
    const unavailable = await downloadAccountingExportArtifact(batchId, foreignArtifactId.artifact_id) as any;
    expect(unavailable).toMatchObject({ success: false });
    await expect(db('accounting_export_artifacts').insert({
      tenant, artifact_id: uuidv4(), batch_id: batchId, file_id: null,
      filename: 'export.csv', content_type: 'text/csv', content: contents[0], storage_fallback: true,
    })).rejects.toThrow();
  });

  it('downloads from object storage first and falls back to the exact tenant-scoped byte backup', async () => {
    const batchId = uuidv4();
    const artifactId = uuidv4();
    const fileId = uuidv4();
    const backup = Buffer.from('Name,Amount\r\ncredit,-40.50\r\n', 'utf8');
    const primary = Buffer.from('Name,Amount\r\ncredit,-40.50\r\n', 'utf8');
    await db('accounting_export_batches').insert({ tenant, batch_id: batchId, adapter_type: 'quickbooks_csv', export_type: 'invoice', status: 'delivered' });
    await db('accounting_export_artifacts').insert({
      tenant, artifact_id: artifactId, batch_id: batchId, file_id: fileId, filename: 'stored.csv',
      content_type: 'text/csv', content: backup, storage_fallback: false,
    });

    const { StorageService } = await import('@alga-psa/storage/StorageService');
    const download = vi.spyOn(StorageService, 'downloadFile');
    const { downloadAccountingExportArtifact } = await import('../actions/accountingExportActions');
    download.mockResolvedValueOnce({ buffer: primary } as any);
    const normal = await downloadAccountingExportArtifact(batchId, artifactId) as any;
    expect(Buffer.from(normal.contentBase64, 'base64')).toEqual(primary);

    download.mockRejectedValueOnce(new Error('object store unavailable'));
    const fallback = await downloadAccountingExportArtifact(batchId, artifactId) as any;
    expect(Buffer.from(fallback.contentBase64, 'base64')).toEqual(backup);
    expect(download).toHaveBeenCalledWith(fileId);
    download.mockRestore();
  });

  it('seeds miscellaneous service idempotently and validates the effective edited row', async () => {
    const { ensureMiscellaneousService } = await import('@alga-psa/db');
    const id = await ensureMiscellaneousService(db, tenant);
    await db('service_catalog').where({ tenant, service_id: id }).update({ service_name: 'Renamed one-time service' });
    expect(await ensureMiscellaneousService(db, tenant)).toBe(id);
    expect((await db('service_catalog').where({ tenant, service_id: id }).first()).service_name).toBe('Renamed one-time service');
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const { updateInvoiceManualItems } = await import('../actions/invoiceModification');
    const itemId = uuidv4();
    expect(await updateInvoiceManualItems(fixture.invoiceId, { newItems: [{ item_id: itemId, service_id: id, description: 'Misc charge', rate: 1000, quantity: 1 } as any], updatedItems: [], removedItemIds: [] })).toMatchObject({ invoice_id: fixture.invoiceId });
    expect(await updateInvoiceManualItems(fixture.invoiceId, { newItems: [], updatedItems: [{ item_id: itemId, description: 'Description-only patch' }], removedItemIds: [] })).toMatchObject({ invoice_id: fixture.invoiceId });
    expect(await updateInvoiceManualItems(fixture.invoiceId, { newItems: [], updatedItems: [{ item_id: itemId, service_id: uuidv4() }], removedItemIds: [] })).toMatchObject({ success: false, code: 'SERVICE_NOT_FOUND' });
    await db('invoice_charges').where({ tenant, item_id: itemId }).update({ service_id: null });
    expect(await updateInvoiceManualItems(fixture.invoiceId, { newItems: [], updatedItems: [{ item_id: itemId, description: 'Legacy edit' }], removedItemIds: [] })).toMatchObject({ success: false, code: 'SERVICE_REQUIRED' });
    expect((await db('invoice_charges').where({ tenant, item_id: itemId }).first()).description).toBe('Description-only patch');
    // A legacy serviceless charge may become an explicit quantity-derived credit.
    expect(await updateInvoiceManualItems(fixture.invoiceId, { newItems: [], updatedItems: [{ item_id: itemId, quantity: 3, rate: -33 }], removedItemIds: [] })).toMatchObject({ invoice_id: fixture.invoiceId });
    const credit = await db('invoice_charges').where({ tenant, item_id: itemId }).first();
    expect(credit).toMatchObject({ service_id: null, is_discount: true, is_manual_credit: true });
    expect(Number(credit.net_amount)).toBe(-99);
    expect(await updateInvoiceManualItems(fixture.invoiceId, { newItems: [], updatedItems: [{ item_id: itemId, description: 'Credit description only' }], removedItemIds: [] })).toMatchObject({ invoice_id: fixture.invoiceId });
    expect(Number((await db('invoice_charges').where({ tenant, item_id: itemId }).first()).net_amount)).toBe(-99);
  });

  it.each(['quickbooks_online', 'xero', 'quickbooks_csv', 'xero_csv', 'quickbooks_desktop'])('serializes manual/automatic discounts, credits and misc charges for %s', async (adapterType) => {
    const { ensureMiscellaneousService } = await import('@alga-psa/db');
    const miscId = await ensureMiscellaneousService(db, tenant);
    await db('discounts').where({ tenant, discount_id: configuredDiscountId }).update({ is_active: true });
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).update({ invoice_number: `REVIEW-CONTRACT-3499-${adapterType}`, tax_source: 'internal' });
    await db.transaction(trx => persistManualInvoiceCharges(trx, fixture.invoiceId, [
      { service_id: miscId, description: 'Miscellaneous charge', quantity: 3, rate: 5000, tax_rate_id: null },
      { description: 'Manual fixed discount', quantity: 3, rate: 101, is_discount: true, discount_type: 'fixed' },
      { description: 'Manual percentage discount', quantity: 1, rate: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10 },
      { description: 'Manual credit', quantity: 3, rate: -33 },
    ], { client_id: clientId, region_code: null, default_currency_code: 'USD' }, { user: { id: userId } } as never, tenant));
    await db.transaction(trx => reconcileAutomaticInvoiceAdjustments(trx, tenant, fixture.invoiceId));
    const realm = ['xero', 'quickbooks_online'].includes(adapterType) ? 'test-realm' : null;
    for (const [kind, local, external] of [['service', miscId, 'MISC'], ['service', serviceId, 'RECURRING'], ['discount', 'invoice_discount', 'DISCOUNT'], ['client', clientId, 'CUSTOMER']]) {
      await db('tenant_external_entity_mappings').where({ tenant, integration_type: adapterType, alga_entity_type: kind, alga_entity_id: local }).delete();
      await db('tenant_external_entity_mappings').insert({ tenant, integration_type: adapterType, alga_entity_type: kind, alga_entity_id: local,
        external_entity_id: external, external_realm_id: realm, sync_status: 'manual_link', metadata: JSON.stringify({ xeroTargetKind: 'account', accountCode: external }) });
    }
    // The fixed-plan parent is intentionally serviceless. Export its canonical
    // allocated children exactly once while preserving the batch parent identity.
    await db('invoice_charges').where({ tenant, item_id: fixture.generatedChargeId }).update({ service_id: null });
    for (const service of [serviceId, miscId]) {
      const detailId = uuidv4();
      const configId = uuidv4();
      await db('contract_line_service_configuration').insert({ tenant, config_id: configId, contract_line_id: contractLineId, service_id: service, configuration_type: 'Fixed', quantity: 1 });
      await db('invoice_charge_details').insert({ tenant, item_detail_id: detailId, item_id: fixture.generatedChargeId, service_id: service, config_id: configId, quantity: 1, rate: 195000 });
      await db('invoice_charge_fixed_details').insert({ tenant, item_detail_id: detailId, base_rate: 195000, allocated_amount: 195000, tax_amount: 0, enable_proration: false, fmv: 195000, proportion: 0.5 });
    }
    const charges = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId }).orderBy('description');
    const context: any = { batch: { tenant, batch_id: uuidv4(), adapter_type: adapterType, target_realm: realm, export_type: 'invoice', created_at: '2026-09-01' },
      lines: charges.map(charge => ({ tenant, line_id: uuidv4(), document_id: fixture.invoiceId, document_line_id: charge.item_id,
        client_id: clientId, amount_cents: Number(charge.total_price), currency_code: 'USD', payload: { service_period_source: 'financial_document_fallback' } })), taxDelegationMode: 'internal' };
    const adapter = adapterType === 'quickbooks_online' ? new (await import('../adapters/accounting/quickBooksOnlineAdapter')).QuickBooksOnlineAdapter()
      : adapterType === 'xero' ? new (await import('../adapters/accounting/xeroAdapter')).XeroAdapter()
      : adapterType === 'quickbooks_csv' ? new (await import('../adapters/accounting/quickBooksCSVAdapter')).QuickBooksCSVAdapter()
      : adapterType === 'xero_csv' ? new (await import('../adapters/accounting/xeroCsvAdapter')).XeroCsvAdapter()
      : new (await import('../adapters/accounting/quickBooksDesktopAdapter')).QuickBooksDesktopAdapter();
    const transformed = await adapter.transform(context);
    if (adapterType === 'quickbooks_csv') {
      const delivery = await adapter.deliver(transformed, context);
      expect(delivery.failedDocuments).toBeUndefined();
      transformed.files = (delivery.metadata as any).files;
    }
    const net = charges.reduce((sum, charge) => sum + Number(charge.net_amount), 0);
    let evidence: unknown = transformed;
    if (adapterType === 'quickbooks_online') {
      const invoice = (transformed.documents[0].payload as any).invoice;
      expect(invoice.Line.filter((line: any) => line.DetailType === 'DiscountLineDetail')).toHaveLength(4);
      expect(Math.round(invoice.Line.reduce((sum: number, line: any) => sum + (line.DetailType === 'DiscountLineDetail' ? -line.Amount : line.Amount), 0) * 100)).toBe(net);
      expect(invoice.Line.filter((line: any) => line.DetailType === 'DiscountLineDetail').every((line: any) => line.DiscountLineDetail.DiscountAccountRef.value === 'DISCOUNT')).toBe(true);
      expect(invoice.Line.filter((line: any) => line.DetailType === 'SalesItemLineDetail')).toHaveLength(3);
      evidence = invoice;
    } else if (adapterType === 'xero') {
      const { XeroClientService } = await import('@alga-psa/integrations/lib/xero/xeroClientService');
      const client = new (XeroClientService as any)(tenant, { scope: 'accounting.invoices', connectionId: 'mock' }, {}, {});
      const request = vi.spyOn(client, 'request').mockResolvedValue({ Invoices: [{ InvoiceID: 'mock-export' }] });
      await client.createInvoices([(transformed.documents[0].payload as any).invoice]);
      const serialized = (request.mock.calls[0][0] as any).data.Invoices[0];
      expect(serialized.LineItems.filter((line: any) => line.AccountCode === 'DISCOUNT')).toHaveLength(4);
      for (const line of serialized.LineItems) expect(Math.round(line.Quantity * line.UnitAmount * 100)).toBe(Math.round(line.LineAmount * 100));
      expect(Math.round(serialized.LineItems.reduce((sum: number, line: any) => sum + line.LineAmount, 0) * 100)).toBe(net);
      evidence = { transport: 'mocked Xero request; no external write', request: serialized };
    } else {
      const content = String(transformed.files?.[0]?.content);
      expect(content).toContain('DISCOUNT'); expect(content).toContain('MISC'); expect(content).toContain('Manual percentage discount');
      if (adapterType === 'quickbooks_desktop') {
        const rows = content.split('\n').filter(row => /^(TRNS|SPL)\t/.test(row));
        expect(Math.round(rows.reduce((sum, row) => sum + Number(row.split('\t')[6]), 0) * 100)).toBe(0);
        expect(Number(rows[0].split('\t')[6]) * 100).toBeCloseTo(net);
      } else {
        const { parseCSV } = await import('@alga-psa/core');
        const rows = parseCSV(content, { header: true });
        const quantityKey = adapterType === 'xero_csv' ? '*Quantity' : '*ItemQuantity';
        const rateKey = adapterType === 'xero_csv' ? '*UnitAmount' : '*ItemRate';
        expect(Math.round(rows.reduce((sum: number, row: any) => sum + Number(row[quantityKey]) * Number(row[rateKey]), 0) * 100)).toBe(net);
      }
    }
    await db('tenant_external_entity_mappings').where({ tenant, integration_type: adapterType, alga_entity_type: 'discount', alga_entity_id: 'invoice_discount' }).delete();
    await expect(adapter.transform(context)).rejects.toThrow(/discount.*mapping/i);
    if (process.env.ACCOUNTING_EVIDENCE_DIR) {
      const fs = await import('node:fs/promises');
      await fs.mkdir(process.env.ACCOUNTING_EVIDENCE_DIR, { recursive: true });
      await fs.writeFile(`${process.env.ACCOUNTING_EVIDENCE_DIR}/${adapterType}.json`, JSON.stringify(evidence, null, 2));
      for (const file of transformed.files ?? []) await fs.writeFile(`${process.env.ACCOUNTING_EVIDENCE_DIR}/${adapterType}.${adapterType === 'quickbooks_desktop' ? 'iif' : 'csv'}`, String(file.content));
    }
  });

  it.each([
    { adapterType: 'quickbooks_online', legacyLineage: false },
    { adapterType: 'xero', legacyLineage: false },
    { adapterType: 'quickbooks_online', legacyLineage: true },
    { adapterType: 'xero', legacyLineage: true },
  ])('round-trips fixed allocation tax through $adapterType (legacy lineage: $legacyLineage)', async ({ adapterType, legacyLineage }) => {
    const { ensureMiscellaneousService } = await import('@alga-psa/db');
    const { ExternalTaxImportService } = await import('./externalTaxImportService');
    const miscId = await ensureMiscellaneousService(db, tenant);
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const externalRef = `TAX-${adapterType}-${fixture.invoiceId.slice(0, 8)}`;
    const realm = 'contract-tax-roundtrip-realm';
    const allocationDetailIds = [uuidv4(), uuidv4()];
    const configIds = [uuidv4(), uuidv4()];
    const internalTax = 110; // cents: 100 on the fixed parent, 10 on the manual charge

    await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).update({
      tax_source: 'pending_external', subtotal: 366000, tax: internalTax, total_amount: 366000 + internalTax,
    });
    await db('invoice_charges').where({ tenant, item_id: fixture.generatedChargeId }).update({
      service_id: null, tax_amount: 100, total_price: 390100,
    });
    await db('invoice_charges').where({ tenant, item_id: fixture.automaticDiscountItemId }).update({
      service_id: null, tax_amount: 0,
    });
    await db.transaction(trx => persistManualInvoiceCharges(trx, fixture.invoiceId, [
      { service_id: miscId, description: 'Round-trip manual charge', quantity: 1, rate: 15000, tax_rate_id: null },
    ], { client_id: clientId, region_code: null, default_currency_code: 'USD' }, { user: { id: userId } } as never, tenant));
    const manualCharge = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId, description: 'Round-trip manual charge' }).first();
    await db('invoice_charges').where({ tenant, item_id: manualCharge.item_id }).update({ tax_amount: 10, total_price: Number(manualCharge.net_amount) + 10 });
    await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).update({ subtotal: 366000, tax: internalTax, total_amount: 366000 + internalTax });
    await db('contract_line_service_configuration').insert([
      { tenant, config_id: configIds[0], contract_line_id: contractLineId, service_id: serviceId, configuration_type: 'Fixed', quantity: 1 },
      { tenant, config_id: configIds[1], contract_line_id: contractLineId, service_id: miscId, configuration_type: 'Fixed', quantity: 1 },
    ]);
    await db('invoice_charge_details').insert([
      { tenant, item_detail_id: allocationDetailIds[0], item_id: fixture.generatedChargeId, service_id: serviceId, config_id: configIds[0], quantity: 1, rate: 195000 },
      { tenant, item_detail_id: allocationDetailIds[1], item_id: fixture.generatedChargeId, service_id: miscId, config_id: configIds[1], quantity: 1, rate: 195000 },
    ]);
    await db('invoice_charge_fixed_details').insert([
      { tenant, item_detail_id: allocationDetailIds[0], base_rate: 195000, allocated_amount: 195000, tax_amount: 40, enable_proration: false, fmv: 195000, proportion: 0.5 },
      { tenant, item_detail_id: allocationDetailIds[1], base_rate: 195000, allocated_amount: 195000, tax_amount: 60, enable_proration: false, fmv: 195000, proportion: 0.5 },
    ]);

    for (const [kind, local, external] of [
      ['service', serviceId, 'RECURRING'], ['service', miscId, 'MISC'],
      ['discount', 'invoice_discount', 'DISCOUNT'], ['client', clientId, 'CUSTOMER'],
    ]) {
      await db('tenant_external_entity_mappings').where({ tenant, integration_type: adapterType, alga_entity_type: kind, alga_entity_id: local, external_realm_id: realm }).delete();
      await db('tenant_external_entity_mappings').insert({ tenant, integration_type: adapterType, alga_entity_type: kind, alga_entity_id: local,
        external_entity_id: external, external_realm_id: realm, sync_status: 'manual_link', metadata: JSON.stringify({ accountCode: external, xeroTargetKind: 'account' }) });
    }

    const adapter = adapterType === 'quickbooks_online'
      ? new (await import('../adapters/accounting/quickBooksOnlineAdapter')).QuickBooksOnlineAdapter()
      : new (await import('../adapters/accounting/xeroAdapter')).XeroAdapter();
    const makeContext = async () => {
      const invoiceCharges = await db('invoice_charges').where({ tenant, invoice_id: fixture.invoiceId }).orderBy('created_at').orderBy('item_id');
      return { batch: { tenant, batch_id: uuidv4(), adapter_type: adapterType, target_realm: realm, export_type: 'invoice', created_at: '2026-09-01' },
        lines: invoiceCharges.map(charge => ({ tenant, line_id: uuidv4(), document_id: fixture.invoiceId, document_line_id: charge.item_id,
          client_id: clientId, amount_cents: Number(charge.total_price), currency_code: 'USD', payload: { service_period_source: 'financial_document_fallback' } })),
        taxDelegationMode: 'delegate' } as any;
    };
    const context = await makeContext();
    const transformed = await adapter.transform(context);
    let qboProviderInvoice: any;
    let xeroProviderInvoice: any;
    let qboFetchedLineage: Array<{ lineId: string; parentChargeId?: string; allocationDetailId?: string }> = [];

    if (adapterType === 'quickbooks_online') {
      const { QboClientService } = await import('@alga-psa/integrations/lib/qbo/qboClientService');
      const qboClient = {
        create: vi.fn(async (_entity: string, payload: any) => {
          qboProviderInvoice = { ...payload, Id: externalRef, SyncToken: '1', TotalAmt: 3664.35, TxnTaxDetail: { TotalTax: 4.35 },
            Line: payload.Line.map((line: any, index: number) => ({ ...line, Id: `qbo-line-${index}` })) };
          return qboProviderInvoice;
        }),
        read: vi.fn(async () => qboProviderInvoice),
        update: vi.fn(async (_entity: string, payload: any) => {
          qboProviderInvoice = { ...qboProviderInvoice, ...payload, SyncToken: '2',
            TotalAmt: 3664.35, TxnTaxDetail: { TotalTax: 4.35 },
            Line: payload.Line.map((line: any, index: number) => ({ ...line, Id: `qbo-line-${index}` })) };
          return qboProviderInvoice;
        }),
      };
      vi.spyOn(QboClientService, 'create').mockResolvedValue(qboClient as any);
      await adapter.deliver(transformed, context);
      const mapping = await db('tenant_external_entity_mappings').where({ tenant, integration_type: adapterType, alga_entity_type: 'invoice', alga_entity_id: fixture.invoiceId }).first();
      const persistedLines = mapping.metadata.chargeLineMappings;
      const parentMappings = persistedLines.filter((line: any) => line.parentChargeId === fixture.generatedChargeId);
      expect(parentMappings.map((line: any) => line.chargeId).sort()).toEqual([...allocationDetailIds].sort());
      expect(parentMappings.map((line: any) => line.allocationDetailId).sort()).toEqual([...allocationDetailIds].sort());
      if (adapterType === 'quickbooks_online') {
        const fetched = await adapter.fetchExternalInvoice(externalRef, realm);
        expect(fetched.success).toBe(true);
        const fetchedParentLines = fetched.invoice!.charges.filter((line: any) => line.parentChargeId === fixture.generatedChargeId);
        expect(fetchedParentLines.map((line: any) => line.lineId).sort()).toEqual([...allocationDetailIds].sort());
        expect(fetchedParentLines.map((line: any) => line.allocationDetailId).sort()).toEqual([...allocationDetailIds].sort());
        qboFetchedLineage = fetchedParentLines.map((line: any) => ({
          lineId: line.lineId, parentChargeId: line.parentChargeId, allocationDetailId: line.allocationDetailId,
        }));
      }
    } else {
      const { XeroClientService } = await import('@alga-psa/integrations/lib/xero/xeroClientService');
      const xeroPayload = (transformed.documents[0].payload as any);
      const fakeClient = {
        createInvoices: vi.fn(async (payloads: any[]) => {
          const payload = payloads[0];
          const lineItems = payload.lines.map((_line: any, index: number) => ({ LineItemID: `xero-line-${index}` }));
          xeroProviderInvoice = {
            invoiceId: externalRef, invoiceNumber: externalRef, status: 'AUTHORISED', currencyCode: 'USD', total: 366435,
            totalTax: 435, subTotal: 366000, lineItems: payload.lines.map((line: any, index: number) => ({
              lineItemId: lineItems[index].LineItemID, lineAmount: line.amountCents,
              taxAmount: xeroPayload.chargeLineage[index]?.allocationDetailId === allocationDetailIds[0] ? 200
                : xeroPayload.chargeLineage[index]?.allocationDetailId === allocationDetailIds[1] ? 210
                  : xeroPayload.chargeIds[index] === manualCharge.item_id ? 25 : 0,
              taxType: 'OUTPUT',
            })),
          };
          return [{ status: 'success', invoiceId: externalRef, documentId: payload.invoiceId,
            raw: { InvoiceID: externalRef, InvoiceNumber: externalRef, Total: 3664.35, LineItems: lineItems } }];
        }),
        getInvoice: vi.fn(async () => xeroProviderInvoice),
      };
      vi.spyOn(XeroClientService, 'create').mockResolvedValue(fakeClient as any);
      await adapter.deliver(transformed, context);
      const mapping = await db('tenant_external_entity_mappings').where({ tenant, integration_type: adapterType, alga_entity_type: 'invoice', alga_entity_id: fixture.invoiceId }).first();
      const persistedLines = mapping.metadata.chargeLineMappings;
      const parentMappings = persistedLines.filter((line: any) => line.parentChargeId === fixture.generatedChargeId);
      expect(parentMappings.map((line: any) => line.chargeId).sort()).toEqual([...allocationDetailIds].sort());
      expect(parentMappings.map((line: any) => line.allocationDetailId).sort()).toEqual([...allocationDetailIds].sort());
    }

    if (legacyLineage) {
      // Pre-lineage exports stored the detail UUID as chargeId. Recover both
      // children from canonical details, without taxing the discount again.
      const query = () => db('tenant_external_entity_mappings').where({ tenant,
        integration_type: adapterType, alga_entity_type: 'invoice', alga_entity_id: fixture.invoiceId });
      const mapping = await query().first();
      await query().update({ metadata: JSON.stringify({ ...mapping.metadata,
        chargeLineMappings: mapping.metadata.chargeLineMappings.map(({ parentChargeId, allocationDetailId, ...line }: any) => line),
      }) });
    }

    const fetchedForImport = await adapter.fetchExternalInvoice(externalRef, realm);
    expect(fetchedForImport.success).toBe(true);
    const allocationTaxes = fetchedForImport.invoice!.charges.filter(line => allocationDetailIds.includes(line.lineId));
    expect(allocationTaxes).toHaveLength(2);
    if (legacyLineage) {
      expect(allocationTaxes.every(line => line.parentChargeId === undefined && line.allocationDetailId === undefined)).toBe(true);
    }

    const importer = new ExternalTaxImportService();
    const importResult = await importer.importTaxForInvoice(fixture.invoiceId, userId);
    expect(importResult).toMatchObject({ success: true, originalTax: internalTax, importedTax: 435, difference: 325 });
    const parent = await db('invoice_charges').where({ tenant, item_id: fixture.generatedChargeId }).first();
    const manual = await db('invoice_charges').where({ tenant, item_id: manualCharge.item_id }).first();
    const discount = await db('invoice_charges').where({ tenant, item_id: fixture.automaticDiscountItemId }).first();
    const invoiceAfterImport = await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).first();
    expect(Number(parent.external_tax_amount)).toBe(adapterType === 'xero' ? 410 : 418);
    expect(Number(manual.external_tax_amount)).toBe(adapterType === 'xero' ? 25 : 17);
    expect(Number(discount.external_tax_amount ?? discount.tax_amount)).toBe(0);
    expect(Number(invoiceAfterImport.total_amount)).toBe(366435);
    expect(invoiceAfterImport.tax_source).toBe('external');

    const repeated = await importer.importTaxForInvoice(fixture.invoiceId, userId);
    expect(repeated).toMatchObject({ success: false, importedTax: 0 });
    expect(Number((await db('invoice_charges').where({ tenant, item_id: fixture.generatedChargeId }).first()).external_tax_amount)).toBe(adapterType === 'xero' ? 410 : 418);
    expect(Number((await db('invoices').where({ tenant, invoice_id: fixture.invoiceId }).first()).total_amount)).toBe(366435);
    expect(await db('external_tax_imports').where({ tenant, invoice_id: fixture.invoiceId }).count('* as count').first().then((row: any) => Number(row.count))).toBe(1);

    const updateContext = await makeContext();
    const updateTransform = await adapter.transform(updateContext);
    if (adapterType === 'xero') {
      const updatePayload = updateTransform.documents[0].payload as any;
      const mapping = await db('tenant_external_entity_mappings').where({ tenant, integration_type: adapterType, alga_entity_type: 'invoice', alga_entity_id: fixture.invoiceId }).first();
      for (const line of mapping.metadata.chargeLineMappings.filter((entry: any) => entry.parentChargeId === fixture.generatedChargeId)) {
        const index = updatePayload.chargeIds.indexOf(line.chargeId);
        expect(updatePayload.invoice.lines[index].externalLineItemId).toBe(line.xeroLineItemId);
      }
    }
    await adapter.deliver(updateTransform, updateContext);
    const finalMapping = await db('tenant_external_entity_mappings').where({ tenant, integration_type: adapterType, alga_entity_type: 'invoice', alga_entity_id: fixture.invoiceId }).first();
    const finalParentMappings = finalMapping.metadata.chargeLineMappings.filter((line: any) => line.parentChargeId === fixture.generatedChargeId);
    expect(finalParentMappings.map((line: any) => line.chargeId).sort()).toEqual([...allocationDetailIds].sort());
    const finalProviderLineIds = adapterType === 'quickbooks_online'
      ? finalParentMappings.map((line: any) => line.qboLineId)
      : finalParentMappings.map((line: any) => line.xeroLineItemId);
    expect(finalProviderLineIds).toHaveLength(2);
    expect(new Set(finalProviderLineIds).size).toBe(2);
    expect(finalProviderLineIds.every((lineId: unknown) => typeof lineId === 'string' && lineId.length > 0)).toBe(true);
    if (process.env.ACCOUNTING_EVIDENCE_DIR) {
      const fs = await import('node:fs/promises');
      await fs.mkdir(process.env.ACCOUNTING_EVIDENCE_DIR, { recursive: true });
      await fs.writeFile(`${process.env.ACCOUNTING_EVIDENCE_DIR}/tax_roundtrip_${adapterType}${legacyLineage ? '_legacy' : ''}.json`, JSON.stringify({
        adapter: adapterType,
        provider: adapterType === 'quickbooks_online' ? 'mocked QBO response' : 'mocked Xero response',
        providerResponse: adapterType === 'quickbooks_online' ? qboProviderInvoice : xeroProviderInvoice,
        fetchedLineage: adapterType === 'quickbooks_online' ? qboFetchedLineage : undefined,
        legacyLineage,
        fetchedForImport: fetchedForImport.invoice!.charges,
        exportedParent: fixture.generatedChargeId,
        allocations: finalParentMappings,
        importResult,
        importedAmountsCents: {
          parentTax: Number(parent.external_tax_amount),
          manualChargeTax: Number(manual.external_tax_amount),
          discountTax: Number(discount.external_tax_amount ?? discount.tax_amount),
          invoiceSubtotal: Number(invoiceAfterImport.subtotal),
          invoiceTax: Number(invoiceAfterImport.tax),
          invoiceTotal: Number(invoiceAfterImport.total_amount),
        },
        repeatedImport: repeated,
        repeatImportCount: 1,
      }, null, 2));
    }
  });
});
