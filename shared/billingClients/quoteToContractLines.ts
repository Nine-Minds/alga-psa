/**
 * Quote → contract line/config construction: the ONE implementation shared by
 * `packages/billing` `quoteConversionService` (the UI path) and the workflow
 * runtime's `crmWorkerDal` (the workflow path). Both paths must create the same
 * contract records for the same accepted quote, so the rows are written here
 * once instead of twice.
 *
 * Pricing semantics (the UI path's settled rules, kept verbatim)
 * -------------------------------------------------------------
 * The billing engine treats a non-NULL `contract_lines.custom_rate` as the
 * WHOLE fee of the line for one period (see resolveFixedLineRate /
 * computeFixedCharges); it never multiplies it by a quantity. So:
 *
 * - A recurring catalog service on a Fixed line with an integer quantity
 *   converts to a PER-UNIT line: no line rate, the quoted unit price on the
 *   member (`base_rate`, `pricing_basis='unit'`) and the quoted quantity on the
 *   configuration, so the fee derives as quantity × rate and a later quantity
 *   change reprices through the normal revision path.
 * - Anything else on a Fixed line is BUNDLE priced: the line carries the quoted
 *   recurring amount (quantity × unit price), never the unit price alone.
 * - Products are never units: their per-unit rate lives on the member and the
 *   quantity on the configuration, so the line keeps the unit price.
 *
 * Writing the unit price as the line rate for a quantity ≠ 1 under-bills the
 * line by (quantity - 1) × unit price, which is exactly what the workflow path
 * used to do.
 */

