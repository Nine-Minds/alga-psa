import type { Knex } from 'knex';
import type { IContract, IInvoice, IQuote, IQuoteItem } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { SharedNumberingService } from '@shared/services/numberingService';
import Contract from '../models/contract';
import Quote from '../models/quote';
import QuoteActivity from '../models/quoteActivity';

export interface QuoteToContractConversionResult {
  quote: IQuote;
  contract: IContract;
  clientContractId?: string;
}

export interface QuoteToInvoiceConversionResult {
  quote: IQuote;
  invoice: IInvoice;
}

export interface QuoteToBothConversionResult {
  quote: IQuote;
  contract: IContract;
  invoice: IInvoice;
  clientContractId?: string;
}

interface ContractLineMapping {
  item: IQuoteItem;
  contractLineId: string;
  contractLineType: 'Fixed' | 'Hourly' | 'Usage';
}

function mapQuoteItemToContractLineType(item: IQuoteItem): 'Fixed' | 'Hourly' | 'Usage' {
  if (item.billing_method === 'hourly') {
    return 'Hourly';
  }

  if (item.billing_method === 'usage') {
    return 'Usage';
  }

  return 'Fixed';
}

function getContractLineBillingTiming(item: IQuoteItem): 'arrears' | 'advance' {
  return item.billing_method === 'hourly' || item.billing_method === 'usage'
    ? 'arrears'
    : 'advance';
}

function getSelectedRecurringItems(items: IQuoteItem[] = []): IQuoteItem[] {
  return items.filter((item) => {
    if (!item.is_recurring || item.is_discount) {
      return false;
    }

    if (item.is_optional && item.is_selected === false) {
      return false;
    }

    return true;
  });
}

function getSelectedOneTimeItems(items: IQuoteItem[] = []): IQuoteItem[] {
  const includedItems = items.filter((item) => {
    if (item.is_recurring) {
      return false;
    }

    if (item.is_optional && item.is_selected === false) {
      return false;
    }

    return true;
  });

  const baseItemIds = new Set(
    includedItems
      .filter((item) => !item.is_discount)
      .map((item) => item.quote_item_id)
  );
  const baseServiceIds = new Set(
    includedItems
      .filter((item) => !item.is_discount && item.service_id)
      .map((item) => item.service_id as string)
  );

  return includedItems.filter((item) => {
    if (!item.is_discount) {
      return true;
    }

    if (!item.applies_to_item_id && !item.applies_to_service_id) {
      return true;
    }

    if (item.applies_to_item_id && baseItemIds.has(item.applies_to_item_id)) {
      return true;
    }

    if (item.applies_to_service_id && baseServiceIds.has(item.applies_to_service_id)) {
      return true;
    }

    return false;
  });
}

