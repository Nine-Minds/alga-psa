import type { Knex } from 'knex';
import type {
  IContract,
  IInvoice,
  IQuote,
  IQuoteItem,
  ISalesOrder,
  ISalesOrderLine,
  QuoteConversionPreview,
  QuoteConversionPreviewItem,
} from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import { SharedNumberingService } from '@shared/services/numberingService';
import Contract from '../models/contract';
import Quote from '../models/quote';
import QuoteActivity from '../models/quoteActivity';

const tableColumnCache = new Map<string, Set<string>>();

async function getTableColumns(
  knexOrTrx: Knex | Knex.Transaction,
  tableName: string
): Promise<Set<string>> {
  const cached = tableColumnCache.get(tableName);
  if (cached) {
    return cached;
  }

  const columnInfo = await knexOrTrx(tableName).columnInfo();
  const columns = new Set(Object.keys(columnInfo));
  tableColumnCache.set(tableName, columns);
  return columns;
}

async function insertRowsUsingExistingColumns(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  tableName: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const columns = await getTableColumns(knexOrTrx, tableName);
  const filteredRows = rows.map((row) => Object.fromEntries(
    Object.entries(row).filter(([key, value]) => columns.has(key) && value !== undefined)
  ));

  await tenantDb(knexOrTrx, tenant).table(tableName).insert(filteredRows);
}

export interface QuoteToContractConversionResult {
  quote: IQuote;
  contract: IContract;
  clientContractId?: string;
}

export interface QuoteToInvoiceConversionResult {
  quote: IQuote;
  invoice: IInvoice;
}

export interface QuoteToSalesOrderConversionResult {
  quote: IQuote;
  salesOrder: ISalesOrder & { lines: ISalesOrderLine[] };
}

export interface QuoteToBothConversionResult {
  quote: IQuote;
  contract: IContract;
  invoice: IInvoice;
  clientContractId?: string;
}

function toPreviewItem(
  item: IQuoteItem,
  target: QuoteConversionPreviewItem['target'],
  reason?: string | null,
  locationName?: string | null
): QuoteConversionPreviewItem {
  return {
    quote_item_id: item.quote_item_id,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price,
    is_optional: item.is_optional,
    is_selected: item.is_selected,
    is_recurring: item.is_recurring,
    is_discount: item.is_discount,
    billing_method: item.billing_method ?? null,
    target,
    reason: reason ?? null,
    location_id: item.location_id ?? null,
    location_name: locationName ?? null,
  };
}

