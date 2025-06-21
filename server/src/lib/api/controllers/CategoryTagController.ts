/**
 * Category & Tag Controller
 * Comprehensive REST API controller for category and tag operations with full CRUD,
 * hierarchical management, analytics, and entity association support
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
import { CategoryTagService } from '../services/CategoryTagService';
import {
  // Service Category Schemas
  createServiceCategorySchema,
  updateServiceCategorySchema,
  serviceCategoryListQuerySchema,
  // Ticket Category Schemas
  createTicketCategorySchema,
  updateTicketCategorySchema,
  ticketCategoryListQuerySchema,
  moveCategorySchema,
  reorderCategoriesSchema,
  // Tag Schemas
  createTagSchema,
  updateTagSchema,
  tagListQuerySchema,
  createBulkTagsSchema,
  updateTagColorSchema,
  // Entity Tagging Schemas
  tagEntitySchema,
  untagEntitySchema,
  bulkTagEntitiesSchema,
  bulkUntagEntitiesSchema,
  // Search Schemas
  tagSearchSchema,
  categorySearchSchema,
  // Analytics Schemas
  tagAnalyticsFilterSchema,
  categoryAnalyticsFilterSchema,
  // Bulk Operations Schemas
  bulkDeleteTagsSchema,
  bulkDeleteCategoriesSchema,
  bulkMergeTagsSchema,
  // Import/Export Schemas
  importTagsSchema,
  importCategoriesSchema,
  // Type Exports
  CreateServiceCategoryData,
  CreateTicketCategoryData,
  CreateTagData,
  UpdateTagData,
  TaggedEntityType,
  CategoryType
} from '../schemas/categoryTagSchemas';
import {
  withAuth,
  withPermission,
  withValidation,
  withQueryValidation,
  createSuccessResponse,
  createPaginatedResponse,
  NotFoundError,
  ApiRequest,
  compose
} from '../middleware/apiMiddleware';
import { ApiRegistry } from '../metadata/ApiRegistry';

export class CategoryTagController extends BaseController {
  private categoryTagService: CategoryTagService;

  constructor() {
    const categoryTagService = new CategoryTagService();
    
    super(categoryTagService, {
      resource: 'category_tag',
      createSchema: createTagSchema,
      updateSchema: updateTagSchema,
      querySchema: tagListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });

    this.categoryTagService = categoryTagService;
    this.registerEndpoints();
  }

  /**
   * Register all endpoints with metadata system
   */
  private registerEndpoints(): void {
    // Service Category Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/service',
      method: 'GET',
      resource: 'service_category',
      action: 'list',
      description: 'List service categories with filtering and pagination',
      permissions: { resource: 'service_category', action: 'read' },
      querySchema: serviceCategoryListQuerySchema,
      tags: ['categories', 'service-categories']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/service',
      method: 'POST',
      resource: 'service_category',
      action: 'create',
      description: 'Create a new service category',
      permissions: { resource: 'service_category', action: 'create' },
      requestSchema: createServiceCategorySchema,
      tags: ['categories', 'service-categories']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/service/{id}',
      method: 'GET',
      resource: 'service_category',
      action: 'read',
      description: 'Get service category details by ID',
      permissions: { resource: 'service_category', action: 'read' },
      tags: ['categories', 'service-categories']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/service/{id}',
      method: 'PUT',
      resource: 'service_category',
      action: 'update',
      description: 'Update service category',
      permissions: { resource: 'service_category', action: 'update' },
      requestSchema: updateServiceCategorySchema,
      tags: ['categories', 'service-categories']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/service/{id}',
      method: 'DELETE',
      resource: 'service_category',
      action: 'delete',
      description: 'Delete service category',
      permissions: { resource: 'service_category', action: 'delete' },
      tags: ['categories', 'service-categories']
    });

    // Ticket Category Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/ticket',
      method: 'GET',
      resource: 'ticket_category',
      action: 'list',
      description: 'List ticket categories with hierarchical support',
      permissions: { resource: 'ticket_category', action: 'read' },
      querySchema: ticketCategoryListQuerySchema,
      tags: ['categories', 'ticket-categories']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/ticket',
      method: 'POST',
      resource: 'ticket_category',
      action: 'create',
      description: 'Create a new ticket category',
      permissions: { resource: 'ticket_category', action: 'create' },
      requestSchema: createTicketCategorySchema,
      tags: ['categories', 'ticket-categories']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/ticket/{id}',
      method: 'GET',
      resource: 'ticket_category',
      action: 'read',
      description: 'Get ticket category details with hierarchy',
      permissions: { resource: 'ticket_category', action: 'read' },
      tags: ['categories', 'ticket-categories']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/ticket/{id}',
      method: 'PUT',
      resource: 'ticket_category',
      action: 'update',
      description: 'Update ticket category',
      permissions: { resource: 'ticket_category', action: 'update' },
      requestSchema: updateTicketCategorySchema,
      tags: ['categories', 'ticket-categories']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/ticket/{id}',
      method: 'DELETE',
      resource: 'ticket_category',
      action: 'delete',
      description: 'Delete ticket category',
      permissions: { resource: 'ticket_category', action: 'delete' },
      tags: ['categories', 'ticket-categories']
    });

    // Category Tree Management
    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/ticket/tree/{channelId}',
      method: 'GET',
      resource: 'ticket_category',
      action: 'read',
      description: 'Get category tree for a channel',
      permissions: { resource: 'ticket_category', action: 'read' },
      tags: ['categories', 'hierarchy']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/ticket/{id}/move',
      method: 'PUT',
      resource: 'ticket_category',
      action: 'update',
      description: 'Move category to new parent',
      permissions: { resource: 'ticket_category', action: 'update' },
      requestSchema: moveCategorySchema,
      tags: ['categories', 'hierarchy']
    });

    // Tag Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags',
      method: 'GET',
      resource: 'tag',
      action: 'list',
      description: 'List tags with filtering and analytics',
      permissions: { resource: 'tag', action: 'read' },
      querySchema: tagListQuerySchema,
      tags: ['tags']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags',
      method: 'POST',
      resource: 'tag',
      action: 'create',
      description: 'Create a new tag',
      permissions: { resource: 'tag', action: 'create' },
      requestSchema: createTagSchema,
      tags: ['tags']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/{id}',
      method: 'GET',
      resource: 'tag',
      action: 'read',
      description: 'Get tag details by ID',
      permissions: { resource: 'tag', action: 'read' },
      tags: ['tags']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/{id}',
      method: 'PUT',
      resource: 'tag',
      action: 'update',
      description: 'Update tag',
      permissions: { resource: 'tag', action: 'update' },
      requestSchema: updateTagSchema,
      tags: ['tags']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/{id}',
      method: 'DELETE',
      resource: 'tag',
      action: 'delete',
      description: 'Delete tag',
      permissions: { resource: 'tag', action: 'delete' },
      tags: ['tags']
    });

    // Entity Tagging Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/entities/{entityType}/{entityId}',
      method: 'GET',
      resource: 'tag',
      action: 'read',
      description: 'Get tags for an entity',
      permissions: { resource: 'tag', action: 'read' },
      tags: ['tags', 'entity-tagging']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/entities/tag',
      method: 'POST',
      resource: 'tag',
      action: 'create',
      description: 'Tag an entity with multiple tags',
      permissions: { resource: 'tag', action: 'create' },
      requestSchema: tagEntitySchema,
      tags: ['tags', 'entity-tagging']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/entities/untag',
      method: 'DELETE',
      resource: 'tag',
      action: 'delete',
      description: 'Remove tags from an entity',
      permissions: { resource: 'tag', action: 'delete' },
      requestSchema: untagEntitySchema,
      tags: ['tags', 'entity-tagging']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/entities/bulk-tag',
      method: 'POST',
      resource: 'tag',
      action: 'create',
      description: 'Bulk tag multiple entities',
      permissions: { resource: 'tag', action: 'create' },
      requestSchema: bulkTagEntitiesSchema,
      tags: ['tags', 'bulk-operations']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/entities/bulk-untag',
      method: 'DELETE',
      resource: 'tag',
      action: 'delete',
      description: 'Bulk remove tags from multiple entities',
      permissions: { resource: 'tag', action: 'delete' },
      requestSchema: bulkUntagEntitiesSchema,
      tags: ['tags', 'bulk-operations']
    });

    // Search Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/search',
      method: 'GET',
      resource: 'tag',
      action: 'read',
      description: 'Search tags with advanced filtering',
      permissions: { resource: 'tag', action: 'read' },
      querySchema: tagSearchSchema,
      tags: ['tags', 'search']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/search',
      method: 'GET',
      resource: 'category',
      action: 'read',
      description: 'Search categories',
      permissions: { resource: 'category', action: 'read' },
      querySchema: categorySearchSchema,
      tags: ['categories', 'search']
    });

    // Analytics Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/analytics',
      method: 'GET',
      resource: 'tag',
      action: 'read',
      description: 'Get tag usage analytics',
      permissions: { resource: 'tag', action: 'read' },
      querySchema: tagAnalyticsFilterSchema,
      tags: ['tags', 'analytics']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/analytics',
      method: 'GET',
      resource: 'category',
      action: 'read',
      description: 'Get category usage analytics',
      permissions: { resource: 'category', action: 'read' },
      querySchema: categoryAnalyticsFilterSchema,
      tags: ['categories', 'analytics']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/cloud',
      method: 'GET',
      resource: 'tag',
      action: 'read',
      description: 'Generate tag cloud data',
      permissions: { resource: 'tag', action: 'read' },
      tags: ['tags', 'analytics']
    });

    // Bulk Operations
    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/bulk/delete',
      method: 'DELETE',
      resource: 'tag',
      action: 'delete',
      description: 'Bulk delete tags',
      permissions: { resource: 'tag', action: 'delete' },
      requestSchema: bulkDeleteTagsSchema,
      tags: ['tags', 'bulk-operations']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tags/bulk/merge',
      method: 'POST',
      resource: 'tag',
      action: 'update',
      description: 'Merge multiple tags into one',
      permissions: { resource: 'tag', action: 'update' },
      requestSchema: bulkMergeTagsSchema,
      tags: ['tags', 'bulk-operations']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/bulk/delete',
      method: 'DELETE',
      resource: 'category',
      action: 'delete',
      description: 'Bulk delete categories',
      permissions: { resource: 'category', action: 'delete' },
      requestSchema: bulkDeleteCategoriesSchema,
      tags: ['categories', 'bulk-operations']
    });
  }

  // ========================================================================
  // SERVICE CATEGORY OPERATIONS
  // ========================================================================

  /**
   * GET /api/v1/categories/service - List service categories
   */
  listServiceCategories() {
    const middleware = compose(
      withAuth,
      withPermission('service_category', 'read'),
      withQueryValidation(serviceCategoryListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

      const filters = { ...validatedQuery, page, limit };
      const result = await this.categoryTagService.listServiceCategories(filters, req.context!);
      
      return createPaginatedResponse(
        result.data.map(category => ({
          ...category,
          _links: this.categoryTagService.generateLinks('category', category.category_id)
        })),
        result.total,
        page,
        limit,
        { resource: 'service_category', filters }
      );
    });
  }

  /**
   * GET /api/v1/categories/service/{id} - Get service category by ID
   */
  getServiceCategoryById() {
    const middleware = compose(
      withAuth,
      withPermission('service_category', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      const category = await this.categoryTagService.getServiceCategoryById(id, req.context!);
      
      if (!category) {
        throw new NotFoundError('Service category not found');
      }

      return createSuccessResponse({
        ...category,
        _links: this.categoryTagService.generateLinks('category', category.category_id)
      });
    });
  }

  /**
   * POST /api/v1/categories/service - Create service category
   */
  createServiceCategory() {
    const middleware = compose(
      withAuth,
      withPermission('service_category', 'create'),
      withValidation(createServiceCategorySchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateServiceCategoryData) => {
      const category = await this.categoryTagService.createServiceCategory(validatedData, req.context!);
      
      return createSuccessResponse({
        ...category,
        _links: this.categoryTagService.generateLinks('category', category.category_id)
      }, 201);
    });
  }

  /**
   * PUT /api/v1/categories/service/{id} - Update service category
   */
  updateServiceCategory() {
    const middleware = compose(
      withAuth,
      withPermission('service_category', 'update'),
      withValidation(updateServiceCategorySchema)
    );

    return middleware(async (req: ApiRequest, validatedData: Partial<CreateServiceCategoryData>) => {
      const id = this.extractIdFromPath(req);
      const category = await this.categoryTagService.updateServiceCategory(id, validatedData, req.context!);
      
      return createSuccessResponse({
        ...category,
        _links: this.categoryTagService.generateLinks('category', category.category_id)
      });
    });
  }

  /**
   * DELETE /api/v1/categories/service/{id} - Delete service category
   */
  deleteServiceCategory() {
    const middleware = compose(
      withAuth,
      withPermission('service_category', 'delete')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      await this.categoryTagService.deleteServiceCategory(id, req.context!);
      
      return new NextResponse(null, { status: 204 });
    });
  }

  // ========================================================================
  // TICKET CATEGORY OPERATIONS
  // ========================================================================

  /**
   * GET /api/v1/categories/ticket - List ticket categories
   */
  listTicketCategories() {
    const middleware = compose(
      withAuth,
      withPermission('ticket_category', 'read'),
      withQueryValidation(ticketCategoryListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

      const filters = { ...validatedQuery, page, limit };
      const result = await this.categoryTagService.listTicketCategories(filters, req.context!);
      
      return createPaginatedResponse(
        result.data.map(category => ({
          ...category,
          _links: this.categoryTagService.generateLinks('category', category.category_id)
        })),
        result.total,
        page,
        limit,
        { resource: 'ticket_category', filters }
      );
    });
  }

  /**
   * GET /api/v1/categories/ticket/{id} - Get ticket category by ID
   */
  getTicketCategoryById() {
    const middleware = compose(
      withAuth,
      withPermission('ticket_category', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      const category = await this.categoryTagService.getTicketCategoryById(id, req.context!);
      
      if (!category) {
        throw new NotFoundError('Ticket category not found');
      }

      return createSuccessResponse({
        ...category,
        _links: this.categoryTagService.generateLinks('category', category.category_id)
      });
    });
  }

  /**
   * POST /api/v1/categories/ticket - Create ticket category
   */
  createTicketCategory() {
    const middleware = compose(
      withAuth,
      withPermission('ticket_category', 'create'),
      withValidation(createTicketCategorySchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateTicketCategoryData) => {
      const category = await this.categoryTagService.createTicketCategory(validatedData, req.context!);
      
      return createSuccessResponse({
        ...category,
        _links: this.categoryTagService.generateLinks('category', category.category_id)
      }, 201);
    });
  }

  /**
   * PUT /api/v1/categories/ticket/{id} - Update ticket category
   */
  updateTicketCategory() {
    const middleware = compose(
      withAuth,
      withPermission('ticket_category', 'update'),
      withValidation(updateTicketCategorySchema)
    );

    return middleware(async (req: ApiRequest, validatedData: Partial<CreateTicketCategoryData>) => {
      const id = this.extractIdFromPath(req);
      const category = await this.categoryTagService.updateTicketCategory(id, validatedData, req.context!);
      
      return createSuccessResponse({
        ...category,
        _links: this.categoryTagService.generateLinks('category', category.category_id)
      });
    });
  }

  /**
   * DELETE /api/v1/categories/ticket/{id} - Delete ticket category
   */
  deleteTicketCategory() {
    const middleware = compose(
      withAuth,
      withPermission('ticket_category', 'delete')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      await this.categoryTagService.deleteTicketCategory(id, req.context!);
      
      return new NextResponse(null, { status: 204 });
    });
  }

  /**
   * GET /api/v1/categories/ticket/tree/{channelId} - Get category tree
   */
  getCategoryTree() {
    const middleware = compose(
      withAuth,
      withPermission('ticket_category', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const channelId = pathParts[pathParts.length - 1];

      const tree = await this.categoryTagService.getCategoryTree(channelId, req.context!);
      
      return createSuccessResponse({
        channel_id: channelId,
        tree,
        metadata: {
          total_categories: tree.length,
          max_depth: Math.max(...tree.map(node => this.getMaxDepth(node)))
        }
      });
    });
  }

  /**
   * PUT /api/v1/categories/ticket/{id}/move - Move category
   */
  moveCategory() {
    const middleware = compose(
      withAuth,
      withPermission('ticket_category', 'update'),
      withValidation(moveCategorySchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const id = this.extractIdFromPath(req);
      const category = await this.categoryTagService.moveCategory(
        id,
        validatedData.new_parent_id,
        req.context!
      );
      
      return createSuccessResponse({
        ...category,
        _links: this.categoryTagService.generateLinks('category', category.category_id)
      });
    });
  }

  // ========================================================================
  // TAG OPERATIONS
  // ========================================================================

  /**
   * GET /api/v1/tags - List tags
   */
  listTags() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'read'),
      withQueryValidation(tagListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

      const filters = { ...validatedQuery, page, limit };
      const result = await this.categoryTagService.listTags(filters, req.context!);
      
      return createPaginatedResponse(
        result.data.map(tag => ({
          ...tag,
          _links: this.categoryTagService.generateLinks('tag', tag.tag_id)
        })),
        result.total,
        page,
        limit,
        { resource: 'tag', filters }
      );
    });
  }

  /**
   * GET /api/v1/tags/{id} - Get tag by ID
   */
  getTagById() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      const tag = await this.categoryTagService.getTagById(id, req.context!);
      
      if (!tag) {
        throw new NotFoundError('Tag not found');
      }

      return createSuccessResponse({
        ...tag,
        _links: this.categoryTagService.generateLinks('tag', tag.tag_id)
      });
    });
  }

  /**
   * POST /api/v1/tags - Create tag
   */
  createTag() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'create'),
      withValidation(createTagSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateTagData) => {
      const tag = await this.categoryTagService.createTag(validatedData, req.context!);
      
      return createSuccessResponse({
        ...tag,
        _links: this.categoryTagService.generateLinks('tag', tag.tag_id)
      }, 201);
    });
  }

  /**
   * PUT /api/v1/tags/{id} - Update tag
   */
  updateTag() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'update'),
      withValidation(updateTagSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateTagData) => {
      const id = this.extractIdFromPath(req);
      const tag = await this.categoryTagService.updateTag(id, validatedData, req.context!);
      
      return createSuccessResponse({
        ...tag,
        _links: this.categoryTagService.generateLinks('tag', tag.tag_id)
      });
    });
  }

  /**
   * DELETE /api/v1/tags/{id} - Delete tag
   */
  deleteTag() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'delete')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      await this.categoryTagService.deleteTag(id, req.context!);
      
      return new NextResponse(null, { status: 204 });
    });
  }

  // ========================================================================
  // ENTITY TAGGING OPERATIONS
  // ========================================================================

  /**
   * GET /api/v1/tags/entities/{entityType}/{entityId} - Get entity tags
   */
  getEntityTags() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const entityType = pathParts[pathParts.length - 2] as TaggedEntityType;
      const entityId = pathParts[pathParts.length - 1];

      const tags = await this.categoryTagService.getTagsByEntity(entityId, entityType, req.context!);
      
      return createSuccessResponse({
        entity_id: entityId,
        entity_type: entityType,
        tags: tags.map(tag => ({
          ...tag,
          _links: this.categoryTagService.generateLinks('tag', tag.tag_id)
        })),
        metadata: {
          total_tags: tags.length
        }
      });
    });
  }

  /**
   * POST /api/v1/tags/entities/tag - Tag entity
   */
  tagEntity() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'create'),
      withValidation(tagEntitySchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const tagTexts = validatedData.tags.map((tag: any) => 
        typeof tag === 'string' ? tag : tag.tag_text
      );

      const tags = await this.categoryTagService.tagEntity(
        validatedData.entity_id,
        validatedData.entity_type,
        tagTexts,
        {
          channel_id: validatedData.channel_id,
          default_colors: validatedData.default_colors
        },
        req.context!
      );
      
      return createSuccessResponse({
        entity_id: validatedData.entity_id,
        entity_type: validatedData.entity_type,
        created_tags: tags.map(tag => ({
          ...tag,
          _links: this.categoryTagService.generateLinks('tag', tag.tag_id)
        })),
        metadata: {
          tags_created: tags.length
        }
      }, 201);
    });
  }

  /**
   * DELETE /api/v1/tags/entities/untag - Untag entity
   */
  untagEntity() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'delete'),
      withValidation(untagEntitySchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      await this.categoryTagService.untagEntity(
        validatedData.entity_id,
        validatedData.entity_type,
        validatedData.tag_ids,
        req.context!
      );
      
      return createSuccessResponse({
        entity_id: validatedData.entity_id,
        entity_type: validatedData.entity_type,
        removed_tag_ids: validatedData.tag_ids,
        metadata: {
          tags_removed: validatedData.tag_ids.length
        }
      });
    });
  }

  /**
   * POST /api/v1/tags/entities/bulk-tag - Bulk tag entities
   */
  bulkTagEntities() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'create'),
      withValidation(bulkTagEntitiesSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.categoryTagService.bulkTagEntities(
        validatedData.entities,
        validatedData.tags,
        {},
        req.context!
      );
      
      return createSuccessResponse({
        ...result,
        entities_processed: validatedData.entities.length,
        tags_applied: validatedData.tags
      });
    });
  }

  /**
   * DELETE /api/v1/tags/entities/bulk-untag - Bulk untag entities
   */
  bulkUntagEntities() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'delete'),
      withValidation(bulkUntagEntitiesSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.categoryTagService.bulkUntagEntities(
        validatedData.entities,
        validatedData.tag_ids,
        req.context!
      );
      
      return createSuccessResponse({
        ...result,
        entities_processed: validatedData.entities.length,
        tag_ids_removed: validatedData.tag_ids
      });
    });
  }

  // ========================================================================
  // SEARCH OPERATIONS
  // ========================================================================

  /**
   * GET /api/v1/tags/search - Search tags
   */
  searchTags() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'read'),
      withQueryValidation(tagSearchSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const results = await this.categoryTagService.searchTags(
        validatedQuery.query,
        validatedQuery,
        req.context!
      );
      
      return createSuccessResponse({
        query: validatedQuery.query,
        results: results.map(result => ({
          ...result,
          _links: this.categoryTagService.generateLinks('tag', result.tag_id)
        })),
        metadata: {
          total_results: results.length,
          exact_match: validatedQuery.exact_match || false
        }
      });
    });
  }

  /**
   * GET /api/v1/categories/search - Search categories
   */
  searchCategories() {
    const middleware = compose(
      withAuth,
      withPermission('category', 'read'),
      withQueryValidation(categorySearchSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const results = await this.categoryTagService.searchCategories(
        validatedQuery.query,
        validatedQuery,
        req.context!
      );
      
      return createSuccessResponse({
        query: validatedQuery.query,
        results: results.map(result => ({
          ...result,
          _links: this.categoryTagService.generateLinks('category', result.category_id)
        })),
        metadata: {
          total_results: results.length,
          category_types: [...new Set(results.map(r => r.category_type))]
        }
      });
    });
  }

  // ========================================================================
  // ANALYTICS OPERATIONS
  // ========================================================================

  /**
   * GET /api/v1/tags/analytics - Get tag analytics
   */
  getTagAnalytics() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'read'),
      withQueryValidation(tagAnalyticsFilterSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const analytics = await this.categoryTagService.getTagAnalytics(
        validatedQuery,
        req.context!
      );
      
      return createSuccessResponse({
        ...analytics,
        metadata: {
          filters_applied: validatedQuery,
          generated_at: new Date().toISOString()
        }
      });
    });
  }

  /**
   * GET /api/v1/categories/analytics - Get category analytics
   */
  getCategoryAnalytics() {
    const middleware = compose(
      withAuth,
      withPermission('category', 'read'),
      withQueryValidation(categoryAnalyticsFilterSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const analytics = await this.categoryTagService.getCategoryAnalytics(
        validatedQuery,
        req.context!
      );
      
      return createSuccessResponse({
        ...analytics,
        metadata: {
          filters_applied: validatedQuery,
          generated_at: new Date().toISOString()
        }
      });
    });
  }

  /**
   * GET /api/v1/tags/cloud - Generate tag cloud
   */
  getTagCloud() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const entityType = url.searchParams.get('entity_type') as TaggedEntityType | undefined;
      const channelId = url.searchParams.get('channel_id') || undefined;
      const minUsage = parseInt(url.searchParams.get('min_usage') || '1');
      const maxTags = parseInt(url.searchParams.get('max_tags') || '50');

      const tagCloud = await this.categoryTagService.getTagCloud(
        {
          entity_type: entityType,
          channel_id: channelId,
          min_usage: minUsage,
          max_tags: maxTags
        },
        req.context!
      );
      
      return createSuccessResponse({
        ...tagCloud,
        metadata: {
          entity_type: entityType,
          channel_id: channelId,
          min_usage: minUsage,
          max_tags: maxTags,
          generated_at: new Date().toISOString()
        }
      });
    });
  }

  // ========================================================================
  // BULK OPERATIONS
  // ========================================================================

  /**
   * DELETE /api/v1/tags/bulk/delete - Bulk delete tags
   */
  bulkDeleteTags() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'delete'),
      withValidation(bulkDeleteTagsSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.categoryTagService.bulkDeleteTags(
        validatedData.ids,
        req.context!
      );
      
      return createSuccessResponse({
        ...result,
        requested_ids: validatedData.ids,
        metadata: {
          operation: 'bulk_delete_tags',
          processed_at: new Date().toISOString()
        }
      });
    });
  }

  /**
   * POST /api/v1/tags/bulk/merge - Bulk merge tags
   */
  bulkMergeTags() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'update'),
      withValidation(bulkMergeTagsSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.categoryTagService.bulkMergeTags(
        validatedData.source_tag_ids,
        validatedData.target_tag_text,
        validatedData.target_colors || {},
        req.context!
      );
      
      return createSuccessResponse({
        ...result,
        source_tag_ids: validatedData.source_tag_ids,
        target_tag_text: validatedData.target_tag_text,
        target_colors: validatedData.target_colors,
        metadata: {
          operation: 'bulk_merge_tags',
          processed_at: new Date().toISOString()
        }
      });
    });
  }

  /**
   * DELETE /api/v1/categories/bulk/delete - Bulk delete categories
   */
  bulkDeleteCategories() {
    const middleware = compose(
      withAuth,
      withPermission('category', 'delete'),
      withValidation(bulkDeleteCategoriesSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.categoryTagService.bulkDeleteCategories(
        validatedData.ids,
        validatedData.category_type,
        validatedData.force || false,
        req.context!
      );
      
      return createSuccessResponse({
        ...result,
        requested_ids: validatedData.ids,
        category_type: validatedData.category_type,
        force_delete: validatedData.force || false,
        metadata: {
          operation: 'bulk_delete_categories',
          processed_at: new Date().toISOString()
        }
      });
    });
  }

  // ========================================================================
  // TAG COLOR OPERATIONS
  // ========================================================================

  /**
   * PUT /api/v1/tags/colors/{tagText}/{entityType} - Update tag colors
   */
  updateTagColors() {
    const middleware = compose(
      withAuth,
      withPermission('tag', 'update'),
      withValidation(updateTagColorSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const entityType = pathParts[pathParts.length - 1] as TaggedEntityType;
      const tagText = decodeURIComponent(pathParts[pathParts.length - 2]);

      const result = await this.categoryTagService.updateTagColors(
        tagText,
        entityType,
        validatedData.background_color,
        validatedData.text_color,
        req.context!
      );
      
      return createSuccessResponse({
        ...result,
        tag_text: tagText,
        entity_type: entityType,
        colors: {
          background_color: validatedData.background_color,
          text_color: validatedData.text_color
        },
        metadata: {
          operation: 'update_tag_colors',
          processed_at: new Date().toISOString()
        }
      });
    });
  }

  // ========================================================================
  // UTILITY METHODS
  // ========================================================================

  /**
   * Get maximum depth in category tree
   */
  private getMaxDepth(node: any): number {
    if (!node.children || node.children.length === 0) {
      return node.depth || 0;
    }
    
    return Math.max(node.depth || 0, ...node.children.map((child: any) => this.getMaxDepth(child)));
  }

  /**
   * Override extractIdFromPath to handle nested routes
   */
  protected extractIdFromPath(req: ApiRequest): string {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    
    // For routes like /api/v1/categories/service/{id} or /api/v1/tags/{id}
    // Find the last UUID-like segment
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const part = pathParts[i];
      if (part && part.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
        return part;
      }
    }
    
    // Fallback to last segment
    return pathParts[pathParts.length - 1];
  }
}