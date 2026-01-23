/**
 * API Client Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { ClientService } from '../services/ClientService';
import { ContactService } from '../services/ContactService';
import {
  createClientSchema,
  updateClientSchema,
  clientListQuerySchema,
  createClientLocationSchema,
  updateClientLocationSchema
} from '../schemas/client';
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
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '../middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiClientController extends ApiBaseController {
  private clientService: ClientService;
  private contactService: ContactService;

  constructor() {
    const clientService = new ClientService();
    const contactService = new ContactService();
    
    super(clientService, {
      resource: 'client',
      createSchema: createClientSchema,
      updateSchema: updateClientSchema,
      querySchema: clientListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    
    this.clientService = clientService;
    this.contactService = contactService;
  }

  /**
   * Get client statistics
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
          const hasAccess = await hasPermission(user, 'client', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read client');
          }

          const stats = await this.clientService.getClientStats(apiRequest.context!);
          
          return createSuccessResponse(stats);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get client contacts
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

        // Extract client/client ID from path (support both old and new paths)
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const clientsIndex = pathParts.findIndex(part => part === 'clients' || part === 'clients');
        const clientId = pathParts[clientsIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'client', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read client');
          }

          // Verify client exists
          const client = await this.clientService.getById(clientId, apiRequest.context!);
          if (!client) {
            throw new NotFoundError('Client not found');
          }

          // Get pagination params
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          // Use ContactService to get contacts for this client
          const contacts = await this.contactService.list(
            { 
              page, 
              limit,
              filters: { client_id: clientId } 
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
   * Create client location
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

        // Extract client/client ID from path (support both old and new paths)
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const clientsIndex = pathParts.findIndex(part => part === 'clients' || part === 'clients');
        const clientId = pathParts[clientsIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'client', 'update', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update client');
          }

          // Verify client exists
          const client = await this.clientService.getById(clientId, apiRequest.context!);
          if (!client) {
            throw new NotFoundError('Client not found');
          }

          // Validate data
          let data;
          try {
            const body = await req.json();
            data = createClientLocationSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Validation failed', error.errors);
            }
            throw error;
          }

          const location = await this.clientService.createLocation(
            clientId,
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
   * Get client locations
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

        // Extract client/client ID from path (support both old and new paths)
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const clientsIndex = pathParts.findIndex(part => part === 'clients' || part === 'clients');
        const clientId = pathParts[clientsIndex + 1];

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const knex = await getConnection(tenantId!);
          const hasAccess = await hasPermission(user, 'client', 'read', knex);
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read client');
          }

          // Verify client exists
          const client = await this.clientService.getById(clientId, apiRequest.context!);
          if (!client) {
            throw new NotFoundError('Client not found');
          }

          const locations = await this.clientService.getClientLocations(
            clientId,
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
