'use server';

import { Knex } from 'knex';
import { revalidatePath } from 'next/cache';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IKitComponent, ISalesOrderLine, KitPricingMode } from '@alga-psa/types';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import {
  calculateKitFinancials,
  resolveKitPriceInTransaction,
  resolveKitPricePolicy,
} from '../lib/kitPricing';

/**
 * Kit (bundle) management — single-level bill of materials (F102).
 *
 * A kit is a `service_catalog` product flagged `product_inventory_settings.is_kit = true`
 * whose `kit_components` rows name the products that make it up. On a sales order a kit line
 * EXPLODES into one parent line plus one editable child line per component
 * (`parent_so_line_id` set). Components may be stocked or non-stocked; non-stocked components
 * still get a line but never decrement stock at fulfillment (F105). Multi-level BOM (a kit
 * containing a kit) is explicitly rejected here and deferred. See design §6.I.
 */

async function requireInvPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
  }
}

async function requireServicePerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'service', action))) {
    throw new Error(`Permission denied: service ${action} required`);
  }
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeMoney(value: unknown, fieldName: string, opts?: { requiredPositive?: boolean }): number {
  const n = Math.round(Number(value ?? 0));
  if (!Number.isFinite(n) || n < 0 || (opts?.requiredPositive && n <= 0)) {
    throw new Error(`${fieldName} must be ${opts?.requiredPositive ? 'greater than 0' : 'a non-negative amount'}`);
  }
  return n;
}

