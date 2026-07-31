import type { Knex } from 'knex';
import { normalizeGtin } from '@alga-psa/core';
import {
  BaseService,
  type ListResult,
  type ServiceContext,
  withTransaction,
} from '@alga-psa/db';
import {
  adjustStockCore,
  assertLocationWritable,
  publishInventoryEvent,
  queryPurchaseOrder,
  queryPurchaseOrders,
  queryStockAtLocation,
  queryStockLocation,
  queryStockLocations,
  queryStockLevelsForProduct,
  queryStockUnits,
  queryTransfers,
  queryUnitDetail,
  receivePoLineCore,
  receiveStockCore,
  receiveTransferCore,
  recordCountCore,
  startCountSessionCore,
  submitCountForReviewCore,
  cancelCountSessionCore,
  timestampPayload,
} from '@alga-psa/inventory';
import type {
  IPurchaseOrder,
  IPurchaseOrderLine,
  IStockTransfer,
  PurchaseOrderStatus,
} from '@alga-psa/types';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../middleware/apiMiddleware';
import type {
  InventoryAdjustmentApi,
  InventoryCountListQuery,
  InventoryCountRecordApi,
  InventoryLookupResult,
  InventoryPoLineReceiveApi,
  InventoryPurchaseOrderListQuery,
  InventoryReceiptApi,
  InventoryStockListQuery,
  InventoryTransferListQuery,
  InventoryUnitListQuery,
} from '../schemas/inventorySchemas';

type InventoryProduct = Extract<InventoryLookupResult, { type: 'product' }>['product'];
type InventoryUnit = Extract<InventoryLookupResult, { type: 'unit' }>['unit'];
type InventoryLevel = Extract<InventoryLookupResult, { type: 'product' }>['levels'][number];

export type CountSessionApiRow = {
  session_id: string;
  location_id: string;
  location_name: string | null;
  status: string;
  line_count: number;
  created_at?: string | Date;
  started_at?: string | Date | null;
};

export type PurchaseOrderApiRow = Omit<IPurchaseOrder, 'lines'> & {
  vendor_name: string | null;
  lines: Array<IPurchaseOrderLine & {
    service_name: string | null;
    sku: string | null;
    is_serialized: boolean;
  }>;
};

export type TransferApiRow = IStockTransfer & {
  from_location_name: string | null;
  to_location_name: string | null;
  line_count: number;
};

function pageSlice<T>(rows: T[], page: number, limit: number): ListResult<T> {
  return {
    data: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
  };
}

