import type { IService } from '@/interfaces/billing.interfaces';
import { normalizeGtin } from '@alga-psa/core';
import { resolveCatalogUnitForCreate, resolveCatalogUnitForUpdate } from '@alga-psa/shared/billingClients/tenantUnitsOfMeasure';
import { BaseService, ServiceContext, ListResult, tenantDb, withTransaction } from '@alga-psa/db';
import { splitServicePricesByEffectiveDate } from '@alga-psa/billing/models/service';
import { resolveCatalogTaxRateIdForCreate } from '@alga-psa/shared/billingClients/defaultTaxRate';
import { ListOptions } from '../controllers/types';
import { publishServiceCatalogSearchEvent, writePricing } from './ServiceCatalogService';
import { ConflictError, NotFoundError } from '../middleware/apiMiddleware';

type SortField = 'service_name' | 'billing_method' | 'default_rate';

type FilterOptions = {
  search?: string;
  category_id?: string | null;
  is_active?: boolean;
  is_license?: boolean;
};

function rethrowProductUniqueViolation(error: unknown): never {
  const databaseError = error as { code?: string; constraint?: string };

  if (databaseError?.code === '23505') {
    if (databaseError.constraint?.includes('service_catalog_product_barcode_unique')) {
      throw new ConflictError(
        'A product with this barcode already exists. Use a different barcode or edit the existing product.'
      );
    }
    if (databaseError.constraint?.includes('service_catalog_product_sku_unique')) {
      throw new ConflictError(
        'A product with this SKU already exists. Use a different SKU or edit the existing product.'
      );
    }
  }

  throw error;
}

export class ProductCatalogService extends BaseService<IService> {
  constructor() {
    super({
      tableName: 'service_catalog',
      primaryKey: 'service_id',
      tenantColumn: 'tenant',
      searchableFields: ['service_name', 'description', 'sku', 'barcode', 'product_category'],
      defaultSort: 'service_name',
      defaultOrder: 'asc'
    });
  }

  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<IService>> {
    const { knex } = await this.getKnex();
    const tenant = context.tenant;
    const db = tenantDb(knex, tenant);

    const page = options.page ?? 1;
    const limit = options.limit ?? 25;
    const offset = (page - 1) * limit;

    const filters = (options.filters ?? {}) as FilterOptions;

    const sortField = this.normalizeSortField(options.sort);
    const sortOrder = this.normalizeOrder(options.order);

    const applyFilters = (query: any) => {
      // Always filter to products only
      query.where('sc.item_kind', 'product');

      if (filters.is_active !== undefined) {
        query.where('sc.is_active', filters.is_active);
      }
      if (filters.category_id !== undefined) {
        if (filters.category_id === null) {
          query.whereNull('sc.category_id');
        } else {
          query.where('sc.category_id', filters.category_id);
        }
      }
      const trimmedSearch = filters.search?.trim();
      if (trimmedSearch) {
        const term = `%${trimmedSearch}%`;
        const barcodeTerm = `%${normalizeGtin(trimmedSearch)}%`;
        query.andWhere((builder: any) => {
          builder
            .whereILike('sc.service_name', term)
            .orWhereILike('sc.description', term)
            .orWhereILike('sc.sku', term)
            .orWhereILike('sc.barcode', barcodeTerm)
            .orWhereILike('sc.product_category', term);
        });
      }
      return query;
    };

    const sortColumnMap: Record<SortField, string> = {
      service_name: 'sc.service_name',
      billing_method: 'sc.billing_method',
      default_rate: 'sc.default_rate'
    };

    const baseQuery = db.table('service_catalog as sc');

    // Count
    const countResult = await applyFilters(baseQuery.clone())
      .count('sc.service_id as count')
      .first();
    const total = parseInt(countResult?.count as string) || 0;

    // Data query with join
    const productsQuery = applyFilters(
      db.tenantJoin(baseQuery.clone(), 'service_types as st', 'sc.custom_service_type_id', 'st.id', { type: 'left' })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.custom_service_type_id',
          'sc.billing_method',
          knex.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.tenant',
          'sc.description',
          'sc.item_kind',
          'sc.is_active',
          'sc.sku',
          'sc.barcode',
          knex.raw('CAST(sc.cost AS FLOAT) as cost'),
          'sc.cost_currency',
          'sc.vendor',
          'sc.manufacturer',
          'sc.product_category',
          'sc.is_license',
          'sc.license_term',
          'sc.license_billing_cadence',
          'sc.tax_rate_id',
          'st.name as service_type_name'
        )
    )
      .orderBy(sortColumnMap[sortField], sortOrder)
      .modify((qb: any) => {
        if (sortField !== 'service_name') {
          qb.orderBy('sc.service_name', 'asc');
        }
        qb.orderBy('sc.service_id', 'asc');
      })
      .limit(limit)
      .offset(offset);

