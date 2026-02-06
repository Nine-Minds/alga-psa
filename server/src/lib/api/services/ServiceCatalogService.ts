import type { IService } from '@/interfaces/billing.interfaces';
import { BaseService, ServiceContext, ListResult } from '@alga-psa/db';
import { ListOptions } from '../controllers/types';

type SortField = 'service_name' | 'billing_method' | 'default_rate';

type FilterOptions = {
  search?: string;
  billing_method?: IService['billing_method'];
  category_id?: string | null;
  custom_service_type_id?: string;
  item_kind?: 'service' | 'product' | 'any';
  is_active?: boolean;
};

export class ServiceCatalogService extends BaseService<IService> {
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

    // Default to 'service' to match legacy behavior
    const itemKind = filters.item_kind ?? 'service';

    const applyFilters = (query: any) => {
      if (itemKind && itemKind !== 'any') {
        query.where('sc.item_kind', itemKind);
      }
      if (filters.is_active !== undefined) {
        query.where('sc.is_active', filters.is_active);
      }
      if (filters.billing_method) {
        query.where('sc.billing_method', filters.billing_method);
      }
      if (filters.custom_service_type_id) {
        query.where('sc.custom_service_type_id', filters.custom_service_type_id);
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
    const servicesQuery = applyFilters(
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

    const servicesData = await servicesQuery;

    // Fetch prices for returned services
    const serviceIds = servicesData.map((s: any) => s.service_id);
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

    const data = servicesData.map((service: any) => ({
      ...service,
      prices: pricesByService[service.service_id] || []
    }));

    return { data, total };
  }

  async getById(id: string, context: ServiceContext): Promise<IService | null> {
    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    const service = await knex('service_catalog as sc')
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

    if (!service) return null;

    const prices = await knex('service_prices')
      .where({ service_id: id, tenant })
      .select('*');

    return { ...service, prices } as IService;
  }

  async create(data: Partial<IService>, context: ServiceContext): Promise<IService> {
    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    const { custom_service_type_id } = data;
    if (custom_service_type_id) {
      const serviceType = await knex('service_types')
        .where({ id: custom_service_type_id, tenant })
        .first();
      if (!serviceType) {
        throw new Error(`ServiceType ID '${custom_service_type_id}' not found for tenant '${tenant}'.`);
      }
    }

    const serviceData = {
      category_id: data.category_id ?? null,
      currency_code: data.currency_code ?? 'USD',
      ...data,
      tenant,
      default_rate: typeof data.default_rate === 'string'
        ? parseFloat(data.default_rate) || 0
        : data.default_rate,
      tax_rate_id: data.tax_rate_id || null,
    };

    const [created] = await knex('service_catalog')
      .insert(serviceData)
      .returning('*');

    return this.getById(created.service_id, context) as Promise<IService>;
  }

  async update(id: string, data: Partial<IService>, context: ServiceContext): Promise<IService> {
    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    // Strip fields that shouldn't be updated
    const { service_type_name: _, prices: _prices, ...updateData } = data as any;

    const [updated] = await knex('service_catalog')
      .where({ service_id: id, tenant })
      .update(updateData)
      .returning('*');

    if (!updated) {
      throw new Error('Resource not found or permission denied');
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
