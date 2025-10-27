/**
 * Base Service Class
 * Provides common database operations and patterns for API services
 */

import { Knex } from 'knex';
import { createTenantKnex } from '@server/lib/db';
// withTransaction helper
async function withTransaction<T>(
  knex: Knex,
  callback: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  return knex.transaction(callback);
}
// Import and re-export for services
export interface ListOptions {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  filters?: Record<string, any>;
}

export interface ServiceContext {
  userId: string;
  tenant: string;
  user?: any;
  db?: Knex;
}

export interface ListResult<T> {
  data: T[];
  total: number;
  _links?: Record<string, { href: string; method: string; rel: string }>;
}

export interface ServiceOptions {
  tableName: string;
  primaryKey?: string;
  tenantColumn?: string;
  softDelete?: boolean;
  auditFields?: {
    createdBy?: string;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  searchableFields?: string[];
  defaultSort?: string;
  defaultOrder?: 'asc' | 'desc';
}

export abstract class BaseService<T = any> {
  protected tableName: string;
  protected primaryKey: string;
  protected tenantColumn: string;
  protected softDelete: boolean;
  protected auditFields: {
    createdBy: string;
    updatedBy: string;
    createdAt: string;
    updatedAt: string;
  };
  protected searchableFields: string[];
  protected defaultSort: string;
  protected defaultOrder: 'asc' | 'desc';

  constructor(options: ServiceOptions) {
    this.tableName = options.tableName;
    this.primaryKey = options.primaryKey || 'id';
    this.tenantColumn = options.tenantColumn || 'tenant';
    this.softDelete = options.softDelete || false;
    this.auditFields = {
      createdBy: 'created_by',
      updatedBy: 'updated_by',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      ...options.auditFields
    };
    this.searchableFields = options.searchableFields || [];
    this.defaultSort = options.defaultSort || this.auditFields.createdAt;
    this.defaultOrder = options.defaultOrder || 'desc';
  }

  /**
   * Get database connection with tenant context
   */
    protected async getKnex(): Promise<{ knex: Knex; tenant: string }> {
      const result = await createTenantKnex();
      if (!result.tenant) {
        throw new Error('No tenant found in current context');
      }
      return { knex: result.knex, tenant: result.tenant };
    }


  /**
   * Get database connection for a context (backward compatibility)
   */
  protected async getDbForContext(context: ServiceContext): Promise<Knex> {
    if (context.db) {
      return context.db;
    }
    const { knex } = await this.getKnex();
    return knex;
  }

  /**
   * Build base query with tenant filtering
   */
  protected buildBaseQuery(knex: Knex, context: ServiceContext): Knex.QueryBuilder {
    let query = knex(this.tableName).where(this.tenantColumn, context.tenant);
    
    if (this.softDelete) {
      query = query.whereNull('deleted_at');
    }
    
    return query;
  }

  /**
   * Apply filters to query
   */
  protected applyFilters(query: Knex.QueryBuilder, filters: Record<string, any>): Knex.QueryBuilder {
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      // Handle special filter types
      if (key.endsWith('_from')) {
        const field = key.replace('_from', '');
        query.where(field, '>=', value);
      } else if (key.endsWith('_to')) {
        const field = key.replace('_to', '');
        query.where(field, '<=', value);
      } else if (key === 'search' && this.searchableFields.length > 0) {
        query.where(subQuery => {
          this.searchableFields.forEach((field, index) => {
            if (index === 0) {
              subQuery.whereILike(field, `%${value}%`);
            } else {
              subQuery.orWhereILike(field, `%${value}%`);
            }
          });
        });
      } else if (Array.isArray(value)) {
        query.whereIn(key, value);
      } else {
        query.where(key, value);
      }
    });

