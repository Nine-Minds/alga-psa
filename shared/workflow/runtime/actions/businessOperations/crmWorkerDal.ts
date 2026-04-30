import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type {
  IContract,
  IInvoice,
  IQuote,
  IQuoteItem,
  IQuoteActivity,
  QuoteConversionPreview,
  QuoteConversionPreviewItem,
  QuoteStatus,
  TaggedEntityType,
} from '@alga-psa/types';
import { SharedNumberingService } from '../../../../services/numberingService';

export const quoteStatusSchema = z.enum([
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'converted',
  'cancelled',
  'superseded',
  'archived',
]);

const quoteItemBillingMethodSchema = z.enum(['fixed', 'hourly', 'usage']);
const quoteDiscountTypeSchema = z.enum(['percentage', 'fixed']);

const createQuoteBaseSchema = z.object({
  client_id: z.string().uuid().optional().nullable(),
  contact_id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  quote_date: z.coerce.date(),
  valid_until: z.coerce.date(),
  po_number: z.string().trim().max(255).optional().nullable(),
  opportunity_id: z.string().uuid().optional().nullable(),
  internal_notes: z.string().optional().nullable(),
  client_notes: z.string().optional().nullable(),
  terms_and_conditions: z.string().optional().nullable(),
  currency_code: z.string().trim().length(3).default('USD'),
  tax_source: z.enum(['internal', 'external', 'pending_external']).default('internal'),
  is_template: z.boolean().default(false),
  created_by: z.string().uuid().optional().nullable(),
});

export const createQuoteSchema = createQuoteBaseSchema.superRefine((value, ctx) => {
  if (!value.is_template && !value.client_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'client_id is required for non-template quotes',
      path: ['client_id'],
    });
  }

  if (value.valid_until < value.quote_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'valid_until must be on or after quote_date',
      path: ['valid_until'],
    });
  }
});

const createQuoteItemBaseSchema = z.object({
  quote_id: z.string().uuid(),
  service_id: z.string().uuid().optional().nullable(),
  description: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().int().min(0).optional(),
  unit_of_measure: z.string().trim().optional().nullable(),
  display_order: z.number().int().min(0).optional(),
  phase: z.string().trim().optional().nullable(),
  is_optional: z.boolean().default(false),
  is_selected: z.boolean().default(true),
  is_recurring: z.boolean().default(false),
  billing_frequency: z.string().trim().optional().nullable(),
  billing_method: quoteItemBillingMethodSchema.optional().nullable(),
  is_discount: z.boolean().default(false),
  discount_type: quoteDiscountTypeSchema.optional().nullable(),
  discount_percentage: z.number().int().min(0).max(100).optional().nullable(),
  applies_to_item_id: z.string().uuid().optional().nullable(),
  applies_to_service_id: z.string().uuid().optional().nullable(),
  is_taxable: z.boolean().default(true),
  tax_region: z.string().trim().optional().nullable(),
  tax_rate: z.number().int().min(0).optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  cost: z.number().int().min(0).optional().nullable(),
  cost_currency: z.string().trim().length(3).optional().nullable(),
  created_by: z.string().uuid().optional().nullable(),
});

export const createQuoteItemSchema = createQuoteItemBaseSchema.superRefine((value, ctx) => {
  if (value.is_recurring && !value.billing_frequency) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'billing_frequency is required for recurring items',
      path: ['billing_frequency'],
    });
  }

  if (value.is_discount && !value.discount_type) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'discount_type is required for discount items',
      path: ['discount_type'],
    });
  }

  if (value.discount_type === 'percentage' && (value.discount_percentage === undefined || value.discount_percentage === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'discount_percentage is required for percentage discounts',
      path: ['discount_percentage'],
    });
  }
});

const QUOTE_ALLOWED_STATUS_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ['pending_approval', 'sent', 'cancelled'],
  pending_approval: ['approved', 'draft', 'cancelled'],
  approved: ['sent', 'cancelled'],
  sent: ['accepted', 'rejected', 'expired', 'cancelled'],
  accepted: ['converted', 'cancelled'],
  rejected: ['cancelled'],
  expired: ['cancelled'],
  converted: [],
  cancelled: [],
  superseded: [],
  archived: [],
};

