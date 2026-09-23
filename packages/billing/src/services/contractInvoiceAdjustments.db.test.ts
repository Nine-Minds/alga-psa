import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../actions/_dbTestUtils';
import { computePartialPeriodAmount } from '../lib/billing/compute/contractInvoiceAdjustments';
import { inspectInvoiceEditable } from './invoiceAdjustmentEditability';

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
let serviceId: string;
let userId: string;
let contractId: string;
let contractLineId: string;
let discountId: string;

async function seedContractDiscount(): Promise<void> {
  contractId = uuidv4();
  contractLineId = uuidv4();
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
    client_contract_id: uuidv4(),
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

async function createDraftWithGeneratedChargeAndDiscount(): Promise<InvoiceFixture> {
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
    currency_code: 'USD',
    is_manual: false,
    client_contract_id: uuidv4(),
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
    client_contract_id: contractId,
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

async function insertManualPartialPeriodCharge(params: {
  invoiceId: string;
  generatedChargeId: string;
  description?: string;
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
  const service = await db('service_catalog').where({ tenant }).first();
  const user = await db('users').where({ tenant }).first();
  clientId = client.client_id;
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

    const discountRows = await db('invoice_charges')
      .where({ tenant, invoice_id: fixture.invoiceId, adjustment_source_kind: 'discount' });
    expect(discountRows).toHaveLength(1);
    expect(Number(discountRows[0].net_amount)).toBe(-40_500);
    expect(discountRows[0].adjustment_source_id).toBe(discountId);
    expect(Number(discountRows[0].adjustment_base_amount)).toBe(405_000);

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

  it('leaves legacy automatic discount rows without provenance untouched', async () => {
    const fixture = await createDraftWithGeneratedChargeAndDiscount();
    const legacyItemId = uuidv4();
    await db('invoice_charges').insert({
      tenant,
      item_id: legacyItemId,
      invoice_id: fixture.invoiceId,
      description: 'Legacy manual discount',
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