async function resolveLocationNames(
  knexOrTrx: Knex | Knex.Transaction | undefined,
  tenant: string | undefined,
  items: IQuoteItem[]
): Promise<Map<string, string>> {
  const locationIds = Array.from(
    new Set(
      items
        .map((item) => item.location_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );

  if (locationIds.length === 0 || !knexOrTrx || !tenant) {
    return new Map();
  }

  const rows = await tenantDb(knexOrTrx, tenant).table('client_locations')
    .whereIn('location_id', locationIds)
    .select('location_id', 'location_name', 'address_line1');

  const map = new Map<string, string>();
  for (const row of rows) {
    const name = row.location_name
      ?? row.address_line1
      ?? row.location_id;
    map.set(row.location_id as string, name as string);
  }

  return map;
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

function isItemSelected(item: IQuoteItem): boolean {
  if (!item.is_optional) return true;
  return item.is_selected === true;
}

function getSelectedRecurringItems(items: IQuoteItem[] = []): IQuoteItem[] {
  return items.filter((item) => {
    if (!item.is_recurring || item.is_discount) {
      return false;
    }

    return isItemSelected(item);
  });
}

function getSelectedOneTimeItems(items: IQuoteItem[] = []): IQuoteItem[] {
  const includedItems = items.filter((item) => {
    if (item.is_recurring) {
      return false;
    }

    return isItemSelected(item);
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

function toIntegerCents(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return null;
  }

  return Math.round(numberValue);
}

async function resolveProductServiceIds(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  items: IQuoteItem[]
): Promise<Set<string>> {
  const serviceIds = Array.from(
    new Set(
      items
        .map((item) => item.service_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );

  if (serviceIds.length === 0) {
    return new Set();
  }

  const rows = await knexOrTrx('service_catalog')
    .where({ tenant, item_kind: 'product' })
    .whereIn('service_id', serviceIds)
    .select('service_id');

  return new Set(rows.map((row) => row.service_id as string));
}

function isProductQuoteItem(item: IQuoteItem, productServiceIds: Set<string>): boolean {
  return item.service_item_kind === 'product'
    || (typeof item.service_id === 'string' && productServiceIds.has(item.service_id));
}

function getSelectedProductOneTimeItems(
  items: IQuoteItem[],
  productServiceIds: Set<string>
): IQuoteItem[] {
  return getSelectedOneTimeItems(items).filter((item) =>
    !item.is_discount && isProductQuoteItem(item, productServiceIds)
  );
}

function excludeSalesOrderProductItems(
  oneTimeItems: IQuoteItem[],
  productServiceIds: Set<string>
): IQuoteItem[] {
  const productItems = oneTimeItems.filter((item) =>
    !item.is_discount && isProductQuoteItem(item, productServiceIds)
  );
  const productQuoteItemIds = new Set(productItems.map((item) => item.quote_item_id));
  const productServiceIdsInQuote = new Set(
    productItems
      .map((item) => item.service_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );

  if (productQuoteItemIds.size === 0 && productServiceIdsInQuote.size === 0) {
    return oneTimeItems;
  }

  return oneTimeItems.filter((item) => {
    if (!item.is_discount) {
      return !productQuoteItemIds.has(item.quote_item_id);
    }

    if (item.applies_to_item_id && productQuoteItemIds.has(item.applies_to_item_id)) {
      return false;
    }

    if (item.applies_to_service_id && productServiceIdsInQuote.has(item.applies_to_service_id)) {
      return false;
    }

    return true;
  });
}

async function getSalesOrderByQuoteId(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string
): Promise<(ISalesOrder & { lines: ISalesOrderLine[] }) | null> {
  const row = await knexOrTrx('sales_orders')
    .where({ tenant, quote_id: quoteId })
    .orderBy('created_at', 'desc')
    .first();

  if (!row) {
    return null;
  }

  const lines = await knexOrTrx('sales_order_lines')
    .where({ tenant, so_id: row.so_id })
    .orderBy('created_at', 'asc');

  return {
    ...(row as ISalesOrder),
    lines: lines as ISalesOrderLine[],
  };
}

async function resolveProductCostFallbacks(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  serviceIds: string[]
): Promise<Map<string, number | null>> {
  if (serviceIds.length === 0) {
    return new Map();
  }

  const rows = await knexOrTrx('service_catalog as sc')
    .leftJoin('product_inventory_settings as pis', function () {
      this.on('pis.service_id', '=', 'sc.service_id')
        .andOn('pis.tenant', '=', 'sc.tenant');
    })
    .where('sc.tenant', tenant)
    .whereIn('sc.service_id', serviceIds)
    .select(
      'sc.service_id',
      'sc.cost as catalog_cost',
      'pis.average_cost as average_cost'
    );

  const map = new Map<string, number | null>();
  for (const row of rows) {
    map.set(
      row.service_id as string,
      toIntegerCents(row.average_cost) ?? toIntegerCents(row.catalog_cost)
    );
  }

  return map;
}

export async function buildQuoteConversionPreview(
  quote: IQuote,
  knexOrTrx?: Knex | Knex.Transaction,
  tenant?: string
): Promise<QuoteConversionPreview> {
  const quoteItems = quote.quote_items ?? [];
  const recurringItems = getSelectedRecurringItems(quoteItems);
  const oneTimeItems = getSelectedOneTimeItems(quoteItems);
  const recurringIds = new Set(recurringItems.map((item) => item.quote_item_id));
  const oneTimeIds = new Set(oneTimeItems.map((item) => item.quote_item_id));

  const resolvedTenant = tenant ?? quote.tenant;
  const locationNameMap = await resolveLocationNames(knexOrTrx, resolvedTenant, quoteItems);
  const lookupName = (item: IQuoteItem): string | null => (
    item.location_id ? (locationNameMap.get(item.location_id) ?? null) : null
  );

  const contractItems: QuoteConversionPreviewItem[] = [];
  const invoiceItems: QuoteConversionPreviewItem[] = [];
  const excludedItems: QuoteConversionPreviewItem[] = [];

  for (const item of quoteItems) {
    if (recurringIds.has(item.quote_item_id)) {
      contractItems.push(toPreviewItem(item, 'contract', null, lookupName(item)));
      continue;
    }

    if (oneTimeIds.has(item.quote_item_id)) {
      invoiceItems.push(toPreviewItem(item, 'invoice', null, lookupName(item)));
      continue;
    }

    let reason = 'Item is not eligible for conversion';
    if (item.is_optional && item.is_selected !== true) {
      reason = 'Optional item was not selected by the client';
    } else if (item.is_discount && item.is_recurring) {
      reason = 'Recurring discount lines are excluded from contract conversion';
    } else if (item.is_recurring && !item.service_id) {
      reason = 'Recurring items must reference a catalog service before contract conversion';
    } else if (item.is_discount) {
      reason = 'Discount line does not apply to any converted one-time item';
    }

    excludedItems.push(toPreviewItem(item, 'excluded', reason, lookupName(item)));
  }

  const availableActions: Array<'contract' | 'invoice' | 'both'> = [];
  if (contractItems.length > 0) {
    availableActions.push('contract');
  }
  if (invoiceItems.length > 0) {
    availableActions.push('invoice');
  }
  if (contractItems.length > 0 && invoiceItems.length > 0) {
    availableActions.push('both');
  }

  return {
    quote_id: quote.quote_id,
    available_actions: availableActions,
    contract_items: contractItems,
    invoice_items: invoiceItems,
    excluded_items: excludedItems,
  };
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

  if (!quote.client_id) {
    throw new Error('Quotes must be linked to a client before they can be converted to a contract');
  }

  const contract = await Contract.create(knexOrTrx, tenant, {
    contract_name: quote.title,
    contract_description: quote.description ?? null,
    billing_frequency: billingFrequency,
    currency_code: quote.currency_code,
    is_active: false,
    status: 'draft',
    is_template: false,
    owner_client_id: quote.client_id,
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

  const db = tenantDb(knexOrTrx, tenant);
  await db.table('contract_lines').insert(
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
      location_id: item.location_id ?? null,
      created_at: nowIso,
      updated_at: nowIso,
    }))
  );

  const configRows = contractLineMappings
    .filter(({ item }) => Boolean(item.service_id))
    .map(({ item, contractLineId, contractLineType }) => ({
      item,
      contractLineId,
      contractLineType,
      configId: uuidv4(),
      serviceId: item.service_id as string,
    }));

  await insertRowsUsingExistingColumns(
    knexOrTrx,
    tenant,
    'contract_line_services',
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

  if (configRows.length > 0) {
    await db.table('contract_line_service_configuration').insert(
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
  }

  const fixedConfigRows = configRows.filter((row) => row.contractLineType === 'Fixed');
  if (fixedConfigRows.length > 0) {
    await db.table('contract_line_service_fixed_config').insert(
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
    await db.table('contract_line_service_hourly_config').insert(
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

    await db.table('contract_line_service_hourly_configs').insert(
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
  }

  const usageConfigRows = configRows.filter((row) => row.contractLineType === 'Usage');
  if (usageConfigRows.length > 0) {
    await db.table('contract_line_service_usage_config').insert(
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

  const clientContractId = uuidv4();
  await db.table('client_contracts').insert({
    tenant,
    client_contract_id: clientContractId,
    client_id: quote.client_id,
    contract_id: contract.contract_id,
    start_date: quote.accepted_at || quote.quote_date || nowIso,
    end_date: null,
    is_active: true,
    created_at: nowIso,
    updated_at: nowIso,
  });

  await db.table('quotes')
    .where({ quote_id: quote.quote_id })
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

export async function convertQuoteToDraftSalesOrder(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string,
  performedBy?: string | null
): Promise<QuoteToSalesOrderConversionResult> {
  const quote = await Quote.getById(knexOrTrx, tenant, quoteId);

  if (!quote) {
    throw new Error(`Quote ${quoteId} not found in tenant ${tenant}`);
  }

  if (quote.is_template) {
    throw new Error('Quote templates cannot be converted to sales orders');
  }

  if (quote.status !== 'accepted') {
    throw new Error('Only accepted quotes can be converted to sales orders');
  }

  await knexOrTrx('quotes')
    .where({ tenant, quote_id: quote.quote_id })
    .forUpdate()
    .first();

  const existingSalesOrder = await getSalesOrderByQuoteId(knexOrTrx, tenant, quote.quote_id);
  if (existingSalesOrder) {
    return {
      quote: await Quote.getById(knexOrTrx, tenant, quote.quote_id) as IQuote,
      salesOrder: existingSalesOrder,
    };
  }

  if (quote.converted_invoice_id) {
    throw new Error('Quote already has a converted invoice; convert product lines to a sales order before invoice conversion');
  }

  if (!quote.client_id) {
    throw new Error('Quotes must be linked to a client before they can be converted to a sales order');
  }

  const quoteItems = quote.quote_items ?? [];
  const productServiceIds = await resolveProductServiceIds(knexOrTrx, tenant, quoteItems);
  const productItems = getSelectedProductOneTimeItems(quoteItems, productServiceIds);

  if (productItems.length === 0) {
    throw new Error('Quote does not contain any one-time product items selected for sales order conversion');
  }

  const missingServiceItem = productItems.find((item) => !item.service_id);
  if (missingServiceItem) {
    throw new Error(`Product quote item ${missingServiceItem.quote_item_id} must reference a catalog product before sales order conversion`);
  }

  const invalidQuantityItem = productItems.find((item) => !Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0);
  if (invalidQuantityItem) {
    throw new Error(`Product quote item ${invalidQuantityItem.quote_item_id} must have a positive integer quantity`);
  }

  const invalidPriceItem = productItems.find((item) => !Number.isInteger(Number(item.unit_price)));
  if (invalidPriceItem) {
    throw new Error(`Product quote item ${invalidPriceItem.quote_item_id} must have an integer unit price in cents`);
  }

  const nowIso = new Date().toISOString();
  const numberResult = await knexOrTrx.raw('SELECT generate_next_number(?::uuid, ?) as number', [tenant, 'SALES_ORDER']);
  const soNumber: string = numberResult.rows[0].number;

  const [salesOrder] = await knexOrTrx('sales_orders')
    .insert({
      tenant,
      so_number: soNumber,
      client_id: quote.client_id,
      status: 'draft',
      order_date: nowIso,
      expected_ship_date: null,
      ship_to: null,
      currency_code: quote.currency_code,
      client_po_number: quote.po_number ?? null,
      invoice_mode: 'on_fulfillment',
      allocation_mode: 'soft',
      notes: null,
      quote_id: quote.quote_id,
      created_by: performedBy ?? quote.accepted_by ?? quote.updated_by ?? quote.created_by ?? null,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .returning('*');

  const soId = (salesOrder as ISalesOrder).so_id;
  const serviceIds = Array.from(new Set(productItems.map((item) => item.service_id as string)));
  const costFallbacks = await resolveProductCostFallbacks(knexOrTrx, tenant, serviceIds);

  await knexOrTrx('sales_order_lines').insert(
    productItems.map((item) => {
      const serviceId = item.service_id as string;
      return {
        tenant,
        so_id: soId,
        service_id: serviceId,
        quantity_ordered: Number(item.quantity),
        quantity_fulfilled: 0,
        quantity_invoiced: 0,
        unit_price: Number(item.unit_price),
        cost_snapshot: toIntegerCents(item.cost) ?? costFallbacks.get(serviceId) ?? null,
        tax_rate_id: null,
        fulfillment_type: 'from_stock',
        parent_so_line_id: null,
        created_at: nowIso,
        updated_at: nowIso,
      };
    })
  );

  await knexOrTrx('quotes')
    .where({ tenant, quote_id: quote.quote_id })
    .update({
      updated_by: performedBy ?? quote.updated_by ?? quote.created_by ?? null,
      updated_at: nowIso,
    });

  await QuoteActivity.create(knexOrTrx, tenant, {
    quote_id: quote.quote_id,
    activity_type: 'converted_to_sales_order',
    description: `Quote converted to draft sales order ${soNumber}`,
    performed_by: performedBy ?? null,
    metadata: {
      so_id: soId,
      so_number: soNumber,
      product_item_count: productItems.length,
    },
  });

  const refreshedQuote = await Quote.getById(knexOrTrx, tenant, quote.quote_id);
  const refreshedSalesOrder = await getSalesOrderByQuoteId(knexOrTrx, tenant, quote.quote_id);

  return {
    quote: refreshedQuote as IQuote,
    salesOrder: refreshedSalesOrder as ISalesOrder & { lines: ISalesOrderLine[] },
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
    const db = tenantDb(knexOrTrx, tenant);
    const existingInvoice = await db.table('invoices')
      .where({ invoice_id: quote.converted_invoice_id })
      .first();

    if (existingInvoice) {
      return {
        quote: await Quote.getById(knexOrTrx, tenant, quote.quote_id) as IQuote,
        invoice: {
          ...existingInvoice,
          invoice_charges: await db.table('invoice_charges').where({ invoice_id: existingInvoice.invoice_id }),
        } as IInvoice,
      };
    }
  }

  if (!quote.client_id) {
    throw new Error('Quotes must be linked to a client before they can be converted to an invoice');
  }

  let oneTimeItems = getSelectedOneTimeItems(quote.quote_items ?? []);
  const salesOrderForQuote = await getSalesOrderByQuoteId(knexOrTrx, tenant, quote.quote_id);
  if (salesOrderForQuote) {
    const productServiceIds = await resolveProductServiceIds(knexOrTrx, tenant, oneTimeItems);
    oneTimeItems = excludeSalesOrderProductItems(oneTimeItems, productServiceIds);
  }

  if (oneTimeItems.length === 0) {
    throw new Error(salesOrderForQuote
      ? 'Quote does not contain any invoiceable one-time items after excluding sales-order product lines'
      : 'Quote does not contain any one-time items selected for invoice conversion');
  }

  const nowIso = new Date().toISOString();
  const invoiceNumber = await SharedNumberingService.getNextNumber('INVOICE', {
    knex: knexOrTrx,
    tenant,
  });

  const invoiceId = uuidv4();
  const db = tenantDb(knexOrTrx, tenant);
  await db.table('invoices').insert({
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
      location_id: item.location_id ?? null,
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

  await insertRowsUsingExistingColumns(knexOrTrx, tenant, 'invoice_charges', invoiceChargeRows);

  const invoiceSubtotal = invoiceChargeRows.reduce((sum, row) => sum + Number(row.net_amount), 0);
  const invoiceTax = invoiceChargeRows.reduce((sum, row) => sum + Number(row.tax_amount), 0);

  await db.table('invoices')
    .where({ invoice_id: invoiceId })
    .update({
      subtotal: Math.round(invoiceSubtotal),
      tax: Math.round(invoiceTax),
      total_amount: Math.round(invoiceSubtotal + invoiceTax),
    });

  const invoice = await db.table('invoices')
    .where({ invoice_id: invoiceId })
    .first();

  await db.table('quotes')
    .where({ quote_id: quote.quote_id })
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

  await tenantDb(knexOrTrx, tenant).table('quotes')
    .where({ quote_id: quoteId })
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
