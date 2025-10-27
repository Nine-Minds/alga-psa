/**
 * API Ticket Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController, AuthenticatedApiRequest } from './ApiBaseController';
import { TicketService } from '@product/api/services/TicketService';
import { 
  createTicketSchema,
  updateTicketSchema,
  ticketListQuerySchema,
  ticketSearchSchema,
  ticketStatsResponseSchema,
  createTicketCommentSchema,
  updateTicketStatusSchema,
  updateTicketAssignmentSchema,
  createTicketFromAssetSchema
} from '@product/api/schemas/ticket';
import { 
  ApiKeyServiceForApi 
} from '@server/lib/services/apiKeyServiceForApi';
import { 
  findUserByIdForApi 
} from '@product/actions/user-actions/findUserByIdForApi';
import { 
  runWithTenant 
} from '@server/lib/db';
import { 
  hasPermission 
} from '@server/lib/auth/rbac';
import {
  ApiRequest,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  createSuccessResponse,
  handleApiError
} from '@product/api/middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiTicketController extends ApiBaseController {
  private ticketService: TicketService;

  constructor() {
    const ticketService = new TicketService();
    
    super(ticketService, {
      resource: 'ticket',
      createSchema: createTicketSchema,
      updateSchema: updateTicketSchema,
      querySchema: ticketListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    
    this.ticketService = ticketService;
  }

  /**
   * Search tickets
   */
  search() {
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
        const apiRequest = req as AuthenticatedApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const hasAccess = await hasPermission(user, 'ticket', 'read');
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read ticket');
          }

          // Validate query
          let validatedQuery;
          try {
            const url = new URL(req.url);
            const query: Record<string, any> = {};
            url.searchParams.forEach((value, key) => {
              query[key] = value;
            });
            validatedQuery = ticketSearchSchema.parse(query);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Query validation failed', error.errors);
            }
            throw error;
          }

          const result = await this.ticketService.search(
            validatedQuery,
            apiRequest.context!
          );

          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get ticket statistics
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
        const apiRequest = req as AuthenticatedApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const hasAccess = await hasPermission(user, 'ticket', 'read');
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read ticket');
          }

          const stats = await this.ticketService.getTicketStats(apiRequest.context!);
          
          return createSuccessResponse(stats);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get ticket comments
   */
  getComments() {
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
        const apiRequest = req as AuthenticatedApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const hasAccess = await hasPermission(user, 'ticket', 'read');
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read ticket');
          }

          const ticketId = await this.extractIdFromPath(apiRequest);
          const comments = await this.ticketService.getTicketComments(
            ticketId, 
            apiRequest.context!
          );

          return createSuccessResponse(comments);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Add comment to ticket
   */
  addComment() {
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
        const apiRequest = req as AuthenticatedApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const hasAccess = await hasPermission(user, 'ticket', 'update');
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update ticket');
          }

          // Validate data
          let validatedData;
          try {
            const body = await req.json();
            validatedData = createTicketCommentSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Validation failed', error.errors);
            }
            throw error;
          }

          const ticketId = await this.extractIdFromPath(apiRequest);
          const comment = await this.ticketService.addComment(
            ticketId,
            validatedData,
            apiRequest.context!
          );

          return createSuccessResponse(comment, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update ticket status
   */
  updateStatus() {
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
        const apiRequest = req as AuthenticatedApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const hasAccess = await hasPermission(user, 'ticket', 'update');
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update ticket');
          }

          // Validate data
          let validatedData;
          try {
            const body = await req.json();
            validatedData = updateTicketStatusSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Validation failed', error.errors);
            }
            throw error;
          }

          const ticketId = await this.extractIdFromPath(apiRequest);
          const updated = await this.ticketService.update(
            ticketId,
            validatedData,
            apiRequest.context!
          );

          if (!updated) {
            throw new NotFoundError('Ticket not found');
          }

          return createSuccessResponse(updated);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update ticket assignment
   */
  updateAssignment() {
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
        const apiRequest = req as AuthenticatedApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const hasAccess = await hasPermission(user, 'ticket', 'update');
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update ticket');
          }

          // Validate data
          let validatedData;
          try {
            const body = await req.json();
            validatedData = updateTicketAssignmentSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Validation failed', error.errors);
            }
            throw error;
          }

          const ticketId = await this.extractIdFromPath(apiRequest);
          const updated = await this.ticketService.update(
            ticketId,
            validatedData,
            apiRequest.context!
          );

          if (!updated) {
            throw new NotFoundError('Ticket not found');
          }

          return createSuccessResponse(updated);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create ticket from asset
   */
  createFromAsset() {
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
        const apiRequest = req as AuthenticatedApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const hasAccess = await hasPermission(user, 'ticket', 'create');
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot create ticket');
          }

          // Validate data
          let validatedData;
          try {
            const body = await req.json();
            validatedData = createTicketFromAssetSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Validation failed', error.errors);
            }
            throw error;
          }

          const ticket = await this.ticketService.createFromAsset(
            validatedData,
            apiRequest.context!
          );

          return createSuccessResponse(ticket, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Override extractIdFromPath to handle ticket-specific routes
   */
  protected async extractIdFromPath(req: AuthenticatedApiRequest): Promise<string> {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const ticketsIndex = pathParts.findIndex(part => part === 'tickets');
    
    // For routes like /tickets/{id}/comments or /tickets/{id}/status
    if (ticketsIndex !== -1 && pathParts[ticketsIndex + 1]) {
      return pathParts[ticketsIndex + 1];
    }
    
    return '';
  }
}