export async function convertQuoteToDraftContract(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string,
  performedBy?: string | null
): Promise<QuoteToContractConversionResult> {
  const quote = await Quote.getById(knexOrTrx, tenant, quoteId);

  if (!quote) {
    throw new Error(`Quote ${quoteId} not found in tenant ${tenant}`);
  }

  if (quote.is_template) {
    throw new Error('Quote templates cannot be converted to contracts');
  }

  if (quote.status !== 'accepted') {
    throw new Error('Only accepted quotes can be converted to contracts');
  }

  if (quote.converted_contract_id) {
    const existingContract = await Contract.getById(knexOrTrx, tenant, quote.converted_contract_id);
    if (existingContract) {
      return {
        quote: await Quote.getById(knexOrTrx, tenant, quote.quote_id) as IQuote,
        contract: existingContract,
      };
    }
  }

  const recurringItems = getSelectedRecurringItems(quote.quote_items ?? []);
  if (recurringItems.length === 0) {
    throw new Error('Quote does not contain any recurring items selected for contract conversion');
  }

  const billingFrequency = recurringItems[0]?.billing_frequency || 'monthly';

  const contract = await Contract.create(knexOrTrx, tenant, {
    contract_name: quote.title,
    contract_description: quote.description ?? null,
    billing_frequency: billingFrequency,
    currency_code: quote.currency_code,
    is_active: false,
    status: 'draft',
    is_template: false,
    template_metadata: {
      source_quote_id: quote.quote_id,
      source_quote_number: quote.quote_number ?? null,
      conversion_kind: 'quote_to_contract',
    },
  });

  const nowIso = new Date().toISOString();
  const contractLineMappings: ContractLineMapping[] = recurringItems.map((item) => ({
    item,
    contractLineId: uuidv4(),
    contractLineType: mapQuoteItemToContractLineType(item),
  }));

  await knexOrTrx('contract_lines').insert(
    contractLineMappings.map(({ item, contractLineId, contractLineType }, index) => ({
      tenant,
      contract_line_id: contractLineId,
      contract_id: contract.contract_id,
      contract_line_name: item.service_name || item.description,
      description: item.description,
      billing_frequency: item.billing_frequency || billingFrequency,
      is_custom: true,
      contract_line_type: contractLineType,
      billing_timing: getContractLineBillingTiming(item),
      display_order: index,
      custom_rate: contractLineType === 'Fixed' ? item.unit_price : null,
      enable_proration: false,
      billing_cycle_alignment: 'start',
      minimum_billable_time: contractLineType === 'Hourly' ? 15 : null,
      round_up_to_nearest: contractLineType === 'Hourly' ? 15 : null,
      is_active: false,
      created_at: nowIso,
      updated_at: nowIso,
    }))
  );

  const configRows = contractLineMappings.map(({ item, contractLineId, contractLineType }) => {
    if (!item.service_id) {
      throw new Error('Recurring quote items must be linked to a catalog service before converting to a contract');
    }

    return {
      item,
      contractLineId,
      contractLineType,
      configId: uuidv4(),
      serviceId: item.service_id,
    };
  });

  await knexOrTrx('contract_line_services').insert(
    configRows.map(({ contractLineId, serviceId, item }) => ({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      quantity: item.quantity,
      custom_rate: item.unit_price,
      created_at: nowIso,
      updated_at: nowIso,
    }))
  );

  await knexOrTrx('contract_line_service_configuration').insert(
    configRows.map(({ configId, contractLineId, contractLineType, serviceId, item }) => ({
      tenant,
      config_id: configId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: contractLineType,
      custom_rate: item.unit_price,
      quantity: item.quantity,
      created_at: nowIso,
      updated_at: nowIso,
    }))
  );

  const fixedConfigRows = configRows.filter((row) => row.contractLineType === 'Fixed');
  if (fixedConfigRows.length > 0) {
    await knexOrTrx('contract_line_service_fixed_config').insert(
      fixedConfigRows.map(({ configId, item }) => ({
        tenant,
        config_id: configId,
        base_rate: item.unit_price,
        created_at: nowIso,
        updated_at: nowIso,
      }))
    );
  }

  const hourlyConfigRows = configRows.filter((row) => row.contractLineType === 'Hourly');
  if (hourlyConfigRows.length > 0) {
    await knexOrTrx('contract_line_service_hourly_configs').insert(
      hourlyConfigRows.map(({ configId, item }) => ({
        tenant,
        config_id: configId,
        hourly_rate: item.unit_price,
        minimum_billable_time: 15,
        round_up_to_nearest: 15,
        created_at: nowIso,
        updated_at: nowIso,
      }))
    );

    await knexOrTrx('contract_line_service_hourly_config').insert(
      hourlyConfigRows.map(({ configId }) => ({
        tenant,
        config_id: configId,
        minimum_billable_time: 15,
        round_up_to_nearest: 15,
        enable_overtime: false,
        overtime_rate: null,
        overtime_threshold: null,
        enable_after_hours_rate: false,
        after_hours_multiplier: null,
        created_at: nowIso,
        updated_at: nowIso,
      }))
    );
  }

  const usageConfigRows = configRows.filter((row) => row.contractLineType === 'Usage');
  if (usageConfigRows.length > 0) {
    await knexOrTrx('contract_line_service_usage_config').insert(
      usageConfigRows.map(({ configId, item }) => ({
        tenant,
        config_id: configId,
        unit_of_measure: item.unit_of_measure || 'unit',
        enable_tiered_pricing: false,
        minimum_usage: 0,
        base_rate: item.unit_price,
        created_at: nowIso,
        updated_at: nowIso,
      }))
    );
  }

  if (!quote.client_id) {
    throw new Error('Quotes must be linked to a client before they can be converted to a contract');
  }

  const clientContractId = uuidv4();
  await knexOrTrx('client_contracts').insert({
    tenant,
    client_contract_id: clientContractId,
    client_id: quote.client_id,
    contract_id: contract.contract_id,
    start_date: quote.accepted_at || quote.quote_date || nowIso,
    end_date: null,
    is_active: false,
    created_at: nowIso,
    updated_at: nowIso,
  });

  await knexOrTrx('quotes')
    .where({ tenant, quote_id: quote.quote_id })
    .update({
      converted_contract_id: contract.contract_id,
      updated_by: performedBy ?? quote.updated_by ?? quote.created_by ?? null,
      updated_at: nowIso,
    });

  await QuoteActivity.create(knexOrTrx, tenant, {
    quote_id: quote.quote_id,
    activity_type: 'converted_to_contract',
    description: `Quote converted to draft contract ${contract.contract_name}`,
    performed_by: performedBy ?? null,
    metadata: {
      contract_id: contract.contract_id,
      client_contract_id: clientContractId,
      recurring_item_count: recurringItems.length,
    },
  });

  const refreshedQuote = await Quote.getById(knexOrTrx, tenant, quote.quote_id);

  return {
    quote: refreshedQuote as IQuote,
    contract,
    clientContractId,
  };
}

