/**
 * Base Controller Class
 * Provides common CRUD operations and patterns for API controllers
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodSchema } from 'zod';
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

export interface CrudOptions {
  resource: string;
  createSchema?: ZodSchema;
  updateSchema?: ZodSchema;
  querySchema?: ZodSchema;
  permissions?: {
    create?: string;
    read?: string;
    update?: string;
    delete?: string;
    list?: string;
  };
}

export interface ListOptions {
  page?: number;
  limit?: number;
  filters?: Record<string, any>;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface BaseService {
  list(options: ListOptions, context: any): Promise<{ data: any[]; total: number }>;
  getById(id: string, context: any): Promise<any | null>;
  create(data: any, context: any): Promise<any>;
  update(id: string, data: any, context: any): Promise<any>;
  delete(id: string, context: any): Promise<void>;
}

export abstract class BaseController {
  protected service: BaseService;
  protected options: CrudOptions;

  constructor(service: BaseService, options: CrudOptions) {
    this.service = service;
    this.options = options;
  }

  /**
   * GET /api/v1/{resource} - List resources with pagination and filtering
   */
  list() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.list || 'read'),
      this.options.querySchema ? withQueryValidation(this.options.querySchema) : (handler: any) => handler
    );

    return middleware(async (req: ApiRequest, validatedQuery?: any) => {
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      const sort = url.searchParams.get('sort') || 'created_at';
      const order = (url.searchParams.get('order') || 'desc') as 'asc' | 'desc';

      const filters = validatedQuery || {};
      delete filters.page;
      delete filters.limit;
      delete filters.sort;
      delete filters.order;

      const listOptions: ListOptions = {
        page,
        limit,
        filters,
        sort,
        order
      };

      const result = await this.service.list(listOptions, req.context);
      
      return createPaginatedResponse(
        result.data,
        result.total,
        page,
        limit,
        {
          sort,
          order,
          filters
        }
      );
    });
  }

  /**
   * GET /api/v1/{resource}/{id} - Get single resource by ID
   */
  getById() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.read || 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const id = pathParts[pathParts.length - 1];

      const resource = await this.service.getById(id, req.context);
      
      if (!resource) {
        throw new NotFoundError(`${this.options.resource} not found`);
      }

      return createSuccessResponse(resource);
    });
  }

  /**
   * POST /api/v1/{resource} - Create new resource
   */
  create() {
    if (!this.options.createSchema) {
      throw new Error('Create schema required for create endpoint');
    }

    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.create || 'create'),
      withValidation(this.options.createSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const resource = await this.service.create(validatedData, req.context);
      return createSuccessResponse(resource, 201);
    });
  }

  /**
   * PUT /api/v1/{resource}/{id} - Update existing resource
   */
  update() {
    if (!this.options.updateSchema) {
      throw new Error('Update schema required for update endpoint');
    }

    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.update || 'update'),
      withValidation(this.options.updateSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const id = pathParts[pathParts.length - 1];

      const resource = await this.service.update(id, validatedData, req.context);
      return createSuccessResponse(resource);
    });
  }

  /**
   * DELETE /api/v1/{resource}/{id} - Delete resource
   */
  delete() {
    const middleware = compose(
      withAuth,
      withPermission(this.options.resource, this.options.permissions?.delete || 'delete')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const pathParts = url.pathname.split('/');
      const id = pathParts[pathParts.length - 1];

      await this.service.delete(id, req.context);
      return new NextResponse(null, { status: 204 });
    });
  }

  /**
   * Helper to extract ID from URL path
   */
  protected extractIdFromPath(req: ApiRequest): string {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    return pathParts[pathParts.length - 1];
  }

  /**
   * Helper to extract parent ID from nested routes
   */
  protected extractParentIdFromPath(req: ApiRequest, parentResource: string): string {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const parentIndex = pathParts.indexOf(parentResource);
    if (parentIndex === -1 || parentIndex + 1 >= pathParts.length) {
      throw new Error(`Parent ${parentResource} ID not found in path`);
    }
    return pathParts[parentIndex + 1];
  }
}

/**
 * CRUD Route Generator
 * Automatically generates standard CRUD routes for a controller
 */
export function createCrudRoutes(controller: BaseController) {
  return {
    GET: controller.list(),
    POST: controller.create()
  };
}

export function createResourceRoutes(controller: BaseController) {
  return {
    GET: controller.getById(),
    PUT: controller.update(),
    DELETE: controller.delete()
  };
}