function normalizeCurrency(value?: string | null): string {
  const currency = (value || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('currency_code must be a 3-letter currency code');
  return currency;
}

function normalizeOptionalText(value?: string | null): string | null {
  const text = (value ?? '').trim();
  return text ? text : null;
}

function normalizeKitPricingMode(value?: KitPricingMode | null): KitPricingMode {
  const mode = value ?? 'sum';
  if (!(['sum', 'fixed'] as KitPricingMode[]).includes(mode)) {
    throw new Error(`Invalid kit_pricing_mode: ${mode}`);
  }
  return mode;
}

function safeRevalidate(path: string): void {
  try {
    revalidatePath(path);
  } catch (error) {
    console.warn(`[kitActions] Failed to revalidate path "${path}":`, error instanceof Error ? error.message : error);
  }
}

async function publishServiceCatalogSearchEvent(
  eventType: 'SERVICE_CATALOG_CREATED' | 'SERVICE_CATALOG_UPDATED',
  tenant: string,
  serviceId: string,
  options: { userId?: string; changedFields?: string[] } = {},
): Promise<void> {
  try {
    await publishEvent({
      eventType,
      payload: {
        tenantId: tenant,
        serviceId,
        userId: options.userId,
        itemKind: 'product',
        changedFields: options.changedFields,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (eventError) {
    console.error(`[kitActions] Failed to publish ${eventType} search event:`, eventError);
  }
}

/** Assert the service is flagged as a kit; throws otherwise. */
async function assertIsKit(trx: Knex.Transaction, tenant: string, kitServiceId: string): Promise<void> {
  const settings = await trx('product_inventory_settings')
    .where({ tenant, service_id: kitServiceId })
    .select('is_kit')
    .first();
  if (!settings) throw new Error('Inventory not enabled for this product; cannot manage kit components');
  if (!settings.is_kit) throw new Error('Product is not flagged as a kit (is_kit=false); set the kit flag first');
}

/**
 * Reject any component that is itself a kit (single-level BOM only, F102), or that is the
 * kit itself. A component with no inventory settings is allowed (non-stocked line, F105).
 */
async function assertComponentAllowed(
  trx: Knex.Transaction,
  tenant: string,
  kitServiceId: string,
  componentServiceId: string,
): Promise<void> {
  if (componentServiceId === kitServiceId) throw new Error('A kit cannot contain itself');
  const svc = await trx('service_catalog')
    .where({ tenant, service_id: componentServiceId })
    .select('service_id')
    .first();
  if (!svc) throw new Error('Component service not found');
  const compSettings = await trx('product_inventory_settings')
    .where({ tenant, service_id: componentServiceId })
    .select('is_kit')
    .first();
  if (compSettings?.is_kit) {
    throw new Error('A kit cannot contain another kit (single-level BOM only)');
  }
}

function normalizeQuantity(quantity: number): number {
  const q = Math.trunc(Number(quantity));
  if (!Number.isFinite(q) || q <= 0) throw new Error('Component quantity must be a positive integer');
  return q;
}

export type KitStatus = 'ready' | 'no_bom' | 'low_stock' | 'incomplete';

export interface KitComponentDetail extends IKitComponent {
  service_name: string;
  sku: string | null;
  item_kind: 'service' | 'product';
  track_stock: boolean;
  is_serialized: boolean;
  default_rate: number;
  cost: number | null;
  average_cost: number | null;
  cost_currency: string | null;
  on_hand: number;
  available: number;
  unit_cost: number | null;
  extended_cost: number | null;
  extended_price: number;
  component_buildable_quantity: number | null;
}

export interface KitSummary {
  service_id: string;
  service_name: string;
  sku: string | null;
  default_rate: number;
  cost: number | null;
  cost_currency: string | null;
  kit_pricing_mode: KitPricingMode;
  kit_fixed_price: number | null;
  component_count: number;
  stocked_component_count: number;
  short_component_count: number;
  buildable_quantity: number | null;
  status: KitStatus;
  computed_price: number;
  component_cost: number | null;
  margin_amount: number | null;
  margin_percent: number | null;
  sales_order_count: number;
}

export interface KitDetail extends KitSummary {
  description: string | null;
  custom_service_type_id: string | null;
  unit_of_measure: string | null;
  is_active: boolean;
  components: KitComponentDetail[];
  sales_order_behavior: {
    parent_line_price: number;
    component_lines_priced_at: 0;
    explodes_on_sales_order: boolean;
  };
}

export interface KitComponentCandidate {
  service_id: string;
  service_name: string;
  sku: string | null;
  track_stock: boolean;
  is_serialized: boolean;
  default_rate: number;
  cost: number | null;
  average_cost: number | null;
  cost_currency: string | null;
  on_hand: number;
  available: number;
}

export interface KitServiceTypeOption {
  id: string;
  name: string;
  is_standard: boolean;
}

export interface CreateKitProductInput {
  service_name: string;
  sku?: string | null;
  custom_service_type_id: string;
  unit_of_measure?: string | null;
  kit_fixed_price?: number | null;
  cost?: number | null;
  currency_code?: string | null;
  description?: string | null;
  kit_pricing_mode?: KitPricingMode;
}

export interface UpdateKitProductInput {
  service_name?: string;
  sku?: string | null;
  custom_service_type_id?: string | null;
  unit_of_measure?: string | null;
  cost?: number | null;
  currency_code?: string | null;
  description?: string | null;
  kit_pricing_mode?: KitPricingMode;
  kit_fixed_price?: number | null;
}

interface KitBaseRow {
  service_id: string;
  service_name: string;
  sku: string | null;
  description: string | null;
  custom_service_type_id: string | null;
  unit_of_measure: string | null;
  is_active: boolean;
  default_rate: number | string | null;
  cost: number | string | null;
  cost_currency: string | null;
  kit_pricing_mode: KitPricingMode | null;
  kit_fixed_price: number | string | null;
  component_count: number | string | null;
  sales_order_count: number | string | null;
}

async function queryKitBaseRows(trx: Knex.Transaction, tenant: string, serviceId?: string): Promise<KitBaseRow[]> {
  const componentCounts = trx('kit_components')
    .where({ tenant })
    .groupBy('kit_service_id')
    .select('kit_service_id')
    .count('* as component_count')
    .as('kc_counts');

  const usageCounts = trx('sales_order_lines')
    .where({ tenant, parent_so_line_id: null })
    .groupBy('service_id')
    .select('service_id')
    .countDistinct('so_id as sales_order_count')
    .as('usage_counts');

  const query = trx('product_inventory_settings as pis')
    .join('service_catalog as sc', function () {
      this.on('pis.service_id', '=', 'sc.service_id').andOn('pis.tenant', '=', 'sc.tenant');
    })
    .leftJoin(componentCounts, 'kc_counts.kit_service_id', 'pis.service_id')
    .leftJoin(usageCounts, 'usage_counts.service_id', 'pis.service_id')
    .where({ 'pis.tenant': tenant, 'pis.is_kit': true })
    .select(
      'sc.service_id',
      'sc.service_name',
      'sc.sku',
      'sc.description',
      'sc.custom_service_type_id',
      'sc.unit_of_measure',
      'sc.is_active',
      'sc.default_rate',
      'sc.cost',
      trx.raw('COALESCE(pis.cost_currency, sc.cost_currency) as cost_currency'),
      'pis.kit_pricing_mode',
      'pis.kit_fixed_price',
      trx.raw('COALESCE(kc_counts.component_count, 0)::int as component_count'),
      trx.raw('COALESCE(usage_counts.sales_order_count, 0)::int as sales_order_count'),
    )
    .orderBy('sc.service_name', 'asc');

  if (serviceId) query.andWhere('pis.service_id', serviceId);
  return (await query) as KitBaseRow[];
}

async function queryKitComponents(
  trx: Knex.Transaction,
  tenant: string,
  kitServiceIds: string[],
): Promise<Map<string, KitComponentDetail[]>> {
  const ids = [...new Set(kitServiceIds.filter(Boolean))];
  const byKit = new Map<string, KitComponentDetail[]>();
  for (const id of ids) byKit.set(id, []);
  if (ids.length === 0) return byKit;

  const stockTotals = trx('stock_levels')
    .where({ tenant })
    .groupBy('service_id')
    .select('service_id')
    .select(trx.raw('COALESCE(SUM(quantity_on_hand), 0)::int as on_hand'))
    .select(trx.raw('COALESCE(SUM(quantity_on_hand - reserved_quantity - held_quantity), 0)::int as available'))
    .as('stock_totals');

  const rows = (await trx('kit_components as kc')
    .join('service_catalog as sc', function () {
      this.on('kc.component_service_id', '=', 'sc.service_id').andOn('kc.tenant', '=', 'sc.tenant');
    })
    .leftJoin('product_inventory_settings as pis', function () {
      this.on('pis.service_id', '=', 'kc.component_service_id').andOn('pis.tenant', '=', 'kc.tenant');
    })
    .leftJoin(stockTotals, 'stock_totals.service_id', 'kc.component_service_id')
    .where({ 'kc.tenant': tenant })
    .whereIn('kc.kit_service_id', ids)
    .select(
      'kc.*',
      'sc.service_name',
      'sc.sku',
      'sc.item_kind',
      'sc.default_rate',
      'sc.cost',
      'sc.cost_currency',
      trx.raw('COALESCE(pis.track_stock, false) as track_stock'),
      trx.raw('COALESCE(pis.is_serialized, false) as is_serialized'),
      'pis.average_cost',
      trx.raw('COALESCE(stock_totals.on_hand, 0)::int as on_hand'),
      trx.raw('COALESCE(stock_totals.available, 0)::int as available'),
    )
    .orderBy('sc.service_name', 'asc')) as any[];

  for (const row of rows) {
    const quantity = normalizeQuantity(row.quantity);
    const defaultRate = asNumber(row.default_rate);
    const cost = row.cost == null ? null : asNumber(row.cost);
    const averageCost = row.average_cost == null ? null : asNumber(row.average_cost);
    const unitCost = averageCost ?? cost;
    const available = asNumber(row.available);
    const detail: KitComponentDetail = {
      ...(row as IKitComponent),
      quantity,
      service_name: row.service_name,
      sku: row.sku ?? null,
      item_kind: row.item_kind === 'product' ? 'product' : 'service',
      track_stock: Boolean(row.track_stock),
      is_serialized: Boolean(row.is_serialized),
      default_rate: defaultRate,
      cost,
      average_cost: averageCost,
      cost_currency: row.cost_currency ?? null,
      on_hand: asNumber(row.on_hand),
      available,
      unit_cost: unitCost,
      extended_cost: unitCost === null ? null : unitCost * quantity,
      extended_price: defaultRate * quantity,
      component_buildable_quantity: row.track_stock ? Math.max(0, Math.floor(available / quantity)) : null,
    };
    byKit.get(row.kit_service_id)?.push(detail);
  }

  return byKit;
}

function summarizeKit(row: KitBaseRow, components: KitComponentDetail[]): KitSummary {
  const mode = normalizeKitPricingMode(row.kit_pricing_mode);
  const fixedPrice = row.kit_fixed_price == null ? null : asNumber(row.kit_fixed_price);
  const componentCount = asNumber(row.component_count);
  const stocked = components.filter((c) => c.track_stock);
  const stockedCount = stocked.length;
  const shortCount = stocked.filter((c) => c.available < c.quantity).length;
  const buildable = stocked.length
    ? Math.min(...stocked.map((c) => c.component_buildable_quantity ?? 0))
    : null;
  const catalogPrice = asNumber(row.default_rate);
  const computedPrice = resolveKitPricePolicy(mode, fixedPrice, components);
  const { componentCost, marginAmount, marginPercent } = calculateKitFinancials(
    computedPrice,
    row.cost_currency ?? 'USD',
    components,
  );

  let status: KitStatus = 'ready';
  if (mode === 'fixed' && !(fixedPrice && fixedPrice > 0)) {
    status = 'incomplete';
  } else if (componentCount === 0) {
    status = 'no_bom';
  } else if (shortCount > 0) {
    status = 'low_stock';
  }

  return {
    service_id: row.service_id,
    service_name: row.service_name,
    sku: row.sku ?? null,
    default_rate: catalogPrice,
    cost: row.cost == null ? null : asNumber(row.cost),
    cost_currency: row.cost_currency ?? null,
    kit_pricing_mode: mode,
    kit_fixed_price: fixedPrice,
    component_count: componentCount,
    stocked_component_count: stockedCount,
    short_component_count: shortCount,
    buildable_quantity: buildable,
    status,
    computed_price: computedPrice,
    component_cost: componentCost,
    margin_amount: marginAmount,
    margin_percent: marginPercent,
    sales_order_count: asNumber(row.sales_order_count),
  };
}

export const listKitServiceTypes = withAuth(async (user, { tenant }): Promise<KitServiceTypeOption[]> => {
  await requireServicePerm(user, 'read');
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await trx('service_types')
      .where({ tenant, is_active: true })
      .select('id', 'name')
      .orderBy('name', 'asc');
    return rows.map((row: any) => ({ id: row.id, name: row.name, is_standard: false }));
  });
});

export const listKitComponentCandidates = withAuth(async (user, { tenant }): Promise<KitComponentCandidate[]> => {
  await requireInvPerm(user, 'read');
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const stockTotals = trx('stock_levels')
      .where({ tenant })
      .groupBy('service_id')
      .select('service_id')
      .select(trx.raw('COALESCE(SUM(quantity_on_hand), 0)::int as on_hand'))
      .select(trx.raw('COALESCE(SUM(quantity_on_hand - reserved_quantity - held_quantity), 0)::int as available'))
      .as('stock_totals');

    const rows = await trx('service_catalog as sc')
      .leftJoin('product_inventory_settings as pis', function () {
        this.on('pis.service_id', '=', 'sc.service_id').andOn('pis.tenant', '=', 'sc.tenant');
      })
      .leftJoin(stockTotals, 'stock_totals.service_id', 'sc.service_id')
      .where({ 'sc.tenant': tenant, 'sc.item_kind': 'product' })
      .andWhereRaw('COALESCE(pis.is_kit, false) = false')
      .select(
        'sc.service_id',
        'sc.service_name',
        'sc.sku',
        'sc.default_rate',
        'sc.cost',
        'sc.cost_currency',
        trx.raw('COALESCE(pis.track_stock, false) as track_stock'),
        trx.raw('COALESCE(pis.is_serialized, false) as is_serialized'),
        'pis.average_cost',
        trx.raw('COALESCE(stock_totals.on_hand, 0)::int as on_hand'),
        trx.raw('COALESCE(stock_totals.available, 0)::int as available'),
      )
      .orderBy('sc.service_name', 'asc');

    return rows.map((row: any) => ({
      service_id: row.service_id,
      service_name: row.service_name,
      sku: row.sku ?? null,
      track_stock: Boolean(row.track_stock),
      is_serialized: Boolean(row.is_serialized),
      default_rate: asNumber(row.default_rate),
      cost: row.cost == null ? null : asNumber(row.cost),
      average_cost: row.average_cost == null ? null : asNumber(row.average_cost),
      cost_currency: row.cost_currency ?? null,
      on_hand: asNumber(row.on_hand),
      available: asNumber(row.available),
    }));
  });
});

export const listKitSummaries = withAuth(async (user, { tenant }): Promise<KitSummary[]> => {
  await requireInvPerm(user, 'read');
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await queryKitBaseRows(trx, tenant);
    const componentsByKit = await queryKitComponents(trx, tenant, rows.map((row) => row.service_id));
    return rows.map((row) => summarizeKit(row, componentsByKit.get(row.service_id) ?? []));
  });
});

