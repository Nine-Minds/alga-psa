/**
 * Shared types for API controllers
 */

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
}

export interface BaseService {
  list(options: ListOptions, context: any): Promise<{ data: any[]; total: number }>;
  getById(id: string, context: any): Promise<any | null>;
  create(data: any, context: any): Promise<any>;
  update(id: string, data: any, context: any): Promise<any>;
  delete(id: string, context: any): Promise<void>;
}