function canTransitionQuoteStatus(currentStatus: QuoteStatus, nextStatus: QuoteStatus): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }
  return QUOTE_ALLOWED_STATUS_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function toQuoteDate(value?: string | Date | null): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function isQuoteItemIncluded(item: { is_optional?: boolean | null; is_selected?: boolean | null }): boolean {
  if (!item.is_optional) return true;
  return item.is_selected === true;
}

function calculateDiscountAmount(
  item: { quantity?: number | string | null; unit_price?: number | string | null; discount_type?: string | null; discount_percentage?: number | string | null },
  baseAmount: number
): number {
  if (item.discount_type === 'percentage') {
    return Math.round(baseAmount * (toNumber(item.discount_percentage) / 100));
  }

  return Math.abs(toNumber(item.quantity || 1) * toNumber(item.unit_price));
}

function isDateApplicable(row: { start_date?: string | Date | null; end_date?: string | Date | null }, date: string): boolean {
  const currentDate = new Date(date);
  if (row.start_date && new Date(row.start_date) > currentDate) return false;
  if (row.end_date && new Date(row.end_date) < currentDate) return false;
  return true;
}

function calculateThresholdBasedTax(
  thresholds: Array<{ min_amount: number | string; max_amount?: number | string | null; rate: number | string }>,
  netAmount: number
): { taxAmount: number; taxRate: number } {
  let taxAmount = 0;
  let remainingAmount = netAmount;

  for (const threshold of thresholds) {
    if (remainingAmount <= 0) break;

    const minAmount = toNumber(threshold.min_amount);
    const maxAmount = threshold.max_amount == null ? null : toNumber(threshold.max_amount);
    const taxableAmount = maxAmount == null
      ? remainingAmount
      : Math.min(remainingAmount, Math.max(maxAmount - minAmount, 0));

    taxAmount += Math.ceil((taxableAmount * toNumber(threshold.rate)) / 100);
    remainingAmount -= taxableAmount;
  }

  return {
    taxAmount,
    taxRate: netAmount > 0 ? (taxAmount / netAmount) * 100 : 0,
  };
}

async function getApplicableTaxHoliday(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string,
  date: string
): Promise<Record<string, unknown> | undefined> {
  const currentDate = new Date(date);
  const holidays = await knexOrTrx('tax_holidays')
    .where({ tenant, tax_rate_id: taxRateId })
    .orderBy('start_date');

  return holidays.find((holiday) =>
    new Date(holiday.start_date) <= currentDate && new Date(holiday.end_date) >= currentDate
  );
}

async function calculateComponentTax(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  component: Record<string, unknown>,
  amount: number,
  date: string
): Promise<number> {
  const holiday = await getApplicableTaxHoliday(knexOrTrx, tenant, String(component.tax_rate_id), date);
  if (holiday) return 0;
  return Math.ceil((amount * toNumber(component.rate)) / 100);
}