export async function convertQuoteToDraftInvoice(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string,
  performedBy?: string | null
): Promise<QuoteToInvoiceConversionResult> {
  const quote = await Quote.getById(knexOrTrx, tenant, quoteId);

  if (!quote) {
    throw new Error(`Quote ${quoteId} not found in tenant ${tenant}`);
  }

  if (quote.is_template) {
    throw new Error('Quote templates cannot be converted to invoices');
  }

  if (quote.status !== 'accepted') {
    throw new Error('Only accepted quotes can be converted to invoices');
  }

  if (quote.converted_invoice_id) {
    const existingInvoice = await knexOrTrx('invoices')
      .where({ tenant, invoice_id: quote.converted_invoice_id })
      .first();

    if (existingInvoice) {
      return {
        quote: await Quote.getById(knexOrTrx, tenant, quote.quote_id) as IQuote,
        invoice: {
          ...existingInvoice,
          invoice_charges: await knexOrTrx('invoice_charges').where({ tenant, invoice_id: existingInvoice.invoice_id }),
        } as IInvoice,
      };
    }
  }

  if (!quote.client_id) {
    throw new Error('Quotes must be linked to a client before they can be converted to an invoice');
  }

  const oneTimeItems = getSelectedOneTimeItems(quote.quote_items ?? []);
  if (oneTimeItems.length === 0) {
    throw new Error('Quote does not contain any one-time items selected for invoice conversion');
  }

  const nowIso = new Date().toISOString();
  const invoiceNumber = await SharedNumberingService.getNextNumber('INVOICE', {
    knex: knexOrTrx,
    tenant,
  });

  const invoiceId = uuidv4();
  await knexOrTrx('invoices').insert({
    tenant,
    invoice_id: invoiceId,
    client_id: quote.client_id,
    po_number: quote.po_number ?? null,
    invoice_date: quote.accepted_at || quote.quote_date || nowIso,
    due_date: quote.accepted_at || quote.quote_date || nowIso,
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    currency_code: quote.currency_code,
    status: 'draft',
    invoice_number: invoiceNumber,
    credit_applied: 0,
    is_manual: true,
    tax_source: quote.tax_source ?? 'internal',
  });

  const invoiceItemIdsByQuoteItemId = new Map<string, string>();
  const invoiceChargeRows = oneTimeItems.map((item) => {
    const itemId = uuidv4();
    invoiceItemIdsByQuoteItemId.set(item.quote_item_id, itemId);

    const netAmount = item.is_discount
      ? -Math.abs(Number(item.net_amount ?? item.total_price ?? (item.quantity * item.unit_price)))
      : Number(item.net_amount ?? (item.quantity * item.unit_price));
    const taxAmount = item.is_discount ? 0 : Number(item.tax_amount ?? 0);

    return {
      tenant,
      item_id: itemId,
      invoice_id: invoiceId,
      service_id: item.service_id ?? null,
      service_item_kind: item.service_item_kind ?? null,
      service_sku: item.service_sku ?? null,
      service_name: item.service_name ?? null,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      net_amount: netAmount,
      tax_amount: taxAmount,
      tax_region: item.tax_region ?? null,
      tax_rate: item.tax_rate ?? 0,
      total_price: netAmount + taxAmount,
      is_manual: true,
      is_taxable: item.is_discount ? false : (item.is_taxable ?? true),
      is_discount: item.is_discount ?? false,
      discount_type: item.discount_type ?? null,
      discount_percentage: item.discount_percentage ?? null,
      applies_to_item_id: item.applies_to_item_id ?? null,
      applies_to_service_id: item.applies_to_service_id ?? null,
      created_by: quote.accepted_by ?? quote.updated_by ?? quote.created_by ?? null,
      updated_by: quote.accepted_by ?? quote.updated_by ?? quote.created_by ?? null,
      created_at: nowIso,
      updated_at: nowIso,
    };
  }).map((row) => ({
    ...row,
    applies_to_item_id: row.applies_to_item_id
      ? (invoiceItemIdsByQuoteItemId.get(row.applies_to_item_id) ?? null)
      : null,
  }));

  await knexOrTrx('invoice_charges').insert(invoiceChargeRows);

  const invoiceSubtotal = invoiceChargeRows.reduce((sum, row) => sum + Number(row.net_amount), 0);
  const invoiceTax = invoiceChargeRows.reduce((sum, row) => sum + Number(row.tax_amount), 0);

  await knexOrTrx('invoices')
    .where({ tenant, invoice_id: invoiceId })
    .update({
      subtotal: Math.round(invoiceSubtotal),
      tax: Math.round(invoiceTax),
      total_amount: Math.round(invoiceSubtotal + invoiceTax),
    });

  const invoice = await knexOrTrx('invoices')
    .where({ tenant, invoice_id: invoiceId })
    .first();

  await knexOrTrx('quotes')
    .where({ tenant, quote_id: quote.quote_id })
    .update({
      converted_invoice_id: invoiceId,
      updated_by: performedBy ?? quote.updated_by ?? quote.created_by ?? null,
      updated_at: nowIso,
    });

  await QuoteActivity.create(knexOrTrx, tenant, {
    quote_id: quote.quote_id,
    activity_type: 'converted_to_invoice',
    description: `Quote converted to draft invoice ${invoiceNumber}`,
    performed_by: performedBy ?? null,
    metadata: {
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      one_time_item_count: oneTimeItems.length,
    },
  });

  const refreshedQuote = await Quote.getById(knexOrTrx, tenant, quote.quote_id);

  return {
    quote: refreshedQuote as IQuote,
    invoice: {
      ...invoice,
      invoice_charges: invoiceChargeRows,
    } as IInvoice,
  };
}