    const productsData = await productsQuery;

    // Fetch prices for returned products
    const serviceIds = productsData.map((s: any) => s.service_id);
    const allPrices = serviceIds.length > 0
      ? await db.table('service_prices')
          .whereIn('service_id', serviceIds)
          .select('*')
          .orderBy([{ column: 'display_order' }, { column: 'currency_code' }])
      : [];

    const pricesByService: Record<string, any[]> = {};
    for (const price of allPrices) {
      if (!pricesByService[price.service_id]) {
        pricesByService[price.service_id] = [];
      }
      pricesByService[price.service_id].push(price);
    }

    // Current price per currency in `prices`; future-dated rows in
    // `scheduled_prices` (same split as the service catalog and the model read
    // paths) so an API consumer cannot read a not-yet-effective rate.
    let products = productsData.map((service: any) => {
      const { current, scheduled } = splitServicePricesByEffectiveDate(
        pricesByService[service.service_id] || [],
      );
      return { ...service, prices: current, scheduled_prices: scheduled };
    });

    // Post-filter by is_license if specified
    if (filters.is_license !== undefined) {
      products = products.filter((p: any) => Boolean(p.is_license) === filters.is_license);
      return {
        data: products,
        total: products.length
      };
    }

    return { data: products, total };
  }

  async getById(id: string, context: ServiceContext): Promise<IService | null> {
    const { knex } = await this.getKnex();
    const tenant = context.tenant;
    const db = tenantDb(knex, tenant);

    const product = await db.tenantJoin(db.table('service_catalog as sc'), 'service_types as st', 'sc.custom_service_type_id', 'st.id', { type: 'left' })
      .where('sc.service_id', id)
      .select(
        'sc.*',
        knex.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
        knex.raw('CAST(sc.cost AS FLOAT) as cost'),
        'st.name as service_type_name'
      )
      .first();

    if (!product) return null;
    if (product.item_kind !== 'product') return null;

    const prices = await db.table('service_prices')
      .where('service_id', id)
      .select('*')
      .orderBy([{ column: 'display_order' }, { column: 'currency_code' }]);

    const { current, scheduled } = splitServicePricesByEffectiveDate(prices);
    return { ...product, prices: current, scheduled_prices: scheduled } as IService;
  }

  async create(data: Partial<IService>, context: ServiceContext): Promise<IService> {
    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    const rawData = data as any;
    const {
      prices,
      scheduled_prices: scheduledPrices,
      billing_method: _billing_method,
      unit_of_measure,
      ...rest
    } = rawData;
    // default_rate mirrors the primary price (prices[0]); the schema defaults an
    // omitted default_rate to 0, so the writer's mirror is what sets it.

    // DD-2/F-2: resolve the product cost currency when not explicitly provided.
    // Products are tenant-scoped (no client_id), so precedence is:
    // explicit input -> tenant default (default_billing_settings) -> 'USD'.
    // We read default_billing_settings directly with the tenant-scoped knex
    // rather than calling resolveClientBillingCurrency() (a withAuth action that
    // would double-resolve auth/tenant). Set explicitly because
    // service_catalog.cost_currency DB column defaults to 'USD' when unset.
    let costCurrency = rest.cost_currency;
    if (!costCurrency) {
      const billingSettings = await tenantDb(knex, tenant).table('default_billing_settings')
        .select('default_currency_code')
        .first();
      costCurrency = billingSettings?.default_currency_code || 'USD';
    }

    // Resolve inherited defaults and units in the transaction, holding the
    // documented rate/region locks until the catalog row is persisted.
    // Publication happens only after commit so search consumers can read it.
    const createdResult = await withTransaction(knex, async (trx) => {
      const productData = {
        ...rest,
        cost_currency: costCurrency,
        item_kind: 'product',
        billing_method: 'usage',
        ...(await resolveCatalogUnitForCreate(trx, tenant, { unit_of_measure, unit_code: rest.unit_code, item_kind: 'product' })),
        tenant,
        default_rate: typeof rest.default_rate === 'string'
          ? parseFloat(rest.default_rate) || 0
          : rest.default_rate,
        // Omitted inherits the tenant default; explicit null stays non-taxable.
        tax_rate_id: await resolveCatalogTaxRateIdForCreate(
          trx,
          tenant,
          rest.tax_rate_id,
          undefined,
          { lock: true },
        ),
        category_id: rest.category_id ?? null,
        barcode: normalizeGtin(rest.barcode ?? '') || null,
      };

      let created: IService;
      try {
        [created] = await tenantDb(trx, tenant).table<IService>('service_catalog')
          .insert(productData)
          .returning('*');
      } catch (error) {
        rethrowProductUniqueViolation(error);
      }

      // Prices go through the shared catalog pricing writer (billing lock,
      // validation, display order, default_rate mirror) in this transaction.
      if (prices !== undefined || scheduledPrices !== undefined) {
        const { servicePatch } = await writePricing(trx, tenant, created.service_id, {
          current: prices,
          scheduled: scheduledPrices,
        });
        if (servicePatch.default_rate !== undefined) {
          await tenantDb(trx, tenant).table('service_catalog')
            .where('service_id', created.service_id)
            .update(servicePatch);
        }
      }

      return {
        serviceId: created.service_id,
        itemKind: 'product' as const,
        changedFields: [
          ...Object.keys(productData),
          ...(prices !== undefined ? ['prices'] : []),
          ...(scheduledPrices !== undefined ? ['scheduled_prices'] : []),
        ],
      };
    });

    await publishServiceCatalogSearchEvent('SERVICE_CATALOG_CREATED', tenant, createdResult.serviceId, {
      userId: context.userId,
      itemKind: createdResult.itemKind,
      changedFields: createdResult.changedFields,
    });

    return this.getById(createdResult.serviceId, context) as Promise<IService>;
  }

  async update(id: string, data: Partial<IService>, context: ServiceContext): Promise<IService> {
    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    const {
      prices,
      scheduled_prices: scheduledPrices,
      billing_method: _billing_method,
      service_type_name: _,
      ...updateData
    } = data as any;

    // One transaction for the catalog row and its prices: a failure after the
    // catalog write leaves no partial state.
    const changedFields = await withTransaction(knex, async (trx) => {
      // Verify it's a product
      const existing = await tenantDb(trx, tenant).table('service_catalog')
        .where('service_id', id)
        .select('item_kind')
        .first();
      if (!existing || existing.item_kind !== 'product') {
        throw new NotFoundError('Resource not found or permission denied');
      }

      const normalizedUpdateData = {
        ...updateData,
        ...(await resolveCatalogUnitForUpdate(trx, tenant, updateData)),
        ...(updateData.barcode !== undefined
          ? { barcode: normalizeGtin(updateData.barcode ?? '') || null }
          : {}),
      };

      if (prices !== undefined || scheduledPrices !== undefined || normalizedUpdateData.default_rate !== undefined) {
        const { servicePatch } = await writePricing(trx, tenant, id, {
          current: prices,
          scheduled: scheduledPrices,
          defaultRate: normalizedUpdateData.default_rate === undefined
            ? undefined
            : Number(normalizedUpdateData.default_rate),
        });
        Object.assign(normalizedUpdateData, servicePatch);
      }

      try {
        await tenantDb(trx, tenant).table('service_catalog')
          .where('service_id', id)
          .update({
            ...normalizedUpdateData,
            item_kind: 'product',
            billing_method: 'usage'
          });
      } catch (error) {
        rethrowProductUniqueViolation(error);
      }

      return [
        ...Object.keys(normalizedUpdateData),
        ...(prices !== undefined ? ['prices'] : []),
        ...(scheduledPrices !== undefined ? ['scheduled_prices'] : []),
      ];
    });

    await publishServiceCatalogSearchEvent('SERVICE_CATALOG_UPDATED', tenant, id, {
      userId: context.userId,
      itemKind: 'product',
      changedFields,
    });

    return this.getById(id, context) as Promise<IService>;
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    await tenantDb(knex, tenant).table('service_catalog')
      .where('service_id', id)
      .delete();

    await publishServiceCatalogSearchEvent('SERVICE_CATALOG_DELETED', tenant, id, {
      userId: context.userId,
      itemKind: 'product',
    });
  }

  private normalizeSortField(sort?: string | null): SortField {
    const allowed: SortField[] = ['service_name', 'billing_method', 'default_rate'];
    if (allowed.includes(sort as SortField)) {
      return sort as SortField;
    }
    return 'service_name';
  }

  private normalizeOrder(order: string | null | undefined): 'asc' | 'desc' {
    if (order === 'asc' || order === 'desc') {
      return order;
    }
    return 'asc';
  }
}
