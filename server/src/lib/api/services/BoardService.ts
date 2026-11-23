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
import {
  createBoardCore,
  deleteBoardCore,
  isBoardLifecycleError,
  updateBoardCore,
} from '@alga-psa/tickets/services/boardLifecycle';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/apiMiddleware';

/** A refused board shape is the caller's to fix: 400, not 500 (R1/R3). */
function rethrowBoardLifecycleRefusal(error: unknown): never {
  if (isBoardLifecycleError(error)) {
    throw new ValidationError(error.message);
  }
  throw error;
}

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
    // F104: the same function the settings screen calls, so a board created through the API has
    // the same statuses, categories, default priority and SLA assignment. It publishes
    // BOARD_CREATED itself, with the row as it is after setup (F110).
    return this.mutationTransaction(context, (trx, tenant) =>
      createBoardCore(trx, tenant, { userId: context.userId }, writable as never)
    ).catch(rethrowBoardLifecycleRefusal);
  }

  async update(id: string, data: Partial<IBoard>, context: ServiceContext): Promise<IBoard> {
    const writable = this.parseWritable(updateBoardInputSchema, data);
    return this.mutationTransaction(context, (trx, tenant) =>
      updateBoardCore(trx, tenant, { userId: context.userId }, id, writable as never)
    ).catch(rethrowBoardLifecycleRefusal);
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    // F112: every check the web delete runs — the default board, inbound defaults, a sender route,
    // settings that point at the board, tickets — and the same cleanup afterwards. `force` is on
    // because an API caller cannot answer a second prompt; the blocking checks still block.
    const { knex } = await this.getKnex();
    const result = await this.mutationTransaction(context, (trx, tenant) =>
      deleteBoardCore({ db: knex, trx }, tenant, { userId: context.userId }, id, {
        force: true,
        cleanupItil: false,
      })
    );

    if (!result.success) {
      if (result.code === 'NOT_FOUND') {
        throw new NotFoundError(result.message ?? 'Board not found');
      }
      throw new ConflictError(result.message ?? 'Cannot delete board');
    }
  }

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
