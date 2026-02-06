import type { IService } from '@/interfaces/billing.interfaces';
import { BaseService, ServiceContext, ListResult } from '@alga-psa/db';
import { ListOptions } from '../controllers/types';

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

    const baseQuery = knex('service_catalog as sc').where({ 'sc.tenant': tenant });

    // Count
    const countResult = await applyFilters(baseQuery.clone())
      .count('sc.service_id as count')
      .first();
    const total = parseInt(countResult?.count as string) || 0;

    // Data query with join
    const productsQuery = applyFilters(
      baseQuery
        .clone()
        .leftJoin('service_types as st', function (this: any) {
          this.on('sc.custom_service_type_id', '=', 'st.id')
            .andOn('sc.tenant', '=', 'st.tenant');
        })
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
      ? await knex('service_prices')
          .where({ tenant })
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

    const product = await knex('service_catalog as sc')
      .leftJoin('service_types as st', function (this: any) {
        this.on('sc.custom_service_type_id', '=', 'st.id')
          .andOn('sc.tenant', '=', 'st.tenant');
      })
      .where({ 'sc.service_id': id, 'sc.tenant': tenant })
      .select(
        'sc.*',
        knex.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
        knex.raw('CAST(sc.cost AS FLOAT) as cost'),
        'st.name as service_type_name'
      )
      .first();

    if (!product) return null;
    if (product.item_kind !== 'product') return null;

    const prices = await knex('service_prices')
      .where({ service_id: id, tenant })
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

    const productData = {
      ...rest,
      item_kind: 'product',
      billing_method: 'per_unit',
      unit_of_measure: unit_of_measure ?? 'each',
      tenant,
      default_rate: typeof rest.default_rate === 'string'
        ? parseFloat(rest.default_rate) || 0
        : rest.default_rate,
      tax_rate_id: rest.tax_rate_id || null,
      category_id: rest.category_id ?? null,
    };

    const [created] = await knex('service_catalog')
      .insert(productData)
      .returning('*');

    // Set prices if provided
    if (prices && prices.length > 0) {
      await this.setServicePrices(knex, created.service_id, tenant, prices);
    }

    return this.getById(created.service_id, context) as Promise<IService>;
  }

  async update(id: string, data: Partial<IService>, context: ServiceContext): Promise<IService> {
    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    // Verify it's a product
    const existing = await knex('service_catalog')
      .where({ service_id: id, tenant })
      .select('item_kind')
      .first();
    if (!existing || existing.item_kind !== 'product') {
      throw new Error('Resource not found or permission denied');
    }

    const { prices, billing_method: _billing_method, service_type_name: _, ...updateData } = data as any;

    await knex('service_catalog')
      .where({ service_id: id, tenant })
      .update({
        ...updateData,
        item_kind: 'product',
        billing_method: 'per_unit'
      });

    // Update prices if provided
    if (prices) {
      await this.setServicePrices(knex, id, tenant, prices);
    }

    return this.getById(id, context) as Promise<IService>;
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    await knex('service_catalog')
      .where({ service_id: id, tenant })
      .delete();
  }

  private async setServicePrices(
    knex: any,
    serviceId: string,
    tenant: string,
    prices: Array<{ currency_code: string; rate: number }>
  ): Promise<void> {
    // Delete existing prices and insert new ones
    await knex('service_prices')
      .where({ service_id: serviceId, tenant })
      .delete();

    if (prices.length > 0) {
      await knex('service_prices').insert(
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