import type { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { Temporal } from '@js-temporal/polyfill';
import { resolveEffectiveTimeZone, tenantDb } from '@alga-psa/db';
import { resolveUnitOfMeasure } from '@alga-psa/core/unitOfMeasure';
import type { IQuoteItem } from '@alga-psa/types';
import { resolveFixedMemberRatePair } from './fixedMemberRate';

export type ContractLineType = 'Fixed' | 'Hourly' | 'Usage';

export interface ContractLineMapping {
  item: IQuoteItem;
  contractLineId: string;
  contractLineType: ContractLineType;
  isUnitPriced: boolean;
}

export interface QuoteContractLinesResult {
  mappings: ContractLineMapping[];
  /** Base quote item → the contract line created for it (discount carry-over keying). */
  contractLineIdByBaseQuoteItemId: Map<string, string>;
}

const tableColumnCache = new Map<string, Set<string>>();

export async function getTableColumns(
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

/** Insert tenant-scoped rows, dropping keys this deployment's schema does not have yet. */
export async function insertRowsUsingExistingColumns(
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

/**
 * A recurring item with no catalog service becomes a Fixed line with a recurring amount and
 * nothing to bill it on; the billing engine refuses such a line (FIXED_LINE_NO_SERVICES), and
 * the contract wizard cannot finish it. Conversion therefore refuses it up front.
 */
export function serviceLessRecurringMessage(item: Pick<IQuoteItem, 'description'>): string {
  return `Recurring item "${item.description}" must reference a catalog service before contract conversion`;
}

/** Refuse a conversion whose recurring items could not be billed. Call before creating the contract. */
export function assertRecurringItemsConvertible(recurringItems: IQuoteItem[]): void {
  const serviceLessItem = recurringItems.find((item) => !item.service_id);
  if (serviceLessItem) {
    throw new Error(serviceLessRecurringMessage(serviceLessItem));
  }
}

export function mapQuoteItemToContractLineType(item: IQuoteItem): ContractLineType {
  if (item.billing_method === 'hourly') {
    return 'Hourly';
  }

  if (item.billing_method === 'usage') {
    return 'Usage';
  }

  return 'Fixed';
}

export function getContractLineBillingTiming(item: IQuoteItem): 'arrears' | 'advance' {
  return item.billing_method === 'hourly' || item.billing_method === 'usage'
    ? 'arrears'
    : 'advance';
}

export function isProductQuoteItem(item: IQuoteItem, productServiceIds: Set<string>): boolean {
  return item.service_item_kind === 'product'
    || (typeof item.service_id === 'string' && productServiceIds.has(item.service_id));
}

/**
 * The quoted recurring amount of a bundle-priced Fixed row: quantity x unit price in integer
 * cents. Product rows keep their unit price (their per-unit rate lives on the member).
 */
export function bundleLineTotal(item: IQuoteItem, productServiceIds: Set<string>): number {
  if (isProductQuoteItem(item, productServiceIds)) {
    return item.unit_price;
  }
  return Math.round(Number(item.quantity) * Number(item.unit_price));
}

/**
 * A recurring catalog service on a Fixed line converts to a per-unit service:
 * the quoted quantity is the seat count and the quoted unit price is the rate
 * per unit (contract_line_service_fixed_config.pricing_basis = 'unit'), so a
 * later quantity change reprices through the normal revision path. Products are
 * never units, custom items without a catalog service have nothing to attach a
 * per-unit configuration to, and a fractional quantity is not a seat count;
 * those keep the bundle pricing they always had.
 */
export function isUnitPricedRecurringItem(
  item: IQuoteItem,
  contractLineType: ContractLineType,
  productServiceIds: Set<string>
): boolean {
  if (contractLineType !== 'Fixed' || !item.service_id) {
    return false;
  }
  if (isProductQuoteItem(item, productServiceIds)) {
    return false;
  }
  const quantity = Number(item.quantity);
  return Number.isInteger(quantity) && quantity >= 0;
}

export async function resolveProductServiceIds(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  items: IQuoteItem[]
): Promise<Set<string>> {
  const serviceIds = quotedServiceIds(items);

  if (serviceIds.length === 0) {
    return new Set();
  }

  const rows = await knexOrTrx('service_catalog')
    .where({ tenant, item_kind: 'product' })
    .whereIn('service_id', serviceIds)
    .select('service_id');

  return new Set(rows.map((row) => row.service_id as string));
}

/**
 * Service category per quoted service. Converted contract lines must carry the
 * catalog category so category-based billing splits see them like any other line.
 */
export async function resolveServiceCategoryIds(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  items: IQuoteItem[]
): Promise<Map<string, string | null>> {
  const serviceIds = quotedServiceIds(items);

  if (serviceIds.length === 0) {
    return new Map();
  }

  const rows = await knexOrTrx('service_catalog')
    .where({ tenant })
    .whereIn('service_id', serviceIds)
    .select('service_id', 'category_id');

  return new Map(rows.map((row) => [row.service_id as string, (row.category_id as string | null) ?? null]));
}

function quotedServiceIds(items: IQuoteItem[]): string[] {
  return Array.from(
    new Set(
      items
        .map((item) => item.service_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );
}

/**
 * Date-only value of an instant (or date) in the tenant's effective time zone.
 * `client_contracts.start_date` is a date column; handing the database a
 * timestamp would let the session time zone pick the day.
 */
export function toDateOnlyInTimeZone(value: string | Date, timeZone: string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return Temporal.Instant.from(iso).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

export type QuoteConversionStartDateSource = {
  accepted_at?: string | Date | null;
  quote_date?: string | Date | null;
};

/**
 * The calendar date the converted contract starts on (and the date its carried
 * discounts take effect): the acceptance instant read in the tenant's time zone.
 */
export async function resolveQuoteContractStartDate(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quote: QuoteConversionStartDateSource,
  nowIso: string
): Promise<string> {
  const effectiveTimeZone = await resolveEffectiveTimeZone(knexOrTrx, tenant);
  return toDateOnlyInTimeZone(quote.accepted_at || quote.quote_date || nowIso, effectiveTimeZone);
}

/**
 * Create the contract lines, their services, the service configuration and the
 * typed fixed/hourly/usage configuration rows for one quote's recurring items.
 * The caller owns the contract itself, the client assignment and the carried
 * discounts (keyed by the returned map).
 */
export async function insertQuoteContractLines(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  params: {
    recurringItems: IQuoteItem[];
    contractId: string;
    billingFrequency: string;
    nowIso: string;
  }
): Promise<QuoteContractLinesResult> {
  const { recurringItems, contractId, billingFrequency, nowIso } = params;
  const productServiceIds = await resolveProductServiceIds(knexOrTrx, tenant, recurringItems);
  const categoryByServiceId = await resolveServiceCategoryIds(knexOrTrx, tenant, recurringItems);
  const mappings: ContractLineMapping[] = recurringItems.map((item) => {
    const contractLineType = mapQuoteItemToContractLineType(item);
    return {
      item,
      contractLineId: randomUUID(),
      contractLineType,
      isUnitPriced: isUnitPricedRecurringItem(item, contractLineType, productServiceIds),
    };
  });

  const db = tenantDb(knexOrTrx, tenant);
  await db.table('contract_lines').insert(
    mappings.map(({ item, contractLineId, contractLineType, isUnitPriced }, index) => ({
      tenant,
      contract_line_id: contractLineId,
      contract_id: contractId,
      contract_line_name: item.service_name || item.description,
      description: item.description,
      billing_frequency: item.billing_frequency || billingFrequency,
      is_custom: true,
      contract_line_type: contractLineType,
      billing_timing: getContractLineBillingTiming(item),
      display_order: index,
      service_category: item.service_id ? (categoryByServiceId.get(item.service_id) ?? null) : null,
      // A per-unit line has no bundle total: quantity x unit rate is the charge.
      // A bundle-priced row bills the line rate once, so the line carries the quoted recurring
      // amount (quantity x unit price), not the unit price alone.
      custom_rate: contractLineType === 'Fixed' && !isUnitPriced ? bundleLineTotal(item, productServiceIds) : null,
      enable_proration: false,
      billing_cycle_alignment: 'start',
      minimum_billable_time: contractLineType === 'Hourly' ? 15 : null,
      round_up_to_nearest: contractLineType === 'Hourly' ? 15 : null,
      is_active: true,
      location_id: item.location_id ?? null,
      created_at: nowIso,
      updated_at: nowIso,
    }))
  );

  const configRows = mappings
    .filter(({ item }) => Boolean(item.service_id))
    .map(({ item, contractLineId, contractLineType, isUnitPriced }) => ({
      item,
      contractLineId,
      contractLineType,
      isUnitPriced,
      configId: randomUUID(),
      serviceId: item.service_id as string,
    }));

  await insertRowsUsingExistingColumns(
    knexOrTrx,
    tenant,
    'contract_line_services',
    configRows.map(({ contractLineId, serviceId, item, isUnitPriced }) => ({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      quantity: item.quantity,
      custom_rate: isUnitPriced ? null : item.unit_price,
      created_at: nowIso,
      updated_at: nowIso,
    }))
  );

  if (configRows.length > 0) {
    await db.table('contract_line_service_configuration').insert(
      configRows.map(({ configId, contractLineId, contractLineType, serviceId, item, isUnitPriced }) => ({
        tenant,
        config_id: configId,
        contract_line_id: contractLineId,
        service_id: serviceId,
        configuration_type: contractLineType,
        custom_rate: isUnitPriced ? null : item.unit_price,
        quantity: item.quantity,
        created_at: nowIso,
        updated_at: nowIso,
      }))
    );
  }

  const fixedConfigRows = configRows.filter((row) => row.contractLineType === 'Fixed');
  if (fixedConfigRows.length > 0) {
    await db.table('contract_line_service_fixed_config').insert(
      fixedConfigRows.map(({ configId, item, isUnitPriced }) => ({
        tenant,
        config_id: configId,
        ...resolveFixedMemberRatePair({
          // Unit rows: base_rate is the rate per unit; the quantity is on the configuration row.
          // Bundle rows: the member's share of the line total (the whole of it, one member per line).
          base_rate: isUnitPriced ? item.unit_price : bundleLineTotal(item, productServiceIds),
          // Unit rows and products are per unit; a bundle row is the whole line total (its share).
          base_rate_basis:
            isUnitPriced || isProductQuoteItem(item, productServiceIds) ? 'per_unit' : 'share',
          pricing_basis: isUnitPriced ? 'unit' : 'bundle',
        }),
        // Bundle rows keep the column defaults.
        ...(isUnitPriced ? { pricing_basis: 'unit', rate_provenance: 'custom' } : {}),
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
        // The quoted unit, else Rec 20 "one" for both columns. The quote item's
        // own code is authoritative; a label with no code does NOT derive one
        // (`withUnitCode`), because the UI path's output is the reference for
        // this conversion and that is the rule it has always written.
        unit_of_measure: item.unit_of_measure || resolveUnitOfMeasure({ fallback: 'C62' }).label,
        unit_code: item.unit_code || resolveUnitOfMeasure({ fallback: 'C62' }).code,
        enable_tiered_pricing: false,
        minimum_usage: 0,
        base_rate: item.unit_price,
        created_at: nowIso,
        updated_at: nowIso,
      }))
    );
  }

  return {
    mappings,
    contractLineIdByBaseQuoteItemId: new Map(
      mappings.map(({ item, contractLineId }) => [item.quote_item_id, contractLineId] as const),
    ),
  };
}
