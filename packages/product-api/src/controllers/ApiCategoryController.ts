/**
 * API Category Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { CategoryService } from '@product/api/services/CategoryService';
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
} from '@product/api/schemas/categorySchemas';
import { 
  runWithTenant 
} from '@server/lib/db';
import { 
  getConnection 
} from '@server/lib/db/db';
import { 
  hasPermission 
} from '@server/lib/auth/rbac';
import {
  AuthenticatedApiRequest,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '@product/api/middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiCategoryController extends ApiBaseController {
  private categoryService: CategoryService;

  constructor() {
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
  }

  private mapCategoryTypeToPermissionResource(categoryType?: CategoryType): 'billing_settings' | 'ticket_settings' {
    return categoryType === 'service' ? 'billing_settings' : 'ticket_settings';
  }

  private async ensurePermission(
    req: AuthenticatedApiRequest,
    resource: 'billing_settings' | 'ticket_settings',
    action: string
  ): Promise<void> {
    if (!req.context.user) {
      throw new UnauthorizedError('User context required');
    }

    const knex = await getConnection(req.context.tenant);
    const hasAccess = await hasPermission(req.context.user, resource, action, knex);
    if (!hasAccess) {
      const resourceLabel = resource.replace('_', ' ');
      throw new ForbiddenError(`Permission denied: Cannot ${action} ${resourceLabel}`);
    }
  }

  // ========================================================================
  // SERVICE CATEGORY OPERATIONS
  // ========================================================================

  /**
   * List service categories
   */
  listServiceCategories() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.ensurePermission(apiRequest, 'billing_settings', 'read');

          // Parse query parameters
          const url = new URL(req.url);
          const query: Record<string, any> = {};
          url.searchParams.forEach((value, key) => {
            query[key] = value;
          });
          
          let validatedQuery;
          try {
            validatedQuery = serviceCategoryListQuerySchema.parse(query);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Query validation failed', error.errors);
            }
            throw error;
          }

          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const filters = { ...validatedQuery, page, limit };
          const result = await this.categoryService.listServiceCategories(filters, apiRequest.context!);
          
          return createPaginatedResponse(
            result.data,
            result.total,
            page,
            limit,
            { resource: 'service_category', filters }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get service category by ID
   */
  getServiceCategory() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.ensurePermission(apiRequest, 'billing_settings', 'read');

          const id = await this.extractIdFromPath(apiRequest);
          const category = await this.categoryService.getServiceCategoryById(id, apiRequest.context!);
          
          if (!category) {
            throw new NotFoundError('Service category not found');
          }

          return createSuccessResponse(category);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create service category
   */
  createServiceCategory() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.ensurePermission(apiRequest, 'billing_settings', 'create');

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = createServiceCategorySchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const category = await this.categoryService.createServiceCategory(validatedData, apiRequest.context!);
          
          return createSuccessResponse(category, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update service category
   */
  updateServiceCategory() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.ensurePermission(apiRequest, 'billing_settings', 'update');

          const id = await this.extractIdFromPath(apiRequest);

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = updateServiceCategorySchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const category = await this.categoryService.updateServiceCategory(id, validatedData, apiRequest.context!);
          
          return createSuccessResponse(category);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete service category
   */
  deleteServiceCategory() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.ensurePermission(apiRequest, 'billing_settings', 'delete');

          const id = await this.extractIdFromPath(apiRequest);
          await this.categoryService.deleteServiceCategory(id, apiRequest.context!);
          
          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ========================================================================
  // TICKET CATEGORY OPERATIONS
  // ========================================================================

  /**
   * List ticket categories
   */
  listTicketCategories() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.ensurePermission(apiRequest, 'ticket_settings', 'read');

          // Parse query parameters
          const url = new URL(req.url);
          const query: Record<string, any> = {};
          url.searchParams.forEach((value, key) => {
            query[key] = value;
          });
          
          let validatedQuery;
          try {
            validatedQuery = ticketCategoryListQuerySchema.parse(query);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Query validation failed', error.errors);
            }
            throw error;
          }

          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const filters = { ...validatedQuery, page, limit };
          const result = await this.categoryService.listTicketCategories(filters, apiRequest.context!);
          
          return createPaginatedResponse(
            result.data,
            result.total,
            page,
            limit,
            { resource: 'ticket_category', filters }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get ticket category by ID
   */
  getTicketCategory() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.ensurePermission(apiRequest, 'ticket_settings', 'read');

          const id = await this.extractIdFromPath(apiRequest);
          const category = await this.categoryService.getTicketCategoryById(id, apiRequest.context!);
          
          if (!category) {
            throw new NotFoundError('Ticket category not found');
          }
          
          return createSuccessResponse(category);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create ticket category
   */
  createTicketCategory() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.ensurePermission(apiRequest, 'ticket_settings', 'create');

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = createTicketCategorySchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const category = await this.categoryService.createTicketCategory(validatedData, apiRequest.context!);
          
          return createSuccessResponse(category, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update ticket category
   */
  updateTicketCategory() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.ensurePermission(apiRequest, 'ticket_settings', 'update');

          const id = await this.extractIdFromPath(apiRequest);

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = updateTicketCategorySchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const category = await this.categoryService.updateTicketCategory(id, validatedData, apiRequest.context!);
          
          return createSuccessResponse(category);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete ticket category
   */
  deleteTicketCategory() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.ensurePermission(apiRequest, 'ticket_settings', 'delete');

          const id = await this.extractIdFromPath(apiRequest);
          await this.categoryService.deleteTicketCategory(id, apiRequest.context!);
          
          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get category tree for a board
   */
  getCategoryTree() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.ensurePermission(apiRequest, 'ticket_settings', 'read');

          const url = new URL(req.url);
          const pathParts = url.pathname.split('/');
          // Support both boardId (legacy) and boardId (new) route parameters
          const boardId = pathParts[pathParts.length - 1];
          const tree = await this.categoryService.getCategoryTree(boardId, apiRequest.context!);
          
          return createSuccessResponse({
            tree,
            total_categories: tree.length
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Move category to new parent
   */
  moveCategory() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.ensurePermission(apiRequest, 'ticket_settings', 'update');

          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = moveCategorySchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          const category = await this.categoryService.moveCategory(
            validatedData.category_id,
            validatedData.new_parent_id ?? null,
            apiRequest.context!
          );
          
          return createSuccessResponse(category);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ========================================================================
  // SEARCH AND ANALYTICS
  // ========================================================================

  /**
   * Search categories
   */
  searchCategories() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Parse query parameters
          const url = new URL(req.url);
          const query: Record<string, any> = {};
          url.searchParams.forEach((value, key) => {
            query[key] = value;
          });
          
          let validatedQuery;
          try {
            validatedQuery = categorySearchSchema.parse(query);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Query validation failed', error.errors);
            }
            throw error;
          }

          // Check permissions
          const resource = this.mapCategoryTypeToPermissionResource(validatedQuery.category_type);
          await this.ensurePermission(apiRequest, resource, 'read');

          const results = await this.categoryService.searchCategories(
            validatedQuery.search_term,
            validatedQuery,
            apiRequest.context!
          );
          
          return createPaginatedResponse(
            results.data,
            results.total,
            validatedQuery.offset || 0,
            validatedQuery.limit || 25,
            { resource: 'category', search_term: validatedQuery.search_term }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get category analytics
   */
  getCategoryAnalytics() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Parse query parameters
          const url = new URL(req.url);
          const query: Record<string, any> = {};
          url.searchParams.forEach((value, key) => {
            query[key] = value;
          });
          
          let validatedQuery;
          try {
            validatedQuery = categoryAnalyticsFilterSchema.parse(query);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Query validation failed', error.errors);
            }
            throw error;
          }

          // Check permissions
          const resource = this.mapCategoryTypeToPermissionResource(validatedQuery.category_type);
          await this.ensurePermission(apiRequest, resource, 'read');

          const analytics = await this.categoryService.getCategoryAnalytics(
            validatedQuery,
            apiRequest.context!
          );
          
          return createSuccessResponse({
            analytics,
            generated_at: new Date().toISOString()
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ========================================================================
  // BULK OPERATIONS
  // ========================================================================

  /**
   * Bulk delete categories
   */
  bulkDeleteCategories() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Parse and validate request body
          const body = await req.json();
          let validatedData;
          try {
            validatedData = bulkDeleteCategoriesSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Request validation failed', error.errors);
            }
            throw error;
          }

          // Check permissions
          const resource = this.mapCategoryTypeToPermissionResource(validatedData.category_type);
          await this.ensurePermission(apiRequest, resource, 'delete');

          const result = await this.categoryService.bulkDeleteCategories(
            validatedData.category_ids,
            apiRequest.context!
          );
          
          return createSuccessResponse({
            message: `Bulk delete completed: ${result.success} successful, ${result.failed} failed`,
            ...result
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}

export default ApiCategoryController;
