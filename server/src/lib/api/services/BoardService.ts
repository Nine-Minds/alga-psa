/**
 * Board Service
 * Business logic for board-related API operations
 */

import { IBoard } from '@alga-psa/types';
import { BaseService, ServiceContext, ListResult, ListOptions } from '@alga-psa/db';

export class BoardService extends BaseService<IBoard> {
  constructor() {
    super({
      tableName: 'boards',
      primaryKey: 'board_id',
      tenantColumn: 'tenant',
      searchableFields: ['board_name', 'description'],
      defaultSort: 'display_order',
      defaultOrder: 'asc'
    });
  }

  /**
   * List boards with optional inactive filtering
   */
  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<IBoard>> {
    const { knex } = await this.getKnex();

    const {
      page = 1,
      limit = 25,
      filters = {},
      sort,
      order
    } = options;

    // Build base query
    let dataQuery = knex('boards')
      .where('tenant', context.tenant);

    let countQuery = knex('boards')
      .where('tenant', context.tenant);

    // Apply include_inactive filter (default: exclude inactive)
    if (!filters.include_inactive) {
      dataQuery = dataQuery.where('is_inactive', false);
      countQuery = countQuery.where('is_inactive', false);
    }
    delete filters.include_inactive;

    // Apply search filter
    if (filters.search) {
      const searchTerm = `%${filters.search}%`;
      dataQuery = dataQuery.where(function() {
        this.whereILike('board_name', searchTerm)
          .orWhereILike('description', searchTerm);
      });
      countQuery = countQuery.where(function() {
        this.whereILike('board_name', searchTerm)
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

    // Apply sorting (boards table doesn't have created_at, use display_order as default)
    const validSortFields = ['display_order', 'board_name', 'is_inactive', 'is_default'];
    const sortField = (sort && validSortFields.includes(sort)) ? sort : this.defaultSort;
    const sortOrder = order || this.defaultOrder;
    dataQuery = dataQuery.orderBy(sortField, sortOrder);

    // Secondary sort by name for consistent ordering
    if (sortField !== 'board_name') {
      dataQuery = dataQuery.orderBy('board_name', 'asc');
    }

    // Apply pagination
    const offset = (page - 1) * limit;
    dataQuery = dataQuery.limit(limit).offset(offset);

    // Execute queries
    const [boards, [{ count }]] = await Promise.all([
      dataQuery.select('*'),
      countQuery.count('* as count')
    ]);

    return {
      data: boards as IBoard[],
      total: parseInt(count as string)
    };
  }

  /**
   * Get board by ID
   */
  async getById(id: string, context: ServiceContext): Promise<IBoard | null> {
    const { knex } = await this.getKnex();

    const board = await knex('boards')
      .where({
        board_id: id,
        tenant: context.tenant
      })
      .first();

    return board as IBoard | null;
  }
}
