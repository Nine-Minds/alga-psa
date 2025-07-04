/**
 * API Company Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseControllerV2 } from './ApiBaseControllerV2';
import { CompanyService } from '../services/CompanyService';
import { ContactService } from '../services/ContactService';
import { 
  createCompanySchema,
  updateCompanySchema,
  companyListQuerySchema,
  createCompanyLocationSchema,
  updateCompanyLocationSchema
} from '../schemas/company';
import { 
  ApiKeyServiceForApi 
} from '../../services/apiKeyServiceForApi';
import { 
  findUserByIdForApi 
} from '../../actions/user-actions/findUserByIdForApi';
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
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '../middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiCompanyControllerV2 extends ApiBaseControllerV2 {
  private companyService: CompanyService;
  private contactService: ContactService;

  constructor() {
    const companyService = new CompanyService();
    const contactService = new ContactService();
    
    super(companyService, {
      resource: 'company',
      createSchema: createCompanySchema,
      updateSchema: updateCompanySchema,
      querySchema: companyListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    
    this.companyService = companyService;
    this.contactService = contactService;
  }

  /**
   * Get company statistics
   */
  stats() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'company', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read company');
          }

          const stats = await this.companyService.getCompanyStats(apiRequest.context!);
          
          return createSuccessResponse(stats);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get company contacts
   */
  getContacts() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract company ID from path
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const companiesIndex = pathParts.findIndex(part => part === 'companies');
        const companyId = pathParts[companiesIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'company', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read company');
          }

          // Verify company exists
          const company = await this.companyService.getById(companyId, apiRequest.context);
          if (!company) {
            throw new NotFoundError('Company not found');
          }

          // Get pagination params
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          // Use ContactService to get contacts for this company
          const contacts = await this.contactService.list(
            { 
              page, 
              limit,
              filters: { company_id: companyId } 
            },
            apiRequest.context!
          );
          
          return createPaginatedResponse(
            contacts.data,
            contacts.total,
            page,
            limit
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create company location
   */
  createLocation() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract company ID from path
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const companiesIndex = pathParts.findIndex(part => part === 'companies');
        const companyId = pathParts[companiesIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'company', 'update', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update company');
          }

          // Verify company exists
          const company = await this.companyService.getById(companyId, apiRequest.context);
          if (!company) {
            throw new NotFoundError('Company not found');
          }

          // Validate data
          let data;
          try {
            const body = await req.json();
            data = createCompanyLocationSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Validation failed', error.errors);
            }
            throw error;
          }

          const location = await this.companyService.createLocation(
            companyId,
            data,
            apiRequest.context!
          );
          
          return createSuccessResponse(location, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get company locations
   */
  getLocations() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Create request with context
        const apiRequest = req as ApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Extract company ID from path
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const companiesIndex = pathParts.findIndex(part => part === 'companies');
        const companyId = pathParts[companiesIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'company', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read company');
          }

          // Verify company exists
          const company = await this.companyService.getById(companyId, apiRequest.context);
          if (!company) {
            throw new NotFoundError('Company not found');
          }

          const locations = await this.companyService.getCompanyLocations(
            companyId,
            apiRequest.context!
          );
          
          return createSuccessResponse(locations);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}