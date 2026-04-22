import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedTenantConnection = vi.hoisted(() => ({
  db: null as any,
  tenant: null as string | null,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => {
      if (!mockedTenantConnection.db || !mockedTenantConnection.tenant) {
        throw new Error('Mock tenant connection not initialized');
      }

      return {
        knex: mockedTenantConnection.db,
        tenant: mockedTenantConnection.tenant,
      };
    }),
  };
});

import { SharedNumberingService } from '@shared/services/numberingService';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestService } from '../../../../../test-utils/billingTestHelpers';
import Quote from '../../../../../../packages/billing/src/models/quote';
import QuoteItem from '../../../../../../packages/billing/src/models/quoteItem';
import {
  buildQuoteConversionPreview,
  convertQuoteToDraftContract,
  convertQuoteToDraftContractAndInvoice,
  convertQuoteToDraftInvoice,
} from '../../../../../../packages/billing/src/services/quoteConversionService';

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const QUOTE_DATE = '2026-03-10T00:00:00.000Z';
const VALID_UNTIL = '2026-03-25T00:00:00.000Z';
const ACCEPTED_AT = '2026-03-14T12:00:00.000Z';

type QuoteItemSpec = {
  description: string;
  quantity?: number;
  unit_price?: number;
  is_optional?: boolean;
  is_selected?: boolean;
  is_recurring?: boolean;
  billing_frequency?: string | null;
  billing_method?: 'fixed' | 'hourly' | 'usage' | 'per_unit';
  unit_of_measure?: string;
  is_discount?: boolean;
  discount_type?: 'percentage' | 'fixed' | null;
  discount_percentage?: number | null;
  applies_to_item_id?: string | null;
  applies_to_service_id?: string | null;
  is_taxable?: boolean;
  rawUpdates?: Record<string, unknown>;
};

