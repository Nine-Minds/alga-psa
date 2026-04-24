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
  getConnection
} from '../../db/db';
import { 
  hasPermission 
} from '../../auth/rbac';
import { authorizeApiResourceRead } from './authorizationKernel';
import { buildAuthorizationAwarePage } from '@alga-psa/authorization/pagination';
import {
  ApiRequest,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  createSuccessResponse,
  createPaginatedResponse,
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

  private buildTicketRecordContext(ticket: Record<string, any>) {
    return {
      id: ticket.ticket_id,
      ownerUserId: typeof ticket.entered_by === 'string' ? ticket.entered_by : undefined,
      assignedUserIds: typeof ticket.assigned_to === 'string' ? [ticket.assigned_to] : [],
      clientId: typeof ticket.client_id === 'string' ? ticket.client_id : undefined,
      boardId: typeof ticket.board_id === 'string' ? ticket.board_id : undefined,
      teamIds: typeof ticket.assigned_team_id === 'string' ? [ticket.assigned_team_id] : [],
      statusId: ticket.status_id,
    };
  }

  private async assertTicketReadAllowed(
    apiRequest: AuthenticatedApiRequest,
    ticketId: string,
    knex?: Awaited<ReturnType<typeof getConnection>>
  ): Promise<Record<string, any>> {
    const resolvedKnex = knex ?? await getConnection(apiRequest.context.tenant);
    const ticket = await this.ticketService.getById(ticketId, apiRequest.context);
    if (!ticket) {
      throw new NotFoundError('ticket not found');
    }

    const allowed = await authorizeApiResourceRead({
      knex: resolvedKnex,
      tenant: apiRequest.context.tenant,
      user: apiRequest.context.user,
      apiKeyId: apiRequest.context.apiKeyId,
      resource: 'ticket',
      recordContext: this.buildTicketRecordContext(ticket as Record<string, any>),
    });

    if (!allowed) {
      throw new ForbiddenError('Permission denied: Cannot read ticket');
    }

    return ticket as Record<string, any>;
  }

  private async filterAuthorizedTickets(
    apiRequest: AuthenticatedApiRequest,
    tickets: Record<string, any>[],
    knex?: Awaited<ReturnType<typeof getConnection>>
  ): Promise<Record<string, any>[]> {
    if (tickets.length === 0) {
      return [];
    }

    const resolvedKnex = knex ?? await getConnection(apiRequest.context.tenant);
    const allowedByRow = await Promise.all(
      tickets.map((ticket) =>
        authorizeApiResourceRead({
          knex: resolvedKnex,
          tenant: apiRequest.context.tenant,
          user: apiRequest.context.user,
          apiKeyId: apiRequest.context.apiKeyId,
          resource: 'ticket',
          recordContext: this.buildTicketRecordContext(ticket),
        })
      )
    );

    return tickets.filter((_, index) => allowedByRow[index]);
  }

  private async listAllAuthorizedTickets(
    apiRequest: AuthenticatedApiRequest,
    knex?: Awaited<ReturnType<typeof getConnection>>
  ): Promise<Record<string, any>[]> {
    const resolvedKnex = knex ?? await getConnection(apiRequest.context.tenant);
    const authorizedTickets: Record<string, any>[] = [];
    const pageSize = 100;
    let page = 1;

    for (;;) {
      const result = await this.ticketService.list({ page, limit: pageSize }, apiRequest.context);
      if (!Array.isArray(result.data) || result.data.length === 0) {
        break;
      }

      authorizedTickets.push(
        ...(await this.filterAuthorizedTickets(apiRequest, result.data as Record<string, any>[], resolvedKnex))
      );

      if (page * pageSize >= result.total || result.data.length < pageSize) {
        break;
      }

      page += 1;
    }

    return authorizedTickets;
  }

  private buildTicketStatsFromAuthorizedRows(tickets: Record<string, any>[]) {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);

    const startOfMonth = new Date(startOfToday);
    startOfMonth.setDate(startOfMonth.getDate() - 30);

    const ticketsByStatus = tickets.reduce((acc: Record<string, number>, ticket) => {
      const key = String(ticket.status_id ?? ticket.status_name ?? 'unknown');
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    const ticketsByPriority = tickets.reduce((acc: Record<string, number>, ticket) => {
      const key = String(ticket.priority_name ?? 'unknown');
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    const ticketsByCategory = tickets.reduce((acc: Record<string, number>, ticket) => {
      if (!ticket.category_name) {
        return acc;
      }
      const key = String(ticket.category_name);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    const ticketsByBoard = tickets.reduce((acc: Record<string, number>, ticket) => {
      const key = String(ticket.board_name ?? 'unknown');
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    return {
      total_tickets: tickets.length,
      open_tickets: tickets.filter((ticket) => ticket.status_is_closed === false).length,
      closed_tickets: tickets.filter((ticket) => ticket.status_is_closed === true).length,
      unassigned_tickets: tickets.filter((ticket) => !ticket.assigned_to).length,
      overdue_tickets: 0,
      tickets_by_status: ticketsByStatus,
      tickets_by_priority: ticketsByPriority,
      tickets_by_category: ticketsByCategory,
      tickets_by_board: ticketsByBoard,
      tickets_created_today: tickets.filter((ticket) => new Date(ticket.entered_at) >= startOfToday).length,
      tickets_created_this_week: tickets.filter((ticket) => new Date(ticket.entered_at) >= startOfWeek).length,
      tickets_created_this_month: tickets.filter((ticket) => new Date(ticket.entered_at) >= startOfMonth).length,
    };
  }

  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.list || 'read');

          let validatedQuery = {};
          if (this.options.querySchema) {
            validatedQuery = this.validateQuery(apiRequest, this.options.querySchema);
          }

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

          const knex = await getConnection(apiRequest.context.tenant);
          const authorizedPage = await buildAuthorizationAwarePage<Record<string, any>>({
            page,
            limit,
            fetchPage: (sourcePage, sourceLimit) =>
              this.ticketService.list({ page: sourcePage, limit: sourceLimit, filters, sort, order }, apiRequest.context),
            authorizeRecord: (ticket) =>
              authorizeApiResourceRead({
                knex,
                tenant: apiRequest.context.tenant,
                user: apiRequest.context.user,
                apiKeyId: apiRequest.context.apiKeyId,
                resource: 'ticket',
                recordContext: this.buildTicketRecordContext(ticket),
              }),
            scanLimit: 100,
          });

          return createPaginatedResponse(
            authorizedPage.data,
            authorizedPage.total,
            page,
            limit,
            { sort, order, filters },
            apiRequest
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  getById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');
          const id = await this.extractIdFromPath(apiRequest);
          const ticket = await this.assertTicketReadAllowed(apiRequest, id);

          return createSuccessResponse(ticket, 200, undefined, apiRequest as AuthenticatedApiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          const knex = await getConnection(apiRequest.context!.tenant);
          const result = await this.ticketService.search(
            validatedQuery,
            apiRequest.context!
          );
          const authorizedResult = await this.filterAuthorizedTickets(
            apiRequest,
            result as Record<string, any>[],
            knex,
          );

          return createSuccessResponse(authorizedResult);
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
          user,
          apiKeyId: keyRecord.api_key_id,
        };

        // Run within tenant context
        return await runWithTenant(tenantId!, async () => {
          // Check permissions
          const hasAccess = await hasPermission(user, 'ticket', 'read');
          if (!hasAccess) {
            throw new ForbiddenError('Permission denied: Cannot read ticket');
          }

          const knex = await getConnection(apiRequest.context!.tenant);
          const authorizedTickets = await this.listAllAuthorizedTickets(apiRequest, knex);
          const stats = this.buildTicketStatsFromAuthorizedRows(authorizedTickets);

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
          user,
          apiKeyId: keyRecord.api_key_id,
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

          const contentFormatRaw = searchParams.get('content_format');
          let contentFormat: 'full' | 'markdown' | undefined;
          if (contentFormatRaw !== null) {
            if (contentFormatRaw !== 'full' && contentFormatRaw !== 'markdown') {
              throw new ValidationError('Validation failed', [
                { path: ['content_format'], message: "content_format must be 'full' or 'markdown'" }
              ]);
            }
            contentFormat = contentFormatRaw;
          }

          const ticketId = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);

          const comments = await this.ticketService.getTicketComments(
            ticketId,
            apiRequest.context!,
            { limit, offset, order, contentFormat }
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
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);
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
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);
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
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);

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
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);

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
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);
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
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);
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
          user,
          apiKeyId: keyRecord.api_key_id,
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
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);
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
          user,
          apiKeyId: keyRecord.api_key_id,
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
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);
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
          user,
          apiKeyId: keyRecord.api_key_id,
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
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);
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
          user,
          apiKeyId: keyRecord.api_key_id,
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
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);
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

  update() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, id, knex);

          const data = this.options.updateSchema
            ? await this.validateData(apiRequest, this.options.updateSchema)
            : await apiRequest.json();

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

  delete() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.delete || 'delete');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, id, knex);

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
          user,
          apiKeyId: keyRecord.api_key_id,
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
