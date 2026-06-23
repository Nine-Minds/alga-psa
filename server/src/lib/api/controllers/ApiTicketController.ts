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
  createTicketFromAssetSchema,
  linkTicketAssetSchema
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
import { authorizeApiResourceRead, buildAuthorizationPrincipalSubject } from './authorizationKernel';
import { buildAuthorizationAwarePage } from '@alga-psa/authorization/pagination';
import { compileResourceReadAuthorizationSql } from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import { createTicketRelationshipSqlAdapter } from '@alga-psa/tickets/lib/ticketAuthorizationSql';
import type { Knex } from 'knex';
import { fetchTimeEntriesForTicketCore } from '@alga-psa/scheduling/actions/timeEntryTicketActions';
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
import {
  createBundleSchema,
  addBundleChildrenSchema,
  promoteBundleMasterSchema,
  updateBundleSettingsSchema
} from '../schemas/ticketBundle';
import { ZodError } from 'zod';

// Resolve a read-authorization predicate that mirrors the global authorization
// kernel for ticket:read (no built-in relationship rules; bundle narrowing only —
// empty in CE, populated in EE). Returns null when a rule isn't representable in
// SQL so the caller falls back to the per-row JS kernel. RBAC is gated upstream
// by checkPermission('read'), exactly as the per-row path relies on.
async function resolveTicketReadAuthorizationApplier(
  apiRequest: AuthenticatedApiRequest,
  knex: Knex
): Promise<((query: Knex.QueryBuilder) => void) | null> {
  const subject = buildAuthorizationPrincipalSubject(
    apiRequest.context.user,
    apiRequest.context.apiKeyId
  );
  subject.tenant = apiRequest.context.tenant;

  const bundleRules = await resolveBundleNarrowingRulesForEvaluation(knex, {
    subject,
    resource: { type: 'ticket', action: 'read' },
    knex,
  });
  const adapter = createTicketRelationshipSqlAdapter(knex, subject.tenant);
  const compile = (query: Knex.QueryBuilder) =>
    compileResourceReadAuthorizationSql(query, {
      resourceType: 'ticket',
      action: 'read',
      builtinRules: [],
      bundleRules,
      ctx: { subject, adapter },
    });

  // Probe representability on a throwaway builder before committing to SQL.
  if (!compile(knex('tickets as t').where('t.tenant', subject.tenant)).supported) {
    return null;
  }
  return (query: Knex.QueryBuilder) => {
    compile(query);
  };
}

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

  // A ticket is "assigned" only to its primary `assigned_to` for read authorization.
  // Do not trust `ticket_resources.additional_user_id` as a read grant because
  // time-entry workflows can create those rows without ticket row-level authorization.
  private buildTicketRecordContext(ticket: Record<string, any>) {
    const assignedUserIds = new Set<string>();
    if (typeof ticket.assigned_to === 'string') assignedUserIds.add(ticket.assigned_to);
    return {
      id: ticket.ticket_id,
      ownerUserId: typeof ticket.entered_by === 'string' ? ticket.entered_by : undefined,
      assignedUserIds: Array.from(assignedUserIds),
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

    const ticketRow = ticket as Record<string, any>;
    const allowed = await authorizeApiResourceRead({
      knex: resolvedKnex,
      tenant: apiRequest.context.tenant,
      user: apiRequest.context.user,
      apiKeyId: apiRequest.context.apiKeyId,
      resource: 'ticket',
      recordContext: this.buildTicketRecordContext(ticketRow),
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
          const fields = (url.searchParams.get('fields') || '')
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean);

          const filters: any = { ...validatedQuery };
          delete filters.page;
          delete filters.limit;
          delete filters.sort;
          delete filters.order;
          delete filters.fields;

          const knex = await getConnection(apiRequest.context.tenant);

          // Preferred path: push read-authorization into SQL so the database
          // paginates and counts only the authorized set (one data + one count
          // query, accurate total). RBAC was already enforced by checkPermission
          // above. Falls back to the per-row JS kernel when a narrowing rule
          // isn't representable in SQL.
          const applyAuthorization = await resolveTicketReadAuthorizationApplier(apiRequest, knex);
          if (applyAuthorization) {
            const authorizedResult = await this.ticketService.list(
              {
                page,
                limit,
                filters,
                sort,
                order,
                fields: fields.length > 0 ? fields : undefined,
                applyAuthorization,
              },
              apiRequest.context
            );

            return createPaginatedResponse(
              authorizedResult.data,
              authorizedResult.total,
              page,
              limit,
              { sort, order, filters },
              apiRequest
            );
          }

          const authorizedPage = await buildAuthorizationAwarePage<Record<string, any>>({
            page,
            limit,
            fetchPage: (sourcePage, sourceLimit) =>
              this.ticketService.list(
                { page: sourcePage, limit: sourceLimit, filters, sort, order, fields: fields.length > 0 ? fields : undefined },
                apiRequest.context
              ),
            authorizeRecord: async (ticket) => {
              return authorizeApiResourceRead({
                knex,
                tenant: apiRequest.context.tenant,
                user: apiRequest.context.user,
                apiKeyId: apiRequest.context.apiKeyId,
                resource: 'ticket',
                recordContext: this.buildTicketRecordContext(ticket),
              });
            },
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

        await this.assertProductApiAccess(apiRequest as AuthenticatedApiRequest);

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

        await this.assertProductApiAccess(apiRequest as AuthenticatedApiRequest);

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

        await this.assertProductApiAccess(apiRequest as AuthenticatedApiRequest);

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
   * Get assets linked to a ticket
   */
  getAssets() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');

          const ticketId = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);
          // Response exposes asset records, so also require asset:read.
          if (!(await hasPermission(apiRequest.context!.user!, 'asset', 'read', knex))) {
            throw new ForbiddenError('Permission denied: Cannot read asset');
          }
          const assets = await this.ticketService.getTicketAssets(ticketId, apiRequest.context!);

          return createSuccessResponse(assets, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Link an asset to a ticket
   */
  linkAsset() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          // Mutating the ticket's associations needs ticket:update; the asset is
          // only referenced, so asset:read is enough.
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');

          const ticketId = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);
          if (!(await hasPermission(apiRequest.context!.user!, 'asset', 'read', knex))) {
            throw new ForbiddenError('Permission denied: Cannot read asset');
          }

          const body = await req.json();
          const validation = linkTicketAssetSchema.safeParse(body);
          if (!validation.success) {
            throw new ValidationError('Validation failed', validation.error.errors);
          }

          const association = await this.ticketService.linkAsset(ticketId, validation.data, apiRequest.context!);

          return createSuccessResponse(association, 201, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Unlink an asset from a ticket
   */
  unlinkAsset() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');

          const ticketId = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);
          if (!(await hasPermission(apiRequest.context!.user!, 'asset', 'read', knex))) {
            throw new ForbiddenError('Permission denied: Cannot read asset');
          }

          // assetId is the path segment after "assets".
          const url = new URL(apiRequest.url || req.url);
          const segments = url.pathname.split('/');
          const assetsIndex = segments.indexOf('assets');
          const assetId = assetsIndex >= 0 ? segments[assetsIndex + 1] : undefined;

          if (!assetId) {
            throw new ValidationError('Validation failed', [
              { path: ['assetId'], message: 'asset ID is required' },
            ]);
          }

          await this.ticketService.unlinkAsset(ticketId, assetId, apiRequest.context!);

          return new NextResponse(null, { status: 204 });
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

          return createSuccessResponse(null, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get time entries logged on a ticket. Returns the caller's own entries and,
   * for callers with `timesheet:read_all`, full detail for other team members'
   * entries. Otherwise an aggregated count + total minutes is returned in lieu
   * of individual entries.
   */
  getTimeEntries() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');

          const ticketId = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context!.tenant);
          await this.assertTicketReadAllowed(apiRequest, ticketId, knex);

          const summary = await fetchTimeEntriesForTicketCore(
            apiRequest.context!.user!,
            apiRequest.context!.tenant,
            knex,
            ticketId,
          );

          return createSuccessResponse(summary, 200, undefined, apiRequest);
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

        await this.assertProductApiAccess(apiRequest as AuthenticatedApiRequest);

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

        await this.assertProductApiAccess(apiRequest as AuthenticatedApiRequest);

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

        await this.assertProductApiAccess(apiRequest as AuthenticatedApiRequest);

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

        await this.assertProductApiAccess(apiRequest as AuthenticatedApiRequest);

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

        await this.assertProductApiAccess(apiRequest as AuthenticatedApiRequest);

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

  // -------------------------------------------------------------------------
  // Ticket bundling
  // -------------------------------------------------------------------------

  /**
   * GET /api/v1/tickets/{id}/bundle - Get bundle membership for a ticket
   */
  getBundle() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          const ticketId = await this.extractIdFromPath(apiRequest);
          const bundle = await this.ticketService.getBundle(apiRequest.context, ticketId);
          return createSuccessResponse(bundle, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/tickets/{id}/bundle - Create a bundle with {id} as master
   */
  bundleTickets() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const masterTicketId = await this.extractIdFromPath(apiRequest);
          const data = await this.validateData(apiRequest, createBundleSchema);
          const result = await this.ticketService.bundleTickets(apiRequest.context, {
            masterTicketId,
            childTicketIds: data.child_ticket_ids,
            mode: data.mode,
          });
          return createSuccessResponse(result, 201, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * DELETE /api/v1/tickets/{id}/bundle - Unbundle the master {id}
   */
  unbundleMaster() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const masterTicketId = await this.extractIdFromPath(apiRequest);
          const result = await this.ticketService.unbundleMaster(apiRequest.context, { masterTicketId });
          return createSuccessResponse(result, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/tickets/{id}/bundle/children - Add children to the bundle
   */
  addBundleChildren() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const masterTicketId = await this.extractIdFromPath(apiRequest);
          const data = await this.validateData(apiRequest, addBundleChildrenSchema);
          const result = await this.ticketService.addBundleChildren(apiRequest.context, {
            masterTicketId,
            childTicketIds: data.child_ticket_ids,
          });
          return createSuccessResponse(result, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * DELETE /api/v1/tickets/{id}/bundle/children/{childId} - Remove a child
   */
  removeBundleChild() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const segments = new URL(req.url).pathname.split('/');
          const childrenIndex = segments.indexOf('children');
          const childTicketId = childrenIndex >= 0 ? segments[childrenIndex + 1] : undefined;
          if (!childTicketId) {
            throw new ValidationError('Validation failed', [
              { path: ['childId'], message: 'child ticket ID is required' },
            ]);
          }
          const result = await this.ticketService.removeBundleChild(apiRequest.context, { childTicketId });
          return createSuccessResponse(result, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/tickets/{id}/bundle/promote - Promote a child to master
   */
  promoteBundleMaster() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const oldMasterTicketId = await this.extractIdFromPath(apiRequest);
          const data = await this.validateData(apiRequest, promoteBundleMasterSchema);
          const result = await this.ticketService.promoteBundleMaster(apiRequest.context, {
            oldMasterTicketId,
            newMasterTicketId: data.new_master_ticket_id,
          });
          return createSuccessResponse(result, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * PUT /api/v1/tickets/{id}/bundle/settings - Update bundle settings
   */
  updateBundleSettings() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const masterTicketId = await this.extractIdFromPath(apiRequest);
          const data = await this.validateData(apiRequest, updateBundleSettingsSchema);
          const result = await this.ticketService.updateBundleSettings(apiRequest.context, {
            masterTicketId,
            mode: data.mode,
            reopenOnChildReply: data.reopen_on_child_reply,
          });
          return createSuccessResponse(result, 200, undefined, apiRequest);
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