export const getKitDetail = withAuth(async (user, { tenant }, kitServiceId: string): Promise<KitDetail | null> => {
  await requireInvPerm(user, 'read');
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const [row] = await queryKitBaseRows(trx, tenant, kitServiceId);
    if (!row) return null;
    const componentsByKit = await queryKitComponents(trx, tenant, [kitServiceId]);
    const components = componentsByKit.get(kitServiceId) ?? [];
    return {
      ...summarizeKit(row, components),
      description: row.description ?? null,
      custom_service_type_id: row.custom_service_type_id ?? null,
      unit_of_measure: row.unit_of_measure ?? null,
      is_active: Boolean(row.is_active),
      components,
      sales_order_behavior: {
        parent_line_price: summarizeKit(row, components).computed_price,
        component_lines_priced_at: 0,
        explodes_on_sales_order: true,
      },
    };
  });
});

export const createKitProduct = withAuth(
  async (user, { tenant }, input: CreateKitProductInput): Promise<KitDetail> => {
    await requireServicePerm(user, 'create');
    await requireInvPerm(user, 'create');

    const serviceName = (input.service_name ?? '').trim();
    if (!serviceName) throw new Error('Kit name is required');
    if (!input.custom_service_type_id) throw new Error('Product type is required');
    const currency = normalizeCurrency(input.currency_code);
    const cost = input.cost == null ? null : normalizeMoney(input.cost, 'Kit cost');
    const mode = normalizeKitPricingMode(input.kit_pricing_mode);
    const fixedPrice = mode === 'fixed'
      ? normalizeMoney(input.kit_fixed_price, 'Fixed kit price', { requiredPositive: true })
      : null;
    const catalogProjection = fixedPrice ?? 0;

    const { knex: db } = await createTenantKnex();
    const serviceId = await withTransaction(db, async (trx: Knex.Transaction) => {
      const type = await trx('service_types')
        .where({ tenant, id: input.custom_service_type_id })
        .first();
      if (!type) throw new Error('Product type not found');

      const [service] = await trx('service_catalog')
        .insert({
          tenant,
          service_name: serviceName,
          custom_service_type_id: input.custom_service_type_id,
          billing_method: 'usage',
          default_rate: catalogProjection,
          unit_of_measure: normalizeOptionalText(input.unit_of_measure) ?? 'kit',
          category_id: null,
          tax_rate_id: null,
          description: input.description ?? '',
          item_kind: 'product',
          is_active: true,
          sku: normalizeOptionalText(input.sku),
          cost,
          cost_currency: currency,
          vendor: null,
          manufacturer: null,
          product_category: null,
          is_license: false,
          license_term: null,
          license_billing_cadence: null,
        })
        .returning('*');

      await trx('service_prices')
        .insert({
          tenant,
          service_id: service.service_id,
          currency_code: currency,
          rate: catalogProjection,
        })
        .onConflict(['tenant', 'service_id', 'currency_code'])
        .merge({ rate: catalogProjection, updated_at: trx.fn.now() });

      await trx('product_inventory_settings')
        .insert({
          tenant,
          service_id: service.service_id,
          track_stock: true,
          is_serialized: false,
          is_kit: true,
          creates_asset_on_delivery: false,
          cost_currency: currency,
          kit_pricing_mode: mode,
          kit_fixed_price: fixedPrice,
        });

      return service.service_id as string;
    });

    await publishServiceCatalogSearchEvent('SERVICE_CATALOG_CREATED', tenant, serviceId, {
      userId: user.user_id,
      changedFields: ['service_name', 'sku', 'default_rate', 'item_kind', 'is_kit'],
    });
    safeRevalidate('/msp/inventory/kits');
    safeRevalidate('/msp/settings/billing');
    const detail = await getKitDetail(serviceId);
    if (!detail) throw new Error('Kit was created but could not be loaded');
    return detail;
  },
);

