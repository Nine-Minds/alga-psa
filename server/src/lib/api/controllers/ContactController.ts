/**
 * Contact Controller
 * Handles contact-related API endpoints
 */

import { NextRequest } from 'next/server';
import { BaseController } from './BaseController';
import { ContactService } from '../services/ContactService';
import { 
  createContactSchema,
  updateContactSchema,
  contactListQuerySchema,
  contactSearchSchema,
  contactExportQuerySchema,
  CreateContactData,
  UpdateContactData,
  ContactSearchData,
  ContactExportQuery
} from '../schemas/contact';
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

export class ContactController extends BaseController {
  private contactService: ContactService;

  constructor() {
    const contactService = new ContactService();
    
    super(contactService, {
      resource: 'contact',
      createSchema: createContactSchema,
      updateSchema: updateContactSchema,
      querySchema: contactListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });

    this.contactService = contactService;
    this.registerEndpoints();
  }

  /**
   * Register endpoints with metadata system
   */
  private registerEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/contacts',
      method: 'GET',
      resource: 'contact',
      action: 'list',
      description: 'List contacts with filtering and pagination',
      permissions: { resource: 'contact', action: 'read' },
      querySchema: contactListQuerySchema,
      tags: ['contacts']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/contacts',
      method: 'POST',
      resource: 'contact',
      action: 'create',
      description: 'Create a new contact',
      permissions: { resource: 'contact', action: 'create' },
      requestSchema: createContactSchema,
      tags: ['contacts']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/contacts/{id}',
      method: 'GET',
      resource: 'contact',
      action: 'read',
      description: 'Get contact details by ID',
      permissions: { resource: 'contact', action: 'read' },
      tags: ['contacts']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/contacts/{id}',
      method: 'PUT',
      resource: 'contact',
      action: 'update',
      description: 'Update contact information',
      permissions: { resource: 'contact', action: 'update' },
      requestSchema: updateContactSchema,
      tags: ['contacts']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/contacts/{id}',
      method: 'DELETE',
      resource: 'contact',
      action: 'delete',
      description: 'Delete a contact',
      permissions: { resource: 'contact', action: 'delete' },
      tags: ['contacts']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/contacts/search',
      method: 'GET',
      resource: 'contact',
      action: 'read',
      description: 'Search contacts with advanced options',
      permissions: { resource: 'contact', action: 'read' },
      querySchema: contactSearchSchema,
      tags: ['contacts', 'search']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/contacts/export',
      method: 'GET',
      resource: 'contact',
      action: 'read',
      description: 'Export contacts to CSV or JSON',
      permissions: { resource: 'contact', action: 'read' },
      querySchema: contactExportQuerySchema,
      tags: ['contacts', 'export']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/contacts/stats',
      method: 'GET',
      resource: 'contact',
      action: 'read',
      description: 'Get contact statistics',
      permissions: { resource: 'contact', action: 'read' },
      tags: ['contacts', 'statistics']
    });
  }

  /**
   * GET /api/v1/contacts/search - Advanced contact search
   */
  searchContacts() {
    const middleware = compose(
      withAuth,
      withPermission('contact', 'read'),
      withQueryValidation(contactSearchSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: ContactSearchData) => {
      const contacts = await this.contactService.search(validatedQuery, req.context!);
      
      return createSuccessResponse(contacts, 200, {
        query: validatedQuery.query,
        total_results: contacts.length,
        search_fields: validatedQuery.fields
      });
    });
  }

  /**
   * GET /api/v1/contacts/export - Export contacts
   */
  exportContacts() {
    const middleware = compose(
      withAuth,
      withPermission('contact', 'read'),
      withQueryValidation(contactExportQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: ContactExportQuery) => {
      const url = new URL(req.url);
      const filters: any = {};
      
      // Extract filter parameters
      url.searchParams.forEach((value, key) => {
        if (!['format', 'include_inactive', 'fields'].includes(key)) {
          filters[key] = value;
        }
      });

      const exportData = await this.contactService.exportContacts(
        filters,
        validatedQuery.format || 'csv',
        req.context!
      );

      const contentType = validatedQuery.format === 'json' 
        ? 'application/json' 
        : 'text/csv';
      
      const filename = `contacts_export_${new Date().toISOString().split('T')[0]}.${validatedQuery.format || 'csv'}`;

      return new Response(exportData, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      });
    });
  }

  /**
   * GET /api/v1/contacts/stats - Get contact statistics
   */
  getContactStats() {
    const middleware = compose(
      withAuth,
      withPermission('contact', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const stats = await this.contactService.getContactStats(req.context!);
      return createSuccessResponse(stats);
    });
  }

  /**
   * Enhanced list method with additional metadata
   */
  list() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.list || 'read'),
      withQueryValidation(contactListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      const sort = url.searchParams.get('sort') || 'full_name';
      const order = (url.searchParams.get('order') || 'asc') as 'asc' | 'desc';

      const filters = { ...validatedQuery };
      delete filters.page;
      delete filters.limit;
      delete filters.sort;
      delete filters.order;

      const listOptions = { page, limit, filters, sort, order };
      const result = await this.contactService.list(listOptions, req.context!);
      
      return createPaginatedResponse(
        result.data,
        result.total,
        page,
        limit,
        {
          sort,
          order,
          filters,
          resource: 'contact'
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
      const contact = await this.contactService.getById(id, req.context!);
      
      if (!contact) {
        throw new NotFoundError('Contact not found');
      }

      // Add HATEOAS links
      const links: any = {
        self: `/api/v1/contacts/${id}`,
        edit: `/api/v1/contacts/${id}`,
        delete: `/api/v1/contacts/${id}`,
        collection: '/api/v1/contacts'
      };

      // Add company link if contact has a company
      if (contact.company_id) {
        links.company = `/api/v1/companies/${contact.company_id}`;
      }

      return createSuccessResponse({ ...contact, _links: links });
    });
  }

  /**
   * Enhanced create with additional processing
   */
  create() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.create || 'create'),
      withValidation(createContactSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateContactData) => {
      const contact = await this.contactService.createContact(validatedData, req.context!);
      
      // Add HATEOAS links
      const links: any = {
        self: `/api/v1/contacts/${contact.contact_name_id}`,
        edit: `/api/v1/contacts/${contact.contact_name_id}`,
        collection: '/api/v1/contacts'
      };

      if (contact.company_id) {
        links.company = `/api/v1/companies/${contact.company_id}`;
      }

      return createSuccessResponse({ ...contact, _links: links }, 201);
    });
  }

  /**
   * Enhanced update with additional processing  
   */
  update() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.update || 'update'),
      withValidation(updateContactSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateContactData) => {
      const id = this.extractIdFromPath(req);
      const contact = await this.contactService.update(id, validatedData, req.context!);
      
      // Add HATEOAS links
      const links: any = {
        self: `/api/v1/contacts/${id}`,
        edit: `/api/v1/contacts/${id}`,
        collection: '/api/v1/contacts'
      };

      if (contact.company_id) {
        links.company = `/api/v1/companies/${contact.company_id}`;
      }

      return createSuccessResponse({ ...contact, _links: links });
    });
  }
}