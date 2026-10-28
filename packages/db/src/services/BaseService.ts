/**
 * Base Service Class
 * Provides common database operations and patterns for API services
 */

import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { createTenantKnex, withTransaction } from '../lib/tenant';
import { tenantDb } from '../lib/tenantDb';
import { admitOperationalWrite } from '../lib/writeAdmission';

const tableColumnsCache = new Map<string, Promise<Set<string>>>();
const warnedMissingAuditFields = new Set<string>();

/**
 * Thrown when `applyFilters` receives a `<field>_from` / `<field>_to` key that
 * has no column mapping for the resource. Failing loudly is deliberate: silently
 * dropping the filter would return unfiltered rows the caller did not ask for.
 *
 * `statusCode`/`code` mirror the API middleware's ValidationError shape so the
 * route layer renders this as a 400 rather than a 500, without packages/db
 * depending on server internals.
 */
export class UnsupportedRangeFilterError extends Error {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';

  constructor(public readonly filterKey: string) {
    super(`Unsupported range filter "${filterKey}": no column mapping is defined for this resource`);
    this.name = 'UnsupportedRangeFilterError';
  }
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
  /** Set by the verified API transport, never from a request body. */
  apiKeyId?: string;
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
  /** Domain admission inside each inherited mutation's transaction, before
   * row access. Custom mutation overrides must retain their own admission.
   * Keeping this injected avoids a database-to-licensing dependency cycle. */
  mutationGuard?: (trx: Knex.Transaction, context: ServiceContext) => Promise<void>;
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
  protected mutationGuard?: ServiceOptions['mutationGuard'];

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
    // Default admission is the same decision `tenantDb` makes at the write terminals, taken
    // early so a refused mutation does no row access or audit work first. A caller's guard
    // COMPOSES with it (admission first), so a subclass cannot opt out by passing its own.
    const callerGuard = options.mutationGuard;
    this.mutationGuard = async (trx, context) => {
      await admitOperationalWrite(trx, context.tenant, this.tableName, `service-mutation:${this.tableName}`);
      await callerGuard?.(trx, context);
    };
  }

  /**
   * Run a custom mutation in one transaction whose first step is this
   * service's mutationGuard, so admission and the write share the transaction.
   * Overrides and service-specific writers use this instead of opening their
   * own transaction, which would skip the guard.
   */
  protected async mutationTransaction<R>(
    context: ServiceContext,
    work: (trx: Knex.Transaction, tenant: string) => Promise<R>,
  ): Promise<R> {
    const { knex, tenant } = await this.getKnex();
    return withTransaction(knex, async (trx) => {
      await this.mutationGuard?.(trx, context);
      return work(trx, tenant);
    });
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
  // LEVERAGE: pattern comanaged-trx-threading — the same choose-the-caller's-handle rule
  // as StorageService.deleteFile and the cleanupExpiredTokens services, spelled a third way.
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
  protected buildTenantScopedQuery(conn: Knex | Knex.Transaction, context: ServiceContext): Knex.QueryBuilder {
    return tenantDb(conn, context.tenant).table(this.tableName);
  }

  protected buildBaseQuery(conn: Knex | Knex.Transaction, context: ServiceContext): Knex.QueryBuilder {
    let query = this.buildTenantScopedQuery(conn, context);

    if (this.softDelete) {
      query = query.whereNull('deleted_at');
    }

    return query;
  }

  /**
   * Declared range-filter keys for this resource. Meaning is per key:
   * - a string value is the column to constrain; whether the bound is `>=` or
   *   `<=` is chosen from the key's suffix (`_from` / `_to`);
   * - `null` means a range key this resource declares but does not support, so
   *   `applyRangeFilters` throws `UnsupportedRangeFilterError` (400);
   * - a key absent from the map is not a range filter at all. `applyRangeFilters`
   *   ignores it and `applyFilters` treats it like any other filter.
   *
   * Key presence — not the `_from`/`_to` suffix — decides what is a range filter,
   * so a real column filter such as `assigned_to` is never mistaken for one.
   * Subclasses that expose additional ranges must extend this map (e.g.
   * override, spread `super.rangeFilterColumns()`, and add keys).
   */
  protected rangeFilterColumns(): Record<string, string | null> {
    return {
      created_from: this.auditFields.createdAt,
      created_to: this.auditFields.createdAt,
      updated_from: this.auditFields.updatedAt,
      updated_to: this.auditFields.updatedAt,
    };
  }

  /**
   * Apply the declared range filters. Only keys present in `rangeFilterColumns()`
   * are range filters: a mapped key applies its bound, a `null` mapping throws
   * `UnsupportedRangeFilterError`, and any other key is left for `applyFilters`
   * or the caller's own filter code.
   *
   * Subclasses with hand-written filter methods can call this to get the common
   * `created_from`/`updated_from` handling without adopting the rest of
   * `applyFilters`.
   */
  protected applyRangeFilters(
    query: Knex.QueryBuilder,
    filters: Record<string, any>,
    columns: Record<string, string | null> = this.rangeFilterColumns()
  ): Knex.QueryBuilder {
    Object.entries(filters ?? {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (!Object.prototype.hasOwnProperty.call(columns, key)) return;

      const rangeColumn = columns[key];
      if (rangeColumn === null) {
        throw new UnsupportedRangeFilterError(key);
      }

      // Direction comes from the suffix, but only for keys declared as ranges.
      query.where(rangeColumn, key.endsWith('_to') ? '<=' : '>=', value);
    });

    return query;
  }

  /**
   * Apply filters to query
   */
  protected applyFilters(query: Knex.QueryBuilder, filters: Record<string, any>): Knex.QueryBuilder {
    const rangeColumns = this.rangeFilterColumns();
    query = this.applyRangeFilters(query, filters, rangeColumns);

    Object.entries(filters ?? {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      // Declared range keys were applied (or rejected) above.
      if (Object.prototype.hasOwnProperty.call(rangeColumns, key)) return;

      if (key === 'search' && this.searchableFields.length > 0) {
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
   * Stamp create audit fields and return the row already filtered against the
   * target table's columns, so a service can never write an audit column the
   * table does not have. Pass `targetTable` when the row is written to a table
   * other than this service's default `tableName`.
   *
   * This is the only supported way to add create audit fields; it goes through
   * `filterAuditFields`, which reuses the shared `tableColumnsCache`.
   */
  protected async addCreateAuditFields(
    conn: Knex | Knex.Transaction,
    data: any,
    context: ServiceContext,
    targetTable: string = this.tableName
  ): Promise<any> {
    const now = new Date().toISOString();
    return this.filterAuditFields(
      conn,
      {
        ...data,
        [this.auditFields.createdBy]: context.userId,
        [this.auditFields.updatedBy]: context.userId,
        [this.auditFields.createdAt]: now,
        [this.auditFields.updatedAt]: now,
        [this.tenantColumn]: context.tenant
      },
      targetTable
    );
  }

  /**
   * Stamp update audit fields and return the row already filtered against the
   * target table's columns. See `addCreateAuditFields` for the contract.
   */
  protected async addUpdateAuditFields(
    conn: Knex | Knex.Transaction,
    data: any,
    context: ServiceContext,
    targetTable: string = this.tableName
  ): Promise<any> {
    return this.filterAuditFields(
      conn,
      {
        ...data,
        [this.auditFields.updatedBy]: context.userId,
        [this.auditFields.updatedAt]: new Date().toISOString()
      },
      targetTable
    );
  }

  /**
   * Get the columns available on a table (defaults to this service's table).
   */
  protected async getTableColumns(
    conn: Knex | Knex.Transaction,
    targetTable: string = this.tableName
  ): Promise<Set<string>> {
    let columnsPromise = tableColumnsCache.get(targetTable);

    if (!columnsPromise) {
      columnsPromise = conn(targetTable)
        .columnInfo()
        .then(columnInfo => new Set(Object.keys(columnInfo)))
        .catch(error => {
          tableColumnsCache.delete(targetTable);
          throw error;
        });
      tableColumnsCache.set(targetTable, columnsPromise);
    }

    return columnsPromise;
  }

  /**
   * Remove generated audit fields that are not present on the target table.
   * Pass `targetTable` when the row will be written to a table other than this
   * service's default `tableName` (e.g. a hand-rolled insert into `contracts`
   * from a `contract_lines` service).
   */
  protected async filterAuditFields(
    conn: Knex | Knex.Transaction,
    data: any,
    targetTable: string = this.tableName
  ): Promise<any> {
    const tableColumns = await this.getTableColumns(conn, targetTable);
    const auditFields = new Set(Object.values(this.auditFields));
    const filteredData = { ...data };

    for (const field of auditFields) {
      if (Object.prototype.hasOwnProperty.call(filteredData, field) && !tableColumns.has(field)) {
        delete filteredData[field];

        const warningKey = `${targetTable}:${field}`;
        if (!warnedMissingAuditFields.has(warningKey)) {
          warnedMissingAuditFields.add(warningKey);
          logger.warn(
            `[db/BaseService] table "${targetTable}" has no column "${field}"; skipping audit field`
          );
        }
      }
    }

    return filteredData;
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
      await this.mutationGuard?.(trx, context);
      const auditedData = await this.addCreateAuditFields(trx, data, context);
      const [result] = await this.buildTenantScopedQuery(trx, context)
        .insert(auditedData)
        .returning('*');
      return result as T;
    });
  }

  /**
   * Update existing resource
   */
  async update(id: string, data: Partial<T>, context: ServiceContext): Promise<T> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      await this.mutationGuard?.(trx, context);
      const auditedData = await this.addUpdateAuditFields(trx, data, context);

      const [result] = await this.buildTenantScopedQuery(trx, context)
        .where(this.primaryKey, id)
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
      await this.mutationGuard?.(trx, context);
      if (this.softDelete) {
        const auditedData = await this.addUpdateAuditFields(
          trx,
          { deleted_at: new Date().toISOString() },
          context
        );

        await this.buildTenantScopedQuery(trx, context)
          .where(this.primaryKey, id)
          .update(auditedData);
      } else {
        await this.buildTenantScopedQuery(trx, context)
          .where(this.primaryKey, id)
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
      await this.mutationGuard?.(trx, context);
      const auditedData = await Promise.all(
        data.map(item => this.addCreateAuditFields(trx, item, context))
      );
      const results = await this.buildTenantScopedQuery(trx, context)
        .insert(auditedData)
        .returning('*');
      return results as T[];
    });
  }

  async bulkUpdate(updates: Array<{ id: string; data: Partial<T> }>, context: ServiceContext): Promise<T[]> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      await this.mutationGuard?.(trx, context);
      const results: any[] = [];

      for (const update of updates) {
        const auditedData = await this.addUpdateAuditFields(trx, update.data, context);

        const [result] = await this.buildTenantScopedQuery(trx, context)
          .where(this.primaryKey, update.id)
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
      await this.mutationGuard?.(trx, context);
      if (this.softDelete) {
        const auditedData = await this.addUpdateAuditFields(
          trx,
          { deleted_at: new Date().toISOString() },
          context
        );

        await this.buildTenantScopedQuery(trx, context)
          .whereIn(this.primaryKey, ids)
          .update(auditedData);
      } else {
        await this.buildTenantScopedQuery(trx, context)
          .whereIn(this.primaryKey, ids)
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