export const updateKitProduct = withAuth(
  async (user, { tenant }, kitServiceId: string, input: UpdateKitProductInput): Promise<KitDetail> => {
    await requireServicePerm(user, 'update');
    await requireInvPerm(user, 'update');

    const { knex: db } = await createTenantKnex();
    await withTransaction(db, async (trx: Knex.Transaction) => {
      await assertIsKit(trx, tenant, kitServiceId);
      const current = await trx('service_catalog as sc')
        .join('product_inventory_settings as pis', function () {
          this.on('pis.service_id', '=', 'sc.service_id').andOn('pis.tenant', '=', 'sc.tenant');
        })
        .where({ 'sc.tenant': tenant, 'sc.service_id': kitServiceId })
        .select('sc.*', 'pis.kit_pricing_mode', 'pis.kit_fixed_price')
        .first();
      if (!current) throw new Error('Kit not found');

      const currency = input.currency_code !== undefined ? normalizeCurrency(input.currency_code) : current.cost_currency ?? 'USD';
      const cost = input.cost === undefined ? current.cost : input.cost === null ? null : normalizeMoney(input.cost, 'Kit cost');
      const mode = normalizeKitPricingMode(input.kit_pricing_mode ?? current.kit_pricing_mode);
      const fixedPrice =
        mode === 'fixed'
          ? normalizeMoney(input.kit_fixed_price ?? current.kit_fixed_price, 'Fixed kit price', { requiredPositive: true })
          : null;
      const catalogProjection = fixedPrice ?? 0;

      if (input.custom_service_type_id) {
        const type = await trx('service_types')
          .where({ tenant, id: input.custom_service_type_id })
          .first();
        if (!type) throw new Error('Product type not found');
      }

      const serviceUpdate: Record<string, unknown> = {};
      if (input.service_name !== undefined) {
        const serviceName = input.service_name.trim();
        if (!serviceName) throw new Error('Kit name is required');
        serviceUpdate.service_name = serviceName;
      }
      if (input.sku !== undefined) serviceUpdate.sku = normalizeOptionalText(input.sku);
      if (input.custom_service_type_id !== undefined && input.custom_service_type_id) {
        serviceUpdate.custom_service_type_id = input.custom_service_type_id;
      }
      if (input.unit_of_measure !== undefined) serviceUpdate.unit_of_measure = normalizeOptionalText(input.unit_of_measure) ?? 'kit';
      if (input.description !== undefined) serviceUpdate.description = input.description ?? '';
      serviceUpdate.default_rate = catalogProjection;
      if (input.cost !== undefined) serviceUpdate.cost = cost;
      if (input.currency_code !== undefined) serviceUpdate.cost_currency = currency;

      await trx('service_catalog')
        .where({ tenant, service_id: kitServiceId })
        .update(serviceUpdate);

      await trx('service_prices')
        .insert({
          tenant,
          service_id: kitServiceId,
          currency_code: currency,
          rate: catalogProjection,
        })
        .onConflict(['tenant', 'service_id', 'currency_code'])
        .merge({ rate: catalogProjection, updated_at: trx.fn.now() });

      await trx('product_inventory_settings')
        .where({ tenant, service_id: kitServiceId })
        .update({
          kit_pricing_mode: mode,
          kit_fixed_price: fixedPrice,
          cost_currency: currency,
          updated_at: trx.fn.now(),
        });
    });

    await publishServiceCatalogSearchEvent('SERVICE_CATALOG_UPDATED', tenant, kitServiceId, {
      userId: user.user_id,
      changedFields: Object.keys(input),
    });
    safeRevalidate('/msp/inventory/kits');
    safeRevalidate('/msp/settings/billing');
    const detail = await getKitDetail(kitServiceId);
    if (!detail) throw new Error('Kit was updated but could not be loaded');
    return detail;
  },
);

