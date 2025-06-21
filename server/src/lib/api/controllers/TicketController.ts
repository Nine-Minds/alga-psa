/**
 * Ticket Controller
 * Handles ticket-related API endpoints
 */

import { NextRequest } from 'next/server';
import { BaseController } from './BaseController';
import { TicketService } from '../services/TicketService';
import { 
  createTicketSchema,
  updateTicketSchema,
  ticketListQuerySchema,
  ticketSearchSchema,
  createTicketCommentSchema,
  updateTicketStatusSchema,
  updateTicketAssignmentSchema,
  createTicketFromAssetSchema,
  CreateTicketData,
  UpdateTicketData,
  TicketSearchData,
  CreateTicketCommentData,
  CreateTicketFromAssetData
} from '../schemas/ticket';
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

export class TicketController extends BaseController {
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
    this.registerEndpoints();
  }

  /**
   * Register endpoints with metadata system
   */
  private registerEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/tickets',
      method: 'GET',
      resource: 'ticket',
      action: 'list',
      description: 'List tickets with advanced filtering',
      permissions: { resource: 'ticket', action: 'read' },
      querySchema: ticketListQuerySchema,
      tags: ['tickets']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tickets',
      method: 'POST',
      resource: 'ticket',
      action: 'create',
      description: 'Create a new ticket',
      permissions: { resource: 'ticket', action: 'create' },
      requestSchema: createTicketSchema,
      tags: ['tickets']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tickets/{id}',
      method: 'GET',
      resource: 'ticket',
      action: 'read',
      description: 'Get ticket details by ID',
      permissions: { resource: 'ticket', action: 'read' },
      tags: ['tickets']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tickets/{id}',
      method: 'PUT',
      resource: 'ticket',
      action: 'update',
      description: 'Update ticket information',
      permissions: { resource: 'ticket', action: 'update' },
      requestSchema: updateTicketSchema,
      tags: ['tickets']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tickets/{id}',
      method: 'DELETE',
      resource: 'ticket',
      action: 'delete',
      description: 'Delete a ticket',
      permissions: { resource: 'ticket', action: 'delete' },
      tags: ['tickets']
    });

    // Ticket-specific endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/tickets/search',
      method: 'GET',
      resource: 'ticket',
      action: 'read',
      description: 'Search tickets with advanced criteria',
      permissions: { resource: 'ticket', action: 'read' },
      querySchema: ticketSearchSchema,
      tags: ['tickets', 'search']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tickets/stats',
      method: 'GET',
      resource: 'ticket',
      action: 'read',
      description: 'Get ticket statistics',
      permissions: { resource: 'ticket', action: 'read' },
      tags: ['tickets', 'statistics']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tickets/from-asset',
      method: 'POST',
      resource: 'ticket',
      action: 'create',
      description: 'Create ticket from asset',
      permissions: { resource: 'ticket', action: 'create' },
      requestSchema: createTicketFromAssetSchema,
      tags: ['tickets', 'assets']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tickets/{id}/comments',
      method: 'GET',
      resource: 'ticket',
      action: 'read',
      description: 'Get ticket comments',
      permissions: { resource: 'ticket', action: 'read' },
      tags: ['tickets', 'comments']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tickets/{id}/comments',
      method: 'POST',
      resource: 'ticket',
      action: 'update',
      description: 'Add comment to ticket',
      permissions: { resource: 'ticket', action: 'update' },
      requestSchema: createTicketCommentSchema,
      tags: ['tickets', 'comments']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tickets/{id}/status',
      method: 'PUT',
      resource: 'ticket',
      action: 'update',
      description: 'Update ticket status',
      permissions: { resource: 'ticket', action: 'update' },
      requestSchema: updateTicketStatusSchema,
      tags: ['tickets', 'status']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/tickets/{id}/assignment',
      method: 'PUT',
      resource: 'ticket',
      action: 'update',
      description: 'Update ticket assignment',
      permissions: { resource: 'ticket', action: 'update' },
      requestSchema: updateTicketAssignmentSchema,
      tags: ['tickets', 'assignment']
    });
  }

  /**
   * GET /api/v1/tickets/search - Advanced ticket search
   */
  searchTickets() {
    const middleware = compose(
      withAuth,
      withPermission('ticket', 'read'),
      withQueryValidation(ticketSearchSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: TicketSearchData) => {
      const tickets = await this.ticketService.search(validatedQuery, req.context!);
      
      return createSuccessResponse(tickets, 200, {
        query: validatedQuery.query,
        total_results: tickets.length,
        search_fields: validatedQuery.fields,
        filters_applied: {
          include_closed: validatedQuery.include_closed,
          status_ids: validatedQuery.status_ids,
          priority_ids: validatedQuery.priority_ids,
          company_ids: validatedQuery.company_ids,
          assigned_to_ids: validatedQuery.assigned_to_ids
        }
      });
    });
  }

  /**
   * GET /api/v1/tickets/stats - Get ticket statistics
   */
  getTicketStats() {
    const middleware = compose(
      withAuth,
      withPermission('ticket', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const stats = await this.ticketService.getTicketStats(req.context!);
      return createSuccessResponse(stats);
    });
  }

  /**
   * POST /api/v1/tickets/from-asset - Create ticket from asset
   */
  createTicketFromAsset() {
    const middleware = compose(
      withAuth,
      withPermission('ticket', 'create'),
      withValidation(createTicketFromAssetSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateTicketFromAssetData) => {
      const ticket = await this.ticketService.createFromAsset(validatedData, req.context!);
      
      // Add HATEOAS links
      const links = {
        self: `/api/v1/tickets/${ticket.ticket_id}`,
        edit: `/api/v1/tickets/${ticket.ticket_id}`,
        comments: `/api/v1/tickets/${ticket.ticket_id}/comments`,
        company: `/api/v1/companies/${ticket.company_id}`,
        asset: `/api/v1/assets/${validatedData.asset_id}`,
        collection: '/api/v1/tickets'
      };

      return createSuccessResponse({ ...ticket, _links: links }, 201);
    });
  }

  /**
   * GET /api/v1/tickets/{id}/comments - Get ticket comments
   */
  getTicketComments() {
    const middleware = compose(
      withAuth,
      withPermission('ticket', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const ticketId = this.extractIdFromPath(req);
      const comments = await this.ticketService.getTicketComments(ticketId, req.context!);
      
      return createSuccessResponse(comments);
    });
  }

  /**
   * POST /api/v1/tickets/{id}/comments - Add comment to ticket
   */
  addTicketComment() {
    const middleware = compose(
      withAuth,
      withPermission('ticket', 'update'),
      withValidation(createTicketCommentSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateTicketCommentData) => {
      const ticketId = this.extractIdFromPath(req);
      const comment = await this.ticketService.addComment(ticketId, validatedData, req.context!);
      
      return createSuccessResponse(comment, 201);
    });
  }

  /**
   * PUT /api/v1/tickets/{id}/status - Update ticket status
   */
  updateTicketStatus() {
    const middleware = compose(
      withAuth,
      withPermission('ticket', 'update'),
      withValidation(updateTicketStatusSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const ticketId = this.extractIdFromPath(req);
      
      // Prepare update data with status change
      const updateData = {
        status_id: validatedData.status_id,
        ...(validatedData.closed_at && { closed_at: validatedData.closed_at }),
        ...(validatedData.closed_by && { closed_by: validatedData.closed_by })
      };

      const ticket = await this.ticketService.update(ticketId, updateData, req.context!);
      
      // Add HATEOAS links
      const links = {
        self: `/api/v1/tickets/${ticketId}`,
        edit: `/api/v1/tickets/${ticketId}`,
        comments: `/api/v1/tickets/${ticketId}/comments`,
        collection: '/api/v1/tickets'
      };

      return createSuccessResponse({ ...ticket, _links: links });
    });
  }

  /**
   * PUT /api/v1/tickets/{id}/assignment - Update ticket assignment
   */
  updateTicketAssignment() {
    const middleware = compose(
      withAuth,
      withPermission('ticket', 'update'),
      withValidation(updateTicketAssignmentSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const ticketId = this.extractIdFromPath(req);
      const ticket = await this.ticketService.update(ticketId, validatedData, req.context!);
      
      // Add HATEOAS links
      const links = {
        self: `/api/v1/tickets/${ticketId}`,
        edit: `/api/v1/tickets/${ticketId}`,
        collection: '/api/v1/tickets'
      };

      if (ticket.assigned_to) {
        links.assignee = `/api/v1/users/${ticket.assigned_to}`;
      }

      return createSuccessResponse({ ...ticket, _links: links });
    });
  }

  /**
   * Enhanced list method with additional metadata
   */
  list() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.list || 'read'),
      withQueryValidation(ticketListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      const sort = url.searchParams.get('sort') || 'entered_at';
      const order = (url.searchParams.get('order') || 'desc') as 'asc' | 'desc';

      const filters = { ...validatedQuery };
      delete filters.page;
      delete filters.limit;
      delete filters.sort;
      delete filters.order;

      const listOptions = { page, limit, filters, sort, order };
      const result = await this.ticketService.list(listOptions, req.context!);
      
      return createPaginatedResponse(
        result.data,
        result.total,
        page,
        limit,
        {
          sort,
          order,
          filters,
          resource: 'ticket'
        }
      );
    });
  }

  /**
   * Enhanced getById with additional data
   */
  getById() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.read || 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      const ticket = await this.ticketService.getById(id, req.context!);
      
      if (!ticket) {
        throw new NotFoundError('Ticket not found');
      }

      // Add HATEOAS links
      const links = {
        self: `/api/v1/tickets/${id}`,
        edit: `/api/v1/tickets/${id}`,
        delete: `/api/v1/tickets/${id}`,
        comments: `/api/v1/tickets/${id}/comments`,
        status: `/api/v1/tickets/${id}/status`,
        assignment: `/api/v1/tickets/${id}/assignment`,
        company: `/api/v1/companies/${ticket.company_id}`,
        collection: '/api/v1/tickets'
      };

      // Add conditional links
      if (ticket.contact_name_id) {
        links.contact = `/api/v1/contacts/${ticket.contact_name_id}`;
      }

      if (ticket.assigned_to) {
        links.assignee = `/api/v1/users/${ticket.assigned_to}`;
      }

      return createSuccessResponse({ ...ticket, _links: links });
    });
  }

  /**
   * Enhanced create with additional processing
   */
  create() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.create || 'create'),
      withValidation(createTicketSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateTicketData) => {
      const ticket = await this.ticketService.create(validatedData, req.context!);
      
      // Add HATEOAS links
      const links = {
        self: `/api/v1/tickets/${ticket.ticket_id}`,
        edit: `/api/v1/tickets/${ticket.ticket_id}`,
        comments: `/api/v1/tickets/${ticket.ticket_id}/comments`,
        company: `/api/v1/companies/${ticket.company_id}`,
        collection: '/api/v1/tickets'
      };

      return createSuccessResponse({ ...ticket, _links: links }, 201);
    });
  }

  /**
   * Enhanced update with additional processing  
   */
  update() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.update || 'update'),
      withValidation(updateTicketSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateTicketData) => {
      const id = this.extractIdFromPath(req);
      const ticket = await this.ticketService.update(id, validatedData, req.context!);
      
      // Add HATEOAS links
      const links = {
        self: `/api/v1/tickets/${id}`,
        edit: `/api/v1/tickets/${id}`,
        comments: `/api/v1/tickets/${id}/comments`,
        collection: '/api/v1/tickets'
      };

      return createSuccessResponse({ ...ticket, _links: links });
    });
  }
}