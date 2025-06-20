/**
 * Company Controller
 * Handles company-related API endpoints
 */

import { NextRequest } from 'next/server';
import { BaseController } from './BaseController';
import { CompanyService } from '../services/CompanyService';
import { 
  createCompanySchema,
  updateCompanySchema,
  companyListQuerySchema,
  createCompanyLocationSchema,
  updateCompanyLocationSchema,
  CreateCompanyData,
  UpdateCompanyData,
  CreateCompanyLocationData,
  UpdateCompanyLocationData
} from '../schemas/company';
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

export class CompanyController extends BaseController {
  private companyService: CompanyService;

  constructor() {
    const companyService = new CompanyService();
    
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
    this.registerEndpoints();
  }

  /**
   * Register endpoints with metadata system
   */
  private registerEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/companies',
      method: 'GET',
      resource: 'company',
      action: 'list',
      description: 'List companies with filtering and pagination',
      permissions: { resource: 'company', action: 'read' },
      querySchema: companyListQuerySchema,
      tags: ['companies']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/companies',
      method: 'POST',
      resource: 'company',
      action: 'create',
      description: 'Create a new company',
      permissions: { resource: 'company', action: 'create' },
      requestSchema: createCompanySchema,
      tags: ['companies']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/companies/{id}',
      method: 'GET',
      resource: 'company',
      action: 'read',
      description: 'Get company details by ID',
      permissions: { resource: 'company', action: 'read' },
      tags: ['companies']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/companies/{id}',
      method: 'PUT',
      resource: 'company',
      action: 'update',
      description: 'Update company information',
      permissions: { resource: 'company', action: 'update' },
      requestSchema: updateCompanySchema,
      tags: ['companies']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/companies/{id}',
      method: 'DELETE',
      resource: 'company',
      action: 'delete',
      description: 'Delete a company',
      permissions: { resource: 'company', action: 'delete' },
      tags: ['companies']
    });

    // Company locations endpoints
    ApiRegistry.registerEndpoint({
      path: '/api/v1/companies/{id}/locations',
      method: 'GET',
      resource: 'company',
      action: 'read',
      description: 'List company locations',
      permissions: { resource: 'company', action: 'read' },
      tags: ['companies', 'locations']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/companies/{id}/locations',
      method: 'POST',
      resource: 'company',
      action: 'update',
      description: 'Create company location',
      permissions: { resource: 'company', action: 'update' },
      requestSchema: createCompanyLocationSchema,
      tags: ['companies', 'locations']
    });

    // Stats endpoint
    ApiRegistry.registerEndpoint({
      path: '/api/v1/companies/stats',
      method: 'GET',
      resource: 'company',
      action: 'read',
      description: 'Get company statistics',
      permissions: { resource: 'company', action: 'read' },
      tags: ['companies', 'statistics']
    });
  }

  /**
   * GET /api/v1/companies/{id}/locations - Get company locations
   */
  getCompanyLocations() {
    const middleware = compose(
      withAuth,
      withPermission('company', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const companyId = this.extractIdFromPath(req);
      const locations = await this.companyService.getCompanyLocations(companyId, req.context!);
      
      return createSuccessResponse(locations);
    });
  }

  /**
   * POST /api/v1/companies/{id}/locations - Create company location
   */
  createCompanyLocation() {
    const middleware = compose(
      withAuth,
      withPermission('company', 'update'),
      withValidation(createCompanyLocationSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateCompanyLocationData) => {
      const companyId = this.extractIdFromPath(req);
      const location = await this.companyService.createLocation(companyId, validatedData, req.context!);
      
      return createSuccessResponse(location, 201);
    });
  }

  /**
   * PUT /api/v1/companies/{companyId}/locations/{locationId} - Update company location
   */
  updateCompanyLocation() {
    const middleware = compose(
      withAuth,
      withPermission('company', 'update'),
      withValidation(updateCompanyLocationSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateCompanyLocationData) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const companyId = pathParts[4]; // /api/v1/companies/{id}/locations/{locationId}
      const locationId = pathParts[6];

      const location = await this.companyService.updateLocation(
        companyId, 
        locationId, 
        validatedData, 
        req.context!
      );
      
      return createSuccessResponse(location);
    });
  }

  /**
   * DELETE /api/v1/companies/{companyId}/locations/{locationId} - Delete company location
   */
  deleteCompanyLocation() {
    const middleware = compose(
      withAuth,
      withPermission('company', 'update')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const companyId = pathParts[4];
      const locationId = pathParts[6];

      await this.companyService.deleteLocation(companyId, locationId, req.context!);
      
      return new Response(null, { status: 204 });
    });
  }

  /**
   * GET /api/v1/companies/stats - Get company statistics
   */
  getCompanyStats() {
    const middleware = compose(
      withAuth,
      withPermission('company', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const stats = await this.companyService.getCompanyStats(req.context!);
      return createSuccessResponse(stats);
    });
  }

  /**
   * GET /api/v1/companies/{id}/contacts - Get company contacts
   */
  getCompanyContacts() {
    const middleware = compose(
      withAuth,
      withPermission('contact', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const companyId = this.extractIdFromPath(req);
      
      // This would integrate with the ContactService when implemented
      // For now, return a placeholder
      return createSuccessResponse([]);
    });
  }

  /**
   * Enhanced list method with additional metadata
   */
  list() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.list || 'read'),
      withQueryValidation(companyListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      const sort = url.searchParams.get('sort') || 'company_name';
      const order = (url.searchParams.get('order') || 'asc') as 'asc' | 'desc';

      const filters = { ...validatedQuery };
      delete filters.page;
      delete filters.limit;
      delete filters.sort;
      delete filters.order;

      const listOptions = { page, limit, filters, sort, order };
      const result = await this.companyService.list(listOptions, req.context!);
      
      return createPaginatedResponse(
        result.data,
        result.total,
        page,
        limit,
        {
          sort,
          order,
          filters,
          resource: 'company'
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
      const company = await this.companyService.getById(id, req.context!);
      
      if (!company) {
        throw new NotFoundError('Company not found');
      }

      // Add HATEOAS links
      const links = {
        self: `/api/v1/companies/${id}`,
        edit: `/api/v1/companies/${id}`,
        delete: `/api/v1/companies/${id}`,
        locations: `/api/v1/companies/${id}/locations`,
        contacts: `/api/v1/companies/${id}/contacts`,
        collection: '/api/v1/companies'
      };

      return createSuccessResponse({ ...company, _links: links });
    });
  }

  /**
   * Enhanced create with additional processing
   */
  create() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.create || 'create'),
      withValidation(createCompanySchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateCompanyData) => {
      const company = await this.companyService.create(validatedData, req.context!);
      
      // Add HATEOAS links
      const links = {
        self: `/api/v1/companies/${company.company_id}`,
        edit: `/api/v1/companies/${company.company_id}`,
        locations: `/api/v1/companies/${company.company_id}/locations`,
        collection: '/api/v1/companies'
      };

      return createSuccessResponse({ ...company, _links: links }, 201);
    });
  }

  /**
   * Enhanced update with additional processing  
   */
  update() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.update || 'update'),
      withValidation(updateCompanySchema)
    );

    return middleware(async (req: ApiRequest, validatedData: UpdateCompanyData) => {
      const id = this.extractIdFromPath(req);
      const company = await this.companyService.update(id, validatedData, req.context!);
      
      // Add HATEOAS links
      const links = {
        self: `/api/v1/companies/${id}`,
        edit: `/api/v1/companies/${id}`,
        locations: `/api/v1/companies/${id}/locations`,
        collection: '/api/v1/companies'
      };

      return createSuccessResponse({ ...company, _links: links });
    });
  }
}