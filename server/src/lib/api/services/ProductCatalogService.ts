import type { BaseService as ControllerBaseService, ListOptions } from '../controllers/types';
import type { IService } from '@/interfaces/billing.interfaces';
import {
  createService,
  deleteService,
  getServiceById,
  getServices,
  setServicePrices,
  updateService,
  ServiceListOptions
} from '@/lib/actions/serviceActions';
import type { CreateProductRequest, UpdateProductRequest } from '../schemas/productSchemas';

type SortField = NonNullable<ServiceListOptions['sort']>;

type FilterOptions = {
  search?: string;
  category_id?: string | null;
  is_active?: boolean;
  is_license?: boolean;
};

export class ProductCatalogService implements ControllerBaseService {
  async list(options: ListOptions, context: unknown): Promise<{ data: IService[]; total: number }> {
    void context;

    const page = options.page ?? 1;
    const limit = options.limit ?? 25;

    const filters = (options.filters ?? {}) as FilterOptions;

    const sortField = this.normalizeSortField(options.sort);
    const sortOrder = this.normalizeOrder(options.order, sortField);

    const listOptions: ServiceListOptions = {
      item_kind: 'product',
      sort: sortField,
      order: sortOrder
    };

    if (filters.search) {
      listOptions.search = filters.search;
    }

    if (filters.category_id !== undefined) {
      listOptions.category_id = filters.category_id;
    }

    if (filters.is_active !== undefined) {
      listOptions.is_active = filters.is_active;
    }

    const response = await getServices(page, limit, listOptions);
    let products = response.services;

    if (filters.is_license !== undefined) {
      products = products.filter((p) => Boolean(p.is_license) === filters.is_license);
    }

    return {
      data: products,
      total: filters.is_license === undefined ? response.totalCount : products.length
    };
  }

  async getById(id: string, context: unknown): Promise<IService | null> {
    void context;
    const item = await getServiceById(id);
    if (!item) return null;
    if (item.item_kind !== 'product') return null;
    return item;
  }

  async create(data: CreateProductRequest, context: unknown): Promise<IService> {
    void context;

    const {
      prices,
      billing_method: _billing_method,
      unit_of_measure,
      ...rest
    } = data;

    const created = await createService({
      ...rest,
      item_kind: 'product',
      billing_method: 'per_unit',
      unit_of_measure: unit_of_measure ?? 'each'
    } as any);

    if (prices && prices.length > 0) {
      await setServicePrices(created.service_id, prices);
    }

    return (await getServiceById(created.service_id)) as IService;
  }

  async update(id: string, data: UpdateProductRequest, context: unknown): Promise<IService | null> {
    void context;

    const existing = await getServiceById(id);
    if (!existing || existing.item_kind !== 'product') {
      return null;
    }

    const {
      prices,
      billing_method: _billing_method,
      ...rest
    } = data;

    const updated = await updateService(id, {
      ...rest,
      item_kind: 'product',
      billing_method: 'per_unit'
    } as any);

    if (prices) {
      await setServicePrices(id, prices);
    }

    return updated;
  }

  async delete(id: string, context: unknown): Promise<void> {
    void context;
    await deleteService(id);
  }

  private normalizeSortField(sort?: string | null): SortField {
    const allowed: SortField[] = ['service_name', 'billing_method', 'default_rate'];
    if (allowed.includes(sort as SortField)) {
      return sort as SortField;
    }
    return 'service_name';
  }

  private normalizeOrder(order: string | null | undefined, _sortField: SortField): 'asc' | 'desc' {
    if (order === 'asc' || order === 'desc') {
      return order;
    }
    return 'asc';
  }
}