/** List a kit's components, merged with catalog name/sku for display. */
export const listKitComponents = withAuth(
  async (user, { tenant }, kitServiceId: string): Promise<Array<IKitComponent & { service_name?: string; sku?: string | null }>> => {
    await requireInvPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      return trx('kit_components as kc')
        .join('service_catalog as sc', function () {
          this.on('kc.component_service_id', '=', 'sc.service_id').andOn('kc.tenant', '=', 'sc.tenant');
        })
        .where({ 'kc.tenant': tenant, 'kc.kit_service_id': kitServiceId })
        .select('kc.*', 'sc.service_name', 'sc.sku')
        .orderBy('sc.service_name', 'asc') as any;
    });
  },
);

/**
 * Replace the full set of a kit's components in one atomic operation (F102).
 * Rejects any component that is itself a kit.
 */
export const setKitComponents = withAuth(
  async (
    user,
    { tenant },
    kitServiceId: string,
    components: Array<{ component_service_id: string; quantity: number }>,
  ): Promise<IKitComponent[]> => {
    await requireInvPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      await assertIsKit(trx, tenant, kitServiceId);

      // Collapse duplicate component ids (summing quantities) and validate each.
      const merged = new Map<string, number>();
      for (const c of components ?? []) {
        const qty = normalizeQuantity(c.quantity);
        merged.set(c.component_service_id, (merged.get(c.component_service_id) ?? 0) + qty);
      }
      for (const componentServiceId of merged.keys()) {
        await assertComponentAllowed(trx, tenant, kitServiceId, componentServiceId);
      }

      await trx('kit_components').where({ tenant, kit_service_id: kitServiceId }).del();

      const rows = Array.from(merged.entries()).map(([componentServiceId, quantity]) => ({
        tenant,
        kit_service_id: kitServiceId,
        component_service_id: componentServiceId,
        quantity,
      }));
      if (rows.length === 0) return [];
      const inserted = await trx('kit_components').insert(rows).returning('*');
      return inserted as IKitComponent[];
    });
  },
);

