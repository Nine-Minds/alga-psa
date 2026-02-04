/**
 * Status Service
 * Business logic for status-related API operations
 */

import { IStatus } from '@alga-psa/types';
import { BaseService, ServiceContext, ListResult, ListOptions } from '@alga-psa/db';

export class StatusService extends BaseService<IStatus> {
  constructor() {
    super({
      tableName: 'statuses',
      primaryKey: 'status_id',
      tenantColumn: 'tenant',
      searchableFields: ['name'],
      defaultSort: 'order_number',
      defaultOrder: 'asc'
    });
  }

  /**
   * List statuses with optional type filtering
   */
  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<IStatus>> {
    const { knex } = await this.getKnex();

    const {
      page = 1,
      limit = 25,
      filters = {},
      sort,
      order
    } = options;

    // Build base query
    let dataQuery = knex('statuses')
      .where('tenant', context.tenant);

    let countQuery = knex('statuses')
      .where('tenant', context.tenant);

    // Apply type filter
    if (filters.type) {
      dataQuery = dataQuery.where('status_type', filters.type);
      countQuery = countQuery.where('status_type', filters.type);
      delete filters.type;
    }

    // Apply search filter
    if (filters.search) {
      const searchTerm = `%${filters.search}%`;
      dataQuery = dataQuery.whereILike('name', searchTerm);
      countQuery = countQuery.whereILike('name', searchTerm);
      delete filters.search;
    }

    // Apply remaining filters
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        dataQuery = dataQuery.where(key, value);
        countQuery = countQuery.where(key, value);
      }
    });

    // Apply sorting
    const sortField = sort || this.defaultSort;
    const sortOrder = order || this.defaultOrder;
    dataQuery = dataQuery.orderBy(sortField, sortOrder);

    // Secondary sort by name for consistent ordering
    if (sortField !== 'name') {
      dataQuery = dataQuery.orderBy('name', 'asc');
    }

    // Apply pagination
    const offset = (page - 1) * limit;
    dataQuery = dataQuery.limit(limit).offset(offset);

    // Execute queries
    const [statuses, [{ count }]] = await Promise.all([
      dataQuery.select('*'),
      countQuery.count('* as count')
    ]);

    return {
      data: statuses as IStatus[],
      total: parseInt(count as string)
    };
  }

  /**
   * Get status by ID
   */
  async getById(id: string, context: ServiceContext): Promise<IStatus | null> {
    const { knex } = await this.getKnex();

    const status = await knex('statuses')
      .where({
        status_id: id,
        tenant: context.tenant
      })
      .first();

    return status as IStatus | null;
  }
}
