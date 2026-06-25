/**
 * Shared types for API controllers
 */
import type { TenantScopedQuery } from '@alga-psa/db';

export interface CrudOptions {
  resource: string;
  createSchema?: any;
  updateSchema?: any;
  querySchema?: any;
  permissions?: {
    create?: string;
    read?: string;
    update?: string;
    delete?: string;
    list?: string;
  };
}

export interface ListOptions {
  page?: number;
  limit?: number;
  filters?: Record<string, any>;
  sort?: string;
  order?: 'asc' | 'desc';
  /**
   * Optional field selection for list endpoints (comma-separated via `?fields=...`).
   * Services may ignore this if not supported.
   */
  fields?: string[];
  /**
   * Optional row-level authorization predicate (e.g. compiled read-narrowing)
   * applied to both the data and count queries, so the service paginates and
   * counts only the authorized set in SQL. Services may ignore this if unsupported.
   */
  applyAuthorization?: (query: TenantScopedQuery) => void;
}

export interface BaseService {
  list(options: ListOptions, context: any): Promise<{ data: any[]; total: number }>;
  getById(id: string, context: any): Promise<any | null>;
  create(data: any, context: any): Promise<any>;
  update(id: string, data: any, context: any): Promise<any>;
  delete(id: string, context: any): Promise<void>;
}
