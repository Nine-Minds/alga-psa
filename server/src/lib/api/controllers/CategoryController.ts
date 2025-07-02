/**
 * Category Controller
 * REST API controller for category operations (service categories and ticket categories)
 * with hierarchical management, analytics, and CRUD support
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
import { CategoryService } from '../services/CategoryService';
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
  // Search Schemas
  categorySearchSchema,
  // Analytics Schemas
  categoryAnalyticsFilterSchema,
  // Bulk Operations Schemas
  bulkDeleteCategoriesSchema,
  // Import/Export Schemas
  importCategoriesSchema,
  // Type Exports
  CreateServiceCategoryData,
  CreateTicketCategoryData,
  CategoryType
} from '../schemas/categorySchemas';
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

export class CategoryController extends BaseController {
  private categoryService: CategoryService;

  constructor() {
    // Initialize service first
    const categoryService = new CategoryService();
    
    super(categoryService, {
      resource: 'category',
      createSchema: createServiceCategorySchema,
      updateSchema: updateServiceCategorySchema,
      querySchema: serviceCategoryListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });

    this.categoryService = categoryService;
    this.registerEndpoints();
  }

  /**
   * Register all endpoints with metadata system
   * TODO: Fix ApiRegistry interface issues
   */
  private registerEndpoints() {
    // Service Category Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/service',
      method: 'GET',
      resource: 'service_category',
      action: 'read',
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
      description: 'Get service category by ID',
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
      action: 'read',
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
      description: 'Get ticket category by ID with hierarchy information',
      permissions: { resource: 'ticket_category', action: 'read' },
      tags: ['categories', 'ticket-categories']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/ticket/{id}',
      method: 'PUT',
      resource: 'ticket_category',
      action: 'update',
      description: 'Update ticket category with hierarchy validation',
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

    // Category Tree and Movement Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/ticket/tree/{channelId}',
      method: 'GET',
      resource: 'ticket_category',
      action: 'read',
      description: 'Get category tree for a channel',
      permissions: { resource: 'ticket_category', action: 'read' },
      tags: ['categories', 'ticket-categories', 'hierarchy']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/ticket/move',
      method: 'POST',
      resource: 'ticket_category',
      action: 'update',
      description: 'Move category to new parent with circular hierarchy prevention',
      permissions: { resource: 'ticket_category', action: 'update' },
      requestSchema: moveCategorySchema,
      tags: ['categories', 'ticket-categories', 'hierarchy']
    });

    // Search and Analytics Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/search',
      method: 'GET',
      resource: 'category',
      action: 'read',
      description: 'Search categories with filtering options',
      permissions: { resource: 'category', action: 'read' },
      querySchema: categorySearchSchema,
      tags: ['categories', 'search']
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

    // Bulk Operations Endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/categories/bulk/delete',
      method: 'POST',
      resource: 'category',
      action: 'delete',
      description: 'Bulk delete categories with validation',
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
      const result = await this.categoryService.listServiceCategories(filters, req.context!);
      
      return createPaginatedResponse(
        result.data,
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
  getServiceCategory() {
    const middleware = compose(
      withAuth,
      withPermission('service_category', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      const category = await this.categoryService.getServiceCategoryById(id, req.context!);
      
      if (!category) {
        throw new NotFoundError('Service category not found');
      }

      return createSuccessResponse(category);
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
      const category = await this.categoryService.createServiceCategory(validatedData, req.context!);
      
      return createSuccessResponse(category, 201);
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
      const category = await this.categoryService.updateServiceCategory(id, validatedData, req.context!);
      
      return createSuccessResponse(category);
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
      await this.categoryService.deleteServiceCategory(id, req.context!);
      
      return createSuccessResponse({ message: 'Service category deleted successfully' });
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
      const result = await this.categoryService.listTicketCategories(filters, req.context!);
      
      return createPaginatedResponse(
        result.data,
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
  getTicketCategory() {
    const middleware = compose(
      withAuth,
      withPermission('ticket_category', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      const category = await this.categoryService.getTicketCategoryById(id, req.context!);
      
      if (!category) {
        throw new NotFoundError('Ticket category not found');
      }
      
      return createSuccessResponse(category);
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
      const category = await this.categoryService.createTicketCategory(validatedData, req.context!);
      
      return createSuccessResponse(category, 201);
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
      const category = await this.categoryService.updateTicketCategory(id, validatedData, req.context!);
      
      return createSuccessResponse(category);
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
      await this.categoryService.deleteTicketCategory(id, req.context!);
      
      return createSuccessResponse({ message: 'Ticket category deleted successfully' });
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
      const tree = await this.categoryService.getCategoryTree(channelId, req.context!);
      
      return createSuccessResponse({
        tree,
        total_categories: tree.length
      });
    });
  }

  /**
   * POST /api/v1/categories/ticket/move - Move category
   */
  moveCategory() {
    const middleware = compose(
      withAuth,
      withPermission('ticket_category', 'update'),
      withValidation(moveCategorySchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const category = await this.categoryService.moveCategory(
        validatedData.category_id,
        validatedData.new_parent_id,
        req.context!
      );
      
      return createSuccessResponse(category);
    });
  }

  // ========================================================================
  // SEARCH AND ANALYTICS
  // ========================================================================

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
      const results = await this.categoryService.searchCategories(
        validatedQuery.search_term,
        validatedQuery,
        req.context!
      );
      
      return createPaginatedResponse(
        results.data,
        results.total,
        validatedQuery.offset || 0,
        validatedQuery.limit || 25,
        { resource: 'category', search_term: validatedQuery.search_term }
      );
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
      const analytics = await this.categoryService.getCategoryAnalytics(
        validatedQuery,
        req.context!
      );
      
      return createSuccessResponse({
        analytics,
        generated_at: new Date().toISOString()
      });
    });
  }

  // ========================================================================
  // BULK OPERATIONS
  // ========================================================================

  /**
   * POST /api/v1/categories/bulk/delete - Bulk delete categories
   */
  bulkDeleteCategories() {
    const middleware = compose(
      withAuth,
      withPermission('category', 'delete'),
      withValidation(bulkDeleteCategoriesSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.categoryService.bulkDeleteCategories(
        validatedData.category_ids,
        req.context!
      );
      
      return createSuccessResponse({
        message: `Bulk delete completed: ${result.success} successful, ${result.failed} failed`,
        ...result
      });
    });
  }
}

export default CategoryController;