import type { IService } from '@/interfaces/billing.interfaces';
import { BaseService, ServiceContext, ListResult, tenantDb } from '@alga-psa/db';
import { ListOptions } from '../controllers/types';
import { publishServiceCatalogSearchEvent } from './ServiceCatalogService';
import { NotFoundError } from '../middleware/apiMiddleware';

type SortField = 'service_name' | 'billing_method' | 'default_rate';

type FilterOptions = {
  search?: string;
  category_id?: string | null;
  is_active?: boolean;
  is_license?: boolean;
};

export class ProductCatalogService extends BaseService<IService> {
  constructor() {
    super({
      tableName: 'service_catalog',
      primaryKey: 'service_id',
      tenantColumn: 'tenant',
      searchableFields: ['service_name', 'description', 'sku'],
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
      if (filters.search) {
        const term = `%${filters.search}%`;
        query.andWhere((builder: any) => {
          builder
            .whereILike('sc.service_name', term)
            .orWhereILike('sc.description', term)
            .orWhereILike('sc.sku', term);
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
      : [];

    const pricesByService: Record<string, any[]> = {};
    for (const price of allPrices) {
      if (!pricesByService[price.service_id]) {
        pricesByService[price.service_id] = [];
      }
      pricesByService[price.service_id].push(price);
    }

    let products = productsData.map((service: any) => ({
      ...service,
      prices: pricesByService[service.service_id] || []
    }));

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
      .select('*');

    return { ...product, prices } as IService;
  }

  async create(data: Partial<IService>, context: ServiceContext): Promise<IService> {
    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    const rawData = data as any;
    const {
      prices,
      billing_method: _billing_method,
      unit_of_measure,
      ...rest
    } = rawData;

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

    const productData = {
      ...rest,
      cost_currency: costCurrency,
      item_kind: 'product',
      billing_method: 'usage',
      unit_of_measure: unit_of_measure ?? 'each',
      tenant,
      default_rate: typeof rest.default_rate === 'string'
        ? parseFloat(rest.default_rate) || 0
        : rest.default_rate,
      tax_rate_id: rest.tax_rate_id || null,
      category_id: rest.category_id ?? null,
    };

    const [created] = await tenantDb(knex, tenant).table('service_catalog')
      .insert(productData)
      .returning('*');

    // Set prices if provided
    if (prices && prices.length > 0) {
      await this.setServicePrices(knex, created.service_id, tenant, prices);
    }

    await publishServiceCatalogSearchEvent('SERVICE_CATALOG_CREATED', tenant, created.service_id, {
      userId: context.userId,
      itemKind: 'product',
      changedFields: Object.keys(productData),
    });

    return this.getById(created.service_id, context) as Promise<IService>;
  }

  async update(id: string, data: Partial<IService>, context: ServiceContext): Promise<IService> {
    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    // Verify it's a product
    const existing = await tenantDb(knex, tenant).table('service_catalog')
      .where('service_id', id)
      .select('item_kind')
      .first();
    if (!existing || existing.item_kind !== 'product') {
      throw new NotFoundError('Resource not found or permission denied');
    }

    const { prices, billing_method: _billing_method, service_type_name: _, ...updateData } = data as any;

    await tenantDb(knex, tenant).table('service_catalog')
      .where('service_id', id)
      .update({
        ...updateData,
        item_kind: 'product',
        billing_method: 'usage'
      });

    // Update prices if provided
    if (prices) {
      await this.setServicePrices(knex, id, tenant, prices);
    }

    await publishServiceCatalogSearchEvent('SERVICE_CATALOG_UPDATED', tenant, id, {
      userId: context.userId,
      itemKind: 'product',
      changedFields: Object.keys(updateData),
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

  private async setServicePrices(
    knex: any,
    serviceId: string,
    tenant: string,
    prices: Array<{ currency_code: string; rate: number }>
  ): Promise<void> {
    // Delete existing prices and insert new ones
    await tenantDb(knex, tenant).table('service_prices')
      .where('service_id', serviceId)
      .delete();

    if (prices.length > 0) {
      await tenantDb(knex, tenant).table('service_prices').insert(
        prices.map((p) => ({
          service_id: serviceId,
          tenant,
          currency_code: p.currency_code,
          rate: p.rate
        }))
      );
    }
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
