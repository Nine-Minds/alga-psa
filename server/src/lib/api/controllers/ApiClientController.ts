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
  createClientLocationSchema
} from '../schemas/client';
import { 
  runWithTenant 
} from '../../db';
import {
  AuthenticatedApiRequest,
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
        const apiRequest = await this.authenticate(req) as AuthenticatedApiRequest;

        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');
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
        const apiRequest = await this.authenticate(req) as AuthenticatedApiRequest;

        // Extract client/client ID from path (support both old and new paths)
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const clientsIndex = pathParts.findIndex(part => part === 'clients' || part === 'clients');
        const clientId = pathParts[clientsIndex + 1];

        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');

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
        const apiRequest = await this.authenticate(req) as AuthenticatedApiRequest;

        // Extract client/client ID from path (support both old and new paths)
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const clientsIndex = pathParts.findIndex(part => part === 'clients' || part === 'clients');
        const clientId = pathParts[clientsIndex + 1];

        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');

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
        const apiRequest = await this.authenticate(req) as AuthenticatedApiRequest;

        // Extract client/client ID from path (support both old and new paths)
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const clientsIndex = pathParts.findIndex(part => part === 'clients' || part === 'clients');
        const clientId = pathParts[clientsIndex + 1];

        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');

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