export async function convertQuoteToDraftContractAndInvoice(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string,
  performedBy?: string | null
): Promise<QuoteToBothConversionResult> {
  const quote = await Quote.getById(knexOrTrx, tenant, quoteId);

  if (!quote) {
    throw new Error(`Quote ${quoteId} not found in tenant ${tenant}`);
  }

  if (quote.status !== 'accepted') {
    throw new Error('Only accepted quotes can be converted');
  }

  if (quote.converted_contract_id || quote.converted_invoice_id) {
    throw new Error('Quote has already started conversion and cannot be converted to both again');
  }

  const recurringItems = getSelectedRecurringItems(quote.quote_items ?? []);
  const oneTimeItems = getSelectedOneTimeItems(quote.quote_items ?? []);

  if (recurringItems.length === 0 || oneTimeItems.length === 0) {
    throw new Error('Quote must contain both recurring and one-time items to convert to both records');
  }

  const contractResult = await convertQuoteToDraftContract(knexOrTrx, tenant, quoteId, performedBy);
  const invoiceResult = await convertQuoteToDraftInvoice(knexOrTrx, tenant, quoteId, performedBy);
  const nowIso = new Date().toISOString();

  await knexOrTrx('quotes')
    .where({ tenant, quote_id: quoteId })
    .update({
      status: 'converted',
      converted_at: nowIso,
      updated_by: performedBy ?? quote.updated_by ?? quote.created_by ?? null,
      updated_at: nowIso,
    });

  await QuoteActivity.create(knexOrTrx, tenant, {
    quote_id: quoteId,
    activity_type: 'converted',
    description: 'Quote converted to both a draft contract and a draft invoice',
    performed_by: performedBy ?? null,
    metadata: {
      contract_id: contractResult.contract.contract_id,
      invoice_id: invoiceResult.invoice.invoice_id,
    },
  });

  const refreshedQuote = await Quote.getById(knexOrTrx, tenant, quoteId);

  return {
    quote: refreshedQuote as IQuote,
    contract: contractResult.contract,
    invoice: invoiceResult.invoice,
    clientContractId: contractResult.clientContractId,
  };
}
