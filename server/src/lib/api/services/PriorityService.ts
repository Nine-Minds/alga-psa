/**
 * Priority Service
 * Business logic for priority-related API operations
 */

import { IPriority } from '@alga-psa/types';
import { BaseService, ServiceContext, ListResult, ListOptions } from '@alga-psa/db';

export class PriorityService extends BaseService<IPriority> {
  constructor() {
    super({
      tableName: 'priorities',
      primaryKey: 'priority_id',
      tenantColumn: 'tenant',
      searchableFields: ['priority_name', 'description'],
      defaultSort: 'order_number',
      defaultOrder: 'asc'
    });
  }

  /**
   * List priorities with optional item_type filtering
   */
  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<IPriority>> {
    const { knex } = await this.getKnex();

    const {
      page = 1,
      limit = 25,
      filters = {},
      sort,
      order
    } = options;

    // Build base query
    let dataQuery = knex('priorities')
      .where('tenant', context.tenant);

    let countQuery = knex('priorities')
      .where('tenant', context.tenant);

    // Apply item_type filter
    if (filters.item_type) {
      dataQuery = dataQuery.where('item_type', filters.item_type);
      countQuery = countQuery.where('item_type', filters.item_type);
      delete filters.item_type;
    }

    // Apply search filter
    if (filters.search) {
      const searchTerm = `%${filters.search}%`;
      dataQuery = dataQuery.where(function() {
        this.whereILike('priority_name', searchTerm)
          .orWhereILike('description', searchTerm);
      });
      countQuery = countQuery.where(function() {
        this.whereILike('priority_name', searchTerm)
          .orWhereILike('description', searchTerm);
      });
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
    if (sortField !== 'priority_name') {
      dataQuery = dataQuery.orderBy('priority_name', 'asc');
    }

    // Apply pagination
    const offset = (page - 1) * limit;
    dataQuery = dataQuery.limit(limit).offset(offset);

    // Execute queries
    const [priorities, [{ count }]] = await Promise.all([
      dataQuery.select('*'),
      countQuery.count('* as count')
    ]);

    return {
      data: priorities as IPriority[],
      total: parseInt(count as string)
    };
  }

  /**
   * Get priority by ID
   */
  async getById(id: string, context: ServiceContext): Promise<IPriority | null> {
    const { knex } = await this.getKnex();

    const priority = await knex('priorities')
      .where({
        priority_id: id,
        tenant: context.tenant
      })
      .first();

    return priority as IPriority | null;
  }
}