describe('Quote conversion infrastructure', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    mockedTenantConnection.db = context.db;
    mockedTenantConnection.tenant = context.tenantId;
  }, 30000);

  afterEach(async () => {
    mockedTenantConnection.db = null;
    mockedTenantConnection.tenant = null;
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 120000);

  async function createAcceptedQuote(itemSpecs: QuoteItemSpec[], overrides: Partial<Record<string, unknown>> = {}) {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: (overrides.title as string) ?? 'Conversion-ready quote',
      description: (overrides.description as string) ?? 'Conversion scope',
      quote_date: QUOTE_DATE,
      valid_until: VALID_UNTIL,
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
      ...overrides,
    } as any);

    const createdItems = [] as any[];

    for (const spec of itemSpecs) {
      let serviceId: string | undefined;
      if (spec.is_recurring || spec.billing_method) {
        serviceId = await createTestService(context, {
          billing_method: spec.billing_method === 'per_unit' ? 'fixed' : (spec.billing_method as 'fixed' | 'hourly' | 'usage' | undefined) ?? 'fixed',
          default_rate: spec.unit_price ?? 1000,
          unit_of_measure: spec.unit_of_measure ?? 'each',
          service_name: `${spec.description} Service`,
        });
      }

      const createdItem = await QuoteItem.create(context.db, context.tenantId, {
        quote_id: quote.quote_id,
        service_id: serviceId,
        description: spec.description,
        quantity: spec.quantity ?? 1,
        unit_price: spec.unit_price ?? 1000,
        is_optional: spec.is_optional ?? false,
        is_selected: spec.is_selected ?? true,
        is_recurring: spec.is_recurring ?? false,
        billing_frequency: spec.billing_frequency ?? null,
        billing_method: spec.billing_method === 'per_unit' ? 'per_unit' : spec.billing_method,
        unit_of_measure: spec.unit_of_measure ?? null,
        is_discount: spec.is_discount ?? false,
        discount_type: spec.discount_type ?? null,
        discount_percentage: spec.discount_percentage ?? null,
        applies_to_item_id: spec.applies_to_item_id ?? null,
        applies_to_service_id: spec.applies_to_service_id ?? null,
        is_taxable: spec.is_taxable ?? true,
        created_by: context.userId,
      } as any);

      if (spec.rawUpdates) {
        await context.db('quote_items')
          .where({ tenant: context.tenantId, quote_item_id: createdItem.quote_item_id })
          .update(spec.rawUpdates);
      }

      createdItems.push({
        ...(await context.db('quote_items')
          .where({ tenant: context.tenantId, quote_item_id: createdItem.quote_item_id })
          .first()),
        service_id: serviceId ?? createdItem.service_id ?? null,
      });
    }

    await context.db('quotes')
      .where({ tenant: context.tenantId, quote_id: quote.quote_id })
      .update({
        status: 'accepted',
        accepted_at: ACCEPTED_AT,
        accepted_by: context.userId,
        updated_by: context.userId,
      });

    const acceptedQuote = await Quote.getById(context.db, context.tenantId, quote.quote_id);
    return {
      quote: acceptedQuote!,
      items: createdItems,
    };
  }

  it('T104: Quote→Contract creates a draft contract with the quote title and accepted date', async () => {
    const { quote } = await createAcceptedQuote([
      {
        description: 'Managed endpoints',
        quantity: 5,
        unit_price: 2500,
        is_recurring: true,
        billing_frequency: 'monthly',
        billing_method: 'fixed',
      },
    ], {
      title: 'Acme Managed Services',
    });

    const result = await context.db.transaction((trx) =>
      convertQuoteToDraftContract(trx, context.tenantId, quote.quote_id, context.userId)
    );

    const assignment = await context.db('client_contracts')
      .where({ tenant: context.tenantId, contract_id: result.contract.contract_id })
      .first();

    expect(result.contract.contract_name).toBe('Acme Managed Services');
    expect(result.contract.status).toBe('draft');
    expect(new Date(assignment.start_date).toISOString().startsWith('2026-03-14')).toBe(true);
  });

  it('T105: recurring fixed-price items create contract lines with fixed configs', async () => {
    const { quote } = await createAcceptedQuote([
      {
        description: 'Fixed support plan',
        quantity: 2,
        unit_price: 4500,
        is_recurring: true,
        billing_frequency: 'monthly',
        billing_method: 'fixed',
      },
    ]);

    const result = await context.db.transaction((trx) =>
      convertQuoteToDraftContract(trx, context.tenantId, quote.quote_id, context.userId)
    );

    const contractLine = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_id: result.contract.contract_id })
      .first();
    const configuration = await context.db('contract_line_service_configuration')
      .where({ tenant: context.tenantId, contract_line_id: contractLine.contract_line_id })
      .first();
    const fixedConfig = await context.db('contract_line_service_fixed_config')
      .where({ tenant: context.tenantId, config_id: configuration.config_id })
      .first();

    expect(contractLine.contract_line_type).toBe('Fixed');
    expect(configuration.configuration_type).toBe('Fixed');
    expect(Number(fixedConfig.base_rate)).toBe(4500);
  });

  it('T106: recurring hourly items create contract lines with hourly configs', async () => {
    const { quote } = await createAcceptedQuote([
      {
        description: 'Hourly engineering block',
        quantity: 3,
        unit_price: 1800,
        is_recurring: true,
        billing_frequency: 'monthly',
        billing_method: 'hourly',
        unit_of_measure: 'hour',
      },
    ]);

    const result = await context.db.transaction((trx) =>
      convertQuoteToDraftContract(trx, context.tenantId, quote.quote_id, context.userId)
    );

    const contractLine = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_id: result.contract.contract_id })
      .first();
    const configuration = await context.db('contract_line_service_configuration')
      .where({ tenant: context.tenantId, contract_line_id: contractLine.contract_line_id })
      .first();
    const hourlyConfig = await context.db('contract_line_service_hourly_config')
      .where({ tenant: context.tenantId, config_id: configuration.config_id })
      .first();

    expect(contractLine.contract_line_type).toBe('Hourly');
    expect(configuration.configuration_type).toBe('Hourly');
    expect(Number(hourlyConfig.minimum_billable_time)).toBe(15);
  });

  it('T107: recurring usage items create contract lines with usage configs', async () => {
    const { quote } = await createAcceptedQuote([
      {
        description: 'Usage metered backup',
        quantity: 10,
        unit_price: 225,
        is_recurring: true,
        billing_frequency: 'monthly',
        billing_method: 'usage',
        unit_of_measure: 'gb',
      },
    ]);

    const result = await context.db.transaction((trx) =>
      convertQuoteToDraftContract(trx, context.tenantId, quote.quote_id, context.userId)
    );

    const contractLine = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_id: result.contract.contract_id })
      .first();
    const configuration = await context.db('contract_line_service_configuration')
      .where({ tenant: context.tenantId, contract_line_id: contractLine.contract_line_id })
      .first();
    const usageConfig = await context.db('contract_line_service_usage_config')
      .where({ tenant: context.tenantId, config_id: configuration.config_id })
      .first();

    expect(contractLine.contract_line_type).toBe('Usage');
    expect(configuration.configuration_type).toBe('Usage');
    expect(usageConfig.unit_of_measure).toBe('gb');
  });

  it('T108: contract conversion creates a client_contracts assignment for the accepted quote client', async () => {
    const { quote } = await createAcceptedQuote([
      {
        description: 'Recurring maintenance',
        quantity: 1,
        unit_price: 6000,
        is_recurring: true,
        billing_frequency: 'monthly',
        billing_method: 'fixed',
      },
    ]);

    const result = await context.db.transaction((trx) =>
      convertQuoteToDraftContract(trx, context.tenantId, quote.quote_id, context.userId)
    );

    const assignment = await context.db('client_contracts')
      .where({ tenant: context.tenantId, contract_id: result.contract.contract_id })
      .first();

    expect(assignment.client_id).toBe(context.clientId);
    expect(new Date(assignment.start_date).toISOString().startsWith('2026-03-14')).toBe(true);
    expect(assignment.is_active).toBe(true);
  });

  it('T109: contract conversion stores converted_contract_id on the source quote', async () => {
    const { quote } = await createAcceptedQuote([
      {
        description: 'Managed firewall service',
        quantity: 1,
        unit_price: 5500,
        is_recurring: true,
        billing_frequency: 'monthly',
        billing_method: 'fixed',
      },
    ]);

    const result = await context.db.transaction((trx) =>
      convertQuoteToDraftContract(trx, context.tenantId, quote.quote_id, context.userId)
    );
    const refreshedQuote = await Quote.getById(context.db, context.tenantId, quote.quote_id);

    expect(refreshedQuote?.converted_contract_id).toBe(result.contract.contract_id);
  });

  it('T110: Quote→Invoice creates a draft manual invoice from one-time items', async () => {
    const { quote } = await createAcceptedQuote([
      {
        description: 'Project onboarding',
        quantity: 1,
        unit_price: 12000,
        is_recurring: false,
        billing_method: 'fixed',
      },
    ]);

    const result = await context.db.transaction((trx) =>
      convertQuoteToDraftInvoice(trx, context.tenantId, quote.quote_id, context.userId)
    );

    expect(result.invoice.status).toBe('draft');
    expect(result.invoice.is_manual).toBe(true);
  });

  it('T111: invoice conversion maps one-time tax and discount data into invoice charges', async () => {
    const { quote, items } = await createAcceptedQuote([
      {
        description: 'Project implementation',
        quantity: 2,
        unit_price: 5000,
        is_recurring: false,
        billing_method: 'fixed',
        rawUpdates: {
          net_amount: 10000,
          tax_amount: 825,
          tax_region: 'US-NY',
          tax_rate: 8,
          total_price: 10825,
        },
      },
    ]);

    const baseItem = items[0];
    await context.db('quotes')
      .where({ tenant: context.tenantId, quote_id: quote.quote_id })
      .update({ tax_source: 'external' });

    const discountItem = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Project implementation discount',
      quantity: 1,
      unit_price: 1000,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
      is_discount: true,
      discount_type: 'percentage',
      discount_percentage: 10,
      applies_to_item_id: baseItem.quote_item_id,
      is_taxable: false,
      created_by: context.userId,
    } as any);

    await context.db('quote_items')
      .where({ tenant: context.tenantId, quote_item_id: discountItem.quote_item_id })
      .update({
        net_amount: 1000,
        tax_amount: 0,
        total_price: 1000,
      });

    await context.db('quote_items')
      .where({ tenant: context.tenantId, quote_item_id: baseItem.quote_item_id })
      .update({
        net_amount: 10000,
        tax_amount: 825,
        tax_region: 'US-NY',
        tax_rate: 8,
        total_price: 10825,
      });

    const result = await context.db.transaction((trx) =>
      convertQuoteToDraftInvoice(trx, context.tenantId, quote.quote_id, context.userId)
    );

    const invoiceCharges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: result.invoice.invoice_id })
      .orderBy('description', 'asc');

    const discountCharge = invoiceCharges.find((charge) => charge.is_discount === true);
    const baseCharge = invoiceCharges.find((charge) => charge.is_discount !== true);

    expect(Number(baseCharge.tax_amount)).toBe(825);
    expect(Number(baseCharge.tax_rate)).toBe(8);
    expect(baseCharge.tax_region).toBe('US-NY');
    expect(discountCharge.discount_type).toBe('percentage');
    expect(Number(discountCharge.discount_percentage)).toBe(10);
    expect(discountCharge.applies_to_item_id).toBe(baseCharge.item_id);
    expect(Number(discountCharge.net_amount)).toBe(-1000);
  });

  it('T112: invoice conversion stores converted_invoice_id on the source quote', async () => {
    const { quote } = await createAcceptedQuote([
      {
        description: 'One-time migration',
        quantity: 1,
        unit_price: 9000,
        is_recurring: false,
        billing_method: 'fixed',
      },
    ]);

    const result = await context.db.transaction((trx) =>
      convertQuoteToDraftInvoice(trx, context.tenantId, quote.quote_id, context.userId)
    );
    const refreshedQuote = await Quote.getById(context.db, context.tenantId, quote.quote_id);

    expect(refreshedQuote?.converted_invoice_id).toBe(result.invoice.invoice_id);
  });

  it('T113: combined conversion creates both a draft contract and draft invoice in one transaction', async () => {
    const { quote } = await createAcceptedQuote([
      {
        description: 'Recurring maintenance',
        quantity: 1,
        unit_price: 4000,
        is_recurring: true,
        billing_frequency: 'monthly',
        billing_method: 'fixed',
      },
      {
        description: 'Implementation project',
        quantity: 1,
        unit_price: 8000,
        is_recurring: false,
        billing_method: 'fixed',
      },
    ]);

    const result = await context.db.transaction((trx) =>
      convertQuoteToDraftContractAndInvoice(trx, context.tenantId, quote.quote_id, context.userId)
    );

    expect(result.contract.contract_id).toBeTruthy();
    expect(result.invoice.invoice_id).toBeTruthy();
    expect(result.quote.converted_contract_id).toBe(result.contract.contract_id);
    expect(result.quote.converted_invoice_id).toBe(result.invoice.invoice_id);
  });

  it('T114: combined conversion rolls back both records if invoice creation fails after contract creation', async () => {
    const { quote } = await createAcceptedQuote([
      {
        description: 'Recurring support',
        quantity: 1,
        unit_price: 3000,
        is_recurring: true,
        billing_frequency: 'monthly',
        billing_method: 'fixed',
      },
      {
        description: 'One-time setup',
        quantity: 1,
        unit_price: 5000,
        is_recurring: false,
        billing_method: 'fixed',
      },
    ]);

    const originalGetNextNumber = SharedNumberingService.getNextNumber.bind(SharedNumberingService);
    const numberingSpy = vi.spyOn(SharedNumberingService, 'getNextNumber').mockImplementation(async (entityType: any, contextArg: any) => {
      if (entityType === 'INVOICE') {
        throw new Error('Injected invoice numbering failure');
      }
      return originalGetNextNumber(entityType, contextArg);
    });

    try {
      await expect(
        context.db.transaction((trx) =>
          convertQuoteToDraftContractAndInvoice(trx, context.tenantId, quote.quote_id, context.userId)
        )
      ).rejects.toThrow('Injected invoice numbering failure');
    } finally {
      numberingSpy.mockRestore();
    }

    const quoteAfterFailure = await Quote.getById(context.db, context.tenantId, quote.quote_id);
    const sourceContracts = await context.db('contracts')
      .whereRaw("tenant = ? AND template_metadata ->> 'source_quote_id' = ?", [context.tenantId, quote.quote_id]);

    expect(sourceContracts).toHaveLength(0);
    expect(quoteAfterFailure?.converted_contract_id).toBeNull();
    expect(quoteAfterFailure?.converted_invoice_id).toBeNull();
  });

  it('T115: successful combined conversion marks the quote as converted', async () => {
    const { quote } = await createAcceptedQuote([
      {
        description: 'Recurring monitoring',
        quantity: 1,
        unit_price: 3500,
        is_recurring: true,
        billing_frequency: 'monthly',
        billing_method: 'fixed',
      },
      {
        description: 'One-time onboarding',
        quantity: 1,
        unit_price: 7000,
        is_recurring: false,
        billing_method: 'fixed',
      },
    ]);

    const result = await context.db.transaction((trx) =>
      convertQuoteToDraftContractAndInvoice(trx, context.tenantId, quote.quote_id, context.userId)
    );

    expect(result.quote.status).toBe('converted');
    expect(result.quote.converted_at).toBeTruthy();
  });

  it('T116: conversion preview categorizes recurring, one-time, and excluded items correctly', async () => {
    const { quote } = await createAcceptedQuote([
      {
        description: 'Recurring support plan',
        quantity: 1,
        unit_price: 4500,
        is_recurring: true,
        billing_frequency: 'monthly',
        billing_method: 'fixed',
      },
      {
        description: 'One-time installation',
        quantity: 1,
        unit_price: 6000,
        is_recurring: false,
        billing_method: 'fixed',
      },
      {
        description: 'Optional training day',
        quantity: 1,
        unit_price: 3000,
        is_optional: true,
        is_selected: false,
        is_recurring: false,
        billing_method: 'fixed',
      },
      {
        description: 'Recurring discount',
        quantity: 1,
        unit_price: 500,
        is_recurring: true,
        is_discount: true,
        discount_type: 'fixed',
        billing_method: 'fixed',
      },
    ]);

    const preview = await buildQuoteConversionPreview(quote);

    expect(preview.available_actions).toEqual(['contract', 'invoice', 'both']);
    expect(preview.contract_items.map((item) => item.description)).toEqual(['Recurring support plan']);
    expect(preview.invoice_items.map((item) => item.description)).toEqual(['One-time installation']);
    expect(preview.excluded_items.map((item) => item.description)).toEqual(
      expect.arrayContaining(['Optional training day', 'Recurring discount'])
    );
  });

  it('T117: deselected optional quote items are excluded from both contract and invoice conversion', async () => {
    const { quote } = await createAcceptedQuote([
      {
        description: 'Recurring core service',
        quantity: 1,
        unit_price: 5000,
        is_recurring: true,
        billing_frequency: 'monthly',
        billing_method: 'fixed',
      },
      {
        description: 'Optional recurring add-on',
        quantity: 1,
        unit_price: 1500,
        is_optional: true,
        is_selected: false,
        is_recurring: true,
        billing_frequency: 'monthly',
        billing_method: 'fixed',
      },
      {
        description: 'One-time project',
        quantity: 1,
        unit_price: 8000,
        is_recurring: false,
        billing_method: 'fixed',
      },
      {
        description: 'Optional one-time training',
        quantity: 1,
        unit_price: 2000,
        is_optional: true,
        is_selected: false,
        is_recurring: false,
        billing_method: 'fixed',
      },
    ]);

    const result = await context.db.transaction((trx) =>
      convertQuoteToDraftContractAndInvoice(trx, context.tenantId, quote.quote_id, context.userId)
    );

    const contractLines = await context.db('contract_lines')
      .where({ tenant: context.tenantId, contract_id: result.contract.contract_id });
    const invoiceCharges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: result.invoice.invoice_id });

    expect(contractLines).toHaveLength(1);
    expect(contractLines[0].contract_line_name).toContain('Recurring core service');
    expect(invoiceCharges).toHaveLength(1);
    expect(invoiceCharges[0].description).toBe('One-time project');
  });
});
