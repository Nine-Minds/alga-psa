import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import type { IService, IServicePrice, IServiceCategory, ISO8601String } from '@alga-psa/types';

export type ServiceListOptions = {
  search?: string;
  item_kind?: 'service' | 'product' | 'any';
  is_active?: boolean;
  billing_method?: 'fixed' | 'hourly' | 'usage' | 'per_unit';
  category_id?: string | null;
  custom_service_type_id?: string;
  sort?: 'service_name' | 'billing_method' | 'default_rate';
  order?: 'asc' | 'desc';
};

export type PaginatedServicesResponse = {
  services: IService[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export async function getServiceCategories(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<IServiceCategory[]> {
  return knexOrTrx<IServiceCategory>('service_categories').where({ tenant }).select('*');
}

export async function getServices(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  page: number = 1,
  pageSize: number = 999,
  options: ServiceListOptions = {}
): Promise<PaginatedServicesResponse> {
  const offset = (page - 1) * pageSize;

  type SortField = NonNullable<ServiceListOptions['sort']>;
  const sortFields: SortField[] = ['service_name', 'billing_method', 'default_rate'];
  const sortField: SortField = sortFields.includes(options.sort as SortField)
    ? (options.sort as SortField)
    : 'service_name';

  const defaultOrderForSort: Record<SortField, 'asc' | 'desc'> = {
    service_name: 'asc',
    billing_method: 'asc',
    default_rate: 'asc'
  };

  const sortOrder: 'asc' | 'desc' =
    options.order === 'asc' || options.order === 'desc' ? options.order : defaultOrderForSort[sortField];

  const sanitizedOptions: ServiceListOptions & { sort: SortField; order: 'asc' | 'desc' } = {
    search: options.search?.trim() ? options.search.trim() : undefined,
    item_kind: options.item_kind ?? 'service',
    is_active: options.is_active,
    billing_method: options.billing_method,
    category_id: options.category_id,
    custom_service_type_id: options.custom_service_type_id,
    sort: sortField,
    order: sortOrder
  };

  const applyFilters = (query: Knex.QueryBuilder) => {
    if (sanitizedOptions.item_kind && sanitizedOptions.item_kind !== 'any') {
      query.where('sc.item_kind', sanitizedOptions.item_kind);
    }

    if (sanitizedOptions.is_active !== undefined) {
      query.where('sc.is_active', sanitizedOptions.is_active);
    }

    if (sanitizedOptions.billing_method) {
      query.where('sc.billing_method', sanitizedOptions.billing_method);
    }

    if (sanitizedOptions.custom_service_type_id) {
      query.where('sc.custom_service_type_id', sanitizedOptions.custom_service_type_id);
    }

    if (sanitizedOptions.category_id !== undefined) {
      if (sanitizedOptions.category_id === null) {
        query.whereNull('sc.category_id');
      } else {
        query.where('sc.category_id', sanitizedOptions.category_id);
      }
    }

    if (sanitizedOptions.search) {
      const term = `%${sanitizedOptions.search}%`;
      query.andWhere((builder) => {
        builder.whereILike('sc.service_name', term).orWhereILike('sc.description', term).orWhereILike('sc.sku', term);
      });
    }

    return query;
  };

  const sortColumnMap: Record<SortField, string> = {
    service_name: 'sc.service_name',
    billing_method: 'sc.billing_method',
    default_rate: 'sc.default_rate'
  };

  const baseQuery = knexOrTrx('service_catalog as sc').where({ 'sc.tenant': tenant });

  const countResult = await applyFilters(baseQuery.clone()).count('sc.service_id as count').first();
  const totalCount = parseInt((countResult?.count as string) || '0', 10);

  const servicesData = await applyFilters(
    baseQuery
      .clone()
      .leftJoin('service_types as st', function () {
        this.on('sc.custom_service_type_id', '=', 'st.id').andOn('sc.tenant', '=', 'st.tenant');
      })
      .select(
        'sc.service_id',
        'sc.service_name',
        'sc.custom_service_type_id',
        'sc.billing_method',
        knexOrTrx.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
        'sc.unit_of_measure',
        'sc.category_id',
        'sc.tenant',
        'sc.description',
        'sc.item_kind',
        'sc.is_active',
        'sc.sku',
        knexOrTrx.raw('CAST(sc.cost AS FLOAT) as cost'),
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
    .orderBy(sortColumnMap[sanitizedOptions.sort], sanitizedOptions.order)
    .modify((queryBuilder) => {
      if (sanitizedOptions.sort !== 'service_name') {
        queryBuilder.orderBy('sc.service_name', 'asc');
      }
      queryBuilder.orderBy('sc.service_id', 'asc');
    })
    .limit(pageSize)
    .offset(offset);

  const serviceIds = servicesData.map((s: { service_id: string }) => s.service_id);
  const allPrices = serviceIds.length
    ? await knexOrTrx<IServicePrice>('service_prices').where({ tenant }).whereIn('service_id', serviceIds).select('*')
    : [];

  const pricesByService = allPrices.reduce<Record<string, IServicePrice[]>>((acc, price) => {
    if (!acc[price.service_id]) acc[price.service_id] = [];
    acc[price.service_id].push(price);
    return acc;
  }, {});

  const services: IService[] = servicesData.map((row: any) => ({
    ...row,
    prices: pricesByService[row.service_id] ?? []
  })) as IService[];

  return { services, totalCount, page, pageSize };
}

export type CreateServiceInput = Omit<IService, 'service_id' | 'tenant'>;

export async function createService(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  serviceData: CreateServiceInput
): Promise<IService> {
  const service_id = uuidv4();
  const now = (knexOrTrx as any).fn?.now ? (knexOrTrx as any).fn.now() : new Date().toISOString();

  const [created] = await knexOrTrx('service_catalog')
    .insert({
      ...serviceData,
      service_id,
      tenant,
      item_kind: (serviceData as any).item_kind ?? 'service',
      created_at: now,
      updated_at: now
    })
    .returning('*');

  return created as IService;
}

export async function updateService(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  serviceId: string,
  serviceData: Partial<IService>
): Promise<IService> {
  const now = (knexOrTrx as any).fn?.now ? (knexOrTrx as any).fn.now() : new Date().toISOString();
  const [updated] = await knexOrTrx('service_catalog')
    .where({ tenant, service_id: serviceId })
    .update({ ...serviceData, updated_at: now })
    .returning('*');

  return updated as IService;
}

export async function deleteService(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  serviceId: string
): Promise<void> {
  await knexOrTrx('service_catalog').where({ tenant, service_id: serviceId }).del();
}

export async function getServiceTypesForSelection(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<Array<{ id: string; name: string; billing_method: 'fixed' | 'hourly' | 'per_unit' | 'usage'; is_standard: boolean }>> {
  const rows = await knexOrTrx('service_types')
    .where({ tenant, is_active: true })
    .select('id', 'name', 'billing_method')
    .orderBy('name', 'asc');
  return rows.map((r: any) => ({ ...r, is_standard: false }));
}

