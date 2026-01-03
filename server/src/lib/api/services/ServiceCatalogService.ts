import type { BaseService as ControllerBaseService, ListOptions } from '../controllers/types';
import type { IService } from '@/interfaces/billing.interfaces';
import {
  createService,
  deleteService,
  getServiceById,
  getServices,
  updateService,
  ServiceListOptions
} from '@/lib/actions/serviceActions';
import type { CreateServiceRequest, UpdateServiceRequest } from '../schemas/serviceSchemas';
import { ca } from 'date-fns/locale';

type SortField = NonNullable<ServiceListOptions['sort']>;

type FilterOptions = {
  search?: string;
  billing_method?: IService['billing_method'];
  category_id?: string | null;
  custom_service_type_id?: string;
  item_kind?: 'service' | 'product' | 'any';
  is_active?: boolean;
};

export class ServiceCatalogService implements ControllerBaseService {
  async list(options: ListOptions, context: unknown): Promise<{ data: IService[]; total: number }> {
    void context;

    const page = options.page ?? 1;
    const limit = options.limit ?? 25;

    const filters = (options.filters ?? {}) as FilterOptions;

    const sortField = this.normalizeSortField(options.sort);
    const sortOrder = this.normalizeOrder(options.order, sortField);

    const listOptions: ServiceListOptions = {
      sort: sortField,
      order: sortOrder
    };

    if (filters.search) {
      listOptions.search = filters.search;
    }

    if (filters.billing_method) {
      listOptions.billing_method = filters.billing_method;
    }

    if (filters.category_id !== undefined) {
      listOptions.category_id = filters.category_id;
    }

    if (filters.custom_service_type_id) {
      listOptions.custom_service_type_id = filters.custom_service_type_id;
    }

    if (filters.item_kind) {
      listOptions.item_kind = filters.item_kind;
    }

    if (filters.is_active !== undefined) {
      listOptions.is_active = filters.is_active;
    }

    const response = await getServices(page, limit, listOptions);

    return {
      data: response.services,
      total: response.totalCount
    };
  }

  async getById(id: string, context: unknown): Promise<IService | null> {
    void context;
    return await getServiceById(id);
  }

  async create(data: CreateServiceRequest, context: unknown): Promise<IService> {
    void context;
    let dataSanitized = {
      category_id: data.category_id ?? null,
      currency_code: data.currency_code ?? 'USD', // Default to USD if not provided
      ...data,
    }
    return await createService(dataSanitized);
  }

  async update(id: string, data: UpdateServiceRequest, context: unknown): Promise<IService | null> {
    void context;
    try {
      const updated = await updateService(id, data);
      return updated;
    } catch (error: unknown) {
      if (error instanceof Error && /not found/i.test(error.message)) {
        return null;
      }
      throw error;
    }
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

  private normalizeOrder(order: string | null | undefined, sortField: SortField): 'asc' | 'desc' {
    if (order === 'asc' || order === 'desc') {
      return order;
    }

    return 'asc';
  }
}
