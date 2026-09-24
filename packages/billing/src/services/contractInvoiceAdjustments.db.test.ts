import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../actions/_dbTestUtils';
import { computePartialPeriodAmount } from '../lib/billing/compute/contractInvoiceAdjustments';
import { inspectInvoiceEditable } from './invoiceAdjustmentEditability';
import { BillingEngine } from '../lib/billing/billingEngine';

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

const {
  persistManualInvoiceCharges,
  reconcileAutomaticInvoiceDiscounts,
  reconcileAutomaticInvoiceAdjustments,
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
let discountId: string;
let defaultBillingProfileId: string;
let smokeLocationId: string;

async function seedContractDiscount(): Promise<void> {
  contractId = uuidv4();
  contractLineId = uuidv4();
  clientContractId = uuidv4();
  discountId = uuidv4();

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
    discount_id: discountId,
    discount_name: 'Loyalty 10%',
    discount_type: 'percentage',
    value: 0.1,
    start_date: '2026-01-01T00:00:00.000Z',
    end_date: null,
    is_active: true,
  });
  await db('contract_line_discounts').insert({
    tenant,
    discount_id: discountId,
    contract_line_id: contractLineId,
    client_id: clientId,
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
    adjustment_source_id: discountId,
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
          service_id: undefined,
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
  const service = await db('service_catalog').where({ tenant }).first();
  const user = await db('users').where({ tenant }).first();
  clientId = client.client_id;
  foreignClientId = foreignClient.client_id;
  serviceId = service.service_id;
  userId = user.user_id;

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
  await db?.destroy().catch(() => undefined);
});

describe('contract invoice adjustments (DB-backed)', () => {
  it('re-applies the invoice-wide discount over generated + manual charges and preserves the manual line', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const manual = await insertManualPartialPeriodCharge({
      invoiceId: fixture.invoiceId,
      generatedChargeId: fixture.generatedChargeId,
      locationId: smokeLocationId,
      billingProfileId: defaultBillingProfileId,
    });

    expect(manual.amount).toBe(15_000);

    await db.transaction(async (trx) => {
      await reconcileAutomaticInvoiceDiscounts(trx, tenant, fixture.invoiceId);
    });

    const manualRow = await db('invoice_charges')
      .where({ tenant, invoice_id: fixture.invoiceId, item_id: manual.itemId })
      .first();
    expect(Number(manualRow.net_amount)).toBe(15_000);
    expect(manualRow.is_manual).toBe(true);
    expect(manualRow.manual_line_metadata?.partialPeriod).toEqual({
      units: 3,
      unitPrice: 10_000,
      coveredDays: 15,
      fullPeriodDays: 30,
    });
    // Operator-chosen attribution survives the manual write, not just the
    // client-default fallback.
    expect(manualRow.location_id).toBe(smokeLocationId);
    expect(manualRow.billing_profile_id).toBe(defaultBillingProfileId);

    const discountRows = await db('invoice_charges')
      .where({ tenant, invoice_id: fixture.invoiceId, adjustment_source_kind: 'discount' });
    expect(discountRows).toHaveLength(1);
    expect(Number(discountRows[0].net_amount)).toBe(-40_500);
    expect(discountRows[0].adjustment_source_id).toBe(discountId);
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
    expect(discounts[0].adjustment_source_id).toBe(discountId);
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
            description: 'Extra manual charge',
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

  it('removes only its own automatic settlement when the source is deactivated', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const manual = await insertManualPartialPeriodCharge({
      invoiceId: fixture.invoiceId,
      generatedChargeId: fixture.generatedChargeId,
    });

    await db('discounts').where({ tenant, discount_id: discountId }).update({ is_active: false });
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
      await db('discounts').where({ tenant, discount_id: discountId }).update({ is_active: true });
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
              description: 'Charge on a foreign location',
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
              description: 'Charge on a foreign billing profile',
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
            description: 'Taxable freeform charge',
            quantity: 1,
            rate: 10_000,
            tax_rate_id: taxRateId,
            is_taxable: true,
          },
          {
            item_id: exemptItemId,
            description: 'Exempt freeform charge',
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
              description: 'Forged tax treatment',
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
    await db('discounts').where({ tenant, discount_id: discountId }).update({ is_active: false });
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
      await db('discounts').where({ tenant, discount_id: discountId }).update({ is_active: true });
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
    });

    // Disable the represented-contract discount so the only candidate is the
    // unrelated one; the invoice already carries a charge from clientContractId.
    await db('discounts').where({ tenant, discount_id: discountId }).update({ is_active: false });
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
      await db('discounts').where({ tenant, discount_id: discountId }).update({ is_active: true });
    }
  });

  it('excludes a discount linked only to an unbilled sibling contract line (detail-backed invoice)', async () => {
    // The only candidate should be the sibling-line discount.
    await db('discounts').where({ tenant, discount_id: discountId }).update({ is_active: false });

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
      await db('discounts').where({ tenant, discount_id: discountId }).update({ is_active: true });
    }
  });

  it('keeps a service-scoped, capped discount intact through tax and totals recalculation', async () => {
    // The plan's financial path: reconcile automatic settlements, then run the
    // shared tax/totals pass that calls recalculatePercentageDiscountInvoiceCharges.
    // Two 60% service-scoped discounts exceed the eligible base, so the second
    // is capped; an out-of-scope manual charge must never enter the base. A
    // legacy whole-invoice recalculation would overwrite both rows with 60% of
    // the 490000 subtotal and wipe the manual line.
    await db('discounts').where({ tenant, discount_id: discountId }).update({ is_active: false });
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
      await db('discounts').where({ tenant, discount_id: discountId }).update({ is_active: true });
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

  it('reports not_found for an unknown invoice', async () => {
    const { invoice, capability } = await inspectInvoiceEditable(db, tenant, uuidv4());
    expect(invoice).toBeNull();
    expect(capability.editable).toBe(false);
    expect(capability.code).toBe('not_found');
  });
});