    return query;
  }

  /**
   * Apply sorting to query
   */
  protected applySorting(
    query: Knex.QueryBuilder, 
    sort?: string, 
    order?: 'asc' | 'desc'
  ): Knex.QueryBuilder {
    const sortField = sort || this.defaultSort;
    const sortOrder = order || this.defaultOrder;
    
    return query.orderBy(sortField, sortOrder);
  }

  /**
   * Apply pagination to query
   */
  protected applyPagination(
    query: Knex.QueryBuilder, 
    page: number, 
    limit: number
  ): Knex.QueryBuilder {
    const offset = (page - 1) * limit;
    return query.limit(limit).offset(offset);
  }

  /**
   * Add audit fields for create operations
   */
  protected addCreateAuditFields(data: any, context: ServiceContext): any {
    const now = new Date().toISOString();
    return {
      ...data,
      [this.auditFields.createdBy]: context.userId,
      [this.auditFields.updatedBy]: context.userId,
      [this.auditFields.createdAt]: now,
      [this.auditFields.updatedAt]: now,
      [this.tenantColumn]: context.tenant
    };
  }

  /**
   * Add audit fields for update operations
   */
  protected addUpdateAuditFields(data: any, context: ServiceContext): any {
    return {
      ...data,
      [this.auditFields.updatedBy]: context.userId,
      [this.auditFields.updatedAt]: new Date().toISOString()
    };
  }

  /**
   * List resources with filtering, sorting, and pagination
   */
  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<T>> {
    const { knex } = await this.getKnex();
    
    const {
      page = 1,
      limit = 25,
      filters = {},
      sort,
      order
    } = options;

    // Build base query for data
    let dataQuery = this.buildBaseQuery(knex, context);
    dataQuery = this.applyFilters(dataQuery, filters);
    dataQuery = this.applySorting(dataQuery, sort, order);
    dataQuery = this.applyPagination(dataQuery, page, limit);

    // Build count query
    let countQuery = this.buildBaseQuery(knex, context);
    countQuery = this.applyFilters(countQuery, filters);

    // Execute queries
    const [data, [{ count }]] = await Promise.all([
      dataQuery.select('*'),
      countQuery.count('* as count')
    ]);

    return {
      data: data as T[],
      total: parseInt(count as string)
    };
  }

  /**
   * Get single resource by ID
   */
  async getById(id: string, context: ServiceContext): Promise<T | null> {
    const { knex } = await this.getKnex();
    
    const result = await this.buildBaseQuery(knex, context)
      .where(this.primaryKey, id)
      .first();

    return result as T | null;
  }

  /**
   * Create new resource
   */
  async create(data: Partial<T>, context: ServiceContext): Promise<T> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const auditedData = this.addCreateAuditFields(data, context);
      const [result] = await trx(this.tableName).insert(auditedData).returning('*');
      return result as T;
    });
  }

  /**
   * Update existing resource
   */
  async update(id: string, data: Partial<T>, context: ServiceContext): Promise<T> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const auditedData = this.addUpdateAuditFields(data, context);
      
      const [result] = await trx(this.tableName)
        .where(this.primaryKey, id)
        .where(this.tenantColumn, context.tenant)
        .update(auditedData)
        .returning('*');

      if (!result) {
        throw new Error('Resource not found or permission denied');
      }

      return result as T;
    });
  }

  /**
   * Delete resource (soft delete if enabled, hard delete otherwise)
   */
  async delete(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      if (this.softDelete) {
        const auditedData = this.addUpdateAuditFields(
          { deleted_at: new Date().toISOString() },
          context
        );
        
        await trx(this.tableName)
          .where(this.primaryKey, id)
          .where(this.tenantColumn, context.tenant)
          .update(auditedData);
      } else {
        await trx(this.tableName)
          .where(this.primaryKey, id)
          .where(this.tenantColumn, context.tenant)
          .delete();
      }
    });
  }

  /**
   * Check if resource exists
   */
  async exists(id: string, context: ServiceContext): Promise<boolean> {
    const { knex } = await this.getKnex();
    
    const result = await this.buildBaseQuery(knex, context)
      .where(this.primaryKey, id)
      .first('1');

    return !!result;
  }

  /**
   * Bulk operations
   */
  async bulkCreate(data: Partial<T>[], context: ServiceContext): Promise<T[]> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const auditedData = data.map(item => this.addCreateAuditFields(item, context));
      const results = await trx(this.tableName).insert(auditedData).returning('*');
      return results as T[];
    });
  }

  async bulkUpdate(updates: Array<{ id: string; data: Partial<T> }>, context: ServiceContext): Promise<T[]> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const results: any[] = [];
      
      for (const update of updates) {
        const auditedData = this.addUpdateAuditFields(update.data, context);
        
        const [result] = await trx(this.tableName)
          .where(this.primaryKey, update.id)
          .where(this.tenantColumn, context.tenant)
          .update(auditedData)
          .returning('*');
          
        if (result) {
          results.push(result);
        }
      }
      
      return results as T[];
    });
  }

  async bulkDelete(ids: string[], context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      if (this.softDelete) {
        const auditedData = this.addUpdateAuditFields(
          { deleted_at: new Date().toISOString() },
          context
        );
        
        await trx(this.tableName)
          .whereIn(this.primaryKey, ids)
          .where(this.tenantColumn, context.tenant)
          .update(auditedData);
      } else {
        await trx(this.tableName)
          .whereIn(this.primaryKey, ids)
          .where(this.tenantColumn, context.tenant)
          .delete();
      }
    });
  }

  /**
   * Custom query method for complex operations
   */
  protected async executeQuery<R = any>(
    queryBuilder: (knex: Knex, context: ServiceContext) => Knex.QueryBuilder,
    context: ServiceContext
  ): Promise<R[]> {
    const { knex } = await this.getKnex();
    const query = queryBuilder(knex, context);
    return query;
  }
}