function numeric(value: unknown): number {
  return Number(value ?? 0);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function normalizeMacForLookup(value: string): string {
  return value.toLowerCase().replace(/[:.\- ]/g, '');
}

// Matches ANY catalog product, tracked or not: a scanned box must resolve even
// before inventory tracking is enabled (receiving then opts the product in).
function catalogProductQuery(trx: Knex.Transaction, tenant: string): Knex.QueryBuilder {
  return trx('service_catalog as sc')
    .leftJoin('product_inventory_settings as pis', function () {
      this.on('pis.service_id', '=', 'sc.service_id').andOn('pis.tenant', '=', 'sc.tenant');
    })
    .where({ 'sc.tenant': tenant, 'sc.item_kind': 'product' })
    .select(
      'sc.service_id',
      'sc.service_name',
      'sc.sku',
      'sc.barcode',
      'sc.unit_of_measure',
      // Left-join NULLs are coalesced in toProduct (null -> false).
      'pis.is_serialized',
      'pis.track_stock',
    );
}

function hydratedUnitQuery(trx: Knex.Transaction, tenant: string): Knex.QueryBuilder {
  return trx('stock_units as su')
    .join('service_catalog as sc', function () {
      this.on('sc.service_id', '=', 'su.service_id').andOn('sc.tenant', '=', 'su.tenant');
    })
    .join('product_inventory_settings as pis', function () {
      this.on('pis.service_id', '=', 'su.service_id').andOn('pis.tenant', '=', 'su.tenant');
    })
    .leftJoin('stock_locations as loc', function () {
      this.on('loc.location_id', '=', 'su.location_id').andOn('loc.tenant', '=', 'su.tenant');
    })
    .leftJoin('clients as c', function () {
      this.on('c.client_id', '=', 'su.client_id').andOn('c.tenant', '=', 'su.tenant');
    })
    .where({ 'su.tenant': tenant })
    .select(
      'su.*',
      'sc.service_name',
      'sc.sku',
      'sc.barcode',
      'sc.unit_of_measure',
      'pis.is_serialized',
      'loc.name as location_name',
      'c.client_name',
    );
}

function toProduct(row: any): InventoryProduct {
  return {
    service_id: row.service_id,
    service_name: row.service_name,
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    is_serialized: Boolean(row.is_serialized),
    track_stock: row.track_stock === undefined ? true : Boolean(row.track_stock),
    unit_of_measure: row.unit_of_measure ?? null,
  };
}

function toUnit(row: any): InventoryUnit {
  return {
    unit_id: row.unit_id,
    service_id: row.service_id,
    service_name: row.service_name ?? row.product_name ?? undefined,
    serial_number: row.serial_number,
    mac_address: row.mac_address ?? null,
    status: row.status,
    location_id: row.location_id ?? null,
    location_name: row.location_name ?? null,
    client_id: row.client_id ?? null,
    client_name: row.client_name ?? null,
    warranty_expires_at: row.warranty_expires_at ?? null,
    warranty_term: row.warranty_term ?? null,
    // Once delivered + converted, a unit links to a managed asset; the scan
    // card offers "View asset" when this is set.
    asset_id: row.asset_id ?? null,
  };
}

function warrantyStatusFrom(endDate: unknown): 'active' | 'expiring_soon' | 'expired' | 'unknown' {
  if (!endDate) return 'unknown';
  const end = new Date(endDate as string).getTime();
  if (Number.isNaN(end)) return 'unknown';
  const now = Date.now();
  if (end < now) return 'expired';
  if (end < now + 30 * 24 * 60 * 60 * 1000) return 'expiring_soon';
  return 'active';
}

// Field-tech scan resolution into the ASSET domain: a scanned serial/tag can
// belong to a managed asset (delivered inventory that became an asset, or an
// RMM-discovered device that never touched inventory).
function assetScanQuery(trx: Knex.Transaction, tenant: string): Knex.QueryBuilder {
  return trx('assets as a')
    .leftJoin('clients as c', function () {
      this.on('c.client_id', '=', 'a.client_id').andOn('c.tenant', '=', 'a.tenant');
    })
    .where({ 'a.tenant': tenant })
    .select(
      'a.asset_id',
      'a.asset_tag',
      'a.name',
      'a.serial_number',
      'a.asset_type',
      'a.status',
      'a.client_id',
      'c.client_name',
      'a.warranty_end_date',
      'a.location',
      'a.stock_unit_id',
    );
}

function toAssetSummary(row: any) {
  return {
    asset_id: row.asset_id,
    asset_tag: row.asset_tag ?? null,
    name: row.name,
    serial_number: row.serial_number ?? null,
    asset_type: row.asset_type ?? null,
    status: row.status ?? null,
    client_id: row.client_id ?? null,
    client_name: row.client_name ?? null,
    warranty_end_date: row.warranty_end_date ?? null,
    warranty_status: warrantyStatusFrom(row.warranty_end_date),
    location: row.location ?? null,
    stock_unit_id: row.stock_unit_id ?? null,
  };
}

function toLevel(row: any, product?: InventoryProduct, locationName?: string | null): InventoryLevel {
  const available = row.available === undefined
    ? numeric(row.quantity_on_hand) - numeric(row.reserved_quantity) - numeric(row.held_quantity)
    : numeric(row.available);
  return {
    service_id: row.service_id,
    service_name: row.service_name ?? product?.service_name,
    sku: row.sku ?? product?.sku ?? null,
    location_id: row.location_id,
    location_name: row.location_name ?? locationName ?? null,
    quantity_on_hand: numeric(row.quantity_on_hand),
    reserved_quantity: numeric(row.reserved_quantity),
    held_quantity: numeric(row.held_quantity),
    available,
    reorder_point: row.reorder_point == null ? null : numeric(row.reorder_point),
  };
}

function conflictWithCode(code: 'DUPLICATE_SERIAL' | 'DUPLICATE_MAC', message: string): ConflictError {
  const error = new ConflictError(message);
  error.code = code;
  return error;
}

function throwInventoryApiError(error: unknown): never {
  if (!(error instanceof Error)) throw error;
  if ('statusCode' in error) throw error;

  const message = error.message;
  const normalized = message.toLowerCase();
  const dbCode = (error as Error & { code?: string; constraint?: string; detail?: string }).code;
  const dbText = `${(error as any).constraint ?? ''} ${(error as any).detail ?? ''}`.toLowerCase();

  if (normalized.includes('duplicate') || normalized.includes('already exists') || dbCode === '23505') {
    if (normalized.includes('mac') || dbText.includes('mac')) throw conflictWithCode('DUPLICATE_MAC', message);
    if (normalized.includes('serial') || dbText.includes('serial')) throw conflictWithCode('DUPLICATE_SERIAL', message);
    throw new ConflictError(message);
  }
  if (normalized.startsWith('permission denied:')) throw new ForbiddenError(message);
  if (normalized.includes('not found')) throw new NotFoundError(message);
  if (
    normalized.includes('current:') ||
    normalized.includes("status '") ||
    normalized.includes('open count session') ||
    normalized.includes('can only be submitted') ||
    normalized.includes('can only be recorded') ||
    normalized.includes('only an in-progress') ||
    normalized.includes('draft purchase order') ||
    normalized.includes('cancelled purchase order')
  ) {
    throw new ConflictError(message);
  }

  throw new ValidationError(message);
}

export class InventoryService extends BaseService<any> {
  constructor() {
    super({
      tableName: 'stock_levels',
      primaryKey: 'service_id',
      tenantColumn: 'tenant',
    });
  }

  async lookup(code: string, context: ServiceContext): Promise<InventoryLookupResult> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      const trimmed = code.trim();
      const gtin = normalizeGtin(trimmed);
      const normalizedMac = normalizeMacForLookup(trimmed);

      const [barcodeProduct, exactSkuProduct, serialUnits, macUnits] = await Promise.all([
        catalogProductQuery(trx, context.tenant).andWhere('sc.barcode', gtin).first(),
        catalogProductQuery(trx, context.tenant).andWhere('sc.sku', trimmed).first(),
        hydratedUnitQuery(trx, context.tenant).andWhere('su.serial_number', trimmed),
        normalizedMac
          ? hydratedUnitQuery(trx, context.tenant).whereRaw(
              "regexp_replace(lower(COALESCE(su.mac_address, '')), '[-:. ]', '', 'g') = ?",
              [normalizedMac],
            )
          : Promise.resolve([]),
      ]);

      const fallbackSkuProduct = exactSkuProduct
        ? null
        : await catalogProductQuery(trx, context.tenant)
            .whereRaw('LOWER(sc.sku) = LOWER(?)', [trimmed])
            .orderBy('sc.sku', 'asc')
            .first();

      const assetRows = await assetScanQuery(trx, context.tenant)
        .andWhere((builder) => builder.where('a.serial_number', trimmed).orWhere('a.asset_tag', trimmed));

      const productRows = [barcodeProduct, exactSkuProduct ?? fallbackSkuProduct].filter(Boolean);
      const products = [...new Map(productRows.map((row: any) => [row.service_id, row])).values()];
      const unitRows = [...(serialUnits as any[]), ...(macUnits as any[])];
      const units = [...new Map(unitRows.map((row: any) => [row.unit_id, row])).values()];
      // A found unit already links to its asset via unit.asset_id (the card
      // offers "View asset"); don't also surface that same asset as a separate
      // hit. Only directly-matched assets NOT reachable through a found unit.
      const unitAssetIds = new Set(units.map((row: any) => row.asset_id).filter(Boolean));
      const assets = [...new Map((assetRows as any[]).map((row) => [row.asset_id, row])).values()]
        .filter((row: any) => !unitAssetIds.has(row.asset_id));

      const domains = (products.length > 0 ? 1 : 0) + (units.length > 0 ? 1 : 0) + (assets.length > 0 ? 1 : 0);

      if (domains > 1) {
        return {
          type: 'multi',
          matches: [
            ...products.map((row: any) => ({ kind: 'product' as const, product: toProduct(row) })),
            ...units.map((row: any) => ({ kind: 'unit' as const, unit: toUnit(row) })),
            ...assets.map((row: any) => ({ kind: 'asset' as const, asset: toAssetSummary(row) })),
          ],
        };
      }

      if (products.length > 0) {
        const product = toProduct(products[0]);
        const levels = await queryStockLevelsForProduct(trx, context.tenant, product.service_id);
        return { type: 'product', product, levels: levels.map((row) => toLevel(row, product)) };
      }

      if (units.length > 0) {
        const row: any = units[0];
        return { type: 'unit', unit: toUnit(row), product: toProduct(row) };
      }

      if (assets.length > 0) {
        return { type: 'asset', asset: toAssetSummary(assets[0]) };
      }

      const rawPrefix = `${escapeLike(trimmed)}%`;
      const barcodePrefix = `${escapeLike(gtin)}%`;
      const macPrefix = `${escapeLike(normalizedMac)}%`;
      const [candidateProducts, candidateUnits] = await Promise.all([
        catalogProductQuery(trx, context.tenant)
          .andWhere((builder) => builder
            .whereRaw('sc.service_name ILIKE ? ESCAPE ?', [rawPrefix, '\\'])
            .orWhereRaw('sc.sku ILIKE ? ESCAPE ?', [rawPrefix, '\\'])
            .orWhereRaw('sc.barcode ILIKE ? ESCAPE ?', [barcodePrefix, '\\']))
          .orderBy('sc.service_name', 'asc')
          .limit(10),
        hydratedUnitQuery(trx, context.tenant)
          .andWhere((builder) => builder
            .whereRaw('su.serial_number ILIKE ? ESCAPE ?', [rawPrefix, '\\'])
            .orWhereRaw(
              "regexp_replace(lower(COALESCE(su.mac_address, '')), '[-:. ]', '', 'g') LIKE ? ESCAPE ?",
              [macPrefix, '\\'],
            ))
          .orderBy('su.serial_number', 'asc')
          .limit(10),
      ]);

      return {
        type: 'none',
        candidates: [
          ...(candidateProducts as any[]).map((row) => ({ kind: 'product' as const, product: toProduct(row) })),
          ...(candidateUnits as any[]).map((row) => ({ kind: 'unit' as const, unit: toUnit(row) })),
        ].slice(0, 10),
      };
    });
  }

  async listStock(
    input: InventoryStockListQuery,
    context: ServiceContext,
  ): Promise<ListResult<InventoryLevel>> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      const locations = input.location_id
        ? [await queryStockLocation(trx, context.tenant, input.location_id)].filter(Boolean)
        : await queryStockLocations(trx, context.tenant);
      const grouped = await Promise.all(locations.map(async (location: any) => ({
        location,
        levels: await queryStockAtLocation(trx, context.tenant, location.location_id),
      })));
      let rows = grouped.flatMap(({ location, levels }) => levels.map((level) => toLevel(level, undefined, location.name)));

      const serviceIds = [...new Set(rows.map((row) => row.service_id))];
      const settings = serviceIds.length > 0
        ? await trx('product_inventory_settings')
            .where({ tenant: context.tenant })
            .whereIn('service_id', serviceIds)
            .select('service_id', 'reorder_point')
        : [];
      const defaultReorder = new Map((settings as any[]).map((row) => [row.service_id, row.reorder_point]));

      rows = rows.map((row) => {
        const effective = row.reorder_point ?? defaultReorder.get(row.service_id) ?? null;
        return {
          ...row,
          reorder_point: effective == null ? null : numeric(effective),
          is_low_stock: effective != null && row.available <= numeric(effective),
        };
      });
      if (input.service_id) rows = rows.filter((row) => row.service_id === input.service_id);
      if (input.search) {
        const search = input.search.toLowerCase();
        rows = rows.filter((row) => row.service_name?.toLowerCase().includes(search) || row.sku?.toLowerCase().includes(search));
      }
      if (input.low_stock) rows = rows.filter((row) => row.is_low_stock);
      rows.sort((left, right) =>
        (left.service_name ?? '').localeCompare(right.service_name ?? '') ||
        (left.location_name ?? '').localeCompare(right.location_name ?? ''));
      return pageSlice(rows, input.page, input.limit);
    });
  }

  async listLocations(context: ServiceContext): Promise<Array<{
    location_id: string;
    name: string;
    location_type: string;
    is_default: boolean;
  }>> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      const rows = await queryStockLocations(trx, context.tenant);
      return rows.map((row) => ({
        location_id: row.location_id,
        name: row.name,
        location_type: row.location_type,
        is_default: row.is_default,
      }));
    });
  }

  async listUnits(
    input: InventoryUnitListQuery,
    context: ServiceContext,
  ): Promise<ListResult<InventoryUnit>> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      let rows = (await queryStockUnits(trx, context.tenant, {
        service_id: input.service_id,
        status: input.status,
        location_id: input.location_id,
        client_id: input.client_id,
      })).map(toUnit);
      if (input.search) {
        const search = input.search.toLowerCase();
        rows = rows.filter((row) =>
          row.serial_number.toLowerCase().includes(search) || row.mac_address?.toLowerCase().includes(search));
      }
      return pageSlice(rows, input.page, input.limit);
    });
  }

  async getUnit(unitId: string, context: ServiceContext): Promise<(InventoryUnit & {
    unit_cost?: number | null;
    cost_currency?: string | null;
    received_at?: string | Date | null;
    delivered_at?: string | Date | null;
    movements: any[];
  }) | null> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      const detail = await queryUnitDetail(trx, context.tenant, unitId);
      if (!detail) return null;
      const [unitRow, movements] = await Promise.all([
        hydratedUnitQuery(trx, context.tenant).andWhere('su.unit_id', unitId).first(),
        trx('stock_movements as sm')
          .leftJoin('stock_locations as from_loc', function () {
            this.on('from_loc.location_id', '=', 'sm.from_location_id').andOn('from_loc.tenant', '=', 'sm.tenant');
          })
          .leftJoin('stock_locations as to_loc', function () {
            this.on('to_loc.location_id', '=', 'sm.to_location_id').andOn('to_loc.tenant', '=', 'sm.tenant');
          })
          .leftJoin('users as u', function () {
            this.on('u.user_id', '=', 'sm.performed_by').andOn('u.tenant', '=', 'sm.tenant');
          })
          .where({ 'sm.tenant': context.tenant, 'sm.unit_id': unitId })
          .orderBy('sm.created_at', 'asc')
          .select(
            'sm.movement_id',
            'sm.movement_type',
            'sm.quantity',
            'sm.reason',
            'sm.created_at',
            'from_loc.name as from_location_name',
            'to_loc.name as to_location_name',
            trx.raw("COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username) as performed_by_name"),
          ),
      ]);
      const source: any = unitRow ?? detail.unit;
      return {
        ...toUnit(source),
        unit_cost: source.unit_cost == null ? null : numeric(source.unit_cost),
        cost_currency: source.cost_currency ?? null,
        received_at: source.received_at ?? null,
        delivered_at: source.delivered_at ?? null,
        movements: (movements as any[]).map((movement) => ({
          ...movement,
          quantity: numeric(movement.quantity),
          from_location_name: movement.from_location_name ?? null,
          to_location_name: movement.to_location_name ?? null,
          performed_by_name: movement.performed_by_name ?? null,
        })),
      };
    });
  }

  async receiveStock(data: InventoryReceiptApi, context: ServiceContext): Promise<{ received: number }> {
    const knex = await this.getDbForContext(context);
    try {
      const core = await withTransaction(knex, async (trx) => {
        let settings = await trx('product_inventory_settings')
          .where({ tenant: context.tenant, service_id: data.service_id })
          .select('is_serialized', 'average_cost', 'cost_currency')
          .first();
        if (!settings) {
          // First receipt is the opt-in: a product scanned and received from
          // the field starts stock tracking on the spot (mobile onboarding
          // path). Serialization is inferred from whether serials were scanned.
          const product = await trx('service_catalog')
            .where({ tenant: context.tenant, service_id: data.service_id, item_kind: 'product' })
            .select('service_id', 'cost', 'cost_currency')
            .first();
          if (!product) throw new NotFoundError('Product not found');
          const inferredSettings = {
            tenant: context.tenant,
            service_id: data.service_id,
            track_stock: true,
            is_serialized: (data.serials?.length ?? 0) > 0,
            average_cost: product.cost ?? null,
            cost_currency: product.cost_currency ?? 'USD',
            default_location_id: data.location_id,
          };
          await trx('product_inventory_settings').insert(inferredSettings);
          settings = {
            is_serialized: inferredSettings.is_serialized,
            average_cost: inferredSettings.average_cost,
            cost_currency: inferredSettings.cost_currency,
          };
        }
        if (settings.is_serialized && (data.serials?.length ?? 0) !== data.quantity) {
          throw new Error(`Serialized receipt requires exactly ${data.quantity} serial(s); got ${data.serials?.length ?? 0}`);
        }
        return receiveStockCore(trx, context.tenant, context.userId, {
          ...data,
          unit_cost: data.unit_cost ?? numeric(settings.average_cost),
          cost_currency: settings.cost_currency,
        });
      });
      for (const payload of core.stock_unit_created_events) {
        await publishInventoryEvent('INVENTORY_STOCK_UNIT_CREATED', timestampPayload(payload));
      }
      return { received: data.quantity };
    } catch (error) {
      throwInventoryApiError(error);
    }
  }

  async adjustStock(data: InventoryAdjustmentApi, context: ServiceContext): Promise<{ adjusted: number }> {
    if (!(data.reason ?? '').trim()) throw new ValidationError('reason is required for a stock adjustment');
    const knex = await this.getDbForContext(context);
    try {
      const core = await withTransaction(knex, (trx) => adjustStockCore(trx, context.tenant, context.userId, {
        service_id: data.service_id,
        location_id: data.location_id,
        delta: data.quantity_delta,
        reason: data.reason,
      }));
      for (const payload of core.stock_unit_created_events) {
        await publishInventoryEvent('INVENTORY_STOCK_UNIT_CREATED', timestampPayload(payload));
      }
      for (const payload of core.stock_unit_updated_events) {
        await publishInventoryEvent('INVENTORY_STOCK_UNIT_UPDATED', timestampPayload(payload));
      }
      if (core.pending_stock_low_event) {
        await publishInventoryEvent('INVENTORY_STOCK_LOW', core.pending_stock_low_event);
      }
      return { adjusted: data.quantity_delta };
    } catch (error) {
      throwInventoryApiError(error);
    }
  }

  async listCounts(
    input: InventoryCountListQuery,
    context: ServiceContext,
  ): Promise<ListResult<CountSessionApiRow>> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      const query = trx('count_sessions as cs')
        .leftJoin('stock_locations as loc', function () {
          this.on('loc.location_id', '=', 'cs.location_id').andOn('loc.tenant', '=', 'cs.tenant');
        })
        .leftJoin(
          trx('count_lines')
            .where({ tenant: context.tenant })
            .groupBy('session_id')
            .select('session_id')
            .count({ line_count: '*' })
            .as('cl'),
          'cl.session_id',
          'cs.session_id',
        )
        .where({ 'cs.tenant': context.tenant });
      if (input.location_id) query.andWhere('cs.location_id', input.location_id);
      if (input.status) query.andWhere('cs.status', input.status);
      const rows = await query
        .orderBy('cs.started_at', 'desc')
        .select('cs.*', 'loc.name as location_name', trx.raw('COALESCE(cl.line_count, 0)::int as line_count'));
      return pageSlice((rows as any[]).map((row) => ({ ...row, line_count: numeric(row.line_count) })), input.page, input.limit);
    });
  }

  private async hydrateCountSession(trx: Knex.Transaction, tenant: string, sessionId: string): Promise<any | null> {
    const session = await trx('count_sessions as cs')
      .leftJoin('stock_locations as loc', function () {
        this.on('loc.location_id', '=', 'cs.location_id').andOn('loc.tenant', '=', 'cs.tenant');
      })
      .where({ 'cs.tenant': tenant, 'cs.session_id': sessionId })
      .select('cs.*', 'loc.name as location_name')
      .first();
    if (!session) return null;
    const lines = await trx('count_lines as cl')
      .leftJoin('service_catalog as sc', function () {
        this.on('sc.service_id', '=', 'cl.service_id').andOn('sc.tenant', '=', 'cl.tenant');
      })
      .leftJoin('product_inventory_settings as pis', function () {
        this.on('pis.service_id', '=', 'cl.service_id').andOn('pis.tenant', '=', 'cl.tenant');
      })
      .where({ 'cl.tenant': tenant, 'cl.session_id': sessionId })
      .orderBy('sc.service_name', 'asc')
      .select(
        'cl.service_id',
        'sc.service_name',
        'sc.sku',
        'cl.counted_qty',
        'cl.counted_serials',
        'cl.expected_qty',
        'pis.is_serialized',
      );
    // Staleness (F067): the location's current on-hand no longer matches the
    // snapshot the session was opened against — stock moved mid-count, recount.
    const closed = session.status === 'approved' || session.status === 'cancelled';
    const levels = closed
      ? []
      : await trx('stock_levels')
          .where({ tenant, location_id: session.location_id })
          .select('service_id', 'quantity_on_hand');
    const onHandById = new Map((levels as any[]).map((level) => [level.service_id, numeric(level.quantity_on_hand)]));
    return {
      ...session,
      line_count: lines.length,
      lines: (lines as any[]).map((line) => {
        const counted = line.counted_qty == null ? null : numeric(line.counted_qty);
        const expected = numeric(line.expected_qty);
        return {
          service_id: line.service_id,
          service_name: line.service_name ?? undefined,
          sku: line.sku ?? null,
          is_serialized: Boolean(line.is_serialized),
          counted_quantity: counted ?? 0,
          counted_serials: (line.counted_serials as string[] | null) ?? null,
          expected_quantity: expected,
          variance: counted == null ? null : counted - expected,
          stale: closed ? false : (onHandById.get(line.service_id) ?? 0) !== expected,
        };
      }),
    };
  }

  async cancelCount(sessionId: string, context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    try {
      return await withTransaction(knex, async (trx) => {
        await cancelCountSessionCore(trx, context.tenant, context.userId, { session_id: sessionId });
        return this.hydrateCountSession(trx, context.tenant, sessionId);
      });
    } catch (error) {
      throwInventoryApiError(error);
    }
  }

  async getCount(sessionId: string, context: ServiceContext): Promise<any | null> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, (trx) => this.hydrateCountSession(trx, context.tenant, sessionId));
  }

  async startCount(locationId: string, context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    try {
      return await withTransaction(knex, async (trx) => {
        const session = await startCountSessionCore(trx, context.tenant, context.userId, { location_id: locationId });
        return this.hydrateCountSession(trx, context.tenant, session.session_id);
      });
    } catch (error) {
      throwInventoryApiError(error);
    }
  }

  async recordCount(sessionId: string, data: InventoryCountRecordApi, context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    try {
      return await withTransaction(knex, async (trx) => {
        await recordCountCore(trx, context.tenant, context.userId, {
          session_id: sessionId,
          service_id: data.service_id,
          counted_qty: data.counted_quantity,
          serials: data.serials,
        });
        const row = await trx('count_lines as cl')
          .leftJoin('service_catalog as sc', function () {
            this.on('sc.service_id', '=', 'cl.service_id').andOn('sc.tenant', '=', 'cl.tenant');
          })
          .where({ 'cl.tenant': context.tenant, 'cl.session_id': sessionId, 'cl.service_id': data.service_id })
          .select('cl.service_id', 'sc.service_name', 'sc.sku', 'cl.counted_qty', 'cl.counted_serials')
          .first();
        return {
          service_id: row.service_id,
          service_name: row.service_name ?? undefined,
          sku: row.sku ?? null,
          counted_quantity: numeric(row.counted_qty),
          counted_serials: (row.counted_serials as string[] | null) ?? null,
        };
      });
    } catch (error) {
      throwInventoryApiError(error);
    }
  }

  async submitCount(sessionId: string, context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    try {
      return await withTransaction(knex, async (trx) => {
        await submitCountForReviewCore(trx, context.tenant, context.userId, { session_id: sessionId });
        return this.hydrateCountSession(trx, context.tenant, sessionId);
      });
    } catch (error) {
      throwInventoryApiError(error);
    }
  }

  private async hydratePurchaseOrder(
    trx: Knex.Transaction,
    tenant: string,
    base: IPurchaseOrder & { vendor_name?: string | null },
  ): Promise<PurchaseOrderApiRow> {
    const detail = await queryPurchaseOrder(trx, tenant, base.po_id);
    if (!detail) throw new Error('Purchase order not found');
    const serviceIds = [...new Set(detail.lines.map((line) => line.service_id))];
    const products = serviceIds.length > 0
      ? await trx('service_catalog as sc')
          .leftJoin('product_inventory_settings as pis', function () {
            this.on('pis.service_id', '=', 'sc.service_id').andOn('pis.tenant', '=', 'sc.tenant');
          })
          .where({ 'sc.tenant': tenant })
          .whereIn('sc.service_id', serviceIds)
          .select('sc.service_id', 'sc.service_name', 'sc.sku', 'pis.is_serialized')
      : [];
    const productsById = new Map((products as any[]).map((product) => [product.service_id, product]));
    let vendorName = base.vendor_name;
    if (vendorName === undefined) {
      const vendor = await trx('vendors').where({ tenant, vendor_id: detail.vendor_id }).select('vendor_name').first();
      vendorName = vendor?.vendor_name ?? null;
    }
    return {
      ...detail,
      vendor_name: vendorName ?? null,
      lines: detail.lines.map((line) => {
        const product: any = productsById.get(line.service_id);
        return {
          ...line,
          quantity_ordered: numeric(line.quantity_ordered),
          quantity_received: numeric(line.quantity_received),
          unit_cost: numeric(line.unit_cost),
          service_name: product?.service_name ?? null,
          sku: product?.sku ?? null,
          is_serialized: Boolean(product?.is_serialized),
        };
      }),
    };
  }

  async listPurchaseOrders(
    input: InventoryPurchaseOrderListQuery,
    context: ServiceContext,
  ): Promise<ListResult<PurchaseOrderApiRow>> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      const batches = input.status?.length
        ? await Promise.all(input.status.map((status) => queryPurchaseOrders(trx, context.tenant, { status })))
        : [await queryPurchaseOrders(trx, context.tenant)];
      const unique = [...new Map(batches.flat().map((row) => [row.po_id, row])).values()]
        .sort((left, right) => String(right.order_date ?? '').localeCompare(String(left.order_date ?? '')));
      const page = unique.slice((input.page - 1) * input.limit, input.page * input.limit);
      return {
        data: await Promise.all(page.map((po) => this.hydratePurchaseOrder(trx, context.tenant, po))),
        total: unique.length,
      };
    });
  }

  async getPurchaseOrder(poId: string, context: ServiceContext): Promise<PurchaseOrderApiRow | null> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      const detail = await queryPurchaseOrder(trx, context.tenant, poId);
      return detail ? this.hydratePurchaseOrder(trx, context.tenant, detail) : null;
    });
  }

  async receivePurchaseOrderLine(
    poId: string,
    lineId: string,
    data: InventoryPoLineReceiveApi,
    context: ServiceContext,
  ): Promise<PurchaseOrderApiRow['lines'][number]> {
    const knex = await this.getDbForContext(context);
    try {
      const core = await withTransaction(knex, async (trx) => {
        const line = await trx('purchase_order_lines')
          .where({ tenant: context.tenant, po_id: poId, po_line_id: lineId })
          .first();
        if (!line) throw new Error('Purchase order line not found');
        const po = await trx('purchase_orders').where({ tenant: context.tenant, po_id: poId }).first();
        if (!po) throw new Error('Purchase order not found');
        const settings = await trx('product_inventory_settings')
          .where({ tenant: context.tenant, service_id: line.service_id })
          .select('default_location_id')
          .first();
        const locationId = data.location_id ?? po.ship_to_location_id ?? settings?.default_location_id;
        if (!locationId) throw new Error('location_id is required when the purchase order has no receiving location');
        return receivePoLineCore(trx, context.tenant, context.userId, {
          ...data,
          po_line_id: lineId,
          location_id: locationId,
        });
      });

      await publishInventoryEvent('INVENTORY_PO_RECEIVED', core.po_received_event);
      await publishInventoryEvent('INVENTORY_PURCHASE_ORDER_UPDATED', timestampPayload({
        tenant: context.tenant,
        po_id: core.po_line.po_id,
        user_id: context.userId,
        changed_fields: ['status', 'quantity_received'],
      }));
      for (const unit of core.units) {
        await publishInventoryEvent('INVENTORY_STOCK_UNIT_CREATED', timestampPayload({
          tenant: context.tenant,
          unit_id: unit.unit_id,
          service_id: unit.service_id,
          user_id: context.userId,
        }));
      }

      return await withTransaction(knex, async (trx) => {
        const po = await this.hydratePurchaseOrder(trx, context.tenant, { po_id: poId } as IPurchaseOrder);
        const line = po.lines.find((candidate) => candidate.po_line_id === lineId);
        if (!line) throw new Error('Purchase order line not found');
        return line;
      });
    } catch (error) {
      throwInventoryApiError(error);
    }
  }

  async listTransfers(
    input: InventoryTransferListQuery,
    context: ServiceContext,
  ): Promise<ListResult<TransferApiRow>> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      const transfers = await queryTransfers(trx, context.tenant, { status: input.status });
      const paged = pageSlice(transfers, input.page, input.limit);
      const data = await Promise.all(paged.data.map(async (transfer) => {
        const [from, to, count] = await Promise.all([
          queryStockLocation(trx, context.tenant, transfer.from_location_id),
          queryStockLocation(trx, context.tenant, transfer.to_location_id),
          trx('stock_transfer_lines')
            .where({ tenant: context.tenant, transfer_id: transfer.transfer_id })
            .count<{ count: string }>('* as count')
            .first(),
        ]);
        return {
          ...transfer,
          from_location_name: from?.name ?? null,
          to_location_name: to?.name ?? null,
          line_count: numeric(count?.count),
        };
      }));
      return { data, total: paged.total };
    });
  }

  async receiveTransfer(transferId: string, context: ServiceContext): Promise<TransferApiRow> {
    const knex = await this.getDbForContext(context);
    try {
      return await withTransaction(knex, async (trx) => {
        const transfer = await trx('stock_transfers')
          .where({ tenant: context.tenant, transfer_id: transferId })
          .first();
        if (!transfer) throw new Error('Transfer not found');
        await assertLocationWritable(trx, context.tenant, context.userId, transfer.to_location_id);
        const received = await receiveTransferCore(trx, context.tenant, context.userId, { transfer_id: transferId });
        const [from, to] = await Promise.all([
          queryStockLocation(trx, context.tenant, received.from_location_id),
          queryStockLocation(trx, context.tenant, received.to_location_id),
        ]);
        return {
          ...received,
          from_location_name: from?.name ?? null,
          to_location_name: to?.name ?? null,
          line_count: received.lines?.length ?? 0,
        };
      });
    } catch (error) {
      throwInventoryApiError(error);
    }
  }
}