/** Add (or update the quantity of) a single component on a kit. */
export const addKitComponent = withAuth(
  async (user, { tenant }, kitServiceId: string, componentServiceId: string, quantity: number): Promise<IKitComponent> => {
    await requireInvPerm(user, 'update');
    const qty = normalizeQuantity(quantity);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      await assertIsKit(trx, tenant, kitServiceId);
      await assertComponentAllowed(trx, tenant, kitServiceId, componentServiceId);
      const [row] = await trx('kit_components')
        .insert({
          tenant,
          kit_service_id: kitServiceId,
          component_service_id: componentServiceId,
          quantity: qty,
        })
        .onConflict(['tenant', 'kit_service_id', 'component_service_id'])
        .merge({ quantity: qty, updated_at: trx.fn.now() })
        .returning('*');
      return row as IKitComponent;
    });
  },
);

/** Remove a single component from a kit. */
export const removeKitComponent = withAuth(
  async (user, { tenant }, kitServiceId: string, componentServiceId: string): Promise<void> => {
    await requireInvPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      await trx('kit_components')
        .where({ tenant, kit_service_id: kitServiceId, component_service_id: componentServiceId })
        .del();
    });
  },
);

export interface ExplodedKitLines {
  parentLine: ISalesOrderLine;
  componentLines: ISalesOrderLine[];
}

