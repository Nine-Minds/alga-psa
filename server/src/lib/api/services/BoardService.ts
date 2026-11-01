/**
 * Board Service
 * Business logic for board-related API operations
 */

import { IBoard } from '@alga-psa/types';
import { BaseService, ServiceContext, ListResult, ListOptions } from '@alga-psa/db';
import {
  createBoardInputSchema,
  updateBoardInputSchema,
} from '@alga-psa/tickets/actions/board-actions/boardInputSchema';
import { publishEvent } from 'server/src/lib/eventBus/publishers';

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
   * Project caller data onto the writable columns shared with the board server
   * actions. Unknown keys (tenant, board_id, made-up columns) are rejected here
   * too, so a direct service caller cannot mass-assign past the controller schema.
   */
  private parseWritable<T extends typeof createBoardInputSchema | typeof updateBoardInputSchema>(
    schema: T,
    data: unknown
  ): Record<string, unknown> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new Error(`Invalid board input: ${detail}`);
    }
    return Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
  }

  async create(data: Partial<IBoard>, context: ServiceContext): Promise<IBoard> {
    const writable = this.parseWritable(createBoardInputSchema, data);
    const board = await this.mutationTransaction(context, async (trx) => {
      // At most one default board per tenant: claiming it releases the previous one.
      if (writable.is_default === true) {
        await this.buildTenantScopedQuery(trx, context).where({ is_default: true }).update({ is_default: false });
      }
      const audited = await this.addCreateAuditFields(trx, writable, context);
      const [row] = await this.buildTenantScopedQuery(trx, context).insert(audited).returning('*');
      return row as IBoard;
    });
    if (!board.board_id) {
      throw new Error('Created board is missing board_id');
    }

    await publishEvent({
      eventType: 'BOARD_CREATED',
      payload: {
        tenantId: context.tenant,
        boardId: board.board_id,
        userId: context.userId,
        changes: { after: board },
        timestamp: new Date().toISOString(),
      },
    });

    return board;
  }

  async update(id: string, data: Partial<IBoard>, context: ServiceContext): Promise<IBoard> {
    const writable = this.parseWritable(updateBoardInputSchema, data);
    const board = await this.mutationTransaction(context, async (trx) => {
      if (writable.is_default === true) {
        await this.buildTenantScopedQuery(trx, context)
          .where({ is_default: true })
          .whereNot({ board_id: id })
          .update({ is_default: false });
      }
      const audited = await this.addUpdateAuditFields(trx, writable, context);
      const [row] = await this.buildTenantScopedQuery(trx, context)
        .where(this.primaryKey, id)
        .update(audited)
        .returning('*');
      if (!row) {
        throw new Error('Resource not found or permission denied');
      }
      return row as IBoard;
    });

    await publishEvent({
      eventType: 'BOARD_UPDATED',
      payload: {
        tenantId: context.tenant,
        boardId: id,
        userId: context.userId,
        changes: { after: board },
        timestamp: new Date().toISOString(),
      },
    });

    return board;
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    await super.delete(id, context);

    await publishEvent({
      eventType: 'BOARD_DELETED',
      payload: {
        tenantId: context.tenant,
        boardId: id,
        userId: context.userId,
        timestamp: new Date().toISOString(),
      },
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
    let dataQuery = this.buildTenantScopedQuery(knex, context);

    let countQuery = this.buildTenantScopedQuery(knex, context);

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

    const board = await this.buildTenantScopedQuery(knex, context)
      .where('board_id', id)
      .first();

    return board as IBoard | null;
  }
}
