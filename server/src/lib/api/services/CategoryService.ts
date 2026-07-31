/**
 * Category Service
 * Service layer for category operations including ticket categories and service categories
 * with hierarchical management, analytics, and CRUD support
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListResult, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/apiMiddleware';

// Import category models and interfaces
import TicketCategory from '../../models/ticketCategory';
import { ITicketCategory } from '../../../interfaces/ticket.interfaces';

// Import schemas for validation
import {
  CreateServiceCategoryData,
  CreateTicketCategoryData,
  ServiceCategoryResponse,
  TicketCategoryResponse,
  CategoryFilterParams,
  CategoryUsageStats
} from '../schemas/categorySchemas';

// ============================================================================
// INTERFACES AND TYPES
// ============================================================================

export interface CategoryTreeNode {
  category_id: string;
  category_name: string;
  parent_category: string | null;
  children: CategoryTreeNode[];
  depth: number;
  path: string;
  order?: number;
  usage_count?: number;
}

export interface CategoryAnalyticsResult {
  total_categories: number;
  active_categories: number;
  categories_with_children: number;
  average_depth: number;
  max_depth: number;
  usage_stats: CategoryUsageStats[];
}

export interface BulkCategoryResult {
  success: number;
  failed: number;
  errors: string[];
}

// ============================================================================
// CATEGORY SERVICE CLASS
// ============================================================================

export class CategoryService extends BaseService {
  
  constructor() {
    // NOTE: ticket categories live in the `categories` table; `service_categories`
    // holds service categories. The two have different column sets — `categories`
    // has no description/is_active/updated_* columns but does have a NOT NULL
    // display_order. Ticket-category methods below query `categories` explicitly.
    super({
      tableName: 'categories',
      primaryKey: 'category_id',
      tenantColumn: 'tenant',
      softDelete: false,
      auditFields: {
        createdBy: 'created_by',
        createdAt: 'created_at'
      },
      searchableFields: ['category_name'],
      defaultSort: 'category_name',
      defaultOrder: 'asc'
    });
  }
  
  // ========================================================================
  // SERVICE CATEGORY OPERATIONS
  // ========================================================================

  /**
   * List service categories with filtering and pagination
   */
  async listServiceCategories(
    filters: CategoryFilterParams = {},
    context: ServiceContext
  ): Promise<ListResult<ServiceCategoryResponse>> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      let query = tenantDb(trx, context.tenant).table('service_categories');

      // Apply filters
      if (filters.search) {
        const searchTerm = `%${filters.search.toLowerCase()}%`;
        query = query.where(function() {
          this.whereRaw('LOWER(category_name) LIKE ?', [searchTerm])
              .orWhereRaw('LOWER(description) LIKE ?', [searchTerm]);
        });
      }

      if (filters.active !== undefined) {
        query = query.where('is_active', filters.active);
      }

      // Get total count
      const countQuery = query.clone();
      const [{ count: total }] = (await countQuery.count('* as count')) as Array<{ count: string }>;

      // Apply pagination
      if (filters.limit) {
        query = query.limit(filters.limit);
      }
      if (filters.offset) {
        query = query.offset(filters.offset);
      }

      // Apply sorting
      const sortBy = filters.sort_by || 'category_name';
      const sortOrder = filters.sort_order || 'asc';
      query = query.orderBy(sortBy, sortOrder);

      const categories = await query.select('*');

      return {
        data: categories as ServiceCategoryResponse[],
        total: parseInt(total as string),
        limit: filters.limit || total,
        offset: filters.offset || 0
      };
    });
  }

  /**
   * Get service category by ID
   */
  async getServiceCategoryById(id: string, context: ServiceContext): Promise<ServiceCategoryResponse | null> {
    const { knex } = await this.getKnex();
    const category = await tenantDb(knex, context.tenant).table('service_categories')
      .where('category_id', id)
      .first();
    return category as ServiceCategoryResponse | null;
  }

  /**
   * Create new service category
   */
  async createServiceCategory(
    data: CreateServiceCategoryData,
    context: ServiceContext
  ): Promise<ServiceCategoryResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const categoryData = {
        category_id: uuidv4(),
        category_name: data.category_name.trim(),
        description: data.description?.trim(),
        is_active: data.is_active ?? true,
        created_by: context.userId,
        updated_by: context.userId,
        created_at: new Date(),
        updated_at: new Date()
      };

      const fullCategoryData = {
        ...categoryData,
        tenant: context.tenant
      };

      const [created] = await tenantDb(trx, context.tenant).table('service_categories')
        .insert(fullCategoryData)
        .returning('*');

      return created as ServiceCategoryResponse;
    });
  }

  /**
   * Update service category
   */
  async updateServiceCategory(
    id: string,
    data: Partial<CreateServiceCategoryData>,
    context: ServiceContext
  ): Promise<ServiceCategoryResponse> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const updateData: any = {
        updated_by: context.userId,
        updated_at: new Date()
      };

      if (data.category_name !== undefined) {
        updateData.category_name = data.category_name.trim();
      }
      if (data.description !== undefined) {
        updateData.description = data.description?.trim();
      }
      if (data.is_active !== undefined) {
        updateData.is_active = data.is_active;
      }

      const [updated] = await tenantDb(trx, context.tenant).table('service_categories')
        .where('category_id', id)
        .update(updateData)
        .returning('*');

      if (!updated) {
        throw new NotFoundError('Service category not found');
      }

      return updated as ServiceCategoryResponse;
    });
  }

  /**
   * Delete service category
   */
  async deleteServiceCategory(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Check if category is in use
      const usageCount = await tenantDb(trx, context.tenant).table('service_items')
        .where('category_id', id)
        .count('* as count')
        .first();

      if (parseInt(usageCount?.count as string || '0') > 0) {
        throw new ConflictError('Cannot delete category that is in use by service items');
      }

      // Clear category_id from service_request_definitions (replaces ON DELETE SET NULL)
      await tenantDb(trx, context.tenant).table('service_request_definitions')
        .where('category_id', id)
        .update({ category_id: null, category_name_snapshot: null });

      const deleted = await tenantDb(trx, context.tenant).table('service_categories')
        .where('category_id', id)
        .del();

      if (!deleted) {
        throw new NotFoundError('Service category not found');
      }
    });
  }

  // ========================================================================
  // TICKET CATEGORY OPERATIONS
  // ========================================================================

  /**
   * List ticket categories with hierarchical support
   */
  async listTicketCategories(
    filters: CategoryFilterParams = {},
    context: ServiceContext
  ): Promise<ListResult<TicketCategoryResponse>> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      let query = this.buildTenantScopedQuery(trx, context);

      // Apply board filter if provided
      if (filters.board_id) {
        query = query.where('board_id', filters.board_id);
      }

      // Apply search filter
      if (filters.search) {
        const searchTerm = `%${filters.search.toLowerCase()}%`;
        query = query.whereRaw('LOWER(category_name) LIKE ?', [searchTerm]);
      }

      // Apply parent filter
      if (filters.parent_category !== undefined) {
        query = query.where('parent_category', filters.parent_category);
      }

      // Get total count
      const countQuery = query.clone();
      const [{ count: total }] = (await countQuery.count('* as count')) as Array<{ count: string }>;

      // Apply pagination
      if (filters.limit) {
        query = query.limit(filters.limit);
      }
      if (filters.offset) {
        query = query.offset(filters.offset);
      }

      // Apply sorting
      const sortBy = filters.sort_by || 'category_name';
      const sortOrder = filters.sort_order || 'asc';
      query = query.orderBy(sortBy, sortOrder);

      const categories = await query.select('*');

      // Enrich with hierarchy information if requested
      let enrichedCategories = categories as TicketCategoryResponse[];
      if (filters.include_hierarchy) {
        enrichedCategories = await this.enrichCategoriesWithHierarchy(enrichedCategories, trx);
      }

      return {
        data: enrichedCategories,
        total: parseInt(total as string),
        limit: filters.limit || total,
        offset: filters.offset || 0
      };
    });
  }

  /**
   * Get ticket category by ID with hierarchy information
   */
  async getTicketCategoryById(id: string, context: ServiceContext): Promise<TicketCategoryResponse | null> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const category = await this.buildTenantScopedQuery(trx, context)
        .where('category_id', id)
        .first();

      if (!category) {
        return null;
      }

      // Enrich with hierarchy information
      const [enriched] = await this.enrichCategoriesWithHierarchy([category], trx);
      return enriched as TicketCategoryResponse;
    });
  }

  /**
   * Create new ticket category with parent validation
   */
  async createTicketCategory(
    data: CreateTicketCategoryData,
    context: ServiceContext
  ): Promise<TicketCategoryResponse> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Validate parent category if provided
      if (data.parent_category) {
        const parent = await this.buildTenantScopedQuery(trx, context)
          .where('category_id', data.parent_category)
          .first();

        if (!parent) {
          throw new NotFoundError('Parent category not found');
        }

        // Check for circular hierarchy
        const wouldCreateCircular = await this.checkCircularHierarchy(
          data.parent_category,
          null, // No existing ID since this is a new category
          context.tenant,
          trx
        );

        if (wouldCreateCircular) {
          throw new ValidationError('Cannot create circular hierarchy');
        }
      }

      const duplicate = await this.buildTenantScopedQuery(trx, context)
        .whereRaw('LOWER(category_name) = LOWER(?)', [data.category_name.trim()])
        .modify((q) => {
          if (data.board_id) {
            q.where('board_id', data.board_id);
          } else {
            q.whereNull('board_id');
          }
        })
        .first();

      if (duplicate) {
        throw new ConflictError('A ticket category with this name already exists in this board');
      }

      // display_order is NOT NULL with no default; append after the current max
      // within the same board scope.
      const maxOrder = await this.buildTenantScopedQuery(trx, context)
        .modify((q) => {
          if (data.board_id) {
            q.where('board_id', data.board_id);
          } else {
            q.whereNull('board_id');
          }
        })
        .max('display_order as max')
        .first();
      const nextOrder = maxOrder?.max != null ? Number(maxOrder.max) + 1 : 0;

      const fullCategoryData = {
        category_id: uuidv4(),
        category_name: data.category_name.trim(),
        parent_category: data.parent_category,
        board_id: data.board_id,
        display_order: nextOrder,
        created_by: context.userId,
        created_at: new Date(),
        tenant: context.tenant
      };

      const [created] = await this.buildTenantScopedQuery(trx, context)
        .insert(fullCategoryData)
        .returning('*');

      // Enrich with hierarchy information
      const [enriched] = await this.enrichCategoriesWithHierarchy([created], trx);
      return enriched as TicketCategoryResponse;
    });
  }

  /**
   * Update ticket category with hierarchy validation
   */
  async updateTicketCategory(
    id: string,
    data: Partial<CreateTicketCategoryData>,
    context: ServiceContext
  ): Promise<TicketCategoryResponse> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate parent category change if provided
      if (data.parent_category !== undefined) {
        if (data.parent_category) {
          const parent = await this.buildTenantScopedQuery(trx, context)
            .where('category_id', data.parent_category)
            .first();

          if (!parent) {
            throw new NotFoundError('Parent category not found');
          }

          // Check for circular hierarchy
          const wouldCreateCircular = await this.checkCircularHierarchy(
            data.parent_category,
            id,
            context.tenant,
            trx
          );

          if (wouldCreateCircular) {
            throw new ValidationError('Cannot create circular hierarchy');
          }
        }
      }

      const updateData: any = {};

      if (data.category_name !== undefined) {
        updateData.category_name = data.category_name.trim();
      }
      if (data.parent_category !== undefined) {
        updateData.parent_category = data.parent_category;
      }
      if (data.board_id !== undefined) {
        updateData.board_id = data.board_id;
      }

      if (Object.keys(updateData).length === 0) {
        const existing = await this.buildTenantScopedQuery(trx, context)
          .where('category_id', id)
          .first();
        if (!existing) {
          throw new NotFoundError('Ticket category not found');
        }
        const [enrichedExisting] = await this.enrichCategoriesWithHierarchy([existing], trx);
        return enrichedExisting as TicketCategoryResponse;
      }

      if (updateData.category_name !== undefined || updateData.board_id !== undefined) {
        const existing = await this.buildTenantScopedQuery(trx, context)
          .where('category_id', id)
          .first();

        if (!existing) {
          throw new NotFoundError('Ticket category not found');
        }

        const nextBoardId = updateData.board_id ?? existing.board_id;
        const duplicate = await this.buildTenantScopedQuery(trx, context)
          .whereRaw('LOWER(category_name) = LOWER(?)', [(updateData.category_name ?? existing.category_name).trim()])
          .whereNot('category_id', id)
          .modify((q) => {
            if (nextBoardId) {
              q.where('board_id', nextBoardId);
            } else {
              q.whereNull('board_id');
            }
          })
          .first();

        if (duplicate) {
          throw new ConflictError('A ticket category with this name already exists in this board');
        }
      }

      const [updated] = await this.buildTenantScopedQuery(trx, context)
        .where('category_id', id)
        .update(updateData)
        .returning('*');

      if (!updated) {
        throw new NotFoundError('Ticket category not found');
      }

      // Enrich with hierarchy information
      const [enriched] = await this.enrichCategoriesWithHierarchy([updated], trx);
      return enriched as TicketCategoryResponse;
    });
  }

  /**
   * Delete ticket category
   */
  async deleteTicketCategory(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Check if category has children
      const childrenCount = await this.buildTenantScopedQuery(trx, context)
        .where('parent_category', id)
        .count('* as count')
        .first();

      if (parseInt(childrenCount?.count as string || '0') > 0) {
        throw new ConflictError('Cannot delete category that has child categories');
      }

      // Check if category is in use by tickets
      const usageCount = await tenantDb(trx, context.tenant).table('tickets')
        .where('category_id', id)
        .count('* as count')
        .first();

      if (parseInt(usageCount?.count as string || '0') > 0) {
        throw new ConflictError('Cannot delete category that is in use by tickets');
      }

      const deleted = await this.buildTenantScopedQuery(trx, context)
        .where('category_id', id)
        .del();

      if (!deleted) {
        throw new NotFoundError('Ticket category not found');
      }
    });
  }

  /**
   * Get category tree for a board
   */
  async getCategoryTree(
    boardId: string | null,
    context: ServiceContext
  ): Promise<CategoryTreeNode[]> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      let query = this.buildTenantScopedQuery(trx, context);

      if (boardId) {
        query = query.where('board_id', boardId);
      } else {
        query = query.whereNull('board_id');
      }

      const categories = await query
        .select('*')
        .orderBy('category_name', 'asc');

      return this.buildCategoryTree(categories);
    });
  }

  /**
   * Move category to new parent with circular hierarchy prevention
   */
  async moveCategory(
    categoryId: string,
    newParentId: string | null,
    context: ServiceContext
  ): Promise<TicketCategoryResponse> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate new parent if provided
      if (newParentId) {
        const parent = await this.buildTenantScopedQuery(trx, context)
          .where('category_id', newParentId)
          .first();

        if (!parent) {
          throw new NotFoundError('New parent category not found');
        }

        // Check for circular hierarchy
        const wouldCreateCircular = await this.checkCircularHierarchy(
          newParentId,
          categoryId,
          context.tenant,
          trx
        );

        if (wouldCreateCircular) {
          throw new ValidationError('Cannot create circular hierarchy');
        }
      }

      const [updated] = await this.buildTenantScopedQuery(trx, context)
        .where('category_id', categoryId)
        .update({
          parent_category: newParentId
        })
        .returning('*');

      if (!updated) {
        throw new NotFoundError('Category not found');
      }

      // Enrich with hierarchy information
      const [enriched] = await this.enrichCategoriesWithHierarchy([updated], trx);
      return enriched as TicketCategoryResponse;
    });
  }

  // ========================================================================
  // SEARCH AND ANALYTICS
  // ========================================================================

  /**
   * Search categories with filtering options
   */
  async searchCategories(
    searchTerm: string,
    filters: CategoryFilterParams = {},
    context: ServiceContext
  ): Promise<ListResult<TicketCategoryResponse | ServiceCategoryResponse>> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const categoryType = filters.category_type || 'ticket';
      const tableName = categoryType === 'service' ? 'service_categories' : 'categories';
      
      let query = tenantDb(trx, context.tenant).table(tableName);

      // Apply search (only service_categories has a description column)
      if (searchTerm) {
        const searchPattern = `%${searchTerm.toLowerCase()}%`;
        query = query.where(function() {
          this.whereRaw('LOWER(category_name) LIKE ?', [searchPattern]);
          if (categoryType === 'service') {
            this.orWhereRaw('LOWER(description) LIKE ?', [searchPattern]);
          }
        });
      }

      // Apply filters
      if (filters.board_id && categoryType === 'ticket') {
        query = query.where('board_id', filters.board_id);
      }

      // Get total count
      const countQuery = query.clone();
      const [{ count: total }] = (await countQuery.count('* as count')) as Array<{ count: string }>;

      // Apply pagination
      if (filters.limit) {
        query = query.limit(filters.limit);
      }
      if (filters.offset) {
        query = query.offset(filters.offset);
      }

      // Calculate relevance and sort
      const categories = await query.select('*');
      const categoriesWithRelevance = categories.map(category => ({
        ...category,
        relevance_score: this.calculateRelevanceScore(category, searchTerm)
      }));

      categoriesWithRelevance.sort((a, b) => b.relevance_score - a.relevance_score);

      return {
        data: categoriesWithRelevance,
        total: parseInt(total as string),
        limit: filters.limit || total,
        offset: filters.offset || 0
      };
    });
  }

  /**
   * Get category usage analytics
   */
  async getCategoryAnalytics(
    filters: CategoryFilterParams = {},
    context: ServiceContext
  ): Promise<CategoryAnalyticsResult> {
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const categoryType = filters.category_type || 'ticket';
      const tableName = categoryType === 'service' ? 'service_categories' : 'categories';
      const usageTable = categoryType === 'service' ? 'service_items' : 'tickets';
      
      // Get basic category stats. Only service_categories has an is_active column;
      // ticket categories (table `categories`) have no active flag, so all count
      // as active.
      const activeCountExpr = categoryType === 'service'
        ? 'COUNT(CASE WHEN is_active = true THEN 1 END) as active_categories'
        : 'COUNT(*) as active_categories';
      const categoryStats = await tenantDb(trx, context.tenant).table(tableName)
        .select(
          trx.raw('COUNT(*) as total_categories'),
          trx.raw(activeCountExpr)
        )
        .first();

      // Get hierarchy stats for ticket categories
      let hierarchyStats = { categories_with_children: 0, average_depth: 0, max_depth: 0 };
      if (categoryType === 'ticket') {
        const categories = await this.buildTenantScopedQuery(trx, context)
          .select('category_id', 'parent_category');

        const categoriesWithChildren = await this.buildTenantScopedQuery(trx, context)
          .whereNotNull('parent_category')
          .countDistinct('parent_category as count')
          .first();

        hierarchyStats = {
          categories_with_children: parseInt(categoriesWithChildren?.count as string || '0'),
          ...this.getCategoryHierarchyStats(categories)
        };
      }

      // Get usage statistics
      const usageQuery = tenantDb(trx, context.tenant).table(`${tableName} as c`);
      tenantDb(trx, context.tenant).tenantJoin(
        usageQuery,
        `${usageTable} as u`,
        'c.category_id',
        'u.category_id',
        { type: 'left' }
      );
      const usageStats = await usageQuery
        .groupBy('c.category_id', 'c.category_name')
        .select(
          'c.category_id',
          'c.category_name',
          trx.raw('COUNT(u.category_id) as usage_count')
        )
        .orderBy('usage_count', 'desc');

      return {
        total_categories: parseInt(categoryStats?.total_categories as string || '0'),
        active_categories: parseInt(categoryStats?.active_categories as string || '0'),
        categories_with_children: hierarchyStats.categories_with_children,
        average_depth: hierarchyStats.average_depth,
        max_depth: hierarchyStats.max_depth,
        usage_stats: usageStats as CategoryUsageStats[]
      };
    });
  }

  /**
   * Bulk delete categories with validation
   */
  async bulkDeleteCategories(
    categoryIds: string[],
    context: ServiceContext
  ): Promise<BulkCategoryResult> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async () => {
      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const categoryId of categoryIds) {
        try {
          await this.deleteTicketCategory(categoryId, context);
          success++;
        } catch {
          failed++;
          errors.push(`${categoryId}: Failed to delete category.`);
        }
      }

      return { success, failed, errors };
    });
  }

  // ========================================================================
  // UTILITY METHODS
  // ========================================================================

  /**
   * Enrich categories with hierarchy information
   */
  private async enrichCategoriesWithHierarchy(
    categories: any[],
    trx: Knex.Transaction
  ): Promise<any[]> {
    const enriched: any[] = [];

    for (const category of categories) {
      const enrichedCategory = { ...category };

      // Add depth and path information
      const depthAndPath = await this.calculateCategoryDepthAndPath(category.category_id, category.tenant, trx);
      enrichedCategory.depth = depthAndPath.depth;
      enrichedCategory.path = depthAndPath.path;

      // Add children count
      const childrenCount = await tenantDb(trx, category.tenant).table('categories')
        .where('parent_category', category.category_id)
        .count('* as count')
        .first();

      enrichedCategory.children_count = parseInt(childrenCount?.count as string || '0');

      enriched.push(enrichedCategory);
    }

    return enriched;
  }

  /**
   * Build category tree structure from flat list
   */
  private buildCategoryTree(categories: any[]): CategoryTreeNode[] {
    const categoryMap = new Map<string, CategoryTreeNode>();
    const rootCategories: CategoryTreeNode[] = [];

    // Create map of all categories
    categories.forEach(category => {
      categoryMap.set(category.category_id, {
        category_id: category.category_id,
        category_name: category.category_name,
        parent_category: category.parent_category,
        children: [],
        depth: 0,
        path: category.category_name,
        order: category.order
      });
    });

    // Build tree structure
    categories.forEach(category => {
      const node = categoryMap.get(category.category_id)!;
      
      if (category.parent_category) {
        const parent = categoryMap.get(category.parent_category);
        if (parent) {
          parent.children.push(node);
          node.depth = parent.depth + 1;
          node.path = `${parent.path} > ${node.category_name}`;
        }
      } else {
        rootCategories.push(node);
      }
    });

    return rootCategories;
  }

  /**
   * Check for circular hierarchy
   */
  private async checkCircularHierarchy(
    newParentId: string,
    categoryId: string | null,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<boolean> {
    if (!categoryId || newParentId === categoryId) {
      return true;
    }

    let currentParentId = newParentId;
    const visited = new Set<string>();

    while (currentParentId) {
      if (visited.has(currentParentId) || currentParentId === categoryId) {
        return true;
      }

      visited.add(currentParentId);

      const parent = await tenantDb(trx, tenant).table('categories')
        .where('category_id', currentParentId)
        .select('parent_category')
        .first();

      currentParentId = parent?.parent_category;
    }

    return false;
  }

  /**
   * Calculate category depth and path
   */
  private async calculateCategoryDepthAndPath(
    categoryId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<{ depth: number; path: string }> {
    const path: string[] = [];
    let currentId = categoryId;
    let depth = 0;

    while (currentId) {
      const category = await tenantDb(trx, tenant).table('categories')
        .where('category_id', currentId)
        .select('category_name', 'parent_category')
        .first();

      if (!category) break;

      path.unshift(category.category_name);
      currentId = category.parent_category;
      depth++;
    }

    return {
      depth: depth - 1, // Subtract 1 because root categories have depth 0
      path: path.join(' > ')
    };
  }

  /**
   * Get category hierarchy statistics
   */
  private getCategoryHierarchyStats(categories: any[]): { average_depth: number; max_depth: number } {
    const depths = categories.map(category => this.calculateCategoryDepth(category.category_id, categories));
    
    const maxDepth = Math.max(...depths, 0);
    const averageDepth = depths.length > 0 ? depths.reduce((sum, depth) => sum + depth, 0) / depths.length : 0;

    return {
      max_depth: maxDepth,
      average_depth: Math.round(averageDepth * 100) / 100 // Round to 2 decimal places
    };
  }

  /**
   * Calculate category depth from flat list
   */
  private calculateCategoryDepth(categoryId: string, categories: any[]): number {
    const category = categories.find(c => c.category_id === categoryId);
    if (!category || !category.parent_category) {
      return 0;
    }

    return 1 + this.calculateCategoryDepth(category.parent_category, categories);
  }

  /**
   * Calculate relevance score for search results
   */
  private calculateRelevanceScore(category: any, searchTerm: string): number {
    if (!searchTerm) return 0;

    const term = searchTerm.toLowerCase();
    const name = (category.category_name || '').toLowerCase();
    const description = (category.description || '').toLowerCase();

    let score = 0;

    // Exact match in name gets highest score
    if (name === term) {
      score += 100;
    }
    // Name starts with search term
    else if (name.startsWith(term)) {
      score += 75;
    }
    // Name contains search term
    else if (name.includes(term)) {
      score += 50;
    }

    // Description matches
    if (description.includes(term)) {
      score += 25;
    }

    return score;
  }
}

export default CategoryService;
