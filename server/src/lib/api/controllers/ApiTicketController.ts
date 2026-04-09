/**
 * API Ticket Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController, AuthenticatedApiRequest } from './ApiBaseController';
import { TicketService } from '../services/TicketService';
import { 
  createTicketSchema,
  updateTicketSchema,
  ticketListQuerySchema,
  ticketSearchSchema,
  ticketStatsResponseSchema,
  createTicketMaterialSchema,
  createTicketCommentSchema,
  updateTicketCommentSchema,
  updateTicketStatusSchema,
  updateTicketAssignmentSchema,  
  createTicketFromAssetSchema
} from '../schemas/ticket';
import { 
  ApiKeyServiceForApi 
} from '../../services/apiKeyServiceForApi';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { 
  runWithTenant 
} from '../../db';
import { 
  hasPermission 
} from '../../auth/rbac';
import {
  ApiRequest,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  createSuccessResponse,
  handleApiError
} from '../middleware/apiMiddleware';
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

          const searchParams = req.nextUrl.searchParams;
          const limitRaw = searchParams.get('limit');
          const offsetRaw = searchParams.get('offset');
          const orderRaw = searchParams.get('order');

          let limit: number | undefined;
          let offset: number | undefined;
          let order: 'asc' | 'desc' | undefined;

          if (limitRaw !== null) {
            const n = Number(limitRaw);
            if (!Number.isInteger(n) || n <= 0 || n > 200) {
              throw new ValidationError('Validation failed', [
                { path: ['limit'], message: 'limit must be an integer between 1 and 200' }
              ]);
            }
            limit = n;
          }

          if (offsetRaw !== null) {
            const n = Number(offsetRaw);
            if (!Number.isInteger(n) || n < 0) {
              throw new ValidationError('Validation failed', [
                { path: ['offset'], message: 'offset must be an integer >= 0' }
              ]);
            }
            offset = n;
          }

          if (orderRaw !== null) {
            if (orderRaw !== 'asc' && orderRaw !== 'desc') {
              throw new ValidationError('Validation failed', [
                { path: ['order'], message: "order must be 'asc' or 'desc'" }
              ]);
            }
            order = orderRaw;
          }

          const ticketId = await this.extractIdFromPath(apiRequest);
          const comments = await this.ticketService.getTicketComments(
            ticketId, 
            apiRequest.context!,
            { limit, offset, order }
          );

          return createSuccessResponse(comments, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get ticket documents
   */
  getDocuments() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');

          const ticketId = await this.extractIdFromPath(apiRequest);
          const documents = await this.ticketService.getTicketDocuments(ticketId, apiRequest.context!);

          return createSuccessResponse(documents, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Upload a ticket document
   */
  uploadDocument() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');

          const ticketId = await this.extractIdFromPath(apiRequest);
          const formData = await req.formData();
          const file = formData.get('file');

          if (!(file instanceof File)) {
            throw new ValidationError('Validation failed', [
              { path: ['file'], message: 'file is required' },
            ]);
          }

          const document = await this.ticketService.uploadTicketDocument(ticketId, file, apiRequest.context!);

          return createSuccessResponse(document, 201, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Download a ticket document
   */
  downloadDocument() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');

          const ticketId = await this.extractIdFromPath(apiRequest);

          // Extract documentId from the URL path segment after "documents/"
          const url = new URL(apiRequest.url || req.url);
          const segments = url.pathname.split('/');
          const docsIndex = segments.indexOf('documents');
          const documentId = docsIndex >= 0 ? segments[docsIndex + 1] : undefined;

          if (!documentId) {
            throw new ValidationError('Validation failed', [
              { path: ['documentId'], message: 'document ID is required' },
            ]);
          }

          const result = await this.ticketService.downloadTicketDocument(ticketId, documentId, apiRequest.context!);

          const headers = new Headers();
          headers.set('Content-Type', result.mimeType);
          headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(result.fileName)}"`);
          headers.set('Cache-Control', 'no-store');

          return new NextResponse(new Uint8Array(result.buffer), { status: 200, headers });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete a ticket document
   */
  deleteDocument() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');

          const ticketId = await this.extractIdFromPath(apiRequest);

          const url = new URL(apiRequest.url || req.url);
          const segments = url.pathname.split('/');
          const docsIndex = segments.indexOf('documents');
          const documentId = docsIndex >= 0 ? segments[docsIndex + 1] : undefined;

          if (!documentId) {
            throw new ValidationError('Validation failed', [
              { path: ['documentId'], message: 'document ID is required' },
            ]);
          }

          await this.ticketService.deleteTicketDocument(ticketId, documentId, apiRequest.context!);

          return NextResponse.json(createSuccessResponse(null), { status: 200 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get ticket materials
   */
  getMaterials() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');

          const ticketId = await this.extractIdFromPath(apiRequest);
          const materials = await this.ticketService.getTicketMaterials(ticketId, apiRequest.context!);

          return createSuccessResponse(materials, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Add a material to a ticket
   */
  addMaterial() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        const validatedData = await this.validateData(apiRequest, createTicketMaterialSchema);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');

          const ticketId = await this.extractIdFromPath(apiRequest);
          const material = await this.ticketService.addTicketMaterial(ticketId, validatedData, apiRequest.context!);

          return createSuccessResponse(material, 201, undefined, apiRequest);
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
   * Update a comment on a ticket
   */
  updateComment() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiKey = req.headers.get('x-api-key');
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;
        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) tenantId = keyRecord.tenant;
        }
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);
        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        const apiRequest = req as AuthenticatedApiRequest;
        apiRequest.context = {
          userId: keyRecord.user_id,
          tenant: keyRecord.tenant,
          user
        };

        return await runWithTenant(tenantId!, async () => {
          const hasAccess = await hasPermission(user, 'ticket', 'update');
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot update ticket');
          }

          let validatedData;
          try {
            const body = await req.json();
            validatedData = updateTicketCommentSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Validation failed', error.errors);
            }
            throw error;
          }

          const ticketId = await this.extractIdFromPath(apiRequest);
          // Extract commentId from URL: /api/v1/tickets/{id}/comments/{commentId}
          const url = new URL(req.url);
          const segments = url.pathname.split('/').filter(Boolean);
          const commentId = segments[segments.length - 1];

          const comment = await this.ticketService.updateComment(
            ticketId,
            commentId,
            validatedData,
            apiRequest.context!
          );

          return createSuccessResponse(comment);
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