async function calculateTaxWithConnection(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  netAmount: number,
  date: string,
  regionCode: string | undefined,
  isTaxable: boolean,
  currencyCode?: string | null
): Promise<{ taxAmount: number; taxRate: number }> {
  const client = await knexOrTrx('clients')
    .where({ tenant, client_id: clientId })
    .select('is_tax_exempt')
    .first();

  if (!client) {
    throw new Error(`Client ${clientId} not found in tenant ${tenant}`);
  }

  if (client.is_tax_exempt || !isTaxable) {
    return { taxAmount: 0, taxRate: 0 };
  }

  const taxSettings = await knexOrTrx('client_tax_settings')
    .where({ tenant, client_id: clientId })
    .select('is_reverse_charge_applicable')
    .first();
  if (taxSettings?.is_reverse_charge_applicable) {
    return { taxAmount: 0, taxRate: 0 };
  }

  if (regionCode) {
    const applicableRates = await knexOrTrx('tax_rates')
      .where({ tenant, region_code: regionCode, is_active: true })
      .andWhere('start_date', '<=', date)
      .andWhere(function dateRange() {
        this.whereNull('end_date').orWhere('end_date', '>', date);
      })
      .andWhere(function currencyRange() {
        this.whereNull('currency_code');
        if (currencyCode) this.orWhere('currency_code', currencyCode);
      })
      .select('tax_percentage');

    const combinedTaxRate = applicableRates.reduce((sum, rate) => sum + toNumber(rate.tax_percentage), 0);
    return {
      taxAmount: netAmount > 0 ? Math.ceil((netAmount * combinedTaxRate) / 100) : 0,
      taxRate: combinedTaxRate,
    };
  }

  const defaultRateAssoc = await knexOrTrx('client_tax_rates')
    .where({ tenant, client_id: clientId, is_default: true })
    .whereNull('location_id')
    .select('tax_rate_id')
    .first();

  if (!defaultRateAssoc) {
    return { taxAmount: 0, taxRate: 0 };
  }

  const taxRate = await knexOrTrx('tax_rates')
    .where({ tenant, tax_rate_id: defaultRateAssoc.tax_rate_id, is_active: true })
    .andWhere('start_date', '<=', date)
    .andWhere(function dateRange() {
      this.whereNull('end_date').orWhere('end_date', '>', date);
    })
    .andWhere(function currencyRange() {
      this.whereNull('currency_code');
      if (currencyCode) this.orWhere('currency_code', currencyCode);
    })
    .first();

  if (!taxRate) {
    return { taxAmount: 0, taxRate: 0 };
  }

  if (taxRate.is_composite) {
    const components = await knexOrTrx('tax_components')
      .join('composite_tax_mappings', function joinMappings() {
        this.on('tax_components.tax_component_id', '=', 'composite_tax_mappings.tax_component_id')
          .andOn('tax_components.tenant', '=', 'composite_tax_mappings.tenant');
      })
      .where({
        'tax_components.tenant': tenant,
        'composite_tax_mappings.composite_tax_id': taxRate.tax_rate_id,
      })
      .orderBy('composite_tax_mappings.sequence')
      .select('tax_components.*');

    let totalTaxAmount = 0;
    let taxableAmount = netAmount;
    for (const component of components) {
      if (!isDateApplicable(component, date)) continue;
      const componentTax = await calculateComponentTax(knexOrTrx, tenant, component, taxableAmount, date);
      totalTaxAmount += componentTax;
      if (component.is_compound) taxableAmount += componentTax;
    }

    return {
      taxAmount: totalTaxAmount,
      taxRate: netAmount > 0 ? (totalTaxAmount / netAmount) * 100 : 0,
    };
  }

  const thresholds = await knexOrTrx('tax_rate_thresholds')
    .where({ tenant, tax_rate_id: taxRate.tax_rate_id })
    .orderBy('min_amount');

  if (thresholds.length > 0) {
    return calculateThresholdBasedTax(thresholds, netAmount);
  }

  if (netAmount <= 0) {
    return { taxAmount: 0, taxRate: toNumber(taxRate.tax_percentage) };
  }

  const taxRatePercentage = toNumber(taxRate.tax_percentage);
  return {
    taxAmount: Math.ceil((netAmount * taxRatePercentage) / 100),
    taxRate: taxRatePercentage,
  };
}

