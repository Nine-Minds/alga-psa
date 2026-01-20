/**
 * API Base Controller
 * Simplified version that properly handles API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodSchema, ZodError } from 'zod';
import { BaseService, CrudOptions } from './types';
import { 
  ApiKeyServiceForApi 
} from '../../services/apiKeyServiceForApi';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { 
  runWithTenant 
} from '../../db';
import { 
  getConnection 
} from '../../db/db';
import { 
  hasPermission 
} from '../../auth/rbac';
import { 
  ApiRequest,
  AuthenticatedApiRequest,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '../middleware/apiMiddleware';

export abstract class ApiBaseController {
  constructor(
    protected service: BaseService,
    protected options: CrudOptions
  ) {}

  /**
   * Authenticate request and set context
   */
  protected async authenticate(req: NextRequest): Promise<AuthenticatedApiRequest> {
    const apiKey = req.headers.get('x-api-key');
    
    if (!apiKey) {
      throw new UnauthorizedError('API key required');
    }

    // Extract tenant ID from header
    let tenantId = req.headers.get('x-tenant-id');
    let keyRecord;

    if (tenantId) {
      // If tenant is provided, validate key for that specific tenant
      keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
    } else {
      // Otherwise, search across all tenants
      keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
      if (keyRecord) {
        tenantId = keyRecord.tenant;
      }
    }
    
    if (!keyRecord) {
      throw new UnauthorizedError('Invalid API key');
    }

    // Get user within tenant context
    const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    // Create extended request with context
    const apiRequest = req as AuthenticatedApiRequest;
    apiRequest.context = {
      userId: keyRecord.user_id,
      tenant: keyRecord.tenant,
      user
    };

    return apiRequest;
  }

  /**
   * Check permissions
   */
  protected async checkPermission(req: AuthenticatedApiRequest, action: string): Promise<void> {
    if (!req.context.user) {
      throw new UnauthorizedError('User context required');
    }

    // Get a connection within the current tenant context
    const knex = await getConnection(req.context.tenant);
    
    const hasAccess = await hasPermission(req.context.user, this.options.resource, action, knex);
    if (!hasAccess) {
      throw new ForbiddenError(`Permission denied: Cannot ${action} ${this.options.resource}`);
    }
  }

  /**
   * Validate request data
   */
  protected async validateData(req: AuthenticatedApiRequest, schema: ZodSchema): Promise<any> {
    try {
      const body = await req.json().catch(() => ({}));
      return schema.parse(body);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }
  }

  /**
   * Validate query parameters
   */
  protected validateQuery(req: AuthenticatedApiRequest, schema: ZodSchema): any {
    try {
      const url = new URL(req.url);
      const query: Record<string, any> = {};
      url.searchParams.forEach((value, key) => {
        query[key] = value;
      });
      return schema.parse(query);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Query validation failed', error.errors);
      }
      throw error;
    }
  }

  /**
   * Extract ID from request path
   */
  protected async extractIdFromPath(req: AuthenticatedApiRequest): Promise<string> {
    // Check if params were passed from Next.js dynamic route
    if ('params' in req && req.params) {
      const params = await req.params;
      if (params && 'id' in params) {
        const id = params.id;
        
        // Validate UUID format (including nil UUID)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (id && !uuidRegex.test(id)) {
          throw new ValidationError(`Invalid ${this.options.resource} ID format`);
        }
        
        return id;
      }
    }
    
    // Fallback to extracting from URL path
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    // Handle special cases for plural forms
    let resourcePlural: string;
    let resourceAlternative: string | null = null;
    if (this.options.resource === 'client') {
      resourcePlural = 'clients';
      resourceAlternative = 'clients'; // Support new client terminology
    } else if (this.options.resource === 'client') {
      resourcePlural = 'clients';
      resourceAlternative = 'clients'; // Support old client terminology for backward compatibility
    } else if (this.options.resource === 'time_entry') {
      resourcePlural = 'time-entries';
    } else {
      resourcePlural = this.options.resource + 's';
    }
    let resourceIndex = pathParts.findIndex(part => part === resourcePlural);
    if (resourceIndex === -1 && resourceAlternative) {
      resourceIndex = pathParts.findIndex(part => part === resourceAlternative);
    }
    const id = pathParts[resourceIndex + 1] || '';
    
    // Validate UUID format (including nil UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (id && !uuidRegex.test(id)) {
      throw new ValidationError(`Invalid ${this.options.resource} ID format`);
    }
    
    return id;
  }

  /**
   * List resources
   */
  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, this.options.permissions?.list || 'read');

          // Validate query if schema provided
          let validatedQuery = {};
          if (this.options.querySchema) {
            validatedQuery = this.validateQuery(apiRequest, this.options.querySchema);
          }

          // Parse pagination parameters
          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
          const sort = url.searchParams.get('sort') || 'created_at';
          const order = (url.searchParams.get('order') || 'desc') as 'asc' | 'desc';

          const filters: any = { ...validatedQuery };
          delete filters.page;
          delete filters.limit;
          delete filters.sort;
          delete filters.order;

          const listOptions = { page, limit, filters, sort, order };
          const result = await this.service.list(listOptions, apiRequest.context);
          
          return createPaginatedResponse(
            result.data,
            result.total,
            page,
            limit,
            { sort, order, filters }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get by ID
   */
  getById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');

          const id = await this.extractIdFromPath(apiRequest);
          const resource = await this.service.getById(id, apiRequest.context);
          
          if (!resource) {
            throw new NotFoundError(`${this.options.resource} not found`);
          }
          
          return createSuccessResponse(resource);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create resource
   */
  create() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, this.options.permissions?.create || 'create');

          // Validate data if schema provided
          let data;
          if (this.options.createSchema) {
            data = await this.validateData(apiRequest, this.options.createSchema);
          } else {
            data = await apiRequest.json();
          }

          try {
            const created = await this.service.create(data, apiRequest.context);
            return createSuccessResponse(created, 201);
          } catch (error: any) {
            if (error.message && error.message.includes('already exists')) {
              throw new ConflictError(error.message);
            }
            throw error;
          }
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update resource
   */
  update() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');

          const id = await this.extractIdFromPath(apiRequest);

          // Validate data if schema provided
          let data;
          if (this.options.updateSchema) {
            data = await this.validateData(apiRequest, this.options.updateSchema);
          } else {
            data = await apiRequest.json();
          }

          const updated = await this.service.update(id, data, apiRequest.context);
          
          if (!updated) {
            throw new NotFoundError(`${this.options.resource} not found`);
          }
          
          return createSuccessResponse(updated);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete resource
   */
  delete() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, this.options.permissions?.delete || 'delete');

          const id = await this.extractIdFromPath(apiRequest);
          const resource = await this.service.getById(id, apiRequest.context);
          
          if (!resource) {
            throw new NotFoundError(`${this.options.resource} not found`);
          }
          
          await this.service.delete(id, apiRequest.context);
          
          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}

// Export types for use in derived classes
export type { AuthenticatedApiRequest };