/**
 * Explode a kit onto a sales order: insert a parent line for the kit plus one child line per
 * component (`parent_so_line_id` = parent line id, `quantity_ordered` = component.quantity ×
 * kitQuantity). Non-stocked components still get a line (F105) — fulfillment decides whether
 * to decrement stock. This is the reusable primitive `salesOrderActions` calls; it operates
 * inside the caller's transaction (no auth/permission check — the caller is authorized for the
 * SO mutation). See design §6.I.
 */
export async function explodeKitOntoSalesOrder(
  trx: Knex.Transaction,
  tenant: string,
  soId: string,
  kitServiceId: string,
  kitQuantity: number,
  basePrice: number,
): Promise<ExplodedKitLines> {
  const qty = normalizeQuantity(kitQuantity);
  await assertIsKit(trx, tenant, kitServiceId);

  const components = (await trx('kit_components')
    .where({ tenant, kit_service_id: kitServiceId })
    .orderBy('component_service_id', 'asc')) as IKitComponent[];
  if (components.length === 0) throw new Error('Kit has no components defined; cannot explode onto sales order');

  // Parent line carries the kit's price; component lines are priced at the kit level (0).
  const [parentLine] = await trx('sales_order_lines')
    .insert({
      tenant,
      so_id: soId,
      service_id: kitServiceId,
      quantity_ordered: qty,
      unit_price: basePrice,
      fulfillment_type: 'from_stock',
      parent_so_line_id: null,
    })
    .returning('*');

  const componentRows = components.map((c) => ({
    tenant,
    so_id: soId,
    service_id: c.component_service_id,
    quantity_ordered: c.quantity * qty,
    unit_price: 0,
    fulfillment_type: 'from_stock',
    parent_so_line_id: (parentLine as ISalesOrderLine).so_line_id,
  }));
  const componentLines = (await trx('sales_order_lines').insert(componentRows).returning('*')) as ISalesOrderLine[];

  return { parentLine: parentLine as ISalesOrderLine, componentLines };
}