async function recalculateQuoteFinancials(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string
): Promise<void> {
  const quote = await knexOrTrx('quotes')
    .where({ tenant, quote_id: quoteId })
    .first() as (Record<string, unknown> & { quote_id: string; client_id?: string | null; quote_date?: string | null; currency_code?: string | null; tax_source?: 'internal' | 'external' | 'pending_external' | null }) | undefined;

  if (!quote) {
    return;
  }

  const items = await knexOrTrx('quote_items')
    .where({ tenant, quote_id: quoteId })
    .orderBy('display_order', 'asc')
    .orderBy('created_at', 'asc') as Array<Record<string, unknown> & {
      quote_item_id: string;
      service_id?: string | null;
      quantity: number | string;
      unit_price: number | string;
      is_discount?: boolean | null;
      discount_type?: 'percentage' | 'fixed' | null;
      discount_percentage?: number | string | null;
      applies_to_item_id?: string | null;
      applies_to_service_id?: string | null;
      is_optional?: boolean | null;
      is_selected?: boolean | null;
      is_taxable?: boolean | null;
      tax_region?: string | null;
      tax_rate?: number | string | null;
      location_id?: string | null;
    }>;

  const client = quote.client_id
    ? await knexOrTrx('clients')
        .where({ tenant, client_id: quote.client_id })
        .select('region_code')
        .first()
    : null;

  const distinctLocationIds = Array.from(
    new Set(
      items
        .map((item) => item.location_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );
  const locationRegionMap = new Map<string, string | null>();
  if (distinctLocationIds.length > 0) {
    const locationRows = await knexOrTrx('client_locations')
      .where({ tenant })
      .whereIn('location_id', distinctLocationIds)
      .select('location_id', 'region_code');
    for (const row of locationRows) {
      locationRegionMap.set(row.location_id as string, (row.region_code as string | null | undefined) ?? null);
    }
  }

  const quoteDate = toQuoteDate(quote.quote_date);
  const currencyCode = quote.currency_code ?? 'USD';
  const taxSource = quote.tax_source ?? 'internal';
  const includedBaseItems = items.filter((item) => !item.is_discount && isQuoteItemIncluded(item));
  const baseSubtotal = includedBaseItems.reduce((sum, item) => sum + (toNumber(item.quantity) * toNumber(item.unit_price)), 0);
  const baseItemTotals = new Map(includedBaseItems.map((item) => [item.quote_item_id, toNumber(item.quantity) * toNumber(item.unit_price)]));
  const baseServiceTotals = new Map<string, number>();

  for (const item of includedBaseItems) {
    if (!item.service_id) {
      continue;
    }

    baseServiceTotals.set(
      item.service_id,
      (baseServiceTotals.get(item.service_id) ?? 0) + (toNumber(item.quantity) * toNumber(item.unit_price))
    );
  }

  let subtotal = 0;
  let discountTotal = 0;
  let tax = 0;

  for (const item of items) {
    const totalPrice = toNumber(item.quantity) * toNumber(item.unit_price);
    const isIncludedInTotals = isQuoteItemIncluded(item);
    const isDiscount = item.is_discount === true;
    const locationRegionCode = item.location_id ? (locationRegionMap.get(item.location_id) ?? null) : null;
    const taxRegion = item.tax_region ?? locationRegionCode ?? client?.region_code ?? null;

    const scopedBaseAmount = item.applies_to_item_id
      ? (baseItemTotals.get(item.applies_to_item_id) ?? 0)
      : item.applies_to_service_id
        ? (baseServiceTotals.get(item.applies_to_service_id) ?? 0)
        : baseSubtotal;
    const resolvedTotalPrice = isDiscount ? calculateDiscountAmount(item, scopedBaseAmount) : totalPrice;

    const netAmount = isIncludedInTotals ? resolvedTotalPrice : 0;
    let taxAmount = 0;
    let taxRate = isIncludedInTotals ? toNumber(item.tax_rate) : 0;

    if (isDiscount) {
      discountTotal += isIncludedInTotals ? resolvedTotalPrice : 0;
    } else {
      subtotal += isIncludedInTotals ? resolvedTotalPrice : 0;

      if (isIncludedInTotals && quote.client_id && taxSource === 'internal') {
        const taxResult = await calculateTaxWithConnection(
          knexOrTrx,
          tenant,
          quote.client_id,
          netAmount,
          quoteDate,
          taxRegion ?? undefined,
          item.is_taxable !== false,
          currencyCode
        );

        taxAmount = taxResult.taxAmount;
        taxRate = Math.round(Number(taxResult.taxRate ?? 0));
      } else if (taxSource !== 'internal') {
        taxAmount = 0;
        taxRate = 0;
      }

      tax += taxAmount;
    }

    await knexOrTrx('quote_items')
      .where({ tenant, quote_item_id: item.quote_item_id })
      .update({
        total_price: resolvedTotalPrice,
        net_amount: netAmount,
        tax_amount: taxAmount,
        tax_region: taxRegion,
        tax_rate: taxRate,
        updated_at: knexOrTrx.fn.now(),
      });
  }

  await knexOrTrx('quotes')
    .where({ tenant, quote_id: quoteId })
    .update({
      subtotal,
      discount_total: discountTotal,
      tax,
      total_amount: subtotal - discountTotal + tax,
      updated_at: knexOrTrx.fn.now(),
    });
}

function normalizeQuoteItem(row: Record<string, unknown>): IQuoteItem {
  return {
    ...row,
    quantity: Number(row.quantity),
    unit_price: Number(row.unit_price),
    total_price: Number(row.total_price),
    tax_amount: Number(row.tax_amount),
    net_amount: Number(row.net_amount),
    discount_percentage: row.discount_percentage == null ? row.discount_percentage : Number(row.discount_percentage),
    display_order: Number(row.display_order),
    tax_rate: row.tax_rate == null ? row.tax_rate : Number(row.tax_rate),
    cost: row.cost == null ? null : Number(row.cost),
    cost_currency: row.cost_currency ?? null,
  } as IQuoteItem;
}

async function getNextQuoteItemDisplayOrder(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string
): Promise<number> {
  const result = await knexOrTrx('quote_items')
    .where({ tenant, quote_id: quoteId })
    .max<{ max?: number | string }>('display_order as max')
    .first();

  return Number(result?.max ?? -1) + 1;
}

function ensureIntegerField(value: unknown, fieldName: string): void {
  if (value !== undefined && value !== null && !Number.isInteger(Number(value))) {
    throw new Error(`${fieldName} must be an integer`);
  }
}

function getTodayStartUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isExpiredOnAccess(quote: Pick<IQuote, 'status' | 'valid_until'>): boolean {
  if (quote.status !== 'sent' || !quote.valid_until) {
    return false;
  }

  return new Date(quote.valid_until) < getTodayStartUTC();
}

async function expireQuoteIfNeeded(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quote: IQuote | null
): Promise<IQuote | null> {
  if (!quote || !isExpiredOnAccess(quote)) {
    return quote;
  }

  const [expiredQuote] = await knexOrTrx('quotes')
    .where({ tenant, quote_id: quote.quote_id })
    .update({
      status: 'expired',
      expired_at: knexOrTrx.fn.now(),
      updated_at: knexOrTrx.fn.now(),
    })
    .returning('*');

  await QuoteActivity.create(knexOrTrx, tenant, {
    quote_id: quote.quote_id,
    activity_type: 'expired',
    description: 'Quote automatically expired on access',
    performed_by: null,
    metadata: { previous_status: quote.status },
  });

  return expiredQuote as IQuote;
}

async function mapQuoteRecord(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quote: IQuote | null
): Promise<IQuote | null> {
  const resolvedQuote = await expireQuoteIfNeeded(knexOrTrx, tenant, quote);
  if (!resolvedQuote) {
    return null;
  }

  resolvedQuote.quote_items = await QuoteItem.listByQuoteId(knexOrTrx, tenant, resolvedQuote.quote_id);
  resolvedQuote.quote_activities = await QuoteActivity.listByQuoteId(knexOrTrx, tenant, resolvedQuote.quote_id);
  return resolvedQuote;
}

export const QuoteActivity = {
  async create(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    activity: Omit<IQuoteActivity, 'activity_id' | 'tenant' | 'created_at'>
  ): Promise<IQuoteActivity> {
    if (!tenant) {
      throw new Error('Tenant context is required for creating quote activity');
    }

    const [createdActivity] = await knexOrTrx('quote_activities')
      .insert({ tenant, ...activity, metadata: activity.metadata ?? {} })
      .returning('*');

    return createdActivity as IQuoteActivity;
  },

  async listByQuoteId(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteId: string
  ): Promise<IQuoteActivity[]> {
    if (!tenant) {
      throw new Error('Tenant context is required for listing quote activities');
    }

    return knexOrTrx('quote_activities')
      .where({ tenant, quote_id: quoteId })
      .orderBy('created_at', 'asc') as Promise<IQuoteActivity[]>;
  },
};

export const QuoteItem = {
  async listByQuoteId(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteId: string
  ): Promise<IQuoteItem[]> {
    if (!tenant) {
      throw new Error('Tenant context is required for listing quote items');
    }

    const items = await knexOrTrx('quote_items')
      .where({ tenant, quote_id: quoteId })
      .orderBy('display_order', 'asc')
      .orderBy('created_at', 'asc');

    return items.map((item) => normalizeQuoteItem(item));
  },

  async create(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    item: Omit<IQuoteItem, 'quote_item_id' | 'tenant' | 'total_price' | 'net_amount' | 'tax_amount' | 'display_order' | 'created_at' | 'updated_at'> & Partial<Pick<IQuoteItem, 'display_order'>>
  ): Promise<IQuoteItem> {
    if (!tenant) {
      throw new Error('Tenant context is required for creating quote item');
    }

    ensureIntegerField(item.quantity, 'Quantity');
    ensureIntegerField(item.unit_price, 'Unit price');

    let resolvedItem = { ...item } as Record<string, unknown> & { service_id?: string | null; quote_id: string; display_order?: number; unit_price?: number | null; quantity?: number | null; description?: string | null; service_item_kind?: string | null; cost?: number | null; cost_currency?: string | null };

    if (item.service_id) {
      const service = await knexOrTrx('service_catalog')
        .where({ tenant, service_id: item.service_id })
        .select(
          'service_name',
          'sku',
          'default_rate',
          'unit_of_measure',
          'billing_method',
          'item_kind',
          'cost',
          'cost_currency'
        )
        .first();

      if (!service) {
        throw new Error(`Service ${item.service_id} not found in tenant ${tenant}`);
      }

      let resolvedUnitPrice = resolvedItem.unit_price;
      if (resolvedUnitPrice == null) {
        const quote = await knexOrTrx('quotes')
          .where({ tenant, quote_id: item.quote_id })
          .select('currency_code')
          .first();
        const currencyCode = quote?.currency_code ?? 'USD';

        const priceRow = await knexOrTrx('service_prices')
          .where({ tenant, service_id: item.service_id, currency_code: currencyCode })
          .select('rate')
          .first();

        resolvedUnitPrice = priceRow ? Number(priceRow.rate) : Number(service.default_rate ?? 0);
      }

      const resolvedItemKind = resolvedItem.service_item_kind ?? service.item_kind ?? 'service';

      resolvedItem = {
        ...resolvedItem,
        service_name: resolvedItem.service_name ?? service.service_name,
        service_sku: resolvedItem.service_sku ?? service.sku ?? null,
        unit_price: resolvedUnitPrice,
        unit_of_measure: resolvedItem.unit_of_measure ?? service.unit_of_measure ?? null,
        billing_method: resolvedItem.billing_method ?? service.billing_method ?? null,
        service_item_kind: resolvedItemKind,
        description: resolvedItem.description || service.service_name,
        cost: resolvedItemKind === 'product' && service.cost != null ? Number(service.cost) : resolvedItem.cost ?? null,
        cost_currency: resolvedItemKind === 'product' && service.cost_currency ? service.cost_currency : resolvedItem.cost_currency ?? null,
      };
    }

    const quantity = Number(resolvedItem.quantity ?? 1);
    const unitPrice = Number(resolvedItem.unit_price ?? 0);
    const totalPrice = quantity * unitPrice;
    const displayOrder = resolvedItem.display_order ?? await getNextQuoteItemDisplayOrder(knexOrTrx, tenant, item.quote_id);

    const [createdItem] = await knexOrTrx('quote_items')
      .insert({
        tenant,
        ...resolvedItem,
        quantity,
        unit_price: unitPrice,
        total_price: totalPrice,
        net_amount: totalPrice,
        tax_amount: 0,
        display_order: displayOrder,
      })
      .returning('*');

    await recalculateQuoteFinancials(knexOrTrx, tenant, item.quote_id);

    const refreshedItem = await knexOrTrx('quote_items')
      .where({ tenant, quote_item_id: createdItem.quote_item_id })
      .first();

    return normalizeQuoteItem(refreshedItem ?? createdItem);
  },
};

export const Quote = {
  async getById(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteId: string
  ): Promise<IQuote | null> {
    if (!tenant) {
      throw new Error('Tenant context is required for getting quote');
    }

    const quote = await knexOrTrx('quotes')
      .where({ tenant, quote_id: quoteId })
      .first();

    return mapQuoteRecord(knexOrTrx, tenant, (quote ?? null) as IQuote | null);
  },

  async create(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quote: Omit<IQuote, 'quote_id' | 'tenant' | 'quote_number' | 'quote_items' | 'quote_activities' | 'created_at' | 'updated_at' | 'status' | 'version'> & Partial<Pick<IQuote, 'status' | 'version'>>
  ): Promise<IQuote> {
    if (!tenant) {
      throw new Error('Tenant context is required for creating quote');
    }

    const quoteNumber = quote.is_template
      ? null
      : await SharedNumberingService.getNextNumber('QUOTE', { knex: knexOrTrx, tenant });

    const [createdQuote] = await knexOrTrx('quotes')
      .insert({
        tenant,
        ...quote,
        quote_number: quoteNumber,
        status: quote.is_template ? null : (quote.status ?? 'draft'),
        version: quote.version ?? 1,
      })
      .returning('*');

    await QuoteActivity.create(knexOrTrx, tenant, {
      quote_id: createdQuote.quote_id,
      activity_type: 'created',
      description: quote.is_template ? 'Quote template created' : 'Quote created',
      performed_by: createdQuote.created_by ?? null,
      metadata: { is_template: createdQuote.is_template },
    });

    return createdQuote as IQuote;
  },

  async update(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteId: string,
    updateData: Partial<IQuote>
  ): Promise<IQuote> {
    if (!tenant) {
      throw new Error('Tenant context is required for updating quote');
    }

    const existingQuote = await knexOrTrx('quotes')
      .where({ tenant, quote_id: quoteId })
      .first();

    if (!existingQuote) {
      throw new Error(`Quote ${quoteId} not found in tenant ${tenant}`);
    }

    if (existingQuote.is_template && updateData.status !== undefined && updateData.status !== null) {
      throw new Error('Quote templates do not participate in status transitions');
    }

    if (updateData.status && existingQuote.status && !canTransitionQuoteStatus(existingQuote.status, updateData.status)) {
      throw new Error(`Invalid quote status transition from ${existingQuote.status} to ${updateData.status}`);
    }

    const [updatedQuote] = await knexOrTrx('quotes')
      .where({ tenant, quote_id: quoteId })
      .update({ ...updateData, updated_at: knexOrTrx.fn.now() })
      .returning('*');

    await QuoteActivity.create(knexOrTrx, tenant, {
      quote_id: quoteId,
      activity_type: updateData.status && updateData.status !== existingQuote.status ? 'status_changed' : 'updated',
      description: updateData.status && updateData.status !== existingQuote.status
        ? `Quote status changed from ${existingQuote.status} to ${updateData.status}`
        : 'Quote updated',
      performed_by: updatedQuote.updated_by ?? null,
      metadata: updateData.status && updateData.status !== existingQuote.status
        ? { previous_status: existingQuote.status, next_status: updateData.status }
        : {},
    });

    if (!updatedQuote.is_template) {
      await recalculateQuoteFinancials(knexOrTrx, tenant, quoteId);
      const recalculatedQuote = await knexOrTrx('quotes')
        .where({ tenant, quote_id: quoteId })
        .first();
      return (recalculatedQuote ?? updatedQuote) as IQuote;
    }

    return updatedQuote as IQuote;
  },
};

export interface QuoteApprovalWorkflowSettings {
  approvalRequired: boolean;
}

function normalizeSettings(rawSettings: unknown): Record<string, any> {
  if (!rawSettings) {
    return {};
  }

  if (typeof rawSettings === 'string') {
    try {
      return JSON.parse(rawSettings);
    } catch {
      return {};
    }
  }

  if (typeof rawSettings === 'object') {
    return rawSettings as Record<string, any>;
  }

  return {};
}

export async function getQuoteApprovalWorkflowSettings(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<QuoteApprovalWorkflowSettings> {
  const row = await knexOrTrx('tenant_settings')
    .select('settings')
    .where({ tenant })
    .first<{ settings?: unknown }>();

  const settings = normalizeSettings(row?.settings);
  return {
    approvalRequired: settings.billing?.quotes?.approvalRequired === true,
  };
}

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

  await knexOrTrx(tableName).insert(filteredRows);
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

  const rows = await knexOrTrx('client_locations')
    .where({ tenant })
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

const Contract = {
  async getById(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    contractId: string
  ): Promise<IContract | null> {
    const contract = await knexOrTrx('contracts')
      .where({ tenant, contract_id: contractId })
      .andWhere((builder) => builder.whereNull('is_template').orWhere('is_template', false))
      .first();
    return (contract ?? null) as IContract | null;
  },

  async create(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    contract: Omit<IContract, 'contract_id'>
  ): Promise<IContract> {
    const timestamp = new Date().toISOString();
    const ownerClientId = typeof contract.owner_client_id === 'string' && contract.owner_client_id.trim().length > 0
      ? contract.owner_client_id.trim()
      : null;
    if (!contract.is_template && !ownerClientId) {
      throw new Error('Non-template contracts require an owning client');
    }

    const [created] = await knexOrTrx('contracts')
      .insert({
        ...contract,
        owner_client_id: ownerClientId,
        contract_id: uuidv4(),
        tenant,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .returning('*');

    return created as IContract;
  },
};

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
  } as Omit<IContract, 'contract_id'>);

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
  }

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

  const clientContractId = uuidv4();
  await knexOrTrx('client_contracts').insert({
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

  await insertRowsUsingExistingColumns(knexOrTrx, 'invoice_charges', invoiceChargeRows);

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

export interface ITagDefinition {
  tenant: string;
  tag_id: string;
  tag_text: string;
  tagged_type: TaggedEntityType;
  board_id?: string | null;
  background_color?: string | null;
  text_color?: string | null;
  created_at?: Date;
}

export interface ITagMapping {
  tenant: string;
  mapping_id: string;
  tag_id: string;
  tagged_id: string;
  tagged_type: TaggedEntityType;
  created_at?: Date;
  created_by?: string | null;
}

export const TagDefinition = {
  async findByTextAndType(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tagText: string,
    taggedType: TaggedEntityType
  ): Promise<ITagDefinition | undefined> {
    return knexOrTrx<ITagDefinition>('tag_definitions')
      .where('tag_text', tagText.trim())
      .where('tagged_type', taggedType)
      .where('tenant', tenant)
      .first();
  },

  async insert(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    definition: Omit<ITagDefinition, 'tag_id' | 'tenant' | 'created_at'>
  ): Promise<ITagDefinition> {
    const normalizedDefinition = {
      ...definition,
      tag_text: definition.tag_text.trim(),
      tag_id: uuidv4(),
      tenant,
    };

    const [inserted] = await knexOrTrx<ITagDefinition>('tag_definitions')
      .insert(normalizedDefinition)
      .returning('*');
    return inserted;
  },

  async getOrCreateWithStatus(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    tagText: string,
    taggedType: TaggedEntityType,
    defaults: Partial<Omit<ITagDefinition, 'tag_id' | 'tenant' | 'tag_text' | 'tagged_type'>> = {}
  ): Promise<{ definition: ITagDefinition; created: boolean }> {
    let definition = await TagDefinition.findByTextAndType(knexOrTrx, tenant, tagText, taggedType);

    if (definition) {
      return { definition, created: false };
    }

    try {
      definition = await TagDefinition.insert(knexOrTrx, tenant, {
        tag_text: tagText,
        tagged_type: taggedType,
        ...defaults,
      });
      return { definition, created: true };
    } catch (insertError: unknown) {
      const errorCode =
        typeof insertError === 'object' && insertError !== null && 'code' in insertError
          ? String((insertError as { code?: unknown }).code)
          : undefined;
      const errorMessage = insertError instanceof Error ? insertError.message : undefined;

      if (errorCode === '23505' || errorMessage?.includes('duplicate')) {
        definition = await TagDefinition.findByTextAndType(knexOrTrx, tenant, tagText, taggedType);
        if (!definition) {
          throw insertError;
        }
        return { definition, created: false };
      }
      throw insertError;
    }
  },
};

export const TagMapping = {
  async insert(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    mapping: Omit<ITagMapping, 'mapping_id' | 'tenant' | 'created_at'>,
    userId?: string
  ): Promise<ITagMapping> {
    const fullMapping = {
      ...mapping,
      mapping_id: uuidv4(),
      tenant,
      created_by: userId || mapping.created_by || null,
    };

    const [inserted] = await knexOrTrx<ITagMapping>('tag_mappings')
      .insert(fullMapping)
      .returning('*');

    return inserted;
  },
};
