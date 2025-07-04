/**
 * API Base Controller Class
 * Enhanced version that uses improved API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodSchema } from 'zod';
import { BaseController, BaseService, CrudOptions } from './BaseController';
import { withApiKeyAuth } from '../middleware/apiAuthMiddleware';
import { 
  withPermission, 
  withValidation, 
  withQueryValidation,
  createSuccessResponse,
  createPaginatedResponse,
  NotFoundError,
  ApiRequest,
  compose
} from '../middleware/apiMiddleware';

/**
 * Enhanced base controller that uses API key authentication
 */
export abstract class ApiBaseController extends BaseController {
  constructor(service: BaseService, options: CrudOptions) {
    super(service, options);
  }

  /**
   * Override list method to use API key auth
   */
  list() {
    const middleware = compose(
      withApiKeyAuth,
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

      const listOptions = {
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
   * Override get method to use API key auth
   */
  get() {
    const middleware = compose(
      withApiKeyAuth,
      withPermission(this.options.resource, this.options.permissions?.read || 'read')
    );

    return middleware(async (req: ApiRequest, params: { id: string }) => {
      const resource = await this.service.getById(params.id, req.context);
      
      if (!resource) {
        throw new NotFoundError(`${this.options.resource} not found`);
      }
      
      return createSuccessResponse(resource);
    });
  }

  /**
   * Override create method to use API key auth
   */
  create() {
    const middleware = compose(
      withApiKeyAuth,
      withPermission(this.options.resource, this.options.permissions?.create || 'create'),
      this.options.createSchema ? withValidation(this.options.createSchema) : (handler: any) => handler
    );

    return middleware(async (req: ApiRequest, validatedData?: any) => {
      const data = validatedData || await req.json();
      const created = await this.service.create(data, req.context);
      
      return createSuccessResponse(created, 201);
    });
  }

  /**
   * Override update method to use API key auth
   */
  update() {
    const middleware = compose(
      withApiKeyAuth,
      withPermission(this.options.resource, this.options.permissions?.update || 'update'),
      this.options.updateSchema ? withValidation(this.options.updateSchema) : (handler: any) => handler
    );

    return middleware(async (req: ApiRequest, validatedData?: any, params?: { id: string }) => {
      const data = validatedData || await req.json();
      const updated = await this.service.update(params!.id, data, req.context);
      
      if (!updated) {
        throw new NotFoundError(`${this.options.resource} not found`);
      }
      
      return createSuccessResponse(updated);
    });
  }

  /**
   * Override delete method to use API key auth
   */
  delete() {
    const middleware = compose(
      withApiKeyAuth,
      withPermission(this.options.resource, this.options.permissions?.delete || 'delete')
    );

    return middleware(async (req: ApiRequest, params: { id: string }) => {
      const resource = await this.service.getById(params.id, req.context);
      
      if (!resource) {
        throw new NotFoundError(`${this.options.resource} not found`);
      }
      
      await this.service.delete(params.id, req.context);
      
      return new NextResponse(null, { status: 204 });
    });
  }
}