/**
 * Re-scale a previously exploded kit on a sales order to a new kit quantity (F106): updates
 * the parent line and proportionally updates each child line's `quantity_ordered` from the
 * kit's bill of materials (component.quantity × newKitQty).
 */
export const scaleKitLineQuantity = withAuth(
  async (user, { tenant }, parentSoLineId: string, newKitQty: number): Promise<ExplodedKitLines> => {
    await requireInvPerm(user, 'update');
    const qty = normalizeQuantity(newKitQty);
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const parent = await trx('sales_order_lines')
        .where({ tenant, so_line_id: parentSoLineId })
        .first();
      if (!parent) throw new Error('Parent sales order line not found');
      if (parent.parent_so_line_id) throw new Error('Line is itself a kit component; pass the parent kit line');

      const components = (await trx('kit_components')
        .where({ tenant, kit_service_id: parent.service_id })) as IKitComponent[];
      const perComponent = new Map(components.map((c) => [c.component_service_id, c.quantity]));

      const [updatedParent] = await trx('sales_order_lines')
        .where({ tenant, so_line_id: parentSoLineId })
        .update({ quantity_ordered: qty, updated_at: trx.fn.now() })
        .returning('*');

      const childLines = (await trx('sales_order_lines')
        .where({ tenant, parent_so_line_id: parentSoLineId })) as ISalesOrderLine[];
      const updatedChildren: ISalesOrderLine[] = [];
      for (const child of childLines) {
        const unit = perComponent.get(child.service_id);
        if (unit === undefined) continue; // component no longer in BOM; leave as-is
        const [row] = await trx('sales_order_lines')
          .where({ tenant, so_line_id: child.so_line_id })
          .update({ quantity_ordered: unit * qty, updated_at: trx.fn.now() })
          .returning('*');
        updatedChildren.push(row as ISalesOrderLine);
      }

      return { parentLine: updatedParent as ISalesOrderLine, componentLines: updatedChildren };
    });
  },
);

/**
 * Compute a kit's price in cents (F108):
 * - `kit_pricing_mode = 'sum'`  → Σ(component `service_catalog.default_rate` × component quantity)
 * - `kit_pricing_mode = 'fixed'`→ `product_inventory_settings.kit_fixed_price`
 */
export const computeKitPrice = withAuth(
  async (user, { tenant }, kitServiceId: string, _currency?: string): Promise<number> => {
    await requireInvPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, (trx: Knex.Transaction) => resolveKitPriceInTransaction(trx, tenant, kitServiceId));
  },
);
